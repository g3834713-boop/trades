const DAY_START_HOUR = 8;
const DAY_END_HOUR = 18; // 6pm
const DURATIONS_MIN = { beginner: 30, teller: 50 };

// Packs today's 8am-6pm window with randomly-typed, back-to-back slots. Each slot is
// either a 'beginner' task (30 min) or a 'teller' task (50 min), chosen at random -
// stops once starting another slot would run past 6pm, so the last slot may end a
// little before 6pm depending on the random mix.
//
// startFrom lets a late reconnect (e.g. the bot was asleep on Render's free tier and
// only woke up at 8:05am) begin the first slot right now instead of at 8am sharp - the
// old behavior generated slots from 8am regardless, so anything that would have already
// started got silently skipped and nothing fired until whatever slot boundary happened
// to land next, up to ~50 minutes of dead air. Only takes effect if startFrom is later
// than 8am and still inside the working day; a genuinely-on-time run (startFrom omitted,
// or before 8am) behaves exactly as before.
export function generateDailySchedule(referenceDate = new Date(), startFrom = null) {
  const slots = [];
  const dayStart = new Date(referenceDate);
  dayStart.setHours(DAY_START_HOUR, 0, 0, 0);
  const dayEnd = new Date(referenceDate);
  dayEnd.setHours(DAY_END_HOUR, 0, 0, 0);

  let cursor = (startFrom && startFrom > dayStart) ? new Date(startFrom) : new Date(dayStart);
  if (cursor > dayEnd) cursor = new Date(dayEnd);

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
