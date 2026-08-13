import baileysPkg from '@whiskeysockets/baileys';
import { query, ensureBotSchema } from './db.js';

const { initAuthCreds, BufferJSON, proto } = baileysPkg;

// Baileys' own useMultiFileAuthState, but backed by Postgres instead of local disk.
// Local disk on most free PaaS hosting (Render included) is ephemeral - it's wiped on
// every restart, which would force a fresh QR scan every single time the process
// restarts for any reason. Storing the same data in Postgres survives that.
export async function useDbAuthState() {
  await ensureBotSchema();

  async function readData(key) {
    const { rows } = await query('select value from bot_whatsapp_session where key = $1', [key]);
    if (!rows.length) return null;
    return JSON.parse(JSON.stringify(rows[0].value), BufferJSON.reviver);
  }

  async function writeData(key, value) {
    const serialized = JSON.parse(JSON.stringify(value, BufferJSON.replacer));
    await query(
      `insert into bot_whatsapp_session (key, value, updated_at) values ($1, $2, now())
       on conflict (key) do update set value = excluded.value, updated_at = now()`,
      [key, serialized]
    );
  }

  async function removeData(key) {
    await query('delete from bot_whatsapp_session where key = $1', [key]);
  }

  const creds = (await readData('creds')) || initAuthCreds();

  return {
    state: {
      creds,
      keys: {
        get: async (type, ids) => {
          const data = {};
          await Promise.all(ids.map(async (id) => {
            let value = await readData(`${type}-${id}`);
            if (type === 'app-state-sync-key' && value) {
              value = proto.Message.AppStateSyncKeyData.fromObject(value);
            }
            data[id] = value;
          }));
          return data;
        },
        set: async (data) => {
          const tasks = [];
          for (const category of Object.keys(data)) {
            for (const id of Object.keys(data[category])) {
              const value = data[category][id];
              const key = `${category}-${id}`;
              tasks.push(value ? writeData(key, value) : removeData(key));
            }
          }
          await Promise.all(tasks);
        }
      }
    },
    saveCreds: async () => {
      await writeData('creds', creds);
    },
    // Wipes the saved session so the next connect attempt requires a fresh QR scan -
    // useful if the account gets logged out remotely (e.g. unlinked from the phone).
    clearAuthState: async () => {
      await query('delete from bot_whatsapp_session');
    }
  };
}
