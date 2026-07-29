/* ============================================================
 * scanner.js — Motor de imagen del simulador
 * - Clasificación por tono (HSL) para filtros ORG / INO / MET
 * - HI/LO penetración (contraste profundo por curva gamma)
 * - Inversión y escala de grises
 * - Zoom (rueda, pellizco, botones) y paneo con arrastre
 * - Conversión pantalla <-> coordenadas normalizadas de imagen
 * ============================================================ */
class XRayScanner {
  constructor(canvas, viewport) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.viewport = viewport;

    // Imagen fuente y buffers
    this.img = null;
    this.src = document.createElement('canvas');   // píxeles originales
    this.out = document.createElement('canvas');   // píxeles filtrados

    // Estado de filtros
    this.state = { filter: 'none', hipen: false, lopen: false, invert: false, bw: false };

    // Estado de vista
    this.scale = 1; this.minScale = 1; this.maxScale = 8;
    this.tx = 0; this.ty = 0;

    // Interacción
    this._drag = null;
    this._pinch = null;
    this.onClickImage = null;   // callback(nx, ny) coords normalizadas
    this.onDragBox = null;      // callback(box) para el anotador
    this.annotatorMode = false;

    this._bindEvents();
    this._resizeObserver = new ResizeObserver(() => this._fit());
    this._resizeObserver.observe(viewport);
  }

  /* ---------- Carga ---------- */
  load(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        this.img = img;
        this.src.width = img.naturalWidth;
        this.src.height = img.naturalHeight;
        this.src.getContext('2d').drawImage(img, 0, 0);
        this.resetView();
        this.applyFilters();
        resolve();
      };
      img.onerror = () => reject(new Error('No se pudo cargar la imagen: ' + url));
      img.src = url;
    });
  }

  /* ---------- Filtros ---------- */
  setFilter(name) { this.state.filter = name; this.applyFilters(); }
  toggle(name) {
    if (name === 'hipen') { this.state.hipen = !this.state.hipen; if (this.state.hipen) this.state.lopen = false; }
    else if (name === 'lopen') { this.state.lopen = !this.state.lopen; if (this.state.lopen) this.state.hipen = false; }
    else this.state[name] = !this.state[name];
    this.applyFilters();
    return this.state[name];
  }
  resetFilters() {
    this.state = { filter: 'none', hipen: false, lopen: false, invert: false, bw: false };
    this.applyFilters();
  }

  applyFilters() {
    if (!this.img) return;
    const w = this.src.width, h = this.src.height;
    this.out.width = w; this.out.height = h;
    const sctx = this.src.getContext('2d');
    const octx = this.out.getContext('2d');
    const data = sctx.getImageData(0, 0, w, h);
    const px = data.data;
    const { filter, hipen, lopen, invert, bw } = this.state;

    // Curva de penetración: gamma < 1 revela zonas densas (HI), gamma > 1 las aplana (LO)
    const gamma = hipen ? 0.55 : lopen ? 1.7 : 1;
    const contrast = hipen ? 1.35 : lopen ? 0.8 : 1;
    const lut = new Uint8ClampedArray(256);
    for (let i = 0; i < 256; i++) {
      let v = Math.pow(i / 255, gamma) * 255;
      v = (v - 128) * contrast + 128;
      lut[i] = Math.max(0, Math.min(255, v));
    }

    for (let i = 0; i < px.length; i += 4) {
      let r = px[i], g = px[i + 1], b = px[i + 2];

      if (filter !== 'none') {
        const cls = XRayScanner.classify(r, g, b); // 'org' | 'ino' | 'met' | 'bg'
        const keep = (filter === 'organic' && cls === 'org') ||
                     (filter === 'inorganic' && cls === 'ino') ||
                     (filter === 'metal' && cls === 'met');
        if (!keep) {
          // Atenuar a gris claro lo que no corresponde al filtro activo
          const lum = 0.299 * r + 0.587 * g + 0.114 * b;
          const wash = lum * 0.25 + 190;
          r = g = b = Math.min(255, wash);
        } else {
          // Saturar levemente la clase seleccionada para resaltarla
          const boost = 1.25;
          const lum = 0.299 * r + 0.587 * g + 0.114 * b;
          r = Math.min(255, lum + (r - lum) * boost);
          g = Math.min(255, lum + (g - lum) * boost);
          b = Math.min(255, lum + (b - lum) * boost);
        }
      }

      r = lut[r | 0]; g = lut[g | 0]; b = lut[b | 0];

      if (bw) { const lum = 0.299 * r + 0.587 * g + 0.114 * b; r = g = b = lum; }
      if (invert) { r = 255 - r; g = 255 - g; b = 255 - b; }

      px[i] = r; px[i + 1] = g; px[i + 2] = b;
    }
    octx.putImageData(data, 0, 0);
    this.render();
  }

  /** Clasifica un píxel según la convención pseudocolor de rayos X:
   *  naranja = orgánico · verde = inorgánico · azul/oscuro = metal · claro = fondo */
  static classify(r, g, b) {
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const lum = (max + min) / 2;
    if (lum > 235 && max - min < 26) return 'bg';           // fondo blanco del túnel
    if (lum < 55) return 'met';                              // muy denso -> metal
    if (max - min < 22) return lum < 140 ? 'met' : 'bg';     // gris denso vs claro
    let hue = 0;
    const d = max - min;
    if (max === r) hue = 60 * (((g - b) / d) % 6);
    else if (max === g) hue = 60 * ((b - r) / d + 2);
    else hue = 60 * ((r - g) / d + 4);
    if (hue < 0) hue += 360;
    if (hue >= 10 && hue < 70) return 'org';                 // naranjas/ámbar
    if (hue >= 70 && hue < 170) return 'ino';                // verdes
    if (hue >= 170 && hue < 280) return 'met';               // azules
    return 'org';                                            // rojizos residuales -> orgánico
  }

  /* ---------- Vista (zoom / pan) ---------- */
  _fit() {
    const r = this.viewport.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.max(1, Math.round(r.width * dpr));
    this.canvas.height = Math.max(1, Math.round(r.height * dpr));
    this.render();
  }

  resetView() {
    this.scale = 1; this.tx = 0; this.ty = 0;
    this._fit();
  }

  /** Geometría base: la imagen se ajusta "contain" al viewport a escala 1 */
  _baseFit() {
    const cw = this.canvas.width, ch = this.canvas.height;
    if (!this.img) return { x: 0, y: 0, w: cw, h: ch };
    const iw = this.src.width, ih = this.src.height;
    const s = Math.min(cw / iw, ch / ih);
    const w = iw * s, h = ih * s;
    return { x: (cw - w) / 2, y: (ch - h) / 2, w, h };
  }

  render() {
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#0b0e12';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    if (!this.img) return;
    const base = this._baseFit();
    ctx.imageSmoothingEnabled = this.scale < 2.5;
    ctx.setTransform(this.scale, 0, 0, this.scale, this.tx, this.ty);
    ctx.drawImage(this.out, base.x, base.y, base.w, base.h);
    if (this._annoDraft) this._drawDraft(base);
    if (typeof this.onRender === 'function') this.onRender();
  }

  _drawDraft(base) {
    const d = this._annoDraft, ctx = this.ctx;
    ctx.save();
    ctx.strokeStyle = '#f0932b'; ctx.setLineDash([6, 4]); ctx.lineWidth = 2 / this.scale;
    ctx.strokeRect(base.x + d.x * base.w, base.y + d.y * base.h, d.w * base.w, d.h * base.h);
    ctx.restore();
  }

  setZoom(newScale, cx, cy) {
    const s0 = this.scale;
    const s1 = Math.max(this.minScale, Math.min(this.maxScale, newScale));
    if (cx === undefined) { cx = this.canvas.width / 2; cy = this.canvas.height / 2; }
    // Mantener el punto (cx,cy) fijo en pantalla
    this.tx = cx - (cx - this.tx) * (s1 / s0);
    this.ty = cy - (cy - this.ty) * (s1 / s0);
    this.scale = s1;
    if (this.scale === 1) { this.tx = 0; this.ty = 0; }
    this.render();
    return this.scale;
  }

  /* ---------- Conversión de coordenadas ---------- */
  screenToImage(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const cx = (clientX - rect.left) * dpr;
    const cy = (clientY - rect.top) * dpr;
    const wx = (cx - this.tx) / this.scale;
    const wy = (cy - this.ty) / this.scale;
    const base = this._baseFit();
    const nx = (wx - base.x) / base.w;
    const ny = (wy - base.y) / base.h;
    return { nx, ny, inside: nx >= 0 && nx <= 1 && ny >= 0 && ny <= 1 };
  }

  imageToScreen(nx, ny) {
    const base = this._baseFit();
    const dpr = window.devicePixelRatio || 1;
    const wx = base.x + nx * base.w;
    const wy = base.y + ny * base.h;
    return { x: (wx * this.scale + this.tx) / dpr, y: (wy * this.scale + this.ty) / dpr };
  }

  /* ---------- Eventos de puntero ---------- */
  _bindEvents() {
    const c = this.canvas;
    const pointers = new Map();

    c.addEventListener('pointerdown', (e) => {
      c.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        this._pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y), scale: this.scale };
        this._drag = null;
        return;
      }
      const pt = this.screenToImage(e.clientX, e.clientY);
      if (this.annotatorMode && pt.inside) {
        this._annoDraft = { x: pt.nx, y: pt.ny, w: 0, h: 0, _sx: pt.nx, _sy: pt.ny };
      } else {
        this._drag = { x: e.clientX, y: e.clientY, tx: this.tx, ty: this.ty, moved: false };
      }
    });

    c.addEventListener('pointermove', (e) => {
      if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (this._pinch && pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        const midX = (a.x + b.x) / 2, midY = (a.y + b.y) / 2;
        const rect = c.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        this.setZoom(this._pinch.scale * (dist / this._pinch.dist), (midX - rect.left) * dpr, (midY - rect.top) * dpr);
        if (typeof this.onZoom === 'function') this.onZoom(this.scale);
        return;
      }

      if (this._annoDraft) {
        const pt = this.screenToImage(e.clientX, e.clientY);
        const x0 = this._annoDraft._sx, y0 = this._annoDraft._sy;
        const x1 = Math.max(0, Math.min(1, pt.nx)), y1 = Math.max(0, Math.min(1, pt.ny));
        this._annoDraft.x = Math.min(x0, x1); this._annoDraft.y = Math.min(y0, y1);
        this._annoDraft.w = Math.abs(x1 - x0); this._annoDraft.h = Math.abs(y1 - y0);
        this.render();
        return;
      }

      if (this._drag) {
        const dx = e.clientX - this._drag.x, dy = e.clientY - this._drag.y;
        if (Math.hypot(dx, dy) > 4) this._drag.moved = true;
        const dpr = window.devicePixelRatio || 1;
        this.tx = this._drag.tx + dx * dpr;
        this.ty = this._drag.ty + dy * dpr;
        this.render();
      }
    });

    const endPointer = (e) => {
      pointers.delete(e.pointerId);
      if (pointers.size < 2) this._pinch = null;

      if (this._annoDraft) {
        const d = this._annoDraft; this._annoDraft = null;
        this.render();
        if (d.w > 0.01 && d.h > 0.01 && typeof this.onDragBox === 'function') {
          this.onDragBox({ x: d.x, y: d.y, w: d.w, h: d.h });
        }
        return;
      }
      if (this._drag) {
        const wasClick = !this._drag.moved;
        this._drag = null;
        if (wasClick && typeof this.onClickImage === 'function') {
          const pt = this.screenToImage(e.clientX, e.clientY);
          if (pt.inside) this.onClickImage(pt.nx, pt.ny);
        }
      }
    };
    c.addEventListener('pointerup', endPointer);
    c.addEventListener('pointercancel', endPointer);

    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      const rect = c.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
      this.setZoom(this.scale * factor, (e.clientX - rect.left) * dpr, (e.clientY - rect.top) * dpr);
      if (typeof this.onZoom === 'function') this.onZoom(this.scale);
    }, { passive: false });
  }
}
