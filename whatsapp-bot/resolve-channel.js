// One-off helper: if you already have a WhatsApp Channel, resolve its invite link into
// the JID this bot needs. Get the invite link from the channel's info screen in
// WhatsApp (looks like https://whatsapp.com/channel/XXXXXXXXXXXXXXXXX) - this bot's
// account must already be following/admin of that channel.
import 'dotenv/config';
import { connectWhatsApp } from './src/whatsapp.js';

const inviteUrl = process.argv[2];
if (!inviteUrl) {
  console.log('\nUsage: node resolve-channel.js https://whatsapp.com/channel/XXXXXXXXXXXXXXXXX\n');
  process.exit(1);
}

const inviteCode = inviteUrl.trim().split('/').pop();

connectWhatsApp({
  onReady: async (sock) => {
    try {
      const metadata = await sock.newsletterMetadata('invite', inviteCode);
      console.log('\nChannel found:\n');
      console.log(`Name: ${metadata.name}`);
      console.log(`JID:  ${metadata.id}\n`);
      console.log('Copy that JID into WHATSAPP_TARGET_JID in .env.\n');
    } catch (err) {
      console.error('Failed to resolve channel from invite link:', err.message);
      console.error('Make sure this bot\'s WhatsApp account is following/admin of the channel first.');
    }
    process.exit(0);
  }
});
