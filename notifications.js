(function () {
  const POLL_MS = 15000;
  const PUSH_DISMISSED_KEY = 'dailytrade_push_dismissed';
  let lastUnreadCount = 0;
  let audioCtx = null;

  const ICONS = {
    deposit_requested: 'la-hourglass-half', deposit_confirmed: 'la-check-circle',
    deposit_declined: 'la-times-circle', deposit_credit: 'la-wallet',
    withdrawal_requested: 'la-hourglass-half', withdrawal_approved: 'la-arrow-up',
    withdrawal_rejected: 'la-times-circle', task_available: 'la-bullhorn',
    verification_required: 'la-id-card', totp_required: 'la-shield-alt',
    easy_earn_reward: 'la-gift', referral_bonus: 'la-user-friends',
    checkin_bonus: 'la-calendar-check', teller_withdraw: 'la-exchange-alt',
    beginner_task_reward: 'la-tasks', order_reward: 'la-box'
  };

  // --- Web Audio beep (built from scratch, no asset file) ---
  function unlockAudio() {
    if (audioCtx) return;
    try {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === 'suspended') audioCtx.resume();
    } catch (e) { /* Web Audio unsupported - beep silently no-ops later */ }
  }
  document.addEventListener('click', unlockAudio, { once: true });
  document.addEventListener('touchstart', unlockAudio, { once: true });

  function playNotificationBeep() {
    if (!audioCtx || audioCtx.state !== 'running') return; // not unlocked yet - never throws
    try {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.0001, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.2, audioCtx.currentTime + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.35);
      osc.connect(gain); gain.connect(audioCtx.destination);
      osc.start(); osc.stop(audioCtx.currentTime + 0.35);
    } catch (e) { console.warn('Notification beep failed:', e); }
  }

  // --- Style injection (once) ---
  function ensureStyles() {
    if (document.getElementById('notificationsSharedStyles')) return;
    const style = document.createElement('style');
    style.id = 'notificationsSharedStyles';
    style.textContent = `
      .header-icons { display:flex; gap:16px; font-size:20px; cursor:pointer; align-items:center; }
      .notification-badge { position:relative; }
      .notification-badge-count { display:none; position:absolute; top:-6px; right:-8px; min-width:16px; height:16px;
        padding:0 3px; border-radius:9px; background:var(--danger-text, #e74c3c); color:#fff; font-size:10px;
        font-weight:700; align-items:center; justify-content:center; line-height:1; }
      .notifications-modal { display:none; position:fixed; inset:0; background:rgba(0,0,0,0.5); z-index:1000; overflow-y:auto; }
      .notifications-modal.show { display:block; }
      .notifications-modal-content { background:var(--surface); margin:20px auto; border-radius:12px; width:90%;
        max-width:600px; max-height:80vh; overflow-y:auto; box-shadow:0 10px 40px var(--shadow-strong); }
      .notifications-modal-header { position:sticky; top:0; padding:16px; background:var(--brand); color:#fff;
        display:flex; align-items:center; justify-content:space-between; border-radius:12px 12px 0 0; z-index:1; }
      .notifications-modal-title { font-weight:bold; font-size:16px; }
      .notifications-modal-close { background:rgba(255,255,255,0.2); border:none; color:#fff; font-size:24px;
        cursor:pointer; width:32px; height:32px; border-radius:50%; display:flex; align-items:center; justify-content:center; }
      .notifications-list-mount { display:flex; flex-direction:column; gap:10px; padding:4px 0 16px; }
      .notif-item { display:flex; gap:10px; padding:10px; border-radius:8px; border-left:3px solid transparent; }
      .notif-item.unread { border-left-color:var(--brand); background:rgba(67,97,238,0.06); }
      .notif-item-icon { font-size:18px; color:var(--brand); flex-shrink:0; margin-top:2px; }
      .notif-item-title { font-weight:600; font-size:13px; color:var(--text-primary); }
      .notif-item-message { font-size:12px; color:var(--text-secondary); margin-top:2px; }
      .notif-item-time { font-size:11px; color:var(--text-secondary); margin-top:4px; opacity:0.8; }
      .notif-empty-state { text-align:center; padding:24px 12px; color:var(--text-secondary); font-size:13px; }
      .push-prompt-banner { position:fixed; left:12px; right:12px; bottom:80px; z-index:998; background:var(--surface);
        border:1px solid var(--border); border-radius:12px; padding:12px 14px; box-shadow:0 8px 24px var(--shadow-strong);
        display:flex; align-items:center; gap:10px; font-size:13px; color:var(--text-primary); }
      .push-prompt-banner i { font-size:20px; color:var(--brand); flex-shrink:0; }
      .push-prompt-actions { display:flex; gap:8px; margin-left:auto; flex-shrink:0; }
      .push-prompt-actions button { border:none; border-radius:8px; padding:8px 12px; font-size:12px; font-weight:600; cursor:pointer; }
      .push-prompt-enable { background:var(--brand); color:#fff; }
      .push-prompt-dismiss { background:var(--surface-alt, #f0f0f0); color:var(--text-secondary); }
    `;
    document.head.appendChild(style);
  }

  // --- Bell injection ---
  function ensureBellIcon() {
    if (document.getElementById('notificationBellIcon')) return;
    const bell = document.createElement('i');
    bell.id = 'notificationBellIcon';
    bell.className = 'las la-bell notification-badge';
    bell.title = 'Notifications';
    bell.style.cursor = 'pointer';
    bell.innerHTML = '<span class="notification-badge-count" id="notificationBadgeCount">0</span>';
    bell.addEventListener('click', () => window.openNotificationsModal());

    let host = document.querySelector('.header-icons');
    if (!host) {
      const header = document.querySelector('.header');
      if (!header) return; // no recognizable header - bail safely, never throw
      host = document.createElement('div');
      host.className = 'header-icons';
      header.appendChild(host);
    }
    host.prepend(bell);
  }

  // --- Modal injection (reuses home.html's pre-existing #notificationsModal if present) ---
  function ensureModal() {
    if (document.getElementById('notificationsModal')) return;
    const modal = document.createElement('div');
    modal.id = 'notificationsModal';
    modal.className = 'notifications-modal';
    modal.addEventListener('click', (e) => { if (e.target === modal) window.closeNotificationsModal(); });
    modal.innerHTML = `
      <div class="notifications-modal-content">
        <div class="notifications-modal-header">
          <div class="notifications-modal-title">Notifications</div>
          <button class="notifications-modal-close" onclick="closeNotificationsModal()"><i class="las la-times"></i></button>
        </div>
        <div style="padding:16px;">
          <div class="notifications-list-mount" id="notificationsListMount">
            <div class="notif-empty-state">Loading notifications…</div>
          </div>
        </div>
      </div>`;
    document.body.appendChild(modal);
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str == null ? '' : String(str);
    return div.innerHTML;
  }

  function timeAgo(dateStr) {
    const mins = Math.floor((Date.now() - new Date(dateStr).getTime()) / 60000);
    if (mins < 1) return 'Just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  }

  function renderNotificationList(list) {
    const mount = document.getElementById('notificationsListMount');
    if (!mount) return;
    if (!list.length) { mount.innerHTML = '<div class="notif-empty-state">No notifications yet</div>'; return; }
    mount.innerHTML = list.map(n => {
      const actionUrl = n.metadata?.actionUrl || '';
      return `
      <div class="notif-item ${n.is_read ? '' : 'unread'}" data-id="${escapeHtml(n.id)}" data-url="${escapeHtml(actionUrl)}" style="${actionUrl ? 'cursor:pointer;' : ''}">
        <div class="notif-item-icon"><i class="las ${ICONS[n.type] || 'la-bell'}"></i></div>
        <div>
          <div class="notif-item-title">${escapeHtml(n.title)}</div>
          <div class="notif-item-message">${escapeHtml(n.message)}</div>
          <div class="notif-item-time">${timeAgo(n.created_at)}</div>
        </div>
      </div>`;
    }).join('');
    ensureListClickHandler();
  }

  // Delegated click handler, wired once - survives re-renders since it's on the
  // (never-replaced) mount container, not the individual item elements.
  let listClickHandlerBound = false;
  function ensureListClickHandler() {
    if (listClickHandlerBound) return;
    const mount = document.getElementById('notificationsListMount');
    if (!mount) return;
    mount.addEventListener('click', async (e) => {
      const item = e.target.closest('.notif-item');
      if (!item) return;
      const id = item.dataset.id;
      const url = item.dataset.url;
      if (id) {
        try { await window.API.call(`/notifications/${id}/read`, { method: 'POST' }); } catch (err) { /* ignore */ }
        item.classList.remove('unread');
      }
      if (url) window.location.href = url;
    });
    listClickHandlerBound = true;
  }

  function updateBadge(count) {
    const el = document.getElementById('notificationBadgeCount');
    if (!el) return;
    el.style.display = count > 0 ? 'flex' : 'none';
    el.textContent = count > 9 ? '9+' : String(count);
  }

  async function fetchNotifications(isFirst) {
    try {
      const data = await window.API.call('/notifications');
      renderNotificationList(data.notifications || []);
      updateBadge(data.unreadCount || 0);
      if (!isFirst && data.unreadCount > lastUnreadCount) playNotificationBeep();
      lastUnreadCount = data.unreadCount || 0;
    } catch (err) {
      console.warn('Notification poll failed:', err.message);
    }
  }

  async function markAllRead() {
    try { await window.API.call('/notifications/read-all', { method: 'POST' }); updateBadge(0); lastUnreadCount = 0; }
    catch (e) { /* ignore - next poll will resync */ }
  }

  window.openNotificationsModal = function () {
    const modal = document.getElementById('notificationsModal');
    if (modal) modal.classList.add('show');
    markAllRead();
  };
  window.closeNotificationsModal = function () {
    const modal = document.getElementById('notificationsModal');
    if (modal) modal.classList.remove('show');
  };
  // Exposed for live verification checks - safe to keep long-term.
  window.__notifDebug = { fetchNotifications, playNotificationBeep };

  // --- Web Push: permission prompt + subscribe flow ---
  function isIosSafari() {
    const ua = window.navigator.userAgent;
    const isIos = /iPad|iPhone|iPod/.test(ua) || (ua.includes('Macintosh') && 'ontouchend' in document);
    const isStandalone = window.navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches;
    return isIos && !isStandalone;
  }

  function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; i++) outputArray[i] = rawData.charCodeAt(i);
    return outputArray;
  }

  function dismissPushBanner() {
    const el = document.getElementById('pushPromptBanner');
    if (el) el.remove();
  }

  async function enablePush() {
    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') { dismissPushBanner(); return; }
      const registration = await navigator.serviceWorker.register('sw.js');
      await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(window.CONFIG.VAPID_PUBLIC_KEY)
      });
      await window.API.call('/push/subscribe', { method: 'POST', body: JSON.stringify({ subscription }) });
    } catch (err) {
      console.warn('Push enable failed:', err.message);
    } finally {
      dismissPushBanner();
    }
  }

  function showPushBanner(iosHint) {
    if (localStorage.getItem(PUSH_DISMISSED_KEY) === '1') return;
    if (document.getElementById('pushPromptBanner')) return;
    const banner = document.createElement('div');
    banner.id = 'pushPromptBanner';
    banner.className = 'push-prompt-banner';
    if (iosHint) {
      banner.innerHTML = `
        <i class="las la-mobile-alt"></i>
        <span>Add DailyTrade to your Home Screen (Share &gt; Add to Home Screen) to enable notifications on iPhone.</span>
        <div class="push-prompt-actions"><button class="push-prompt-dismiss" id="pushDismissBtn">Got it</button></div>`;
    } else {
      banner.innerHTML = `
        <i class="las la-bell"></i>
        <span>Enable notifications to get instant alerts for deposits, withdrawals, and more.</span>
        <div class="push-prompt-actions">
          <button class="push-prompt-dismiss" id="pushDismissBtn">Not now</button>
          <button class="push-prompt-enable" id="pushEnableBtn">Enable</button>
        </div>`;
    }
    document.body.appendChild(banner);
    document.getElementById('pushDismissBtn').addEventListener('click', () => {
      localStorage.setItem(PUSH_DISMISSED_KEY, '1');
      dismissPushBanner();
    });
    const enableBtn = document.getElementById('pushEnableBtn');
    if (enableBtn) enableBtn.addEventListener('click', enablePush);
  }

  function maybePromptForPush() {
    if (!window.CONFIG || !window.CONFIG.VAPID_PUBLIC_KEY) return;
    if (!('Notification' in window)) return;
    if (Notification.permission !== 'default') return;
    if ('serviceWorker' in navigator && 'PushManager' in window) {
      showPushBanner(false);
    } else if (isIosSafari()) {
      showPushBanner(true);
    }
  }

  async function start() {
    ensureStyles();
    ensureBellIcon();
    ensureModal();
    let retries = 0;
    while (typeof window.API === 'undefined' && retries < 20) {
      await new Promise(r => setTimeout(r, 150));
      retries++;
    }
    if (typeof window.API === 'undefined') return;
    await fetchNotifications(true);
    setInterval(() => fetchNotifications(false), POLL_MS);
    setTimeout(maybePromptForPush, 2000);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
