const DAY_START_HOUR = 8;
const DAY_END_HOUR = 18; // 6pm
const DURATIONS_MIN = { beginner: 30, teller: 50 };

// Packs today's 8am-6pm window with randomly-typed, back-to-back slots. Each slot is
// either a 'beginner' task (30 min) or a 'teller' task (50 min), chosen at random -
// stops once starting another slot would run past 6pm, so the last slot may end a
// little before 6pm depending on the random mix.
export function generateDailySchedule(referenceDate = new Date()) {
  const slots = [];
  const dayStart = new Date(referenceDate);
  dayStart.setHours(DAY_START_HOUR, 0, 0, 0);
  const dayEnd = new Date(referenceDate);
  dayEnd.setHours(DAY_END_HOUR, 0, 0, 0);

  let cursor = new Date(dayStart);
  while (cursor < dayEnd) {
    const type = Math.random() < 0.5 ? 'beginner' : 'teller';
    const durationMs = DURATIONS_MIN[type] * 60 * 1000;
    const slotEnd = new Date(cursor.getTime() + durationMs);
    if (slotEnd > dayEnd) break;
    slots.push({ type, startsAt: new Date(cursor), endsAt: slotEnd });
    cursor = slotEnd;
  }

  return slots;
}
