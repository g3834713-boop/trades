(function () {
  const PULL_THRESHOLD = 70; // px of drag before release triggers a refresh
  const MAX_PULL = 110; // visual cap so the indicator doesn't drag indefinitely
  let startY = 0;
  let pulling = false;
  let currentPull = 0;
  let indicator = null;
  let refreshing = false;

  function ensureIndicator() {
    if (indicator) return indicator;

    const style = document.createElement('style');
    style.textContent = `
      #pullToRefreshIndicator {
        position: fixed; top: 0; left: 0; right: 0; height: 60px;
        display: flex; align-items: center; justify-content: center;
        transform: translateY(-60px); transition: transform 0.2s ease;
        z-index: 9998; pointer-events: none;
      }
      #pullToRefreshIndicator .ptr-spinner {
        width: 28px; height: 28px; border: 3px solid var(--border, #e0e0e0);
        border-top-color: var(--brand, #4361ee); border-radius: 50%;
      }
      #pullToRefreshIndicator .ptr-spinner.spinning { animation: ptrSpin 0.7s linear infinite; }
      @keyframes ptrSpin { to { transform: rotate(360deg); } }
    `;
    document.head.appendChild(style);

    indicator = document.createElement('div');
    indicator.id = 'pullToRefreshIndicator';
    indicator.innerHTML = '<div class="ptr-spinner"></div>';
    document.body.appendChild(indicator);
    return indicator;
  }

  // Resets the indicator to its hidden resting position - must be called any time
  // `pulling` is abandoned mid-gesture (not just on a clean touchend), otherwise it
  // can be left visually stuck partway down the screen with nothing left to reset it.
  function resetIndicator() {
    currentPull = 0;
    if (indicator) indicator.style.transform = 'translateY(-60px)';
  }

  function onTouchStart(e) {
    if (refreshing) { pulling = false; return; }
    if (window.scrollY > 0 || e.touches.length !== 1) { pulling = false; return; }
    startY = e.touches[0].clientY;
    pulling = true;
    currentPull = 0;
  }

  function onTouchMove(e) {
    if (!pulling || refreshing) return;
    // A second finger joining mid-gesture (e.g. an accidental pinch) or the touch
    // list emptying out mid-move both bail out of custom pull tracking rather than
    // risk misreading a multi-touch gesture as a single downward drag.
    if (window.scrollY > 0 || e.touches.length !== 1) { pulling = false; resetIndicator(); return; }

    const deltaY = e.touches[0].clientY - startY;
    if (deltaY <= 0) { currentPull = 0; return; }

    currentPull = Math.min(deltaY, MAX_PULL);
    const el = ensureIndicator();
    el.style.transform = `translateY(${-60 + Math.min(currentPull, 60)}px)`;
    const spinner = el.querySelector('.ptr-spinner');
    if (spinner) spinner.style.transform = `rotate(${currentPull * 3}deg)`;

    // Small deadzone so ordinary taps/scrolls are never hijacked - only once the
    // gesture is clearly a deliberate downward pull do we block native overscroll.
    if (deltaY > 10) e.preventDefault();
  }

  async function onTouchEnd() {
    if (!pulling) return;
    pulling = false;
    const el = ensureIndicator();

    if (currentPull >= PULL_THRESHOLD) {
      refreshing = true;
      el.style.transform = 'translateY(10px)';
      const spinner = el.querySelector('.ptr-spinner');
      if (spinner) spinner.classList.add('spinning');
      try {
        if (typeof window.onPullToRefresh === 'function') {
          await window.onPullToRefresh();
        } else {
          window.location.reload();
          return;
        }
      } catch (err) {
        console.warn('Pull-to-refresh callback failed:', err);
      } finally {
        if (spinner) spinner.classList.remove('spinning');
        refreshing = false;
      }
    }
    resetIndicator();
  }

  function onTouchCancel() {
    pulling = false;
    resetIndicator();
  }

  document.addEventListener('touchstart', onTouchStart, { passive: true });
  document.addEventListener('touchmove', onTouchMove, { passive: false });
  document.addEventListener('touchend', onTouchEnd, { passive: true });
  document.addEventListener('touchcancel', onTouchCancel, { passive: true });
})();
