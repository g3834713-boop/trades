import { getPendingChatMessages, markChatMessageRelayed, resolveChatUser, postAdminReply } from './apiClient.js';

const ADMIN_JID = process.env.WHATSAPP_ADMIN_JID;
const POLL_MS = 5000;

// Only the non-quoted-reply fallback lives here - the quote-reply mapping itself is
// persisted on chat_messages.whatsapp_message_id (see /chat/resolve-user), so losing
// this on a bot restart just means the next relayed message re-establishes it.
let lastActiveUserId = null;
let pendingPollIntervalId = null;

function isValidAdminJid(jid) {
  return typeof jid === 'string' && /^\d+@s\.whatsapp\.net$/.test(jid);
}

async function relayPendingMessages(sock) {
  let pending;
  try {
    pending = await getPendingChatMessages();
  } catch (err) {
    console.error('Failed to fetch pending chat messages:', err.message);
    return;
  }
  for (const msg of pending) {
    try {
      const text = `*${msg.full_name || 'A user'}*\n${msg.message}`;
      const sent = await sock.sendMessage(ADMIN_JID, { text });
      await markChatMessageRelayed(msg.id, sent?.key?.id || null);
      lastActiveUserId = msg.user_id;
    } catch (err) {
      console.error(`Failed to relay chat message ${msg.id} to admin:`, err.message);
    }
  }
}

function extractText(message) {
  return message?.conversation || message?.extendedTextMessage?.text || null;
}

async function handleIncomingAdminMessage(msg) {
  const text = extractText(msg.message);
  if (!text) return;

  const stanzaId = msg.message?.extendedTextMessage?.contextInfo?.stanzaId;
  let targetUserId = null;

  if (stanzaId) {
    try {
      targetUserId = await resolveChatUser(stanzaId);
    } catch (err) {
      console.error('Failed to resolve quoted chat message:', err.message);
    }
  }
  if (!targetUserId) targetUserId = lastActiveUserId;

  if (!targetUserId) {
    console.warn('Admin replied but no user could be resolved (no quote, no recent conversation) - reply not delivered:', text);
    return;
  }

  try {
    await postAdminReply(targetUserId, text);
    lastActiveUserId = targetUserId;
  } catch (err) {
    console.error('Failed to post admin reply:', err.message);
  }
}

// Called from handleReady(sock) in index.js on every fresh connection (initial + reconnects).
export function startAdminChatBridge(sock) {
  if (!isValidAdminJid(ADMIN_JID)) {
    console.warn('WHATSAPP_ADMIN_JID is not set or malformed (expected "<countrycode><number>@s.whatsapp.net") - Live Chat bridge disabled.');
    return;
  }

  // Intervals stack across reconnects if not cleared first - same bug class
  // scheduleNextDayKickoff() had before it got a clear-before-rearm guard.
  if (pendingPollIntervalId) clearInterval(pendingPollIntervalId);
  pendingPollIntervalId = setInterval(() => relayPendingMessages(sock), POLL_MS);

  // Registered fresh per sock instance - each reconnect hands out a brand-new sock
  // with its own event emitter, so this does NOT need a stacking guard the way the
  // interval above does.
  sock.ev.on('messages.upsert', async ({ messages }) => {
    for (const msg of messages || []) {
      if (!msg.key || msg.key.fromMe) continue;
      if (msg.key.remoteJid !== ADMIN_JID) continue;
      await handleIncomingAdminMessage(msg);
    }
  });
}
