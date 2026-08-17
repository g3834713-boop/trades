(function () {
  // Registers the service worker unconditionally and early, and captures
  // beforeinstallprompt as soon as it fires - both are prerequisites for Chrome/Edge
  // on Android/Desktop to offer a real "Install App" prompt. Previously the service
  // worker only ever registered as a side effect of a user granting notification
  // permission (see notifications.js/task-ideas.html), which meant Chrome usually
  // hadn't seen it yet by the time a user reached the "Add to Home Screen" step.
  // register() is idempotent - safe to call again even if a push flow elsewhere on
  // the page also registers it.
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(err => {
      console.warn('Service worker registration failed:', err);
    });
  }

  // The event is scoped to this page load only - it cannot be carried across a
  // navigation - so this listener is added as early as possible (this script should
  // load in <head>, before body content) to maximize the chance of catching it on
  // whichever page the user happens to be on when Chrome decides to fire it.
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    window.__deferredInstallPrompt = e;
  });

  window.addEventListener('appinstalled', () => {
    window.__deferredInstallPrompt = null;
  });
})();
