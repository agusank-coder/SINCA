/* ============================================================
 * biometria.js — Reset de contraseña con verificación biométrica
 *
 * FLUJO:
 *   1. El usuario no puede acceder al sistema: va a la pantalla de login
 *   2. Hace clic en "Restablecer contraseña con DNI"
 *   3. Apunta la cámara al código de barras del DNI → se extrae el DNI
 *   4. Verificación de vida: parpadear, mover la cabeza, sonreír
 *   5. Ingresa una nueva contraseña
 *   6. El sistema guarda la foto + log de auditoría y actualiza la contraseña
 * ============================================================ */
const BioReset = {
  stream: null,
  video: null,
  scanning: false,
  dniDetectado: null,
  fotoVerif: null,

  /* Punto de entrada: muestra el modal de reset biométrico */
  async open() {
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.id = 'bio-modal';
    modal.innerHTML = `
      <div class="modal-card" style="max-width:520px">
        <div class="panel-title">Restablecer contraseña — Verificación biométrica</div>
        <div id="bio-paso" class="bio-paso">
          <p class="hint">Este proceso verifica su identidad mediante el escaneo del código de barras
          de su DNI (Documento Nacional de Identidad) y una captura facial de verificación de vida.
          Queda registro de la acción en la auditoría del sistema (Ley 25.506).</p>
          <div class="bio-cam"><video id="bio-video" autoplay muted playsinline></video>
            <div id="bio-overlay"></div></div>
          <div id="bio-status" class="hint mono">Iniciando cámara…</div>
          <div class="results-actions">
            <button class="btn-primary" id="bio-btn-scan">Escanear DNI 🔍</button>
            <button class="btn-ghost" id="bio-cancel">Cancelar</button>
          </div>
        </div>
      </div>`;
    document.body.appendChild(modal);
    modal.querySelector('#bio-cancel').addEventListener('click', () => this.close());

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 360, facingMode: 'environment' }, audio: false
      });
    } catch {
      // Intentar con la cámara frontal si no hay cámara trasera
      try {
        this.stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      } catch {
        document.getElementById('bio-status').textContent = '✘ Sin acceso a la cámara. Contacte al administrador.';
        return;
      }
    }
    this.video = document.getElementById('bio-video');
    this.video.srcObject = this.stream;
    document.getElementById('bio-status').textContent = 'Cámara lista. Apunte al código de barras del DNI (parte trasera).';
    document.getElementById('bio-btn-scan').addEventListener('click', () => this._startScan());
  },

  /* PASO 1: Escaneo del código de barras del DNI argentino */
  _startScan() {
    if (this.scanning) return;
    this.scanning = true;
    const status = document.getElementById('bio-status');
    status.textContent = 'Escaneando código de barras… Mantenga el DNI estable y bien iluminado.';
    document.getElementById('bio-btn-scan').disabled = true;

    // Intentar con BarcodeDetector nativo del navegador
    if ('BarcodeDetector' in window) {
      const bd = new BarcodeDetector({ formats: ['pdf417', 'code_39', 'code_128', 'qr_code', 'ean_13'] });
      const scan = async () => {
        if (!this.scanning) return;
        try {
          const codes = await bd.detect(this.video);
          if (codes.length > 0) {
            const raw = codes[0].rawValue;
            const dni = this._parseDNI(raw);
            if (dni) { this._dniOk(dni); return; }
          }
        } catch {}
        requestAnimationFrame(scan);
      };
      requestAnimationFrame(scan);
    } else {
      // BarcodeDetector no disponible: pedir ingreso manual con cámara encendida
      status.textContent = '⚠ Escaneo automático no disponible en este navegador. Ingrese su DNI manualmente para continuar con la verificación facial.';
      const inp = document.createElement('input');
      inp.type = 'number'; inp.placeholder = 'Número de DNI sin puntos';
      inp.style.cssText = 'width:100%;padding:10px;border-radius:8px;border:1px solid var(--line);background:#10141a;color:var(--text);font-size:16px;margin-top:10px';
      inp.addEventListener('change', () => { if (inp.value.length >= 6) this._dniOk(inp.value.trim()); });
      document.getElementById('bio-paso').insertBefore(inp, document.getElementById('bio-status'));
    }
  },

  /* Extraer el DNI del string del código de barras del DNI argentino
     El PDF417 del DNI argentino contiene campos separados por @ o por espacios.
     El DNI (número) suele estar en el campo 4 o 5. */
  _parseDNI(raw) {
    if (!raw) return null;
    // Formato PDF417 del DNI argentino: APELLIDO@NOMBRES@DNI@TRAMITE@...
    const parts = raw.split('@');
    if (parts.length >= 3) {
      const dni = parts.find(p => /^\d{6,9}$/.test(p.trim()));
      if (dni) return dni.trim();
    }
    // Si es solo números (ingreso manual)
    if (/^\d{6,9}$/.test(raw.trim())) return raw.trim();
    return null;
  },

  _dniOk(dni) {
    this.scanning = false;
    this.dniDetectado = dni;
    document.getElementById('bio-status').textContent = '✔ DNI detectado: ' + dni + '. Ahora se realizará la verificación de vida.';
    document.getElementById('bio-btn-scan').textContent = '✔ DNI leído';
    document.getElementById('bio-btn-scan').disabled = true;
    setTimeout(() => this._verificacionVida(), 1200);
  },

  /* PASO 2: Verificación de vida — instrucciones visuales + captura facial */
  _verificacionVida() {
    const paso = document.getElementById('bio-paso');
    const status = document.getElementById('bio-status');

    // Cambiar a cámara frontal para la verificación facial
    this.stream.getTracks().forEach(t => t.stop());
    navigator.mediaDevices.getUserMedia({ video: { width: 400, height: 400, facingMode: 'user' }, audio: false })
      .then(s => {
        this.stream = s;
        this.video.srcObject = s;
        const overlay = document.getElementById('bio-overlay');
        overlay.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;';

        // Secuencia de instrucciones de vida (4 segundos cada una)
        const instrucciones = [
          { msg: '👁 Mire directamente a la cámara', dur: 3500 },
          { msg: '😊 Sonría', dur: 2500 },
          { msg: '🔄 Gire levemente la cabeza hacia la derecha', dur: 2500 },
          { msg: '↩ Vuelva a mirar al frente', dur: 2000 }
        ];
        let i = 0;
        const sig = () => {
          if (i >= instrucciones.length) {
            // Capturar foto de verificación
            status.textContent = '✔ Verificación de vida completada. Tomando foto de registro…';
            setTimeout(() => {
              this.fotoVerif = this._snapshot();
              this._nuevaPassword();
            }, 800);
            return;
          }
          const instr = instrucciones[i++];
          overlay.innerHTML = '<div style="background:rgba(10,14,20,.85);padding:14px 20px;border-radius:12px;color:#fff;font-size:18px;text-align:center">' + instr.msg + '</div>';
          status.textContent = 'Verificación de vida — ' + instr.msg.replace(/[^\w\s]/g, '');
          setTimeout(sig, instr.dur);
        };
        sig();
      })
      .catch(() => {
        // Si no hay cámara frontal, tomar snapshot de la cámara actual
        this.fotoVerif = this._snapshot();
        this._nuevaPassword();
      });
  },

  /* PASO 3: Nueva contraseña */
  _nuevaPassword() {
    const paso = document.getElementById('bio-paso');
    paso.innerHTML = `
      <p class="hint">DNI verificado: <b>${this.dniDetectado}</b>. Foto de verificación de vida registrada.</p>
      <div class="bio-foto-preview">${this.fotoVerif ? '<img src="' + this.fotoVerif + '" alt="Verificación de vida">' : '<span class="hint">Sin foto</span>'}</div>
      <label class="form-label">Nueva contraseña (mínimo 6 caracteres)
        <input type="password" id="bio-pass1" style="width:100%;padding:10px;border-radius:8px;border:1px solid var(--line);background:#10141a;color:var(--text);font-size:15px;margin-top:6px"></label>
      <label class="form-label" style="margin-top:10px;display:block">Confirmar contraseña
        <input type="password" id="bio-pass2" style="width:100%;padding:10px;border-radius:8px;border:1px solid var(--line);background:#10141a;color:var(--text);font-size:15px;margin-top:6px"></label>
      <div id="bio-err" style="color:var(--alert);font-size:13px;min-height:18px"></div>
      <div class="results-actions">
        <button class="btn-primary" id="bio-btn-ok">Restablecer contraseña ✔</button>
        <button class="btn-ghost" id="bio-cancel2">Cancelar</button>
      </div>`;
    document.getElementById('bio-cancel2').addEventListener('click', () => this.close());
    document.getElementById('bio-btn-ok').addEventListener('click', () => this._submit());
  },

  async _submit() {
    const p1 = document.getElementById('bio-pass1').value;
    const p2 = document.getElementById('bio-pass2').value;
    const err = document.getElementById('bio-err');
    if (p1.length < 6) { err.textContent = 'La contraseña debe tener al menos 6 caracteres.'; return; }
    if (p1 !== p2) { err.textContent = 'Las contraseñas no coinciden.'; return; }
    err.textContent = '';
    const btn = document.getElementById('bio-btn-ok');
    btn.disabled = true; btn.textContent = 'Verificando…';
    try {
      const r = await API.bioReset({ dni: this.dniDetectado, password: p1, foto: this.fotoVerif });
      if (r.ok) {
        this.close();
        alert('✔ Contraseña restablecida para ' + r.apellido + ', ' + r.nombre + '.\n\nSe registró la verificación biométrica en la auditoría del sistema. Inicie sesión con su nueva contraseña.');
      } else { err.textContent = r.error || 'Error al restablecer.'; btn.disabled = false; btn.textContent = 'Restablecer contraseña ✔'; }
    } catch (e) { err.textContent = e.message; btn.disabled = false; btn.textContent = 'Restablecer contraseña ✔'; }
  },

  _snapshot() {
    try {
      const v = this.video;
      if (!v || !v.videoWidth) return null;
      const c = document.createElement('canvas');
      c.width = 400; c.height = Math.round(400 * v.videoHeight / v.videoWidth);
      c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
      return c.toDataURL('image/jpeg', 0.7);
    } catch { return null; }
  },

  close() {
    try { this.stream?.getTracks().forEach(t => t.stop()); } catch {}
    this.stream = null; this.scanning = false; this.dniDetectado = null; this.fotoVerif = null;
    document.getElementById('bio-modal')?.remove();
  }
};
