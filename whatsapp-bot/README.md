# DailyTrade WhatsApp Task Bot

Posts a randomized daily schedule of task announcements to a WhatsApp group, 8am-6pm,
alternating between two task types:

- **Beginner / product-link task** (30 min) - announces a specific product name (pulled
  from the site's active Beginner Tasks). Users find and paste that product's real
  Amazon link into the site to earn a reward. The site validates the submitted link
  actually matches the announced product name before accepting it.
- **Teller package task** (50 min) - announces the current Teller package tiers
  (amount / profit / total return), computed live from the site's real product prices
  and commissions every time, so it never drifts out of sync with what Teller tasks
  actually pay.

The bot decides the schedule and pushes each slot to the main site's API
(`POST /schedule/slots`) as it announces it, so the site always knows what's currently
allowed.

## First-time setup

1. `npm install`
2. Copy `.env.example` to `.env` and fill in:
   - `DATABASE_URL` - same database the main backend uses.
   - `SITE_API_URL` - the backend's URL.
   - `SCHEDULER_API_KEY` - must match the backend's own `SCHEDULER_API_KEY` env var exactly.
   - Leave `WHATSAPP_TARGET_JID` blank for now.
3. `npm start`. A QR code prints in the terminal - open WhatsApp on the phone that
   should run this bot, go to **Settings -> Linked Devices -> Link a Device**, and scan it.
4. Once connected, stop the bot (Ctrl+C), add the bot's WhatsApp account to the group
   you want it to post in, then run `npm run list-groups` to print every group it's in
   with its JID. Copy the right one into `WHATSAPP_TARGET_JID` in `.env`.
5. `npm start` again. It'll generate and schedule the rest of today's slots
   immediately, and regenerate a fresh schedule every day at 8am from then on.

The WhatsApp login itself is saved to Postgres (a `bot_whatsapp_session` table this bot
creates automatically), not to local files - so restarting the process does **not**
require re-scanning the QR code, unless the phone actually unlinks the device.

## Adding more content

- **More product names for beginner tasks**: admin panel -> Beginner Tasks -> add more
  (there's currently only one seeded - the bot needs several to actually rotate).
  Keep titles specific and accurate (e.g. "Wireless Bluetooth Headphones", not just
  "Headphones") since the site checks submitted links against this exact text.
- **Teller package tiers**: these come straight from the real Products list in admin -
  add/edit/remove products there and the next teller announcement reflects it
  automatically. No bot changes needed.

## Hosting

This needs to run **continuously** - the WhatsApp connection drops the moment the
process stops, and reconnects automatically as long as the process is alive.

Two real risks to know about wherever you host it:

1. **Idle sleep** (Render free tier specifically): spins the process down after 15 min
   with no incoming HTTP traffic. The bot starts a tiny HTTP server (`/`, whatever
   `$PORT` gives it) for exactly this reason - point a free external pinger
   (UptimeRobot, cron-job.org) at it every ~10 minutes to prevent that.
2. **Restarts in general** (redeploys, platform maintenance, etc.): because the session
   is saved to Postgres and not local disk, a restart just reconnects using the saved
   session - no QR re-scan needed. This is what makes Render (or any restart-prone
   host) viable at all for this.

Recommended: deploy this the same way as the backend (Render, root directory
`whatsapp-bot`, build `npm install`, start `npm start`), add a free uptime pinger, and
it should stay connected indefinitely. A dedicated always-on machine is more robust if
you have one, but isn't required.
