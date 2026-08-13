import http from 'http';
import { renderTaskNumberCard, renderTellerPackageCard } from './cardImage.js';
import { formatBeginnerTaskMessage, formatTellerTaskMessage } from './messageTemplates.js';
import { getBeginnerTaskProducts, getTellerProducts } from './apiClient.js';

const SCHEDULER_KEY = process.env.SCHEDULER_API_KEY;
const TARGET_JID = process.env.WHATSAPP_TARGET_JID;

// A minimal HTTP server, just so this can be deployed as a Render web service (which
// requires binding to $PORT) and so an external uptime pinger (e.g. UptimeRobot,
// cron-job.org - free tier is fine) has something to hit every ~10 minutes to stop
// the free tier from idling out and dropping the WhatsApp connection.
//
// Also exposes POST /debug/test-send?type=ok|beginner|teller, guarded by the same
// X-Scheduler-Key used for the schedule-push API. It sends a one-off test card through
// the socket this process is ALREADY connected with (not a second session), so it can
// verify real delivery from outside (e.g. curl from a local machine) without needing
// Render's paid Shell tab or risking the local/Render session conflict a second
// `npm run test-send` run would cause.
export function startHealthServer(port = process.env.PORT || 3000, state = {}) {
  const server = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url.startsWith('/debug/test-send')) {
      handleTestSend(req, res, state);
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
  });
  server.listen(port, () => console.log(`Health server listening on :${port}`));
  return server;
}

async function handleTestSend(req, res, state) {
  if (!SCHEDULER_KEY || req.headers['x-scheduler-key'] !== SCHEDULER_KEY) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Unauthorized' }));
    return;
  }
  if (!state.sock || !TARGET_JID) {
    res.writeHead(503, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Bot is not connected yet or WHATSAPP_TARGET_JID is not set' }));
    return;
  }

  const params = new URL(req.url, 'http://internal').searchParams;
  const type = params.get('type') || 'ok';
  const taskNumber = parseInt(params.get('number'), 10) || 1;
  try {
    let card, caption;
    if (type === 'teller') {
      const tellerProducts = await getTellerProducts();
      card = renderTellerPackageCard(taskNumber, tellerProducts);
      caption = formatTellerTaskMessage(taskNumber, tellerProducts);
    } else if (type === 'beginner') {
      const products = await getBeginnerTaskProducts();
      const product = products[0] || { title: 'Sample Product' };
      card = renderTaskNumberCard(taskNumber, 'Product Link Task');
      caption = formatBeginnerTaskMessage(taskNumber, product);
    } else {
      card = renderTaskNumberCard(taskNumber, 'Connection Test');
      caption = '*DailyTrade Bot* debug test send - real announcements post at the next scheduled slot.';
    }
    const result = await state.sock.sendMessage(TARGET_JID, { image: card, caption });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, type, messageId: result?.key?.id || null }));
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message }));
  }
}
