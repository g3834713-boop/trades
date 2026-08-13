// One-off helper: creates a brand-new WhatsApp Channel owned by this bot's account and
// prints its JID - copy that into WHATSAPP_TARGET_JID in .env.
//
// Only use this if you don't already have a channel. If you already have one, use
// resolve-channel.js instead with its invite link.
import 'dotenv/config';
import { connectWhatsApp } from './src/whatsapp.js';

const name = process.argv[2];
const description = process.argv[3] || 'Daily task announcements';

if (!name) {
  console.log('\nUsage: node create-channel.js "Channel Name" "Optional description"\n');
  process.exit(1);
}

connectWhatsApp({
  onReady: async (sock) => {
    try {
      const metadata = await sock.newsletterCreate(name, description);
      console.log('\nChannel created:\n');
      console.log(`Name: ${name}`);
      console.log(`JID:  ${metadata.id}\n`);
      console.log('Copy that JID into WHATSAPP_TARGET_JID in .env.\n');
    } catch (err) {
      console.error('Failed to create channel:', err.message);
    }
    process.exit(0);
  }
});
