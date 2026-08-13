# DailyTrade WhatsApp Task Bot

Posts a randomized daily schedule of task announcements to a WhatsApp group **or**
Channel, 8am-6pm, alternating between two task types:

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
3. `npm start`. A QR code prints in the terminal, and is also saved as `qr.png` in this
   folder (easier to actually scan than terminal ASCII art in most setups) - open
   WhatsApp on the phone that should run this bot, go to **Settings -> Linked Devices ->
   Link a Device**, and scan it. It expires after ~30-60s; the bot regenerates a fresh
   one automatically if you miss it.
4. Once connected, stop the bot (Ctrl+C) and get the JID to post to - pick **one**:

   **Posting to a Channel** (one-way broadcast, anyone can follow, they can't reply -
   this is what "post to a WhatsApp channel" means):
   - New channel: `node create-channel.js "Channel Name" "Description"` - creates it
     and prints its JID directly.
   - Already have a channel: open its info screen in WhatsApp, copy its invite link
     (`https://whatsapp.com/channel/XXXXXXXXXXXXXXXXX`), then
     `node resolve-channel.js <that link>` - this bot's account must already be
     following/admin of it first. Prints the JID.

   **Posting to a Group** (two-way, members can reply):
   - Add the bot's WhatsApp account to the group, then `npm run list-groups` to print
     every group it's in with its JID.

   Either way, set `WHATSAPP_TARGET_JID` in `.env` to that JID, then run
   `npm run test-send` to send one real message and confirm delivery before trusting it
   for the actual schedule.

   Either way, copy the JID into `WHATSAPP_TARGET_JID` in `.env` - `sendMessage` works
   the same way for both, nothing else about the bot changes based on which you pick.
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
