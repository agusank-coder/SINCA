/* ============================================================
 * proctor.js — Supervisión IA del examen (100 % local, sin nube)
 *
 * FASE 1 · Calibración y bloqueo:
 *   - Consentimiento + permisos de cámara y micrófono
 *   - Captura inicial de rostro y entorno (queda como evidencia)
 *   - Pantalla completa, clic derecho y atajos inhabilitados
 * FASE 2 · Monitoreo en tiempo real (face-api.js embebido):
 *   - Ausencia de rostro sostenida / abandono del puesto
 *   - Segundo rostro en cuadro
 *   - Orientación de cabeza desviada en forma sostenida
 *   - Ruido/voces sostenidas por micrófono (Web Audio)
 *   - Salida de pestaña/ventana y de pantalla completa
 * FASE 3 · Registro de eventos y riesgo:
 *   - Cada anomalía → marca de tiempo + foto + puntos (pesa el SERVIDOR)
 *   - El alumno sigue rindiendo; el docente audita después
 * ============================================================ */
const Proctor = {
  active: false,
  sessionId: null,
  stream: null,
  screen: null,          // stream de pantalla compartida
  screenVideo: null,
  video: null,
  onBlock: null,         // callback al bloquearse el examen (lo registra cada pantalla de examen)
  _lastNivel: 'verde',
  _warned35: false,
  audioCtx: null,
  analyser: null,
  loopId: null,
  audioId: null,
  modelsReady: false,

  // acumuladores de detección sostenida
  _noFaceSince: null,
  _multiSince: null,
  _gazeSince: null,
  _noiseSince: null,
  _baseNoise: null,
  _lastEventAt: {},   // throttling por tipo

  THROTTLE_MS: 8000,   // mínimo entre eventos del mismo tipo — fijo, no configurable
  // Los siguientes se sobreescriben en begin() al cargar la config del servidor:
  SUSTAIN_MS:       3500,  // persistencia sin_rostro / múltiples_rostros (ms)
  CHECK_MS:          900,  // intervalo de análisis de video (ms)
  YAW_THRESHOLD:    0.22,  // giro horizontal máximo antes de alertar
  PITCH_THRESHOLD:  0.55,  // inclinación vertical máxima
  GAZE_WARN_MS:    2500,  // ms fuera de rango → 1ª advertencia
  GAZE_BLOCK_MS:   2000,  // ms adicionales → bloqueo
  ERRATIC_DYAW:    0.20,  // delta yaw que cuenta como salto brusco
  ERRATIC_COUNT:      4,  // cuántos saltos en ventana = errático
  ERRATIC_WIN_MS:  4000,  // ventana de tiempo para erraticidad (ms)
  SMOOTH_N:           5,  // frames para promedio móvil de ángulos (1 = sin suavizado)
  _smoothYaw:       [],   // buffer de suavizado yaw
  _smoothPitch:     [],   // buffer de suavizado pitch

  /* ---------- FASE 1: calibración y bloqueo ---------- */
  async begin(courseId, contexto, onReady, onCancel) {
    // Cargar configuración de calibración desde el servidor (con fallback a defaults si falla)
    try {
      const cfg = (await API.getProctorConfig()).config;
      if (cfg) {
        this.SUSTAIN_MS      = Number(cfg.sustain_ms)      || this.SUSTAIN_MS;
        this.CHECK_MS        = Number(cfg.check_ms)        || this.CHECK_MS;
        this.YAW_THRESHOLD   = Number(cfg.yaw_threshold)   || this.YAW_THRESHOLD;
        this.PITCH_THRESHOLD = Number(cfg.pitch_threshold) || this.PITCH_THRESHOLD;
        this.GAZE_WARN_MS    = Number(cfg.gaze_warn_ms)    || this.GAZE_WARN_MS;
        this.GAZE_BLOCK_MS   = Number(cfg.gaze_block_ms)   || this.GAZE_BLOCK_MS;
        this.ERRATIC_DYAW    = Number(cfg.erratic_dYaw)    || this.ERRATIC_DYAW;
        this.ERRATIC_COUNT   = Number(cfg.erratic_count)   || this.ERRATIC_COUNT;
        this.ERRATIC_WIN_MS  = Number(cfg.erratic_win_ms)  || this.ERRATIC_WIN_MS;
        this.SMOOTH_N        = Math.max(1, Number(cfg.smooth_n) || this.SMOOTH_N);
      }
    } catch { /* defaults ya asignados */ }

    // Pantalla de consentimiento + calibración
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.id = 'proctor-modal';
    modal.innerHTML = `
      <div class="modal-card proctor-card">
        <div class="panel-title">SUPERVISIÓN DEL EXAMEN — CALIBRACIÓN</div>
        <p class="proctor-text">Este examen se rinde bajo <b>supervisión automatizada</b>. Al continuar, usted presta
        <b>consentimiento</b> (Ley 25.326) para que la plataforma acceda a su cámara y micrófono, tome capturas
        iniciales de su rostro, su entorno y su <b>pantalla completa</b>, y registre eventos (cámara + pantalla) con fines exclusivos de integridad académica.
        El análisis se realiza <b>localmente en su equipo</b>; solo se conservan las evidencias de eventos.</p>
        <div class="proctor-cam"><video id="proctor-cal-video" autoplay muted playsinline></video>
          <div id="proctor-cal-status" class="mono">Esperando permisos de cámara y micrófono…</div></div>
        <div class="results-actions">
          <button class="btn-primary" id="proctor-accept" disabled style="width:auto">Acepto — Calibrar e iniciar</button>
          <button class="btn-ghost" id="proctor-cancel">Cancelar</button>
        </div>
      </div>`;
    document.body.appendChild(modal);
    const status = modal.querySelector('#proctor-cal-status');
    const calVideo = modal.querySelector('#proctor-cal-video');
    modal.querySelector('#proctor-cancel').addEventListener('click', () => { this._teardownMedia(); modal.remove(); onCancel && onCancel(); });

    // Permisos
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480, facingMode: 'user' }, audio: true
      });
    } catch {
      status.textContent = '✘ Permisos denegados. Sin cámara y micrófono no es posible rendir este examen.';
      return;
    }
    calVideo.srcObject = this.stream;
    this.video = calVideo;

    // Cargar IA local
    status.textContent = 'Cargando modelo de visión (local)…';
    await this._loadModels();
    status.textContent = this.modelsReady
      ? 'Ubíquese solo, de frente y con buena luz. Verificando rostro…'
      : '⚠ IA de visión no disponible: se supervisará foco, pantalla y micrófono igualmente.';

    // Verificación de rostro único antes de habilitar
    const accept = modal.querySelector('#proctor-accept');
    if (this.modelsReady) {
      const check = setInterval(async () => {
        const dets = await this._detect(calVideo);
        if (dets.length === 1) { status.textContent = '✔ Rostro reconocido. Puede iniciar.'; accept.disabled = false; }
        else if (dets.length === 0) { status.textContent = 'No se detecta rostro: acérquese y mejore la iluminación.'; accept.disabled = true; }
        else { status.textContent = '⚠ Se detecta más de una persona en cuadro.'; accept.disabled = true; }
        if (!document.body.contains(modal)) clearInterval(check);
      }, 900);
    } else accept.disabled = false;

    accept.addEventListener('click', async () => {
      accept.disabled = true;
      // Captura de PANTALLA obligatoria: debe compartir "Pantalla completa"
      try {
        this.screen = await navigator.mediaDevices.getDisplayMedia({ video: { displaySurface: 'monitor' }, audio: false });
      } catch {
        status.textContent = '✘ Debe compartir su pantalla (elija "Pantalla completa") para rendir bajo supervisión.';
        accept.disabled = false; return;
      }
      const surf = this.screen.getVideoTracks()[0].getSettings().displaySurface;
      if (surf && surf !== 'monitor') {
        status.textContent = '⚠ Compartió una ventana/pestaña. Vuelva a intentar eligiendo "Pantalla completa".';
        this.screen.getTracks().forEach(t => t.stop()); this.screen = null;
        accept.disabled = false; return;
      }
      this.screenVideo = document.createElement('video');
      this.screenVideo.autoplay = true; this.screenVideo.muted = true; this.screenVideo.playsInline = true;
      this.screenVideo.style.cssText = 'position:fixed;width:1px;height:1px;opacity:0;pointer-events:none';
      this.screenVideo.srcObject = this.screen;
      document.body.appendChild(this.screenVideo);
      this.screen.getVideoTracks()[0].addEventListener('ended', () =>
        this._report('pantalla_interrumpida', 'El usuario dejó de compartir la pantalla', true));
      await new Promise(r => setTimeout(r, 600));   // primer cuadro de pantalla
      try {
        const foto = this._snapshot();
        const pantalla = this._snapshotScreen();
        const r = await API.proctorStart({ course_id: courseId, contexto, foto, pantalla });
        this.sessionId = r.session_id;
      } catch (e) { alert(e.message); modal.remove(); this._teardownMedia(); onCancel && onCancel(); return; }
      modal.remove();
      this._enterLockdown();
      this._startMonitoring();
      this._mountBadge();
      this.active = true;
      onReady && onReady(this.sessionId);
    });
  },

  /* ---------- Aislamiento del entorno ---------- */
  _addAntiCaptureCss() {
    if (document.getElementById('proctor-anti-cap')) return;
    const s = document.createElement('style');
    s.id = 'proctor-anti-cap';
    s.textContent = [
      'body.proctor-active{-webkit-user-select:none!important;user-select:none!important}',
      'body.proctor-active *{-webkit-user-select:none!important;user-select:none!important}',
      // Bloqueo de captura de pantalla via CSS (Chrome/Edge)
      'body.proctor-active{-webkit-touch-callout:none!important}',
      '@media print{body.proctor-active *{visibility:hidden!important}body.proctor-active::after{content:"CONTENIDO PROTEGIDO — PSA/ISSA";visibility:visible!important;position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);font-size:28px;color:#000;font-weight:bold}}'
    ].join('');
    document.head.appendChild(s);
    // Interceptar teclas de captura (PrintScreen no siempre dispara keydown en el navegador,
    // por eso también monitoreamos blur/visibilitychange que suelen ocurrir junto con capturas del SO)
    this._keyGuard = (e) => {
      if (!document.body.classList.contains('proctor-active')) return;
      const isPrintScreen = e.key === 'PrintScreen' || e.code === 'PrintScreen' || e.keyCode === 44;
      const isSnipTool = (e.key === 'S' || e.key === 's') && e.shiftKey && e.metaKey;
      const isSnipTool2 = (e.key === 'S' || e.key === 's') && e.shiftKey && e.getModifierState && e.getModifierState('Meta');
      if (isPrintScreen || isSnipTool || isSnipTool2) {
        e.preventDefault(); e.stopPropagation();
        this._toast('⛔ Captura de pantalla detectada y bloqueada durante el examen.');
        this._report('captura_pantalla', 'Tecla de captura de pantalla presionada (PrintScreen/Recorte)', true);
        return false;
      }
    };
    document.addEventListener('keydown', this._keyGuard, true);
    document.addEventListener('keyup', this._keyGuard, true);

    // Detección indirecta: la herramienta Recortes (Win+Shift+S) y muchas apps de captura
    // hacen que la ventana pierda el foco brevemente. Si el examen pierde foco de forma muy breve
    // y recupera el foco enseguida, es un patrón típico de captura — lo reportamos como sospechoso.
    this._blurTimestamp = null;
    this._onBlurCapture = () => {
      if (!document.body.classList.contains('proctor-active')) return;
      this._blurTimestamp = Date.now();
    };
    this._onFocusCapture = () => {
      if (!document.body.classList.contains('proctor-active') || !this._blurTimestamp) return;
      const dur = Date.now() - this._blurTimestamp;
      this._blurTimestamp = null;
      // Pérdida de foco corta (100ms-2s) es el patrón típico de herramientas de captura
      if (dur > 100 && dur < 2000) {
        this._report('posible_captura', 'La ventana perdió el foco brevemente ('+dur+'ms) — patrón compatible con herramienta de captura de pantalla', true);
      }
    };
    window.addEventListener('blur', this._onBlurCapture);
    window.addEventListener('focus', this._onFocusCapture);

    // Detección de cambio de tamaño de pantalla (posible apertura de herramienta de captura/DevTools)
    this._lastScreenSize = { w: window.innerWidth, h: window.innerHeight };
    this._onResizeCapture = () => {
      if (!document.body.classList.contains('proctor-active')) return;
      const dw = Math.abs(window.innerWidth - this._lastScreenSize.w);
      const dh = Math.abs(window.innerHeight - this._lastScreenSize.h);
      if (dw > 80 || dh > 80) {
        this._report('cambio_tamano_ventana', 'Cambio abrupto de tamaño de ventana detectado', false);
      }
      this._lastScreenSize = { w: window.innerWidth, h: window.innerHeight };
    };
    window.addEventListener('resize', this._onResizeCapture);
  },

  _enterLockdown() {
    document.body.classList.add('proctor-active');
    document.documentElement.requestFullscreen?.().catch(() => {});
    this._addAntiCaptureCss();
    this._onCtx = e => { e.preventDefault(); this._report('atajo_bloqueado', 'Intento de menú contextual'); };
    this._onKey = e => {
      const k = e.key.toLowerCase();
      const bloqueado = e.key === 'F12' || e.key === 'F11' ||
        ((e.ctrlKey || e.metaKey) && ['c', 'v', 'x', 'p', 's', 'u', 't', 'n', 'w', 'f'].includes(k)) ||
        ((e.ctrlKey || e.metaKey) && e.shiftKey && ['i', 'j', 'c'].includes(k)) ||
        (e.altKey && k === 'd');
      if (bloqueado) { e.preventDefault(); e.stopPropagation(); this._report('atajo_bloqueado', `Atajo inhabilitado: ${e.ctrlKey ? 'Ctrl+' : ''}${e.altKey ? 'Alt+' : ''}${e.shiftKey ? 'Shift+' : ''}${e.key}`); }
    };
    this._onVis = () => { if (document.hidden) this._report('salida_pestana', 'La pestaña del examen perdió visibilidad'); };
    this._onBlur = () => this._report('salida_pestana', 'La ventana del examen perdió el foco');
    this._onFs = () => {
      if (!document.fullscreenElement && this.active) {
        this._report('salida_pantalla_completa', 'Abandonó la pantalla completa');
        document.documentElement.requestFullscreen?.().catch(() => {});
      }
    };
    this._onCopy = e => { e.preventDefault(); this._report('atajo_bloqueado', 'Intento de copiar/pegar'); };
    this._onPrtSc = e => {
      if (e.key === 'PrintScreen' || (e.ctrlKey && e.shiftKey && e.key === 'p')) {
        e.preventDefault(); this._report('atajo_bloqueado', 'Intento de captura de pantalla');
      }
    };
    document.addEventListener('contextmenu', this._onCtx, true);
    document.addEventListener('keydown', this._onKey, true);
    document.addEventListener('visibilitychange', this._onVis);
    window.addEventListener('blur', this._onBlur);
    document.addEventListener('fullscreenchange', this._onFs);
    document.addEventListener('copy', this._onCopy, true);
    document.addEventListener('paste', this._onCopy, true);
    document.addEventListener('keyup', this._onPrtSc, true);
    document.addEventListener('keydown', this._onPrtSc, true);
    if (!document.getElementById('proctor-nocapture')) {
      const _s = document.createElement('style');
      _s.id = 'proctor-nocapture';
      _s.textContent = '@media print { body * { visibility: hidden; } }';
      document.head.appendChild(_s);
    }
  },

  /* ---------- FASE 2: monitoreo biométrico ---------- */
  async _loadModels() {
    if (this.modelsReady) return;
    try {
      if (!window.faceapi) await this._script('/vendor/faceapi/face-api.min.js');
      await faceapi.nets.tinyFaceDetector.loadFromUri('/vendor/faceapi/models');
      await faceapi.nets.faceLandmark68TinyNet.loadFromUri('/vendor/faceapi/models');
      this.modelsReady = true;
    } catch (e) { console.warn('IA de visión no disponible:', e); this.modelsReady = false; }
  },
  _script(src) {
    return new Promise((ok, err) => {
      const s = document.createElement('script');
      s.src = src; s.onload = ok; s.onerror = err;
      document.head.appendChild(s);
    });
  },
  async _detect(videoEl) {
    try {
      return await faceapi.detectAllFaces(videoEl,
        new faceapi.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.45 }))
        .withFaceLandmarks(true);
    } catch { return []; }
  },

  _startMonitoring() {
    // Video oculto persistente para el análisis durante todo el examen
    const v = document.createElement('video');
    v.autoplay = true; v.muted = true; v.playsInline = true;
    v.style.cssText = 'position:fixed;width:1px;height:1px;opacity:0;pointer-events:none';
    v.srcObject = this.stream;
    document.body.appendChild(v);
    this.video = v;
    // Conectar al preview lateral con retry
    const _cp = () => {
      const pre = document.getElementById('proctor-preview');
      if (pre && this.stream) { pre.srcObject = this.stream; pre.play().catch(()=>{}); }
      else if (this.stream && this.active) setTimeout(_cp, 500);
    };
    setTimeout(_cp, 300);

    // Análisis de video
    this.loopId = setInterval(async () => {
      if (!this.active) return;
      if (!this.stream.getVideoTracks().some(t => t.readyState === 'live')) {
        this._report('camara_interrumpida', 'La cámara dejó de transmitir'); return;
      }
      if (!this.modelsReady) return;
      const now = Date.now();
      const dets = await this._detect(v);

      // Ausencia / abandono del puesto
      if (dets.length === 0) {
        this._noFaceSince ??= now;
        const elapsed = now - this._noFaceSince;
        const reported = this._noFaceReported || 0;
        if (reported === 0 && elapsed > 2000) {
          // Primera detección: advertencia visible, tono, NO bloquea (2s)
          this._toast('⚠ ATENCIÓN: no se detecta su rostro. Mire a la cámara. Si persiste, el examen se bloqueará.');
          this._beep(2);
          this._noFaceReported = 1;
          this._noFaceWarnAt = now;
          this._report('sin_rostro', 'Primera advertencia: sin rostro detectado', true);
        } else if (reported === 1 && now - (this._noFaceWarnAt||now) > 3000) {
          // Segunda detección sostenida (3s más = ~5s total): bloquear
          this._noFaceReported = 2;
          this._report('sin_rostro', 'Abandono del puesto confirmado — examen bloqueado', true);
          this._blocked();
        }
      } else { this._noFaceSince = null; this._noFaceReported = 0; this._noFaceWarnAt = null; }

      // Segunda persona
      if (dets.length > 1) {
        this._multiSince ??= now;
        const rep = this._multiReported || 0;
        if (rep === 0 && now - this._multiSince > 1200) {
          this._toast('⚠ ATENCIÓN: se detecta más de una persona en cámara. Asegúrese de estar solo. El examen se bloqueará si persiste.');
          this._beep(3);
          this._multiReported = 1;
          this._multiWarnAt = now;
          this._report('multiples_rostros', 'Advertencia: ' + dets.length + ' rostros en cuadro', true);
        } else if (rep === 1 && now - (this._multiWarnAt||now) > 2000) {
          this._multiReported = 2;
          this._report('multiples_rostros', 'Segunda persona confirmada — examen bloqueado', true);
          this._blocked();
        }
      } else { this._multiSince = null; this._multiReported = 0; this._multiWarnAt = null; }

      // Orientación + pitch (cabeza hacia abajo → posible celular) + distancia (muy lejos)
      if (dets.length === 1) {
        const box = dets[0].detection.box;
        const faceRatio = box.width / Math.max(1, this.video.videoWidth || 640);
        if (faceRatio < 0.12) {
          this._lejosSince ??= now;
          if (now - this._lejosSince > this.SUSTAIN_MS)
            this._report('sin_rostro', 'Posible alejamiento o consulta de celular/apuntes (rostro muy pequeño en cámara)', true);
        } else this._lejosSince = null;
        const lm = dets[0].landmarks;
        const nose = lm.getNose()[3];
        const L = this._center(lm.getLeftEye());
        const R = this._center(lm.getRightEye());

        // ── Ángulos RAW (sin suavizar) ────────────────────────────────
        const yawRaw   = ((nose.x - L.x) / Math.max(1, R.x - L.x)) - 0.5;
        const noseY    = lm.getNose()[0].y;
        const pitchRaw = (noseY - (L.y + R.y) / 2) / Math.max(1, box.height);

        // ── Suavizado temporal: promedio móvil de los últimos SMOOTH_N frames ──
        // Reduce el ruido de cámara y vibraciones sin aumentar la latencia real
        this._smoothYaw.push(yawRaw);
        this._smoothPitch.push(pitchRaw);
        if (this._smoothYaw.length   > this.SMOOTH_N) this._smoothYaw.shift();
        if (this._smoothPitch.length > this.SMOOTH_N) this._smoothPitch.shift();
        const yaw   = this._smoothYaw.reduce((s,v)   => s+v, 0) / this._smoothYaw.length;
        const pitch = this._smoothPitch.reduce((s,v) => s+v, 0) / this._smoothPitch.length;

        // ── Historial para detección de movimiento errático ───────────
        this._motionHistory ??= [];
        this._motionHistory.push({ yaw, pitch, t: now });
        this._motionHistory = this._motionHistory.filter(h => now - h.t < this.ERRATIC_WIN_MS);
        if (this._motionHistory.length >= 6) {
          let cambiosBruscos = 0;
          for (let i = 1; i < this._motionHistory.length; i++) {
            const dYaw = Math.abs(this._motionHistory[i].yaw - this._motionHistory[i-1].yaw);
            if (dYaw > this.ERRATIC_DYAW) cambiosBruscos++;
          }
          const erratico = cambiosBruscos >= this.ERRATIC_COUNT;
          if (erratico) {
            this._erraticSince ??= now;
            if (now - this._erraticSince > 1500) {
              const rep = this._erraticReported || 0;
              if (rep === 0) {
                this._toast('⚠ ATENCIÓN: se detectaron movimientos erráticos de la cabeza. Mantenga la vista al frente.');
                this._beep(2);
                this._erraticReported = 1;
                this._report('movimiento_erratico', 'Movimientos erráticos/nerviosos detectados (posible consulta repetida a otro lugar)', true);
              } else if (rep === 1 && now - this._erraticSince > 6000) {
                this._erraticReported = 2;
                this._report('movimiento_erratico', 'Movimientos erráticos persistentes — examen bloqueado', true);
                this._blocked();
              }
            }
          } else { this._erraticSince = null; this._erraticReported = 0; }
        }

        // ── Detección de mirada desviada con persistencia configurable ──
        // Umbral calibrado para operador de rayos X: permite leve movimiento de inspección
        if (Math.abs(yaw) > this.YAW_THRESHOLD || pitch > this.PITCH_THRESHOLD) {
          this._gazeSince ??= now;
          const motivo = pitch > this.PITCH_THRESHOLD
            ? 'Mirada dirigida hacia abajo (posible consulta de celular o apuntes)'
            : 'Cabeza orientada hacia ' + (yaw > 0 ? 'la derecha' : 'la izquierda') + ' — fuera de la pantalla';
          const elapsed = now - this._gazeSince;
          const rep = this._gazeReported || 0;
          // 1ª advertencia: solo si la desviación se sostiene más de GAZE_WARN_MS
          if (rep === 0 && elapsed > this.GAZE_WARN_MS) {
            this._toast('⚠ ATENCIÓN: ' + motivo + '. Mire directamente a la pantalla. Una segunda infracción bloqueará el examen.');
            this._beep(2);
            this._gazeReported = 1;
            this._gazeWarnAt = now;
            this._report('mirada_desviada', 'Advertencia 1: ' + motivo, true);
          } else if (rep === 1 && now - (this._gazeWarnAt||now) > this.GAZE_BLOCK_MS) {
            // 2ª infracción: bloqueo
            this._gazeReported = 2;
            this._report('mirada_desviada', 'Infracción confirmada: ' + motivo + ' — examen bloqueado', true);
            this._blocked();
          }
        } else { this._gazeSince = null; this._gazeReported = 0; this._gazeWarnAt = null; }
      } else { this._lejosSince = null; }
      // Fuente de luz intensa en cuadro (celular/segundo dispositivo)
      this._detectBrightSource(now);
    }, this.CHECK_MS);

    // Análisis de audio: energía sostenida sobre la línea de base del ambiente
    try {
      this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const src = this.audioCtx.createMediaStreamSource(this.stream);
      this.analyser = this.audioCtx.createAnalyser();
      this.analyser.fftSize = 512;
      src.connect(this.analyser);
      const buf = new Uint8Array(this.analyser.frequencyBinCount);
      const samples = [];
      this.audioId = setInterval(() => {
        if (!this.active) return;
        this.analyser.getByteFrequencyData(buf);
        const rms = Math.sqrt(buf.reduce((s, x) => s + x * x, 0) / buf.length);
        if (samples.length < 25) { samples.push(rms); if (samples.length === 25) this._baseNoise = samples.reduce((a, b) => a + b) / 25; return; }
        const now = Date.now();
        if (this._baseNoise != null && rms > Math.max(18, this._baseNoise * 2.4)) {
          this._noiseSince ??= now;
          if (now - this._noiseSince > this.SUSTAIN_MS)
            this._report('ruido_detectado', 'Voces o ruido sostenido captado por el micrófono', true);
        } else this._noiseSince = null;
      }, 400);
    } catch (e) { console.warn('Audio no disponible:', e); }
  },
  _lejosSince: null,
  _brightSince: null,

  _brightWarnCount: 0,   // advertencias de luz intensa antes de reportar
  _brightCooldown: 0,    // tiempo de espera para la siguiente advertencia

  _detectBrightSource(now) {
    try {
      const v = this.video; if (!v || !v.videoWidth) return;
      const c = document.createElement('canvas'); c.width = 80; c.height = 60;
      c.getContext('2d').drawImage(v, 0, 0, 80, 60);
      const data = c.getContext('2d').getImageData(0, 0, 80, 60).data;
      let bright = 0;
      for (let i = 0; i < data.length; i += 4)
        if ((data[i] * 0.299 + data[i+1] * 0.587 + data[i+2] * 0.114) > 248) bright++;
      if (bright / 4800 > 0.14) {
        this._brightSince ??= now;
        // Solo actuar cada SUSTAIN_MS para no saturar
        if (now - this._brightSince > this.SUSTAIN_MS && now > (this._brightCooldown || 0)) {
          this._brightWarnCount = (this._brightWarnCount || 0) + 1;
          this._brightCooldown = now + this.SUSTAIN_MS;
          if (this._brightWarnCount < 5) {
            // Advertencia sin reporte al servidor
            this._toast('⚠ Luz intensa detectada en cámara (' + this._brightWarnCount + '/5 advertencias). Si es iluminación ambiental ignore este aviso.');
            this._beep(1);
            this._brightSince = null;  // reiniciar acumulador
          } else {
            // 5ta advertencia: reportar al servidor
            this._brightWarnCount = 0;
            this._report('multiples_rostros', `Luz intensa persistente en cámara — ${Math.round(bright/48)}% del cuadro (5 advertencias agotadas)`, true);
          }
        }
      } else { this._brightSince = null; }
    } catch {}
  },

  _center(pts) {
    return { x: pts.reduce((s, p) => s + p.x, 0) / pts.length, y: pts.reduce((s, p) => s + p.y, 0) / pts.length };
  },

  /* ---------- FASE 3: registro de eventos ---------- */
  async _report(tipo, detalle, conFoto) {
    // Actualizar panel lateral de supervisión
    const sideAlarms = document.getElementById('side-alarms');
    if (sideAlarms) {
      const bloquea = conFoto === true;
      const item = document.createElement('div');
      item.style.cssText = 'font-size:10px;padding:4px 6px;margin-bottom:3px;border-radius:4px;background:'+(bloquea?'rgba(229,72,77,.2)':'rgba(242,140,26,.1)')+';border-left:2px solid '+(bloquea?'#e5484d':'#e07b0a');
      item.textContent = new Date().toLocaleTimeString('es-AR',{hour12:false,hour:'2-digit',minute:'2-digit',second:'2-digit'})+' — '+String(detalle).slice(0,65);
      sideAlarms.prepend(item);
      while (sideAlarms.children.length > 12) sideAlarms.removeChild(sideAlarms.lastChild);
    }
    const sideStatus = document.getElementById('side-proctor-status');
    if (sideStatus) { sideStatus.textContent = String(detalle).slice(0,55); sideStatus.style.color = conFoto?'#e5484d':'#e07b0a'; }
    if (!this.active || !this.sessionId) return;
    const now = Date.now();
    if (now - (this._lastEventAt[tipo] || 0) < this.THROTTLE_MS) return;   // anti-spam
    this._lastEventAt[tipo] = now;
    // reset del acumulador correspondiente
    if (tipo === 'sin_rostro') this._noFaceSince = null;
    if (tipo === 'multiples_rostros') this._multiSince = null;
    if (tipo === 'mirada_desviada') this._gazeSince = null;
    if (tipo === 'ruido_detectado') this._noiseSince = null;
    try {
      const evid = conFoto || ['salida_pestana', 'salida_pantalla_completa', 'camara_interrumpida', 'pantalla_interrumpida'].includes(tipo);
      const r = await API.proctorEvent({
        session_id: this.sessionId, tipo, detalle,
        foto: evid ? this._snapshot() : null,
        pantalla: evid ? this._snapshotScreen() : null
      });
      this._updateBadge(r.nivel, r.risk_score);
      // Alerta SONORA antes de llegar a rojo
      if (r.nivel === 'amarillo' && this._lastNivel === 'verde') {
        this._beep(2);
        this._toast('⚠ Supervisión en AMARILLO: se registraron irregularidades. Continúe con normalidad frente a la cámara.');
      }
      if (r.nivel === 'amarillo' && r.risk_score >= 35 && !this._warned35) {
        this._warned35 = true;
        this._beep(3);
        this._toast('⚠ ATENCIÓN: una nueva irregularidad BLOQUEARÁ el examen (revisión humana obligatoria).');
      }
      this._lastNivel = r.nivel;
      if (r.bloquear) this._blocked();
    } catch {}
  },

  /* Tono de advertencia (sin archivos de audio: Web Audio) */
  _beep(times) {
    try {
      const ctx = this.audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      for (let i = 0; i < (times || 1); i++) {
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.type = 'square'; o.frequency.value = 880;
        g.gain.setValueAtTime(0.0001, ctx.currentTime + i * 0.35);
        g.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + i * 0.35 + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + i * 0.35 + 0.28);
        o.connect(g); g.connect(ctx.destination);
        o.start(ctx.currentTime + i * 0.35); o.stop(ctx.currentTime + i * 0.35 + 0.3);
      }
    } catch {}
  },

  _toast(msg) {
    let t = document.getElementById('proctor-toast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'proctor-toast';
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(this._toastTo);
    this._toastTo = setTimeout(() => t.classList.remove('show'), 6000);
  },

  /* Bloqueo del examen al alcanzar nivel ROJO */
  _blocked() {
    this._beep(4);
    const ov = document.createElement('div');
    ov.id = 'proctor-lock';
    ov.innerHTML = `<div class="lock-card">
      <div class="lock-icon">⛔</div>
      <h2>EXAMEN BLOQUEADO POR SUPERVISIÓN</h2>
      <p>El nivel de sospecha alcanzó el umbral <b>ROJO</b>. La instancia quedó registrada con sus evidencias
      (cámara y pantalla) y será <b>revisada por un docente</b>, quien decidirá convalidar o anular.</p>
      <p class="hint">Será redirigido al curso en unos segundos…</p>
    </div>`;
    document.body.appendChild(ov);
    const cb = this.onBlock;
    this.end();
    setTimeout(() => { ov.remove(); if (cb) cb(); }, 6000);
  },

  _snapshotScreen() {
    try {
      const v = this.screenVideo;
      if (!v || !v.videoWidth) return null;
      const c = document.createElement('canvas');
      c.width = 800; c.height = Math.round(800 * v.videoHeight / v.videoWidth);
      c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
      return c.toDataURL('image/jpeg', 0.55);
    } catch { return null; }
  },

  _snapshot() {
    try {
      const v = this.video;
      if (!v || !v.videoWidth) return null;
      const c = document.createElement('canvas');
      c.width = 480; c.height = Math.round(480 * v.videoHeight / v.videoWidth);
      c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
      return c.toDataURL('image/jpeg', 0.65);
    } catch { return null; }
  },

  /* ---------- Indicador visible para el alumno ---------- */
  _mountBadge() {
    const b = document.createElement('div');
    b.id = 'proctor-badge';
    b.setAttribute('role', 'status');
    b.setAttribute('aria-live', 'assertive');
    b.setAttribute('aria-atomic', 'true');
    b.setAttribute('aria-label', 'Estado de supervisión del examen: VERDE');
    b.innerHTML = '<span class="rec" aria-hidden="true"></span> SUPERVISIÓN ACTIVA · <b id="proctor-nivel">VERDE</b>';
    document.body.appendChild(b);
  },
  _updateBadge(nivel, score) {
    const el = document.getElementById('proctor-nivel');
    if (el) {
      el.textContent = nivel.toUpperCase();
      el.parentElement.dataset.nivel = nivel;
      // Actualizar aria-label para lectores de pantalla
      el.parentElement.setAttribute('aria-label', 'Estado de supervisión: ' + nivel.toUpperCase());
    }
  },

  /* ---------- Cierre ---------- */
  async end() {
    if (!this.active) return;
    this.active = false;
    try { if (this.sessionId) await API.proctorEnd(this.sessionId); } catch {}
    this._teardown();
  },
  _teardown() {
    clearInterval(this.loopId); clearInterval(this.audioId);
    document.removeEventListener('contextmenu', this._onCtx, true);
    document.removeEventListener('keydown', this._onKey, true);
    document.removeEventListener('visibilitychange', this._onVis);
    window.removeEventListener('blur', this._onBlur);
    document.removeEventListener('fullscreenchange', this._onFs);
    document.removeEventListener('copy', this._onCopy, true);
    document.removeEventListener('paste', this._onCopy, true);
    document.removeEventListener('keyup', this._onPrtSc, true);
    document.removeEventListener('keydown', this._onPrtSc, true);
    if (this._keyGuard) { document.removeEventListener('keydown', this._keyGuard, true); document.removeEventListener('keyup', this._keyGuard, true); }
    if (this._onBlurCapture) window.removeEventListener('blur', this._onBlurCapture);
    if (this._onFocusCapture) window.removeEventListener('focus', this._onFocusCapture);
    if (this._onResizeCapture) window.removeEventListener('resize', this._onResizeCapture);
    document.getElementById('proctor-nocapture')?.remove();
    document.getElementById('proctor-badge')?.remove();
    document.body.classList.remove('proctor-active');
    document.exitFullscreen?.().catch(() => {});
    this._teardownMedia();
    if (this.video?.parentElement === document.body) this.video.remove();
    this.sessionId = null;
    this._motionHistory = [];
    this._smoothYaw   = [];
    this._smoothPitch = [];
  },
  _teardownMedia() {
    try { this.stream?.getTracks().forEach(t => t.stop()); } catch {}
    try { this.screen?.getTracks().forEach(t => t.stop()); } catch {}
    try { this.audioCtx?.close(); } catch {}
    this.screenVideo?.remove();
    this.stream = null; this.screen = null; this.screenVideo = null;
    this._lastNivel = 'verde'; this._warned35 = false;
    this._lejosSince = null; this._brightSince = null;
    document.body.classList.remove('proctor-active');
    if (this._keyGuard) { document.removeEventListener('keydown', this._keyGuard, true); document.removeEventListener('keyup', this._keyGuard, true); this._keyGuard = null; }
    this._brightWarnCount = 0; this._brightCooldown = 0;
    this._noFaceReported = 0; this._gazeReported = 0; this._multiReported = 0;
  }
};
