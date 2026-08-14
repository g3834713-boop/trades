import 'dotenv/config';
import { connectWhatsApp } from './whatsapp.js';
import { generateDailySchedule } from './scheduler.js';
import { pushScheduleSlot, getBeginnerTaskProducts, getTellerProducts, getTodaySlots } from './apiClient.js';
import { formatBeginnerTaskMessage, formatTellerTaskMessage } from './messageTemplates.js';
import { renderTaskNumberCard, renderTellerPackageCard } from './cardImage.js';
import { startHealthServer } from './healthServer.js';

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

function scheduleDay(sock) {
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
    setTimeout(() => runSlot(sock, slot), delay);
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

async function main() {
  if (!TARGET_JID) {
    console.warn('WHATSAPP_TARGET_JID is not set yet - connect once, then run `npm run list-groups` to find it.');
  }

  const botState = { sock: null };
  startHealthServer(undefined, botState);

  await connectWhatsApp({
    onReady: (sock) => {
      botState.sock = sock;
      if (TARGET_JID) {
        scheduleDay(sock);
        scheduleNextDayKickoff(sock);
      }
    }
  });
}

main().catch((err) => {
  console.error('Fatal error starting bot:', err);
  process.exit(1);
});
