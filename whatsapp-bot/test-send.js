// One-off: sends a test image card + caption to WHATSAPP_TARGET_JID to confirm both
// text and image delivery actually work, then exits. Run this from wherever the bot
// is actually deployed (e.g. Render's Shell tab) - never run it while the main bot
// process is also live, they'd conflict over the same WhatsApp session.
import 'dotenv/config';
import { connectWhatsApp } from './src/whatsapp.js';
import { renderTaskNumberCard } from './src/cardImage.js';

const TARGET_JID = process.env.WHATSAPP_TARGET_JID;
if (!TARGET_JID) {
  console.log('WHATSAPP_TARGET_JID is not set in .env');
  process.exit(1);
}

connectWhatsApp({
  onReady: async (sock) => {
    try {
      const card = renderTaskNumberCard('OK', 'Connection Test');
      const result = await sock.sendMessage(TARGET_JID, {
        image: card,
        caption: '*DailyTrade Bot* connected successfully. This is a one-time test - real task announcements start at the next scheduled slot (8am-6pm).'
      });
      console.log('Message sent. Server ack:', JSON.stringify(result?.key || result));
    } catch (err) {
      console.error('Failed to send test message:', err.message);
    }
    process.exit(0);
  }
});
