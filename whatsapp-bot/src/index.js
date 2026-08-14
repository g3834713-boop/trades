import 'dotenv/config';
import { connectWhatsApp } from './whatsapp.js';
import { generateDailySchedule } from './scheduler.js';
import { pushScheduleSlot, getBeginnerTaskProducts, getTellerProducts, getTodaySlots } from './apiClient.js';
import { formatBeginnerTaskMessage, formatTellerTaskMessage } from './messageTemplates.js';
import { renderTaskNumberCard, renderTellerPackageCard } from './cardImage.js';
import { startHealthServer } from './healthServer.js';

// Baileys' low-level frame decoder can throw a raw, synchronous crypto exception
// (`Unsupported state or unable to authenticate data`) that no local try/catch can
// reach - confirmed live via a Render deploy log: it happens when a NEW deploy's
// process starts a fresh connection while the OLD deploy's process (kept alive by
// Render until the new one passes its health check) is still holding the same
// Postgres-backed WhatsApp session, desyncing the encrypted session between the two.
// Node's default behavior for an uncaught exception is to kill the whole process,
// which is exactly what turned this into a series of "Failed deploy"s - the health
// server (already listening by this point) never got the chance to pass Render's
// check. Catching it here and retrying the connection keeps the process (and health
// check) alive instead, so the deploy succeeds and the bot reconnects on its own
// once the old process is fully torn down.
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception (bot stays up, reconnecting in 10s):', err.message);
  setTimeout(() => {
    connectWhatsApp({ onReady: handleReady }).catch((connectErr) => {
      console.error('Reconnect attempt after uncaught exception failed:', connectErr.message);
    });
  }, 10000);
});

const TARGET_JID = process.env.WHATSAPP_TARGET_JID;
const MAX_RECENT_PRODUCTS = 3; // avoid repeating the same product too often in a row

let taskCounter = 0; // only ever used as a fallback if getTodaySlots() itself fails
let recentProductIds = [];

function pickBeginnerProduct(products) {
  const available = products.filter(p => !recentProductIds.includes(p.id));
  const pool = available.length ? available : products;
  const chosen = pool[Math.floor(Math.random() * pool.length)];
  recentProductIds.push(chosen.id);
  if (recentProductIds.length > MAX_RECENT_PRODUCTS) recentProductIds.shift();
  return chosen;
}

// Computed from what's actually been posted today (schedule_slots), not an in-memory
// counter - a counter resets to 0 on every process restart (Render free tier can sleep
// and restart mid-day even with a keep-alive pinger occasionally missing a beat), which
// was mislabeling whatever posted right after a restart as "Task #1" again.
async function getNextTaskNumber() {
  try {
    const todaySlots = await getTodaySlots();
    const maxNumber = todaySlots.reduce((max, s) => Math.max(max, s.details?.taskNumber || 0), 0);
    return maxNumber + 1;
  } catch (err) {
    console.error('Failed to compute next task number from schedule history, falling back to in-memory counter:', err.message);
    taskCounter += 1;
    return taskCounter;
  }
}

async function runSlot(sock, slot) {
  const taskNumber = await getNextTaskNumber();
  try {
    if (slot.type === 'beginner') {
      const products = await getBeginnerTaskProducts();
      if (!products.length) {
        console.warn('No active beginner-task products configured in admin - skipping this slot.');
        return;
      }
      const product = pickBeginnerProduct(products);
      const card = renderTaskNumberCard(taskNumber, 'Product Link Task');
      await sock.sendMessage(TARGET_JID, { image: card, caption: formatBeginnerTaskMessage(taskNumber, product) });
      await pushScheduleSlot({
        taskType: 'beginner',
        startsAt: slot.startsAt.toISOString(),
        endsAt: slot.endsAt.toISOString(),
        details: { taskNumber, productId: product.id, productTitle: product.title }
      });
    } else {
      const tellerProducts = await getTellerProducts();
      const card = renderTellerPackageCard(taskNumber, tellerProducts);
      await sock.sendMessage(TARGET_JID, { image: card, caption: formatTellerTaskMessage(taskNumber) });
      await pushScheduleSlot({
        taskType: 'teller',
        startsAt: slot.startsAt.toISOString(),
        endsAt: slot.endsAt.toISOString(),
        details: { taskNumber, packages: tellerProducts }
      });
    }
    console.log(`Posted Task #${taskNumber} (${slot.type}), live until ${slot.endsAt.toLocaleTimeString()}`);
  } catch (err) {
    console.error(`Failed to run slot #${taskNumber} (${slot.type}):`, err.message);
  }
}

let armedTimeouts = [];

function scheduleDay(sock) {
  // onReady can fire more than once (Baileys can reconnect multiple times in a row
  // during an unstable moment, or right around a deploy restart) - without cancelling
  // whatever a previous scheduleDay() call already armed, each fire would layer a
  // complete second full-day schedule on top of the first, posting duplicate/
  // overlapping slots. Confirmed live: a redeploy caused two different task types to
  // post 20 seconds apart, both claiming to start at the same moment.
  armedTimeouts.forEach(id => clearTimeout(id));
  armedTimeouts = [];

  taskCounter = 0;
  // Single timestamp reused for both startFrom and the delay math below - using two
  // separate `new Date()` calls a statement apart made the first slot's delay come out
  // marginally negative (generated a few ms before "now" was captured for the loop),
  // which the skip-check below then threw away immediately. That silently cancelled the
  // very slot this whole late-reconnect fix exists to fire.
  const now = new Date();
  // Passing "now" lets a late reconnect (e.g. woken up after 8am on Render's free tier)
  // start its first slot immediately instead of at 8am sharp - see scheduler.js.
  const slots = generateDailySchedule(now, now);
  console.log(`Generated ${slots.length} slot(s) for today (8am-6pm).`);

  const nowMs = now.getTime();
  for (const slot of slots) {
    const delay = slot.startsAt.getTime() - nowMs;
    if (delay < 0) continue; // slot already passed (e.g. bot started mid-day)
    armedTimeouts.push(setTimeout(() => runSlot(sock, slot), delay));
  }
}

function scheduleNextDayKickoff(sock) {
  const next8am = new Date();
  next8am.setHours(8, 0, 0, 0);
  if (next8am.getTime() <= Date.now()) next8am.setDate(next8am.getDate() + 1);

  setTimeout(() => {
    scheduleDay(sock);
    scheduleNextDayKickoff(sock);
  }, next8am.getTime() - Date.now());
}

const botState = { sock: null };

// Shared by the initial connect and any exception-triggered reconnect, so both go
// through the exact same "arm today's schedule" path (which is itself idempotent -
// see the armedTimeouts guard in scheduleDay()).
function handleReady(sock) {
  botState.sock = sock;
  if (TARGET_JID) {
    scheduleDay(sock);
    scheduleNextDayKickoff(sock);
  }
}

async function main() {
  if (!TARGET_JID) {
    console.warn('WHATSAPP_TARGET_JID is not set yet - connect once, then run `npm run list-groups` to find it.');
  }

  startHealthServer(undefined, botState);

  await connectWhatsApp({ onReady: handleReady });
}

main().catch((err) => {
  console.error('Fatal error starting bot:', err);
  process.exit(1);
});
