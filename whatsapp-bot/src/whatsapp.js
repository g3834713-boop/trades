import baileysPkg from '@whiskeysockets/baileys';
import qrcodeTerminal from 'qrcode-terminal';
import { useDbAuthState } from './dbAuthState.js';

const { default: makeWASocket, DisconnectReason, fetchLatestBaileysVersion } = baileysPkg;

// Connects (or reconnects) to WhatsApp using the Postgres-backed session. Calls
// onReady(sock) once fully connected. Automatically reconnects on drops, except
// when the account was actually logged out (unlinked from the phone), in which
// case the saved session is cleared so the next run prompts a fresh QR scan.
export async function connectWhatsApp({ onReady }) {
  const { state, saveCreds, clearAuthState } = await useDbAuthState();
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    auth: state,
    version,
    printQRInTerminal: false,
    syncFullHistory: false
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log('\nScan this QR code with WhatsApp -> Linked Devices -> Link a Device:\n');
      qrcodeTerminal.generate(qr, { small: true });
    }

    if (connection === 'close') {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const loggedOut = statusCode === DisconnectReason.loggedOut;

      if (loggedOut) {
        console.log('WhatsApp account was unlinked. Clearing saved session - restart the bot to scan a new QR code.');
        await clearAuthState();
        return;
      }

      console.log('Connection dropped, reconnecting in 3s...');
      setTimeout(() => connectWhatsApp({ onReady }), 3000);
    } else if (connection === 'open') {
      console.log('WhatsApp connected.');
      if (onReady) onReady(sock);
    }
  });

  return sock;
}
