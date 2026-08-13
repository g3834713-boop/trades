(function () {
  var STORAGE_KEY = 'dailytrade_theme'; // stored value is 'light' or 'dark'; absent = follow system

  function systemPrefersDark() {
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  }

  function resolveTheme() {
    var saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'light' || saved === 'dark') return saved;
    return systemPrefersDark() ? 'dark' : 'light';
  }

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
  }

  // Apply immediately, before the rest of the page parses, to avoid a flash of the wrong theme.
  applyTheme(resolveTheme());

  window.ThemeService = {
    // 'light' | 'dark' | 'system'
    get: function () {
      var saved = localStorage.getItem(STORAGE_KEY);
      return saved === 'light' || saved === 'dark' ? saved : 'system';
    },
    set: function (choice) {
      if (choice === 'system') {
        localStorage.removeItem(STORAGE_KEY);
        applyTheme(systemPrefersDark() ? 'dark' : 'light');
      } else {
        localStorage.setItem(STORAGE_KEY, choice);
        applyTheme(choice);
      }
    }
  };

  if (window.matchMedia) {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function (e) {
      if (!localStorage.getItem(STORAGE_KEY)) {
        applyTheme(e.matches ? 'dark' : 'light');
      }
    });
  }
})();
