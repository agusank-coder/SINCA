/* ============================================================
 * modes.js — Simulador de Rayos X
 *  · Entrenamiento libre (feedback inmediato + siluetas)
 *  · Examen práctico de curso (20 imágenes, cronometrado;
 *    la corrección y la regla AEI se aplican EN EL SERVIDOR)
 *  · Anotador (docente/admin)
 * ============================================================ */
const EVAL_IMAGE_COUNT = 20;
const EVAL_SECONDS_PER_IMAGE = 30;

const Sim = {
  scanner: null, mode: null, pool: [], queue: [], index: 0,
  marks: [], records: [], locked: false,
  startedAt: 0, timerId: null, remaining: 0,
  practicalCourseId: null,
  practicalSessionId: null,
  annoThreats: [], annoDirty: false,
  els: {},

  init() {
    this.els = {
      viewport: document.getElementById('viewport'),
      canvas: document.getElementById('xray-canvas'),
      marksLayer: document.getElementById('marks-layer'),
      scanline: document.getElementById('scanline'),
      modeLabel: document.getElementById('sim-mode-label'),
      progress: document.getElementById('sim-progress'),
      timer: document.getElementById('sim-timer'),
      trayId: document.getElementById('tray-id'),
      filterLabel: document.getElementById('active-filter-label'),
      zoomLevel: document.getElementById('zoom-level'),
      feedback: document.getElementById('feedback-box'),
      btnNext: document.getElementById('btn-next'),
      btnClean: document.getElementById('btn-clean'),
      btnConfirm: document.getElementById('btn-confirm'),
      btnClear: document.getElementById('btn-clear-marks'),
      hint: document.getElementById('viewport-hint'),
      annotatorPanel: document.getElementById('annotator-panel')
    };
    this.scanner = new XRayScanner(this.els.canvas, this.els.viewport);
    this.scanner.onRender = () => this.updateOverlays();
    this.scanner.onZoom = (s) => { this.els.zoomLevel.textContent = Math.round(s * 100) + ' %'; };
    this.scanner.onClickImage = (nx, ny) => this.handleImageClick(nx, ny);
    this.scanner.onDragBox = (box) => this.handleAnnotationBox(box);
    this._bindControls();
  },

  _bindControls() {
    document.querySelectorAll('.key[data-filter]').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.key[data-filter]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const f = btn.dataset.filter;
        this.scanner.setFilter(f);
        const labels = { none: 'MULTI-ENERGÍA', organic: 'ORGÁNICO', inorganic: 'INORGÁNICO', metal: 'METAL' };
        this.els.filterLabel.textContent = labels[f];
      });
    });
    document.querySelectorAll('.key[data-toggle]').forEach(btn => {
      btn.addEventListener('click', () => {
        const on = this.scanner.toggle(btn.dataset.toggle);
        btn.classList.toggle('active', !!on);
        if (btn.dataset.toggle === 'hipen' || btn.dataset.toggle === 'lopen') {
          document.querySelectorAll('.key[data-toggle="hipen"], .key[data-toggle="lopen"]').forEach(b => {
            b.classList.toggle('active', !!this.scanner.state[b.dataset.toggle]);
          });
        }
      });
    });
    document.getElementById('zoom-in').addEventListener('click', () => this.scanner.onZoom(this.scanner.setZoom(this.scanner.scale * 1.3)));
    document.getElementById('zoom-out').addEventListener('click', () => this.scanner.onZoom(this.scanner.setZoom(this.scanner.scale / 1.3)));
    document.getElementById('zoom-reset').addEventListener('click', () => { this.scanner.resetView(); this.scanner.onZoom(1); });
    this.els.btnClean.addEventListener('click', () => this.submitDecision(true));
    this.els.btnConfirm.addEventListener('click', () => this.submitDecision(false));
    this.els.btnClear.addEventListener('click', () => { if (!this.locked) { this.marks = []; this.updateOverlays(); } });
    this.els.btnNext.addEventListener('click', () => this.nextImage());
    document.getElementById('anno-save').addEventListener('click', () => this.saveAnnotation(false));
    document.getElementById('anno-clean').addEventListener('click', () => this.saveAnnotation(true));
    document.getElementById('anno-undo').addEventListener('click', () => { this.annoThreats.pop(); this.annoDirty = true; this.updateOverlays(); });
    document.getElementById('anno-prev').addEventListener('click', () => this.stepAnnotator(-1));
    document.getElementById('anno-next').addEventListener('click', () => this.stepAnnotator(1));
  },

  /* ---------- Arranque ---------- */
  async start(mode, images, practicalCourseId) {
    this.mode = mode;
    this.pool = images;
    this.practicalCourseId = practicalCourseId || null;
    this.records = [];
    this.index = 0;
    this.stopTimer();

    const annotated = images.filter(i => i.annotated);
    const isAnnotator = mode === 'annotator';
    this.els.annotatorPanel.classList.toggle('hidden', !isAnnotator);
    document.querySelector('.decision').classList.toggle('hidden', isAnnotator);
    this.scanner.annotatorMode = isAnnotator;

    if (isAnnotator) {
      if (!images.length) throw new Error('No hay imágenes en assets/xray_images/.');
      this.queue = [...images].sort((a, b) => a.filename.localeCompare(b.filename));
      this.els.modeLabel.textContent = 'ANOTADOR';
      this.els.timer.classList.add('hidden');
      this.els.hint.textContent = 'Arrastre para dibujar cajas de amenaza · Guarde antes de cambiar de imagen';
    } else if (mode === 'evaluation') {
      // El SERVIDOR asigna el set (con AEI garantizado) y NO envía las amenazas al cliente
      const set = await API.practicalSet(practicalCourseId);
      this.practicalSessionId = set.practical_session_id;
      this.queue = set.images.map(i => ({ ...i, threats: [], is_clean: null }));
      this.secondsPerImage = set.seconds_per_image || EVAL_SECONDS_PER_IMAGE;
      this.els.timer.classList.remove('hidden');
      this.els.modeLabel.textContent = 'EXAMEN PRÁCTICO';
      this.els.hint.textContent = `Clic: marcar objeto sospechoso · Máx. ${this.secondsPerImage}s por imagen · Sin retroalimentación hasta el final`;
      this.startedAt = Date.now();
    } else {
      if (annotated.length < 1) throw new Error('No hay imágenes anotadas para entrenar.');
      this.queue = shuffle([...annotated]);
      this.els.timer.classList.add('hidden');
      this.els.modeLabel.textContent = 'ENTRENAMIENTO LIBRE';
      this.els.hint.textContent = 'Clic: marcar objeto sospechoso · Rueda / pellizco: zoom · Arrastrar: desplazar';
      this.startedAt = Date.now();
    }
    await this.loadCurrent();
  },

  async loadCurrent() {
    const item = this.queue[this.index];
    this.marks = [];
    this.annoThreats = item.threats ? JSON.parse(JSON.stringify(item.threats)) : [];
    this.annoDirty = false;
    this.locked = false;
    this.hideFeedback();
    this.els.btnNext.classList.add('hidden');
    this.scanner.resetFilters();
    document.querySelectorAll('.key').forEach(k => k.classList.remove('active'));
    document.querySelector('.key[data-filter="none"]').classList.add('active');
    this.els.filterLabel.textContent = 'MULTI-ENERGÍA';
    this.els.zoomLevel.textContent = '100 %';
    this.els.trayId.textContent = String(1000 + hashCode(item.filename) % 9000);
    this.els.progress.textContent = `${this.index + 1} / ${this.queue.length}`;
    try { await this.scanner.load(item.url); }
    catch { this.showFeedback('bad', 'Error al cargar ' + item.filename); setTimeout(() => this.nextImage(true), 1200); return; }
    this.els.scanline.classList.remove('run');
    void this.els.scanline.offsetWidth;
    this.els.scanline.classList.add('run');
    this.updateOverlays();
    // Timer por imagen: solo en modo evaluación
    if (this.mode === 'evaluation') {
      this.stopTimer();
      this.remaining = this.secondsPerImage || EVAL_SECONDS_PER_IMAGE;
      this.startTimer();
    }
  },

  handleImageClick(nx, ny) {
    if (this.mode === 'annotator' || this.locked) return;
    if (!this.marks.some(m => Math.hypot(m.nx - nx, m.ny - ny) < 0.03)) {
      this.marks.push({ nx, ny });
      this.updateOverlays();
    }
  },

  handleAnnotationBox(box) {
    if (this.mode !== 'annotator') return;
    box.tipo = document.getElementById('threat-type').value;
    this.annoThreats.push(box);
    this.annoDirty = true;
    this.updateOverlays();
  },

  /* Evaluación local: solo para feedback del ENTRENAMIENTO (el práctico se corrige en servidor) */
  evaluateImage(declaredClean) {
    const item = this.queue[this.index];
    const threats = item.threats || [];
    const isClean = !!item.is_clean || threats.length === 0;
    let correct, hits = [];
    if (declaredClean) correct = isClean;
    else if (this.marks.length === 0) correct = false;
    else {
      hits = threats.map(t => this.marks.some(m =>
        m.nx >= t.x && m.nx <= t.x + t.w && m.ny >= t.y && m.ny <= t.y + t.h));
      correct = !isClean && hits.every(Boolean);
    }
    return { item, isClean, threats, hits, correct, declaredClean };
  },

  submitDecision(declaredClean) {
    if (this.locked || this.mode === 'annotator') return;
    if (!declaredClean && this.marks.length === 0) {
      this.showFeedback('bad', 'No hay marcas para confirmar. Marque el objeto o declare el equipaje limpio.');
      return;
    }
    this.records.push({
      filename: this.queue[this.index].filename,
      declaredClean, marks: this.marks
    });
    this.locked = true;
    this.stopTimer(); // detener el reloj de esta imagen apenas se registra la decisión

    if (this.mode === 'training') {
      const r = this.evaluateImage(declaredClean);
      this.revealThreats(r);
      const det = r.hits.filter(Boolean).length;
      if (r.correct && r.isClean) this.showFeedback('good', '✔ Correcto. Equipaje sin amenazas.');
      else if (r.correct) this.showFeedback('good', `✔ Correcto. Detectó ${det}/${r.threats.length} amenaza(s).`);
      else if (r.declaredClean && !r.isClean) this.showFeedback('bad', `✘ Declaró limpio un equipaje con ${r.threats.length} amenaza(s). Vea las siluetas.`);
      else if (!r.declaredClean && r.isClean) this.showFeedback('bad', '✘ Falsa alarma: marcó objetos en un equipaje limpio.');
      else this.showFeedback('bad', `✘ Incompleto: detectó ${det}/${r.threats.length}. Las no detectadas en rojo.`);
      this.els.btnNext.classList.remove('hidden');
    } else {
      this.nextImage();
    }
  },

  revealThreats(r) {
    r.threats.forEach((t, i) => { t._reveal = r.hits[i] ? 'hit' : 'miss'; });
    this.updateOverlays();
  },

  nextImage(skip) {
    if (this.mode !== 'annotator' && !skip && !this.locked) return;
    this.index++;
    if (this.index >= this.queue.length) {
      if (this.mode === 'evaluation') return this.finishEvaluation();
      this.queue = shuffle(this.queue);
      this.index = 0;
    }
    this.loadCurrent();
  },

  async finishEvaluation(byTimeout) {
    this.stopTimer();
    const duration = Math.round((Date.now() - this.startedAt) / 1000);
    try {
      // Corrección EN EL SERVIDOR: regla AEI (40 % + condición excluyente) incluida
      const r = await API.practicalSubmit(this.practicalCourseId, {
        records: this.records, duration_s: duration,
        practical_session_id: this.practicalSessionId,
        proctor_session_id: Proctor.sessionId || undefined
      });
      await Proctor.end();
      App.showPracticalResult(r, byTimeout);
    } catch (e) {
      await Proctor.end();
      App.showPracticalResult({ error: e.message }, byTimeout);
    }
  },

  startTimer() {
    this.updateTimerLabel();
    this.timerId = setInterval(() => {
      this.remaining--;
      this.updateTimerLabel();
      if (this.remaining <= 0) {
        this.stopTimer();
        this.onImageTimeout();
      }
    }, 1000);
  },
  // Se agotó el tiempo de ESTA imagen: se registra como incorrecta (sin marcas, sin decisión)
  // y se avanza automáticamente a la siguiente. Si era la última, finaliza la evaluación.
  onImageTimeout() {
    if (this.mode !== 'evaluation' || this.locked) return;
    this.locked = true;
    this.records.push({
      filename: this.queue[this.index].filename,
      declaredClean: null, marks: [], timeout: true
    });
    this.showFeedback('bad', '⏱ Tiempo agotado — imagen registrada como incorrecta.');
    setTimeout(() => this.nextImage(true), 700);
  },
  stopTimer() { if (this.timerId) { clearInterval(this.timerId); this.timerId = null; } },
  updateTimerLabel() {
    const s = Math.max(0, this.remaining);
    this.els.timer.textContent = `⏱ ${String(s).padStart(2, '0')}s`;
    this.els.timer.style.color = s <= 10 ? 'var(--alert)' : (s <= 15 ? 'var(--organic)' : '');
  },

  updateOverlays() {
    const layer = this.els.marksLayer;
    layer.innerHTML = '';
    if (!this.scanner.img) return;
    for (const m of this.marks) {
      const p = this.scanner.imageToScreen(m.nx, m.ny);
      const el = document.createElement('div');
      el.className = 'mark';
      el.style.left = p.x + 'px'; el.style.top = p.y + 'px';
      layer.appendChild(el);
    }
    const boxes = this.mode === 'annotator'
      ? this.annoThreats.map(t => ({ ...t, cls: 'anno', label: t.tipo }))
      : (this.locked && this.mode === 'training'
        ? (this.queue[this.index].threats || []).map(t => ({ ...t, cls: t._reveal || 'miss', label: t.tipo || 'amenaza' }))
        : []);
    for (const b of boxes) {
      const p1 = this.scanner.imageToScreen(b.x, b.y);
      const p2 = this.scanner.imageToScreen(b.x + b.w, b.y + b.h);
      const el = document.createElement('div');
      el.className = 'threat-box ' + b.cls;
      el.style.left = p1.x + 'px'; el.style.top = p1.y + 'px';
      el.style.width = (p2.x - p1.x) + 'px'; el.style.height = (p2.y - p1.y) + 'px';
      el.textContent = (b.label || '').replace('_', ' ');
      layer.appendChild(el);
    }
  },

  async saveAnnotation(markClean) {
    const item = this.queue[this.index];
    if (markClean) this.annoThreats = [];
    try {
      await API.saveAnnotation({ filename: item.filename, threats: this.annoThreats });
      item.threats = JSON.parse(JSON.stringify(this.annoThreats));
      item.is_clean = this.annoThreats.length === 0;
      item.annotated = true;
      this.annoDirty = false;
      this.showFeedback('good', `✔ Anotación guardada (${this.annoThreats.length} amenaza(s)).`);
      this.updateOverlays();
    } catch (e) { this.showFeedback('bad', 'Error: ' + e.message); }
  },

  stepAnnotator(delta) {
    if (this.annoDirty && !confirm('Hay cambios sin guardar. ¿Cambiar de imagen igual?')) return;
    this.index = (this.index + delta + this.queue.length) % this.queue.length;
    this.loadCurrent();
  },

  showFeedback(kind, msg) {
    this.els.feedback.className = 'feedback ' + kind;
    this.els.feedback.textContent = msg;
  },
  hideFeedback() { this.els.feedback.className = 'feedback hidden'; },
  teardown() { this.stopTimer(); }
};

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function hashCode(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}
