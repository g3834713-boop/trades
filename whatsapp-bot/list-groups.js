// One-off helper: connect, then print every group the linked WhatsApp account is in,
// with its JID - copy the right one into WHATSAPP_TARGET_JID in .env.
import 'dotenv/config';
import { connectWhatsApp } from './src/whatsapp.js';

connectWhatsApp({
  onReady: async (sock) => {
    const groups = await sock.groupFetchAllParticipating();
    const entries = Object.entries(groups);

    if (entries.length === 0) {
      console.log('\nNo groups found for this account. Add it to a WhatsApp group first, then rerun this.\n');
    } else {
      console.log('\nGroups this WhatsApp account is in:\n');
      for (const [jid, meta] of entries) {
        console.log(`${meta.subject}\n  -> ${jid}\n`);
      }
    }
    process.exit(0);
  }
});
