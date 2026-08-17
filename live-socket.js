(function () {
  const WS_RECONNECT_BASE_MS = 2000;
  const WS_RECONNECT_MAX_MS = 30000;
  let socket = null;
  let reconnectAttempt = 0;
  let reconnectTimeoutId = null;
  let intentionallyClosed = false;
  let lastToken = null;

  function wsUrl() {
    return window.CONFIG.API_URL.replace(/^http/, 'ws') + '/ws/live';
  }

  // Formats mirror each page's own fetch-driven render exactly (checked directly,
  // not assumed) - bonusValue on tasks.html is a bare number, everything else is
  // prefixed "GHC ", so a live push looks identical to a normal fetch update.
  function updateBalanceDom(balance, bonus) {
    const balanceDisplay = document.getElementById('balanceDisplay');
    if (balanceDisplay) balanceDisplay.textContent = `GHC ${balance.toFixed(2)}`;

    const bonusDisplay = document.getElementById('bonusDisplay');
    if (bonusDisplay) bonusDisplay.textContent = `GHC ${bonus.toFixed(2)}`;

    const bonusValue = document.getElementById('bonusValue');
    if (bonusValue) bonusValue.textContent = bonus.toFixed(2);

    const myBalanceValue = document.getElementById('myBalanceValue');
    if (myBalanceValue) myBalanceValue.textContent = `GHC ${balance.toFixed(2)}`;

    const commissionDisplay = document.getElementById('commissionDisplay');
    if (commissionDisplay) commissionDisplay.textContent = `GHC ${(balance + bonus).toFixed(2)}`;
  }

  function updateTellerBalanceDom(balance) {
    const el = document.getElementById('tellerBalance');
    if (el) el.textContent = `GHC ${balance.toFixed(2)}`;
  }

  // Write-through so the NEXT page load's instant-cache-read (tasks.html/home.html/
  // mine.html/teller.html) already reflects this, not just the currently-open page -
  // this is what closes tasks.html's read-only gap without touching its own fetch code.
  function writeThroughCache(balance, bonus) {
    try {
      let existing = {};
      try { existing = JSON.parse(localStorage.getItem('cachedUserProfile') || '{}') || {}; } catch (e) { existing = {}; }
      existing.balance = balance;
      existing.bonus = bonus;
      localStorage.setItem('cachedUserProfile', JSON.stringify(existing));
    } catch (e) { /* localStorage unavailable - live DOM update above still happened */ }
  }

  function writeThroughTellerCache(balance) {
    try {
      localStorage.setItem('cachedTellerBalance', JSON.stringify({ balance }));
    } catch (e) { /* ignore */ }
  }

  function handleMessage(event) {
    let data;
    try { data = JSON.parse(event.data); } catch (e) { return; }
    if (data.type === 'balance_update') {
      updateBalanceDom(Number(data.balance) || 0, Number(data.bonus) || 0);
      writeThroughCache(Number(data.balance) || 0, Number(data.bonus) || 0);
    } else if (data.type === 'teller_balance_update') {
      updateTellerBalanceDom(Number(data.balance) || 0);
      writeThroughTellerCache(Number(data.balance) || 0);
    } else if (data.type === 'chat_reply') {
      // mine.html's existing chat-modal code listens for this instead of owning a socket.
      window.dispatchEvent(new CustomEvent('liveChatReply', { detail: data }));
    }
  }

  function scheduleReconnect() {
    if (intentionallyClosed || !lastToken) return;
    const delay = Math.min(WS_RECONNECT_BASE_MS * Math.pow(2, reconnectAttempt), WS_RECONNECT_MAX_MS);
    reconnectAttempt++;
    if (reconnectTimeoutId) clearTimeout(reconnectTimeoutId);
    reconnectTimeoutId = setTimeout(() => connect(lastToken), delay);
  }

  function connect(token) {
    if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) return;
    lastToken = token;
    try {
      socket = new WebSocket(wsUrl());
    } catch (e) {
      scheduleReconnect();
      return;
    }
    socket.onopen = () => {
      reconnectAttempt = 0;
      socket.send(JSON.stringify({ token }));
    };
    socket.onmessage = handleMessage;
    socket.onclose = () => { if (!intentionallyClosed) scheduleReconnect(); };
    // onclose always fires after onerror for a WS - reconnect is handled there, this
    // just stops an uncaught-error-looking console entry from onerror alone.
    socket.onerror = () => {};
  }

  async function start() {
    let retries = 0;
    while (typeof window.AuthService === 'undefined' && retries < 20) {
      await new Promise((resolve) => setTimeout(resolve, 150));
      retries++;
    }
    if (typeof window.AuthService === 'undefined') return;
    try {
      const session = await window.AuthService.getSession();
      if (session && session.access_token) connect(session.access_token);
    } catch (e) { /* no session yet - guard on each page will redirect to login if needed */ }
  }

  // A backgrounded tab's WS can get silently dropped by the browser/OS - reconnect
  // when the user actually comes back rather than waiting for the next reconnect
  // backoff tick, which could be up to 30s away.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && (!socket || socket.readyState === WebSocket.CLOSED)) {
      reconnectAttempt = 0;
      if (lastToken) connect(lastToken);
      else start();
    }
  });

  window.addEventListener('beforeunload', () => {
    intentionallyClosed = true;
    if (reconnectTimeoutId) clearTimeout(reconnectTimeoutId);
    if (socket) socket.close();
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
