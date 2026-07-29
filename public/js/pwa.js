/* ============================================================
 * pwa.js — Gestión de la PWA: instalación, SW, notificaciones
 * y detección de dispositivo para bloqueo de examen en mobile.
 * ============================================================ */
const PWA = {
  _installPrompt: null,
  _swRegistration: null,

  // ── Inicialización ────────────────────────────────────────────
  async init() {
    // Registrar Service Worker
    if ('serviceWorker' in navigator) {
      try {
        this._swRegistration = await navigator.serviceWorker.register('/sw.js');
        // Si hay una actualización disponible, notificar al usuario
        this._swRegistration.addEventListener('updatefound', () => {
          const newSW = this._swRegistration.installing;
          newSW.addEventListener('statechange', () => {
            if (newSW.state === 'installed' && navigator.serviceWorker.controller) {
              this._showUpdateBanner();
            }
          });
        });
      } catch(e) { console.warn('SW no registrado:', e.message); }
    }

    // Capturar el evento de instalación para mostrarlo en el momento oportuno
    window.addEventListener('beforeinstallprompt', e => {
      e.preventDefault();
      this._installPrompt = e;
      // Mostrar el banner de instalación solo si el usuario está logueado
      // y no está en medio de un examen
      if (API.token) this._showInstallBanner();
    });

    window.addEventListener('appinstalled', () => {
      this._installPrompt = null;
      document.getElementById('pwa-install-banner')?.remove();
    });
  },

  // ── Detección de dispositivo mobile (para bloqueo de examen) ──
  detectDevice() {
    const ua = navigator.userAgent || '';
    const esMobileUA = /Android|iPhone|iPad|iPod|Mobile|webOS/i.test(ua);

    // pointer: coarse = pantalla táctil. pointer: fine = mouse real.
    // Esta propiedad NO se puede falsificar desde el navegador.
    const esTactil = window.matchMedia('(pointer: coarse)').matches;
    const tieneMouse = window.matchMedia('(pointer: fine)').matches;

    // Resolución física de la pantalla
    const pantallaChica = Math.min(screen.width, screen.height) < 600;

    // Touch points: 0 o 1 puede ser mouse. >1 es definitivamente táctil.
    const touchPoints = navigator.maxTouchPoints || 0;

    return {
      esMobile: esMobileUA || esTactil || pantallaChica || touchPoints > 1,
      esTactil,
      tieneMouse,
      pantallaChica,
      touchPoints,
      screenW: screen.width,
      screenH: screen.height,
      ua: ua.slice(0, 120),
    };
  },

  // ── Verificar si puede rendir examen ─────────────────────────
  puedeRendirExamen() {
    const d = this.detectDevice();
    return {
      permitido: !d.esMobile,
      razon: d.esMobile
        ? 'Los exámenes deben rendirse desde una computadora con cámara. '
          + 'Podés continuar estudiando desde acá — cuando estés listo, '
          + 'accedé a SINCA desde tu PC para rendir.'
        : null,
      device: d,
    };
  },

  // ── Banner de instalación ─────────────────────────────────────
  _showInstallBanner() {
    if (document.getElementById('pwa-install-banner')) return;
    const banner = document.createElement('div');
    banner.id = 'pwa-install-banner';
    banner.setAttribute('role', 'complementary');
    banner.setAttribute('aria-label', 'Instalar aplicación');
    banner.innerHTML = `
      <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
        <span style="font-size:22px">📲</span>
        <div style="flex:1;min-width:0">
          <div style="font-weight:600;font-size:14px">Instalá SINCA en tu celular</div>
          <div style="font-size:12px;color:var(--muted)">Accedé sin abrir el navegador, sin usar datos adicionales</div>
        </div>
        <button id="pwa-install-btn" class="btn-primary" style="width:auto;font-size:13px;padding:8px 16px">
          Instalar app
        </button>
        <button id="pwa-install-close" class="btn-ghost" aria-label="Cerrar"
          style="width:auto;font-size:18px;padding:4px 10px;border:none;background:none">✕</button>
      </div>`;

    // Estilo del banner
    Object.assign(banner.style, {
      position: 'fixed', bottom: '72px', left: '12px', right: '12px',
      background: 'var(--panel)', border: '1px solid var(--line)',
      borderRadius: '14px', padding: '14px 16px',
      boxShadow: '0 4px 24px rgba(0,0,0,.18)',
      zIndex: '9000',
      animation: 'slide-up .3s ease',
    });

    document.body.appendChild(banner);

    document.getElementById('pwa-install-btn').addEventListener('click', async () => {
      if (!this._installPrompt) return;
      this._installPrompt.prompt();
      const { outcome } = await this._installPrompt.userChoice;
      if (outcome === 'accepted') banner.remove();
      this._installPrompt = null;
    });

    document.getElementById('pwa-install-close').addEventListener('click', () => {
      banner.remove();
      // No volver a mostrar en esta sesión
      sessionStorage.setItem('pwa-banner-dismissed', '1');
    });

    // Auto-cerrar después de 12 segundos si no interactuó
    setTimeout(() => banner.remove(), 12000);
  },

  // ── Banner de actualización disponible ────────────────────────
  _showUpdateBanner() {
    const banner = document.createElement('div');
    banner.id = 'pwa-update-banner';
    banner.innerHTML = `
      <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
        <span style="font-size:20px">🔄</span>
        <div style="flex:1">
          <div style="font-weight:600;font-size:14px">Hay una actualización disponible</div>
          <div style="font-size:12px;color:var(--muted)">Recargá para obtener la versión más reciente de SINCA</div>
        </div>
        <button onclick="location.reload()" class="btn-primary" style="width:auto;font-size:13px">
          Actualizar ahora
        </button>
      </div>`;
    Object.assign(banner.style, {
      position: 'fixed', top: '0', left: '0', right: '0',
      background: 'var(--panel)', borderBottom: '2px solid var(--blue)',
      padding: '12px 16px', zIndex: '9999',
      boxShadow: '0 2px 12px rgba(0,0,0,.15)',
    });
    document.body.prepend(banner);
  },

  // ── Solicitar permiso de notificaciones push ──────────────────
  async requestNotifications() {
    if (!('Notification' in window)) return false;
    if (Notification.permission === 'granted') return true;
    if (Notification.permission === 'denied') return false;
    const result = await Notification.requestPermission();
    return result === 'granted';
  },

  // ── Notificación local (sin push server) ─────────────────────
  async notify(title, body, opts = {}) {
    if (Notification.permission !== 'granted') return;
    const reg = this._swRegistration;
    if (reg) {
      await reg.showNotification(title, {
        body, icon: '/icons/icon-192.png', badge: '/icons/icon-96.png',
        vibrate: [100, 50, 100], ...opts,
      });
    } else {
      new Notification(title, { body, icon: '/icons/icon-192.png', ...opts });
    }
  },
};
