import 'dotenv/config';

const API_URL = process.env.SITE_API_URL;
const SCHEDULER_KEY = process.env.SCHEDULER_API_KEY;

async function call(path, options = {}) {
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'X-Scheduler-Key': SCHEDULER_KEY,
      ...(options.headers || {})
    }
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`API ${path} failed: ${res.status} ${body}`);
  }
  return res.json();
}

export async function pushScheduleSlot({ taskType, startsAt, endsAt, details }) {
  return call('/schedule/slots', {
    method: 'POST',
    body: JSON.stringify({ task_type: taskType, starts_at: startsAt, ends_at: endsAt, details })
  });
}

// Active product names for beginner/URL tasks. Each one's title IS the exact
// product name the site checks the submitted link against - keep titles specific
// (e.g. "Wireless Bluetooth Headphones", not just "Headphones").
export async function getBeginnerTaskProducts() {
  return call('/schedule/beginner-tasks');
}

// Live price/commission-derived package tiers - always matches whatever products
// currently exist, computed fresh on every call.
export async function getTellerProducts() {
  return call('/schedule/teller-products');
}

// Every slot already pushed today, used to compute the next task number from
// persisted history instead of an in-memory counter that resets on every restart.
export async function getTodaySlots() {
  return call('/schedule/today');
}

// Fired once a day at 7:30am - in-app/push heads-up that today's task window is
// about to open. Separate from the WhatsApp channel post the bot sends itself.
export async function triggerDayStartAnnouncement() {
  return call('/reminders/day-starting', { method: 'POST' });
}

// Fired once a day in the afternoon - reminds only users who haven't checked in yet.
export async function triggerCheckinReminder() {
  return call('/reminders/daily-checkin', { method: 'POST' });
}
