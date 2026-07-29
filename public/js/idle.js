/* ============================================================
 * idle.js — Control de inactividad con aviso previo
 *
 * Flujo:
 *   1. Al entrar al campus, IdleGuard.start() carga los parámetros
 *      del servidor y registra los listeners de actividad.
 *   2. Tras idle_warn_ms sin actividad → muestra el modal con
 *      cuenta regresiva del tiempo restante.
 *   3. Si el usuario hace clic en "Sigo aquí" → resetea el timer.
 *   4. Si no responde → cierra sesión al cumplirse idle_total_ms.
 *   5. Durante examen (screen-exam, screen-sim, Proctor.active,
 *      Sim.mode==='evaluation') el guard se pausa automáticamente.
 * ============================================================ */
const IdleGuard = {
  _warnMs:   180_000,   // 3 min → mostrar aviso (default)
  _totalMs:  300_000,   // 5 min → cerrar sesión (default)
  _warnId:   null,      // setTimeout para el aviso
  _closeId:  null,      // setTimeout para el cierre definitivo
  _tickId:   null,      // setInterval para la cuenta regresiva
  _active:   false,
  _paused:   false,

  /* ── Pantallas y condiciones que pausan el guard ───────────── */
  _isExempt() {
    const activeScreen = document.querySelector('.screen.active');
    const sid = activeScreen?.id;
    // Exámenes teórico y práctico: nunca interrumpir
    if (sid === 'screen-exam' || sid === 'screen-sim') return true;
    // Proctor activo o simulador en modo evaluación
    if (typeof Proctor !== 'undefined' && Proctor.active) return true;
    if (typeof Sim !== 'undefined' && Sim.mode === 'evaluation') return true;
    // Sin sesión activa
    if (typeof API !== 'undefined' && !API.token) return true;
    return false;
  },

  /* ── Cargar parámetros del servidor ────────────────────────── */
  async _loadConfig() {
    try {
      const r = await fetch('/api/admin/settings/idle', {
        headers: { Authorization: 'Bearer ' + (API?.token || '') }
      }).then(x => x.json());
      if (r.config) {
        this._warnMs  = Number(r.config.idle_warn_ms)  || this._warnMs;
        this._totalMs = Number(r.config.idle_total_ms) || this._totalMs;
      }
    } catch { /* usar defaults */ }
  },

  /* ── Iniciar el guard ───────────────────────────────────────── */
  async start() {
    this.stop(); // limpiar cualquier instancia previa
    await this._loadConfig();
    this._active = true;
    this._paused = false;

    // Escuchar actividad del usuario
    const reset = () => this._onActivity();
    ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll', 'click'].forEach(ev =>
      document.addEventListener(ev, reset, { passive: true })
    );
    this._removeListeners = () =>
      ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll', 'click'].forEach(ev =>
        document.removeEventListener(ev, reset)
      );

    this._schedule();
  },

  /* ── Detener el guard completamente ────────────────────────── */
  stop() {
    this._active = false;
    clearTimeout(this._warnId);
    clearTimeout(this._closeId);
    clearInterval(this._tickId);
    this._warnId = this._closeId = this._tickId = null;
    if (this._removeListeners) { this._removeListeners(); this._removeListeners = null; }
    this._removeModal();
  },

  /* ── Resetear al detectar actividad ────────────────────────── */
  _onActivity() {
    if (!this._active || this._isExempt()) return;
    if (this._paused) return;
    // Si el modal de aviso ya está visible, no interrumpir con actividad de fondo
    if (document.getElementById('idle-modal')) return;
    this._schedule();
  },

  /* ── Programar el siguiente aviso ──────────────────────────── */
  _schedule() {
    clearTimeout(this._warnId);
    clearTimeout(this._closeId);
    clearInterval(this._tickId);
    if (!this._active) return;

    this._warnId = setTimeout(() => {
      if (this._isExempt()) { this._schedule(); return; } // aún en examen: posponer
      this._showWarning();
    }, this._warnMs);
  },

  /* ── Mostrar el modal de aviso con cuenta regresiva ─────────── */
  _showWarning() {
    this._removeModal(); // por si acaso hay uno anterior

    const remainMs = this._totalMs - this._warnMs; // tiempo desde el aviso hasta el cierre
    let secsLeft = Math.round(remainMs / 1000);

    const modal = document.createElement('div');
    modal.id = 'idle-modal';
    modal.setAttribute('role', 'alertdialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', 'idle-title');
    modal.setAttribute('aria-describedby', 'idle-desc');
    modal.style.cssText = [
      'position:fixed;inset:0;z-index:99999',
      'display:flex;align-items:center;justify-content:center',
      'background:rgba(0,0,0,0.55)',
      'animation:idle-fade-in .18s ease'
    ].join(';');

    modal.innerHTML = `
      <style>
        @keyframes idle-fade-in { from { opacity:0; } to { opacity:1; } }
        @keyframes idle-shrink   { from { width:100%; } to { width:0%; } }
        #idle-box { background:var(--panel,#fff); border:1px solid var(--line,#ddd);
          border-radius:14px; padding:32px 28px 24px; max-width:400px; width:90%;
          box-shadow:0 8px 40px rgba(0,0,0,.22); text-align:center; }
        #idle-icon { font-size:44px; margin-bottom:12px; }
        #idle-title { font-size:17px; font-weight:700; margin-bottom:8px; }
        #idle-desc { font-size:14px; color:var(--muted,#666); margin-bottom:20px; line-height:1.55; }
        #idle-secs { font-size:36px; font-weight:800; color:var(--alert,#e54d4d);
          margin-bottom:16px; font-variant-numeric:tabular-nums; }
        #idle-bar-wrap { height:5px; border-radius:3px; background:var(--line,#eee);
          margin-bottom:22px; overflow:hidden; }
        #idle-bar { height:100%; border-radius:3px; background:var(--alert,#e54d4d);
          animation:idle-shrink ${secsLeft}s linear forwards; }
        #idle-btn { display:block; width:100%; padding:12px; border-radius:8px;
          background:var(--blue,#3d82e8); color:#fff; border:none; font-size:15px;
          font-weight:600; cursor:pointer; transition:opacity .15s; }
        #idle-btn:hover { opacity:.88; }
      </style>
      <div id="idle-box">
        <div id="idle-icon">⏰</div>
        <div id="idle-title">¿Seguís presente?</div>
        <div id="idle-desc">
          No se detectó actividad. La sesión se cerrará automáticamente en:
        </div>
        <div id="idle-secs">${secsLeft}</div>
        <div id="idle-bar-wrap"><div id="idle-bar"></div></div>
        <button id="idle-btn" autofocus>Sigo aquí — continuar</button>
      </div>`;

    document.body.appendChild(modal);

    // Cuenta regresiva visible
    this._tickId = setInterval(() => {
      secsLeft--;
      const el = document.getElementById('idle-secs');
      if (el) el.textContent = Math.max(0, secsLeft);
      if (secsLeft <= 0) clearInterval(this._tickId);
    }, 1000);

    // Cierre automático al vencer el tiempo del aviso
    this._closeId = setTimeout(() => this._logout('inactividad'), remainMs);

    // Botón "Sigo aquí"
    document.getElementById('idle-btn').addEventListener('click', () => {
      clearTimeout(this._closeId);
      clearInterval(this._tickId);
      this._removeModal();
      this._schedule(); // reiniciar desde cero
    });
  },

  /* ── Quitar el modal si existe ──────────────────────────────── */
  _removeModal() {
    document.getElementById('idle-modal')?.remove();
  },

  /* ── Cerrar sesión por inactividad ─────────────────────────── */
  _logout(motivo) {
    this.stop();
    // Liberar cupo de cola si es estudiante
    if (typeof API !== 'undefined' && API.token && API.user?.role === 'estudiante') {
      fetch('/api/queue/leave', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + API.token }
      }).catch(() => {});
    }
    // Limpiar sesión y mostrar mensaje
    if (typeof API !== 'undefined') API.clearSession();
    if (typeof App !== 'undefined') {
      App._heartbeatId && clearInterval(App._heartbeatId);
      // Mostrar la pantalla de auth con mensaje de inactividad
      App.show('screen-auth');
      setTimeout(() => {
        // Inyectar el aviso en la pantalla de login
        const existing = document.getElementById('idle-notice');
        if (existing) existing.remove();
        const notice = document.createElement('div');
        notice.id = 'idle-notice';
        notice.setAttribute('role', 'alert');
        notice.style.cssText = [
          'background:rgba(229,77,77,.1)',
          'border:1px solid rgba(229,77,77,.35)',
          'border-radius:8px',
          'padding:12px 16px',
          'font-size:13px',
          'color:var(--alert,#c0392b)',
          'margin-bottom:14px',
          'text-align:center'
        ].join(';');
        notice.innerHTML = '⏰ La sesión se cerró automáticamente por ' +
          (motivo === 'inactividad' ? 'inactividad prolongada.' : motivo + '.') +
          ' Iniciá sesión nuevamente para continuar.';
        const form = document.getElementById('form-login');
        if (form) form.parentElement.insertBefore(notice, form);
      }, 50);
    }
  },

  /* ── Pausar temporalmente (útil si otra parte del código lo necesita) ── */
  pause() { this._paused = true; clearTimeout(this._warnId); clearTimeout(this._closeId); clearInterval(this._tickId); },
  resume() { if (this._active) { this._paused = false; this._schedule(); } }
};
