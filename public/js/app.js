/* app.js — Controlador general de SINCA */
const App = {
  lastCertificate: null,
  practicalCourseId: null,

  show(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById(id).classList.add('active');
    window.scrollTo(0, 0);
  },

  async boot() {
    // Inicializar PWA (Service Worker + detección de dispositivo)
    await PWA.init();

    // Detectar si es mobile y configurar la experiencia correspondiente
    const device = PWA.detectDevice();
    if (device.esMobile) {
      document.body.classList.add('is-mobile');
      this._isMobile = true;
    }

    Sim.init();
    this._bindAuth();
    this._bindShell();
    this._loadJerarquias();
    if (API.hasSession) {
      try { await this.enterCampus(); return; }
      catch { API.clearSession(); }
    }
    this.show('screen-auth');
  },

  async _loadJerarquias() {
    try {
      const { jerarquias } = await fetch('/api/jerarquias').then(r=>r.json());
      const sel = document.getElementById('reg-rango-select');
      if (sel) {
        jerarquias.forEach(j => {
          const opt = document.createElement('option');
          opt.value = j; opt.textContent = j;
          sel.appendChild(opt);
        });
      }
    } catch {}
  },

  /* ---------- Autenticación ---------- */
  _bindAuth() {
    const err = document.getElementById('auth-error');
    const showErr = m => { err.textContent = m; err.classList.remove('hidden'); };

    document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(x => x.classList.remove('active'));
      t.classList.add('active');
      document.getElementById('form-login').classList.toggle('hidden', t.dataset.tab !== 'login');
      document.getElementById('form-register').classList.toggle('hidden', t.dataset.tab !== 'register');
      err.classList.add('hidden');
    }));

    document.getElementById('form-login').addEventListener('submit', async e => {
      e.preventDefault();
      const fd = new FormData(e.target);
      try {
        const res = await fetch('/api/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ usuario: fd.get('usuario'), password: fd.get('password') })
        });
        const data = await res.json();

        // ── Cola virtual: el sistema está lleno ──────────────────────
        if (res.status === 503 && data.en_cola) {
          App._queueCredentials = { usuario: fd.get('usuario'), password: fd.get('password') };
          App._showQueue(data);
          return;
        }

        if (!res.ok) { showErr(data.error || 'Error ' + res.status); return; }

        const { token, user } = data;
        API.setSession(token, user);
        await this.enterCampus();
      } catch (ex) { showErr(ex.message); }
    });

    document.getElementById('form-register').addEventListener('submit', async e => {
      e.preventDefault();
      const fd = new FormData(e.target);
      try {
        const { token, user } = await API.register({
          nombre: fd.get('nombre'), apellido: fd.get('apellido'), dni: fd.get('dni'),
          legajo: fd.get('legajo'), rango: fd.get('rango'), organismo: fd.get('organismo'),
          password: fd.get('password')
        });
        API.setSession(token, user);
        await this.enterCampus();
      } catch (ex) { showErr(ex.message); }
    });

    document.getElementById('verify-btn').addEventListener('click', async () => {
      const out = document.getElementById('verify-result');
      const code = document.getElementById('verify-input').value.trim();
      if (!code) return;
      try {
        const { certificate: c, vigente } = await API.verify(code);
        out.style.color = vigente ? 'var(--ok)' : 'var(--organic)';
        out.textContent = `✔ Válido — ${c.apellido}, ${c.nombre} (DNI ${c.dni || '—'}, Leg. ${c.legajo}) · ${c.curso_cod} · ${c.score_pct} % · ` +
          (c.vencimiento ? `vence ${c.vencimiento}${vigente ? '' : ' — VENCIDO, requiere recurrencia'}` : 'sin vencimiento');
      } catch (ex) {
        out.style.color = 'var(--alert)';
        out.textContent = '✘ ' + ex.message;
      }
    });
  },

  /* ---------- Campus ---------- */
  async enterCampus() {
    const { user } = await API.me();
    API.setSession(API.token, user);
    document.getElementById('operator-info').textContent =
      `${user.rango ? user.rango + ' ' : ''}${user.apellido}, ${user.nombre} · ${user.role.toUpperCase()}`;
    const canManage = ['admin','instructor','supervisor','fiscalizador','sanidad','juosp','juosp_regional'].includes(user.role);
    document.getElementById('nav-gestion').classList.toggle('hidden', !canManage);

    // Limpiar la cola si venía de esperar
    const qd = document.getElementById('queue-waiting');
    if (qd) qd.remove();

    this.show('screen-campus');

    // Roles sin campus de alumno van directo a su panel de gestión
    const roleSinCampus = ['sanidad','medico','juosp','juosp_regional'].includes(user.role);
    if (roleSinCampus) {
      Campus.nav('gestion');
    } else {
      Campus.nav('catalogo');
    }

    // Mostrar la nav mobile si corresponde y bindear sus botones
    if (this._isMobile) this._initMobileNav();

    // ── Módulo 4: verificar estado de destino al login ─────────────────
    // No aplica al usuario demo ni a roles exclusivamente médicos
    if (user.usuario !== 'demo' && !['sanidad'].includes(user.role)) {
      this._checkDestino();
    }

    // Solicitar permiso de notificaciones al entrar (solo una vez)
    if (this._isMobile && !sessionStorage.getItem('notif-asked')) {
      sessionStorage.setItem('notif-asked', '1');
      setTimeout(() => PWA.requestNotifications(), 3000);
    }
    // Iniciar heartbeat para mantener el cupo en la cola virtual (solo estudiantes)
    this._startHeartbeat();
    // Iniciar control de inactividad (desactivado en modo demo)
    if (user.usuario !== 'demo') IdleGuard.start();

    // Banner de modo demo
    document.getElementById('demo-banner')?.remove();
    if (user.usuario === 'demo') {
      const b = document.createElement('div');
      b.id = 'demo-banner';
      b.innerHTML = '🎯 <strong>MODO DEMO</strong> — Todas las restricciones operativas están desactivadas. Las firmas emitidas no tienen validez legal.';
      Object.assign(b.style, {
        position:'fixed', top:'0', left:'0', right:'0', zIndex:'9990',
        background:'#C89614', color:'#000', fontSize:'12px', fontWeight:'600',
        padding:'7px 14px', textAlign:'center', letterSpacing:'.02em',
      });
      document.body.prepend(b);
      // Empujar el contenido hacia abajo
      document.getElementById('screen-campus').style.paddingTop = '32px';
    }
    // Iniciar badges de pendientes
    if (this._pendientesTimer) clearInterval(this._pendientesTimer);
    setTimeout(() => this._pollPendientes(), 1000);
    this._pendientesTimer = setInterval(() => this._pollPendientes(), 30000);
  },

  async _pollPendientes() {
    if (!API.token) return;
    try {
      const p = await fetch('/api/pendientes', {headers:{'Authorization':'Bearer '+API.token}}).then(r=>r.json());
      const total = (p.eppt||0)+(p.supervision||0)+(p.vencimientos||0)+(p.eppt_vencidos||0);
      const navG = document.getElementById('nav-gestion');
      if (navG) {
        let badge = navG.querySelector('.nav-badge');
        if (total > 0) {
          if (!badge) {
            badge = document.createElement('span');
            badge.className = 'nav-badge';
            badge.style.cssText = 'display:inline-block;background:#e5484d;color:#fff;border-radius:50%;min-width:17px;height:17px;font-size:10px;font-weight:700;text-align:center;line-height:17px;padding:0 3px;margin-left:5px;vertical-align:middle;animation:badgePulse 1.5s ease infinite;box-sizing:border-box';
            navG.appendChild(badge);
          }
          badge.textContent = total > 9 ? '9+' : String(total);
          navG.title = 'Pendientes — EPPT: '+(p.eppt||0)+' · Supervisión: '+(p.supervision||0)+' · Vencimientos: '+(p.vencimientos||0);
        } else if (badge) badge.remove();
      }

    } catch {}
  },

  _bindShell() {
    document.querySelectorAll('#mainnav button').forEach(b =>
      b.addEventListener('click', () => Campus.nav(b.dataset.nav)));
    document.getElementById('btn-logout').addEventListener('click', () => App.logout());
    document.getElementById('btn-course-back').addEventListener('click', () => this.enterCampus());
    document.getElementById('btn-lesson-exit').addEventListener('click', () => {
      if (confirm('Si abandona la unidad, la sesión de visualización no se computa y deberá reiniciarla. ¿Salir?'))
        Campus.openCourse(Campus.courseId);
    });
    document.getElementById('btn-exam-cancel').addEventListener('click', () => {
      if (confirm('Si cancela, la sesión de examen generada queda inutilizada (no consume intento hasta que entregue). ¿Salir?'))
        Campus.openCourse(Campus.courseId);
    });
    document.getElementById('btn-exam-submit').addEventListener('click', () => Campus.submitExam());
    document.getElementById('btn-exit-sim').addEventListener('click', () => {
      if (Sim.mode === 'evaluation' && !confirm('¿Abandonar el examen práctico? Las imágenes no respondidas se computan incorrectas.')) return;
      if (Sim.mode === 'evaluation') { Sim.finishEvaluation(true); return; }
      Sim.teardown();
      Campus.courseId ? Campus.openCourse(Campus.courseId) : this.enterCampus();
      if (!Campus.courseId) this.enterCampus();
    });
    document.getElementById('btn-back-menu').addEventListener('click', () => {
      Campus.courseId ? (this.show('screen-course'), Campus.openCourse(Campus.courseId)) : this.enterCampus();
    });
    document.getElementById('btn-download-cert').addEventListener('click', () => {
      if (this.lastCertificate) generateCertificatePDF(this.lastCertificate);
    });
  },

  /* ---------- Arranque de modos del simulador ---------- */
  async startFreeTraining() {
    try {
      const { images, admin, totales } = await API.images('?only=annotated&limit=300&shuffle=1');
      if (admin && totales) console.log('Banco de imágenes:', totales);
      Campus.courseId = null;
      await Sim.start('training', images, null);
      this.show('screen-sim');
    } catch (e) { alert(e.message); }
  },

  async openAnnotator() {
    try {
      const r = await API.images('?only=pending&limit=500');
      const pool = r.images.length ? r.images : (await API.images('?only=all&limit=500')).images;
      if (!pool.length) return alert('No hay imágenes en el banco. Cargue imágenes desde Gestión → Banco de imágenes.');
      Campus.courseId = null;
      await Sim.start('annotator', pool, null);
      this.show('screen-sim');
    } catch (e) { alert(e.message); }
  },

  async startPractical(courseId) {
    // Bloqueo: el simulador de RX también requiere PC
    if (typeof PWA !== 'undefined' && !this.checkExamAllowed()) return;
    const launch = async () => {
      try {
        this.practicalCourseId = courseId;
        await Sim.start('evaluation', [], courseId);   // el set lo asigna el servidor
        this.show('screen-sim');
      } catch (e) { alert(e.message); await Proctor.end(); }
    };
    Proctor.onBlock = () => { App.show('screen-campus'); Campus.openCourse(courseId); };
    if (Campus.currentCourse?.proctor) Proctor.begin(courseId, 'practico', launch, () => {});
    else launch();
  },

  /* ---------- Resultados ---------- */
  showTheoryResult(r) {
    this.lastCertificate = r.certificate || null;
    document.getElementById('results-title').textContent =
      `Examen teórico — ${r.tipo === 'recuperatorio' ? 'Recuperatorio' : 'Primera instancia'}`;
    const dial = document.getElementById('results-score');
    dial.textContent = r.score_pct + ' %';
    dial.parentElement.className = 'score-dial ' + (r.passed ? 'pass' : 'fail');
    document.getElementById('results-detail').textContent =
      (r.passed ? `APROBADO (mínimo ${r.nota_min} %). ` : `NO APROBADO (mínimo ${r.nota_min} %). `) +
      (r.curso_aprobado ? 'Curso completo: certificado emitido.' : r.eppt_pendiente ? `Exámenes aprobados: se habilitó el EPPT (${r.eppt?.regla || 'entrenamiento en el puesto'}) hasta el ${r.eppt?.deadline}. El certificado se emite al completarlo.` :
        r.passed ? 'Reste aprobar el práctico si el curso lo exige.' :
        (r.tipo === 'teorico' ? 'Dispone de una instancia de recuperación.' : 'Sin más instancias: contacte al docente.'));
    document.getElementById('btn-download-cert').classList.toggle('hidden', !this.lastCertificate);
    document.querySelector('#results-table tbody').innerHTML = '';
    this.show('screen-results');
  },

  showPracticalResult(r, byTimeout) {
    if (r.error) {
      document.getElementById('results-title').textContent = 'Examen práctico';
      document.getElementById('results-score').textContent = '—';
      document.getElementById('results-score').parentElement.className = 'score-dial fail';
      document.getElementById('results-detail').textContent = r.error;
      document.getElementById('btn-download-cert').classList.add('hidden');
      document.querySelector('#results-table tbody').innerHTML = '';
      this.show('screen-results');
      return;
    }
    this.lastCertificate = r.certificate || null;
    document.getElementById('results-title').textContent =
      byTimeout ? 'Examen práctico — tiempo agotado' : 'Examen práctico — Simulador de Rayos X';
    const dial = document.getElementById('results-score');
    dial.textContent = r.score_pct + ' %';
    dial.parentElement.className = 'score-dial ' + (r.passed ? 'pass' : 'fail');
    document.getElementById('results-detail').textContent =
      `${r.correct}/${r.total} imágenes correctas · AEI: ${r.aei_ok ? 'todos detectados ✔' : 'NO detectado ✘ (condición excluyente)'} · ` +
      `Puntaje ponderado (AEI 40 %): ${r.score_pct} % · Mínimo ${r.nota_min} %. ` +
      (r.passed ? (r.curso_aprobado ? 'CURSO APROBADO: certificado emitido.' : r.eppt_pendiente ? `Práctico APROBADO. Se habilitó el EPPT (${r.eppt?.regla || ''}) con vencimiento ${r.eppt?.deadline}: el certificado se emite al completar las horas en el puesto con firma dual.` : 'Práctico APROBADO.')
                : 'DESAPROBADO. El práctico no tiene recuperatorio: el docente puede rehabilitar la cursada.');
    document.getElementById('btn-download-cert').classList.toggle('hidden', !this.lastCertificate);
    const tbody = document.querySelector('#results-table tbody');
    tbody.innerHTML = '';
    (r.detail || []).forEach((d, i) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${i + 1}</td><td class="mono">${d.f}${d.aei ? ' · AEI' : ''}</td>
        <td>${d.aei ? 'Imagen crítica' : 'Imagen estándar'}</td>
        <td>${d.ok ? '<span class="badge-pass">✔</span>' : '<span class="badge-fail">✘</span>'}</td>`;
      tbody.appendChild(tr);
    });
    this.show('screen-results');
  },

  /* ══════════════════════════════════════════════════════════════════
     COLA VIRTUAL
     Muestra la pantalla de espera y hace polling cada 8 segundos.
     Cuando el servidor admite al estudiante, entra al campus.
  ══════════════════════════════════════════════════════════════════ */
  _queueCredentials: null,
  _queueIntervalId: null,
  _heartbeatId: null,

  _showQueue(data) {
    // Reutilizar la pantalla de auth para mostrar la cola
    this.show('screen-auth');
    const loginBox = document.getElementById('form-login')?.closest('.auth-card') ||
                     document.getElementById('form-login')?.parentElement;
    const queueDiv = document.createElement('div');
    queueDiv.id = 'queue-waiting';
    queueDiv.style.cssText = 'text-align:center;padding:24px 16px';
    queueDiv.innerHTML = `
      <div style="font-size:40px;margin-bottom:12px">⏳</div>
      <h2 style="margin-bottom:8px">Sistema al máximo de capacidad</h2>
      <p class="hint" style="margin-bottom:20px;max-width:380px;margin-inline:auto">
        Hay <b>${data.max_concurrent}</b> estudiantes activos. Estás en la fila virtual y entrarás automáticamente cuando se libere un lugar.
      </p>
      <div style="background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:20px;margin-bottom:20px;display:inline-block;min-width:260px">
        <div style="font-size:32px;font-weight:800;color:var(--blue)" id="q-pos">${data.posicion}</div>
        <div style="font-size:13px;color:var(--muted);margin-bottom:12px">posición en la fila</div>
        <div style="display:flex;justify-content:center;gap:24px;font-size:13px">
          <div><b id="q-total">${data.total_cola}</b><br><span class="hint">en fila</span></div>
          <div><b id="q-activos">${data.activos}</b><br><span class="hint">activos</span></div>
          <div><b id="q-espera">${Math.ceil(data.espera_estimada_s / 60)} min</b><br><span class="hint">estimado</span></div>
        </div>
      </div>
      <div id="q-barra" style="height:6px;border-radius:3px;background:var(--line);margin-bottom:16px;overflow:hidden">
        <div id="q-barra-fill" style="height:100%;background:var(--blue);width:0;transition:width 8s linear"></div>
      </div>
      <p class="hint" style="font-size:12px;margin-bottom:16px" id="q-msg">Verificando disponibilidad cada 8 segundos…</p>
      <button class="btn-ghost" onclick="App._queueCancel()" style="font-size:13px">Cancelar y volver al login</button>`;

    // Ocultar el formulario de login y mostrar la pantalla de cola
    if (loginBox) loginBox.style.display = 'none';
    const authScreen = document.getElementById('screen-auth');
    authScreen.appendChild(queueDiv);

    // Animar la barra de progreso entre polls
    setTimeout(() => {
      const fill = document.getElementById('q-barra-fill');
      if (fill) fill.style.width = '100%';
    }, 50);

    // Polling cada 8 segundos
    this._queueIntervalId = setInterval(() => this._queuePoll(), 8000);
  },

  async _queuePoll() {
    if (!this._queueCredentials) return;
    try {
      // Reintentar el login con las mismas credenciales
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(this._queueCredentials)
      });
      const data = await res.json();

      if (res.ok && data.token) {
        // Admitido
        clearInterval(this._queueIntervalId);
        this._queueIntervalId = null;
        this._queueCredentials = null;
        document.getElementById('q-msg').textContent = '✔ ¡Lugar disponible! Ingresando…';

        API.setSession(data.token, data.user);
        await this.enterCampus();
        return;
      }

      if (res.status === 503 && data.en_cola) {
        // Actualizar posición en pantalla
        const pos = document.getElementById('q-pos');
        const tot = document.getElementById('q-total');
        const act = document.getElementById('q-activos');
        const esp = document.getElementById('q-espera');
        const fill = document.getElementById('q-barra-fill');
        if (pos) pos.textContent = data.posicion;
        if (tot) tot.textContent = data.total_cola;
        if (act) act.textContent = data.activos;
        if (esp) esp.textContent = Math.ceil(data.espera_estimada_s / 60) + ' min';
        // Reiniciar animación de barra
        if (fill) { fill.style.transition = 'none'; fill.style.width = '0'; }
        setTimeout(() => { if (fill) { fill.style.transition = 'width 8s linear'; fill.style.width = '100%'; } }, 50);
      }
    } catch { /* sin conexión, ignorar */ }
  },

  _queueCancel() {
    clearInterval(this._queueIntervalId);
    this._queueIntervalId = null;
    this._queueCredentials = null;
    const qd = document.getElementById('queue-waiting');
    if (qd) qd.remove();
    const loginBox = document.getElementById('form-login')?.closest('.auth-card') ||
                     document.getElementById('form-login')?.parentElement;
    if (loginBox) loginBox.style.display = '';
  },

  // Heartbeat: se llama desde enterCampus() y se mantiene mientras el usuario está logueado
  _startHeartbeat() {
    if (this._heartbeatId) clearInterval(this._heartbeatId);
    this._heartbeatId = setInterval(async () => {
      if (!API.token || API.user?.role !== 'estudiante') return;
      try {
        const r = await fetch('/api/queue/heartbeat', {
          method: 'POST', headers: { Authorization: 'Bearer ' + API.token }
        }).then(x => x.json());
        if (r.estado === 'expirado') {
          clearInterval(this._heartbeatId);
          alert('Tu sesión expiró por inactividad. Por favor, volvé a ingresar.');
          API.clearSession();
          location.reload();
        }
      } catch { /* sin conexión, no interrumpir */ }
    }, 30_000);
  },

  logout() {
    IdleGuard.stop();
    document.getElementById('mobile-nav')?.classList.add('hidden');
    if (API.user?.role === 'estudiante' && API.token) {
      // Liberar el cupo al salir explícitamente (best-effort, sin esperar)
      fetch('/api/queue/leave', { method: 'POST', headers: { Authorization: 'Bearer ' + API.token } }).catch(() => {});
    }
    clearInterval(this._heartbeatId);
    this._heartbeatId = null;
    API.clearSession();
    this.show('screen-auth');
  },

  // ── Módulo 4: verificación de destino al login ─────────────────────
  async _checkDestino() {
    try {
      const r = await API.getEstadoDestino();

      // Mostrar notificaciones pendientes en la bandeja (no bloquean)
      if (r.notificaciones?.length) this._mostrarBandeja(r.notificaciones);

      if (r.bloquear) {
        // Bloqueo duro: interceptar con pantalla obligatoria
        this._mostrarPantallaDestino(r);
      } else if (r.estado === 'proximo') {
        // Aviso banner sin bloquear
        this._mostrarBannerDestino(r.dias_restantes);
      }

      // Mostrar pendientes de validación para jefes/admins
      if (['supervisor','instructor','juosp','juosp_regional','admin'].includes(API.user?.role)) {
        const pend = await API.getPendientesValidacion().catch(() => ({ pendientes: [] }));
        if (pend.pendientes?.length) this._mostrarBannerValidacion(pend.pendientes);
      }
    } catch(e) { console.warn('checkDestino:', e.message); }
  },

  _mostrarBannerDestino(diasRestantes) {
    document.getElementById('banner-destino')?.remove();
    const b = document.createElement('div');
    b.id = 'banner-destino';
    const color = diasRestantes <= 5 ? '#C05A00' : diasRestantes <= 15 ? '#B8860B' : '#14327A';
    b.innerHTML = `<span>📍 Tu reconfirmación de destino vence en <strong>${diasRestantes} días</strong>. 
      <a href="#" id="link-reconfirmar" style="color:inherit;text-decoration:underline">Actualizar ahora</a></span>
      <button onclick="this.parentElement.remove()" style="background:none;border:none;color:inherit;font-size:16px;cursor:pointer;margin-left:8px">✕</button>`;
    Object.assign(b.style, {
      position:'fixed', top:'0', left:'0', right:'0', zIndex:'8000',
      background: color, color:'#fff', fontSize:'13px', fontWeight:'500',
      padding:'8px 16px', display:'flex', alignItems:'center', justifyContent:'center',
      gap:'8px', boxShadow:'0 2px 8px rgba(0,0,0,.2)',
    });
    document.body.prepend(b);
    document.getElementById('link-reconfirmar')?.addEventListener('click', e => {
      e.preventDefault(); b.remove(); this._mostrarPantallaDestino({ estado: 'proximo' });
    });
  },

  _mostrarBannerValidacion(pendientes) {
    document.getElementById('banner-validacion')?.remove();
    const b = document.createElement('div');
    b.id = 'banner-validacion';
    b.innerHTML = `<span>✅ Tenés <strong>${pendientes.length}</strong> declaración${pendientes.length>1?'es':''} de destino pendiente${pendientes.length>1?'s':''} de tu validación.
      <a href="#" id="link-validar" style="color:inherit;text-decoration:underline">Validar ahora</a></span>
      <button onclick="this.parentElement.remove()" style="background:none;border:none;color:inherit;font-size:16px;cursor:pointer;margin-left:8px">✕</button>`;
    Object.assign(b.style, {
      position:'fixed', top: document.getElementById('banner-destino') ? '36px' : '0',
      left:'0', right:'0', zIndex:'7900',
      background:'#155C3A', color:'#fff', fontSize:'13px', fontWeight:'500',
      padding:'8px 16px', display:'flex', alignItems:'center', justifyContent:'center',
      gap:'8px',
    });
    document.body.prepend(b);
    document.getElementById('link-validar')?.addEventListener('click', e => {
      e.preventDefault(); b.remove();
      if (typeof Gestion !== 'undefined') { Campus.nav('gestion'); setTimeout(() => Gestion.nav('reconfirmacion_destino'), 100); }
    });
  },

  _mostrarBandeja(notifs) {
    // Badge en la nav mostrando cantidad de notificaciones no leídas
    const badge = document.getElementById('notif-badge');
    if (badge) { badge.textContent = notifs.length; badge.style.display = 'inline'; }
  },

  _mostrarPantallaDestino(estadoObj) {
    // Ocultar el campus durante el bloqueo
    document.getElementById('screen-campus').style.display = 'none';
    const overlay = document.createElement('div');
    overlay.id = 'destino-overlay';
    Object.assign(overlay.style, {
      position:'fixed', inset:'0', zIndex:'9500',
      background:'var(--bg)', display:'flex', alignItems:'center', justifyContent:'center',
      padding:'20px',
    });

    const esVencido   = estadoObj.estado === 'vencido' || estadoObj.estado === 'nunca_declarado';
    const titulo      = esVencido ? '📍 Reconfirmación de destino obligatoria' : '📍 Actualizar destino';
    const subtitulo   = esVencido
      ? 'Tu información de destino está vencida. Debés actualizarla para continuar usando el sistema.'
      : `Tu reconfirmación vence en ${estadoObj.dias_restantes} días. Podés actualizarla ahora.`;

    overlay.innerHTML = `
      <div style="background:var(--panel);border:1px solid var(--line);border-radius:18px;
                  padding:28px;max-width:480px;width:100%;box-shadow:0 8px 40px rgba(0,0,0,.3)">
        <div style="text-align:center;margin-bottom:20px">
          <div style="font-size:40px;margin-bottom:10px">📍</div>
          <h2 style="font-size:20px;margin-bottom:8px">${titulo}</h2>
          <p style="color:var(--muted);font-size:14px;line-height:1.5">${subtitulo}</p>
        </div>

        ${esVencido ? `<div style="background:rgba(192,90,0,.1);border:1px solid rgba(192,90,0,.3);
          border-radius:10px;padding:12px 14px;margin-bottom:18px;font-size:13px;color:#C05A00">
          ⚠ Funciones bloqueadas hasta reconfirmar: inscripción a cursos, descarga de certificados,
          firma de documentos y todos los trámites.
        </div>` : ''}

        <label style="font-size:13px;font-weight:600;display:block;margin-bottom:6px">
          Destino / Unidad *
        </label>
        <select id="dest-select" style="width:100%;margin-bottom:14px;padding:11px;font-size:14px;
          border-radius:10px;background:var(--panel-2);border:1px solid var(--line);color:var(--text)">
          <option value="">Cargando catálogo…</option>
        </select>

        <label style="font-size:13px;font-weight:600;display:block;margin-bottom:6px">
          Jefe / Responsable directo *
        </label>
        <select id="jefe-select" style="width:100%;margin-bottom:18px;padding:11px;font-size:14px;
          border-radius:10px;background:var(--panel-2);border:1px solid var(--line);color:var(--text)">
          <option value="">Cargando…</option>
        </select>

        <button id="btn-declarar-destino" class="btn-primary" style="width:100%;margin-bottom:10px">
          Confirmar y continuar
        </button>
        ${!esVencido ? `<button id="btn-skip-destino" class="btn-ghost" style="width:100%;font-size:13px">
          Recordarme más tarde
        </button>` : ''}
        <p id="destino-err" style="color:var(--alert);font-size:13px;margin-top:10px;text-align:center;display:none"></p>
      </div>`;

    document.body.appendChild(overlay);

    // Cargar catálogo y jefes
    Promise.all([API.getDestinosCatalogo(), API.getJefesDisponibles()]).then(([dc, dj]) => {
      const sel = document.getElementById('dest-select');
      sel.innerHTML = '<option value="">Seleccionar destino…</option>' +
        dc.destinos.map(d => `<option value="${d.id}">${d.codigo} — ${d.nombre}${d.aeropuerto?' ('+d.aeropuerto+')':''}</option>`).join('');

      // Pre-seleccionar el destino actual si tiene uno
      if (estadoObj.decl?.destino_id) sel.value = estadoObj.decl.destino_id;

      const jSel = document.getElementById('jefe-select');
      jSel.innerHTML = '<option value="">Seleccionar jefe/responsable…</option>' +
        dj.jefes.map(j => `<option value="${j.id}">${j.apellido}, ${j.nombre} (${j.role})</option>`).join('');

      if (estadoObj.decl?.jefe_id) jSel.value = estadoObj.decl.jefe_id;
    }).catch(() => {});

    // Confirmar
    document.getElementById('btn-declarar-destino').addEventListener('click', async () => {
      const destino_id = document.getElementById('dest-select').value;
      const jefe_id    = document.getElementById('jefe-select').value;
      const errEl      = document.getElementById('destino-err');
      if (!destino_id || !jefe_id) {
        errEl.textContent = 'Seleccioná tu destino y tu jefe/responsable.';
        errEl.style.display = 'block'; return;
      }
      try {
        const r = await API.declararDestino({ destino_id: Number(destino_id), jefe_id: Number(jefe_id) });
        if (r.ok) {
          overlay.remove();
          document.getElementById('screen-campus').style.display = '';
          // Mostrar confirmación breve
          const ok = document.createElement('div');
          ok.innerHTML = `✔ Destino registrado: <b>${r.destino}</b>. Tu jefe recibirá la notificación para validarlo.`;
          Object.assign(ok.style, {
            position:'fixed', bottom:'20px', left:'50%', transform:'translateX(-50%)',
            background:'var(--ok)', color:'#fff', padding:'12px 20px', borderRadius:'10px',
            fontSize:'13px', zIndex:'9000', boxShadow:'0 4px 20px rgba(0,0,0,.2)',
          });
          document.body.appendChild(ok);
          setTimeout(() => ok.remove(), 4000);
        } else {
          errEl.textContent = r.error || 'Error al guardar.'; errEl.style.display = 'block';
        }
      } catch(e) { errEl.textContent = e.message; errEl.style.display = 'block'; }
    });

    // Skip (solo si no es vencido)
    document.getElementById('btn-skip-destino')?.addEventListener('click', () => {
      overlay.remove();
      document.getElementById('screen-campus').style.display = '';
    });
  },

  _isMobile: false,

  // ── Navegación mobile: barra inferior ────────────────────────
  _initMobileNav() {
    const nav = document.getElementById('mobile-nav');
    if (!nav) return;
    nav.classList.remove('hidden');

    // Mostrar botón EPPT solo para roles que firman
    const role = API.user?.role;
    const epptBtn = document.getElementById('mobile-eppt-btn');
    if (epptBtn) {
      epptBtn.style.display = ['supervisor','instructor','admin'].includes(role) ? '' : 'none';
    }

    nav.querySelectorAll('[data-mnav]').forEach(btn => {
      btn.addEventListener('click', () => {
        nav.querySelectorAll('.mobile-nav-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const dest = btn.dataset.mnav;
        if (dest === 'eppt-mobile') {
          this.show('screen-campus');
          Campus.nav('gestion');
          setTimeout(() => { if (typeof Gestion !== 'undefined') Gestion.nav('eppt'); }, 120);
          return;
        }
        this.show('screen-campus');
        Campus.nav(dest);
      });
    });
  },

  // ── Bloqueo de examen en mobile ───────────────────────────────
  checkExamAllowed() {
    const check = PWA.puedeRendirExamen();
    if (!check.permitido) {
      const modal = document.getElementById('mobile-exam-block');
      if (modal) {
        modal.classList.remove('hidden');
        document.getElementById('meb-close')?.addEventListener('click',
          () => modal.classList.add('hidden'), { once: true });
      }
      return false;
    }
    return true;
  },

};

window.addEventListener('DOMContentLoaded', () => App.boot());
