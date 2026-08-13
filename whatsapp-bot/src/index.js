import 'dotenv/config';
import { connectWhatsApp } from './whatsapp.js';
import { generateDailySchedule } from './scheduler.js';
import { pushScheduleSlot, getBeginnerTaskProducts, getTellerProducts } from './apiClient.js';
import { formatBeginnerTaskMessage, formatTellerTaskMessage } from './messageTemplates.js';
import { renderTaskNumberCard, renderTellerPackageCard } from './cardImage.js';
import { startHealthServer } from './healthServer.js';

const TARGET_JID = process.env.WHATSAPP_TARGET_JID;
const MAX_RECENT_PRODUCTS = 3; // avoid repeating the same product too often in a row

let taskCounter = 0;
let recentProductIds = [];

function pickBeginnerProduct(products) {
  const available = products.filter(p => !recentProductIds.includes(p.id));
  const pool = available.length ? available : products;
  const chosen = pool[Math.floor(Math.random() * pool.length)];
  recentProductIds.push(chosen.id);
  if (recentProductIds.length > MAX_RECENT_PRODUCTS) recentProductIds.shift();
  return chosen;
}

async function runSlot(sock, slot) {
  taskCounter += 1;
  try {
    if (slot.type === 'beginner') {
      const products = await getBeginnerTaskProducts();
      if (!products.length) {
        console.warn('No active beginner-task products configured in admin - skipping this slot.');
        return;
      }
      const product = pickBeginnerProduct(products);
      const card = renderTaskNumberCard(taskCounter, 'Product Link Task');
      await sock.sendMessage(TARGET_JID, { image: card, caption: formatBeginnerTaskMessage(taskCounter, product) });
      await pushScheduleSlot({
        taskType: 'beginner',
        startsAt: slot.startsAt.toISOString(),
        endsAt: slot.endsAt.toISOString(),
        details: { taskNumber: taskCounter, productId: product.id, productTitle: product.title }
      });
    } else {
      const tellerProducts = await getTellerProducts();
      const card = renderTellerPackageCard(taskCounter, tellerProducts);
      await sock.sendMessage(TARGET_JID, { image: card, caption: formatTellerTaskMessage(taskCounter, tellerProducts) });
      await pushScheduleSlot({
        taskType: 'teller',
        startsAt: slot.startsAt.toISOString(),
        endsAt: slot.endsAt.toISOString(),
        details: { taskNumber: taskCounter, packages: tellerProducts }
      });
    }
    console.log(`Posted Task #${taskCounter} (${slot.type}), live until ${slot.endsAt.toLocaleTimeString()}`);
  } catch (err) {
    console.error(`Failed to run slot #${taskCounter} (${slot.type}):`, err.message);
  }
}

function scheduleDay(sock) {
  taskCounter = 0;
  const slots = generateDailySchedule();
  console.log(`Generated ${slots.length} slot(s) for today (8am-6pm).`);

  const now = Date.now();
  for (const slot of slots) {
    const delay = slot.startsAt.getTime() - now;
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
