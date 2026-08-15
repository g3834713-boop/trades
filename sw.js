// Minimal service worker whose only job is to receive Web Push events and show an
// OS-level notification - this is what lets alerts arrive even when no tab is open.
self.addEventListener('push', (event) => {
  let data = { title: 'DailyTrade', body: 'You have a new notification.' };
  try {
    if (event.data) data = event.data.json();
  } catch (e) {
    // Non-JSON payload - fall back to the default text above rather than failing silently.
  }

  event.waitUntil(
    self.registration.showNotification(data.title || 'DailyTrade', {
      body: data.body || '',
      icon: 'logo.png',
      badge: 'logo.png',
      data: { url: data.url || 'home.html' }
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || 'home.html';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('navigate' in client && 'focus' in client) {
          return client.navigate(targetUrl).then((c) => c.focus());
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(targetUrl);
    })
  );
});
