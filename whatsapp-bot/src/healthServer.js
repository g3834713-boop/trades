import http from 'http';

// A minimal HTTP server, just so this can be deployed as a Render web service (which
// requires binding to $PORT) and so an external uptime pinger (e.g. UptimeRobot,
// cron-job.org - free tier is fine) has something to hit every ~10 minutes to stop
// the free tier from idling out and dropping the WhatsApp connection.
export function startHealthServer(port = process.env.PORT || 3000) {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
  });
  server.listen(port, () => console.log(`Health server listening on :${port}`));
  return server;
}
