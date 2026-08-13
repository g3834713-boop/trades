// One-off: sends a single test message to WHATSAPP_TARGET_JID to confirm delivery
// actually works, then exits.
import 'dotenv/config';
import { connectWhatsApp } from './src/whatsapp.js';

const TARGET_JID = process.env.WHATSAPP_TARGET_JID;
if (!TARGET_JID) {
  console.log('WHATSAPP_TARGET_JID is not set in .env');
  process.exit(1);
}

connectWhatsApp({
  onReady: async (sock) => {
    try {
      const result = await sock.sendMessage(TARGET_JID, {
        text: '*DailyTrade Bot* connected successfully. This is a one-time test message - real task announcements start tomorrow at 8am.'
      });
      console.log('Message sent. Server ack:', JSON.stringify(result?.key || result));
    } catch (err) {
      console.error('Failed to send test message:', err.message);
    }
    process.exit(0);
  }
});
