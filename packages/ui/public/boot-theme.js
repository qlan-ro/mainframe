// Runs before the first paint (classic script in <head>, so the app's CSP allows it).
// Puts the stored theme on <html> so the window ground below is already the right colour
// while the bundle loads. Mirrors `readMode`/`applyStoredTheme` in src/store/theme.ts.
(function () {
  var mode = 'system';
  try {
    var stored = localStorage.getItem('mf-theme');
    if (stored === 'light' || stored === 'dark' || stored === 'system') mode = stored;
  } catch (e) {
    /* storage unavailable: follow the system */
  }
  var dark = mode === 'dark';
  if (mode === 'system') {
    try {
      dark = !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
    } catch (e) {
      dark = false;
    }
  }
  document.documentElement.classList.toggle('dark', dark);
})();
