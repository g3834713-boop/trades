(function () {
  function ensureStyles() {
    if (document.getElementById('whatsappButtonSharedStyles')) return;
    const style = document.createElement('style');
    style.id = 'whatsappButtonSharedStyles';
    style.textContent = `
      .whatsapp-float-btn { display:none; position:fixed; left:16px; bottom:80px; z-index:998; width:52px; height:52px;
        border-radius:50%; background:#25D366; color:#fff; align-items:center; justify-content:center; font-size:28px;
        box-shadow:0 8px 24px var(--shadow-strong, rgba(0,0,0,0.3)); cursor:pointer; text-decoration:none; border:none; }
      .whatsapp-float-btn:hover { filter:brightness(1.05); }
    `;
    document.head.appendChild(style);
  }

  function ensureButton() {
    if (document.getElementById('whatsappFloatBtn')) return;
    const btn = document.createElement('a');
    btn.id = 'whatsappFloatBtn';
    btn.className = 'whatsapp-float-btn';
    btn.target = '_blank';
    btn.rel = 'noopener';
    btn.title = 'Message us on WhatsApp';
    btn.innerHTML = '<i class="lab la-whatsapp"></i>';
    document.body.appendChild(btn);
  }

  async function loadNumber() {
    try {
      const res = await fetch(`${window.CONFIG.API_URL}/settings`);
      if (!res.ok) return;
      const settings = await res.json();
      const number = settings?.support?.supportWhatsappNumber;
      const btn = document.getElementById('whatsappFloatBtn');
      if (!btn) return;
      if (number && String(number).trim()) {
        const digits = String(number).replace(/[^\d]/g, '');
        btn.href = `https://wa.me/${digits}`;
        btn.style.display = 'flex';
      } else {
        btn.style.display = 'none';
      }
    } catch (err) {
      console.warn('WhatsApp button: failed to load number:', err.message);
    }
  }

  function start() {
    ensureStyles();
    ensureButton();
    loadNumber();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
