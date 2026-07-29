/* ============================================================
 * campus.js — Vistas del estudiante
 *  - Catálogo / Mis cursos / Mis certificados
 *  - Curso por niveles (orden propio del alumno, desbloqueo secuencial)
 *  - Reproductor de micro-video BLOQUEADO (sin pausa, sin salto,
 *    velocidad fija) + checkpoint obligatorio
 *  - Examen teórico con sesión única (subconjunto y orden aleatorios)
 * ============================================================ */
const Campus = {
  courseId: null,
  lessonId: null,
  session: null,
  examSession: null,

  /* ---------- Navegación de vistas del campus ---------- */
  nav(name) {
    document.querySelectorAll('#mainnav button').forEach(b => b.classList.toggle('active', b.dataset.nav === name));
    document.querySelectorAll('.campus-view').forEach(v => v.classList.add('hidden'));
    document.getElementById('view-' + name).classList.remove('hidden');
    if (name === 'catalogo') this.renderCatalogo();
    if (name === 'miscursos') this.renderMisCursos();
    if (name === 'certificados') this.renderCertificados();
    if (name === 'gestion') Gestion.render();
    if (name === 'perfil') this.renderPerfil();
  },

  /* ---------- Catálogo ---------- */
  async renderCatalogo() {
    const el = document.getElementById('view-catalogo');
    el.innerHTML = '<p class="hint">Cargando catálogo…</p>';
    try {
      const { courses } = await API.courses();
      const mod = m => m.split(',').map(x => ({ P: 'Presencial', S: 'Semipresencial', E: 'E-learning' }[x] || x)).join(' · ');
      el.innerHTML = `
        <h1>Plataforma de Capacitación e Instrucción del Instituto Superior de Seguridad Aeroportuaria</h1>
        <div class="course-grid">
          ${courses.map(c => `
            <div class="course-card">
              <div class="course-cod mono">${c.cod}</div>
              <strong>${c.nombre}</strong>
              <div class="course-meta">
                <span>⏱ ${c.horas} hs (${c.horas_teoricas}T + ${c.horas_practicas}P)</span>
                <span>📋 ${mod(c.modalidades)}</span>
                ${c.vigencia_meses ? `<span>♻ Recurrencia: ${c.vigencia_meses} meses</span>` : ''}
                ${c.simulador ? '<span>🖥 Práctico en simulador de Rayos X</span>' : ''}
              </div>
              <p class="course-dest">${c.destinatarios}</p>
              <button class="btn-primary" data-open="${c.id}">${c.inscripto ? 'Continuar curso ▶' : (App.user?.role === 'estudiante' ? 'Ver curso' : 'Asignarme e iniciar')}</button>
            </div>`).join('')}
        </div>
        ${App.user?.role === 'estudiante' && !courses.length ? '<p class="hint">Aún no tiene cursos asignados. La inscripción la realiza la administración del ISSA o su Centro de Capacitación.</p>' : ''}
        <div class="free-train">
          <strong>Entrenamiento libre — Simulador de Rayos X</strong>
          <span>Práctica sin registro de nota, con retroalimentación inmediata y silueta de amenazas.</span>
          <button class="btn-ghost" id="btn-free-training">Abrir simulador</button>
        </div>`;
      el.querySelectorAll('[data-open]').forEach(b => b.addEventListener('click', async () => {
        const id = Number(b.dataset.open);
        if (App.user?.role !== 'estudiante') { try { await API.enroll(id); } catch {} }
        this.openCourse(id);
      }));
      document.getElementById('btn-free-training').addEventListener('click', () => App.startFreeTraining());
    } catch (e) { el.innerHTML = `<p class="error">${e.message}</p>`; }
  },

  /* ---------- Mis cursos ---------- */
  async renderMisCursos() {
    const el = document.getElementById('view-miscursos');
    el.innerHTML = '<p class="hint">Cargando…</p>';
    try {
      const { enrollments } = await API.me();
      if (!enrollments.length) { el.innerHTML = '<h1>Mis cursos</h1><p class="hint">Aún no está inscripto en ningún curso. Vaya al Catálogo.</p>'; return; }
      const badge = e => e === 'aprobado' ? '<span class="badge-pass">APROBADO</span>'
        : e === 'desaprobado' ? '<span class="badge-fail">DESAPROBADO</span>' : '<span class="pill">CURSANDO</span>';
      el.innerHTML = `<h1>Mis cursos</h1>
        <table class="list-table"><thead><tr><th>Código</th><th>Curso</th><th>Estado</th><th>Inscripción</th><th></th></tr></thead>
        <tbody>${enrollments.map(e => `
          <tr><td class="mono">${e.cod}</td><td>${e.nombre}</td><td>${badge(e.estado)}</td>
          <td class="mono">${e.created_at}</td>
          <td><button class="btn-ghost" data-open="${e.course_id}">Abrir ▶</button></td></tr>`).join('')}
        </tbody></table>`;
      el.querySelectorAll('[data-open]').forEach(b => b.addEventListener('click', () => this.openCourse(Number(b.dataset.open))));
    } catch (e) { el.innerHTML = `<p class="error">${e.message}</p>`; }
  },

  /* ---------- Mis certificados + tarjetita ---------- */
  async renderCertificados() {
    const el = document.getElementById('view-certificados');
    el.innerHTML = '<p class="hint">Cargando…</p>';
    try {
      const { certificates, user } = await API.me();
      const hoy = new Date().toISOString().slice(0, 10);
      const vigentes = (certificates||[]).filter(c => !c.anulado && (!c.vencimiento || c.vencimiento >= hoy));
      const vencidos = (certificates||[]).filter(c => !c.anulado && c.vencimiento && c.vencimiento < hoy);

      el.innerHTML = '<h1>Mis certificados</h1>' +
        '<div class="kpi-row">' +
        '<div class="kpi"><b style="color:var(--ok)">' + vigentes.length + '</b><span>Vigentes</span></div>' +
        '<div class="kpi"><b style="color:var(--alert)">' + vencidos.length + '</b><span>Vencidos</span></div>' +
        '</div>' +
        '<div class="filter-row">' +
        '<button class="btn-primary" id="btn-tarjeta" style="width:auto">🪪 Imprimir credencial con QR</button>' +
        '</div>' +
        '<table class="list-table"><thead><tr><th>Código</th><th>Curso</th><th>Nota</th><th>Emisión</th><th>Vencimiento</th><th>Firma</th><th></th></tr></thead>' +
        '<tbody>' + (certificates||[]).map(c => {
          const est = c.anulado ? '<span class="badge-fail">ANULADO</span>'
            : !c.vencimiento ? '<span class="badge-pass">SIN VENCIMIENTO</span>'
            : c.vencimiento < hoy ? '<span class="badge-fail">' + _fmtFecha(c.vencimiento) + ' VENCIDO</span>'
            : '<span class="badge-pass">' + _fmtFecha(c.vencimiento) + '</span>';
          return '<tr><td class="mono">' + c.code + '</td>' +
            '<td>' + (c.curso_cod||'') + ' — ' + (c.curso_nombre||'') + '</td>' +
            '<td>' + c.score_pct + ' %</td>' +
            '<td class="mono">' + _fmtFecha(c.issued_at) + '</td>' +
            '<td>' + est + '</td>' +
            '<td class="mono" style="font-size:10px">' + (c.firma_hash ? c.firma_hash.slice(0,12) + '…' : '—') + '</td>' +
            '<td>' + (!c.anulado ? '<button class="btn-ghost" data-dl="' + c.code + '">PDF ⬇</button>' : '') + '</td></tr>';
        }).join('') +
        (!(certificates||[]).length ? '<tr><td colspan="7" class="hint" style="text-align:center;padding:20px">Todavía no posee certificados emitidos.</td></tr>' : '') +
        '</tbody></table>';

      el.querySelectorAll('[data-dl]').forEach(b => b.addEventListener('click', async () => {
        const { certificate } = await API.certificate(b.dataset.dl);
        await generateCertificate(certificate);
      }));
      document.getElementById('btn-tarjeta').addEventListener('click', async () => {
        const { user: u } = await API.me();
        await this.printTarjeta(u, certificates||[]);
      });
    } catch (e) { el.innerHTML = '<p class="error">' + e.message + '</p>'; }
  },

  // Credencial vertical con marca de agua, número de permiso y datos correctos
  async printTarjeta(user, certs) {
    if (!window.jspdf) { alert('jsPDF no disponible'); return; }
    const numPermiso = prompt('Ingrese el número de permiso aeroportuario:');
    if (numPermiso === null || !numPermiso.trim()) { alert('El número de permiso es obligatorio.'); return; }
    // Generar código único de verificación para esta credencial
    const verCode = 'CRED-' + user.legajo + '-' + Date.now().toString(36).toUpperCase().slice(-6);
    const { jsPDF } = window.jspdf;
    const hoy = new Date().toISOString().slice(0,10);
    const vigentes = certs.filter(c=>!c.anulado&&(!c.vencimiento||c.vencimiento>=hoy));
    // CR80 estándar: 85.6mm x 54mm
    const CW=85.6, CH=54;
    // A4 portrait con instrucciones
    const doc = new jsPDF({unit:'mm', format:'a4', orientation:'portrait'});
    const PW=210, PH=297;
    // Centrar en la página
    const ox=(PW-CW)/2, oy=40;

    // ─── INSTRUCCIONES ───
    doc.setFont('helvetica','normal'); doc.setFontSize(8); doc.setTextColor(100,110,120);
    doc.text('CREDENCIAL AVSEC — Tamaño CR80 (85.6 × 54 mm — estándar tarjeta de crédito)', PW/2, 12, {align:'center'});
    doc.text('Imprimir, recortar por las líneas de corte y laminar. Para doble faz: ver instrucciones al pie.', PW/2, 17, {align:'center'});

    // ─── MARCAS DE CORTE ───
    const drawCuts = (x,y,w,h) => {
      doc.setDrawColor(180,190,200); doc.setLineWidth(0.15);
      const t=5;
      [[x,y],[x+w,y],[x,y+h],[x+w,y+h]].forEach(([cx,cy])=>{
        doc.line(cx-t,cy,cx-1,cy); doc.line(cx+1,cy,cx+t,cy);
        doc.line(cx,cy-t,cx,cy-1); doc.line(cx,cy+1,cx,cy+t);
      });
      doc.setLineDash([1,1],0);
      doc.rect(x,y,w,h); doc.setLineDash([],0);
    };

    // ─── FRENTE BLANCO (estilo carnet de conducir) ───
    const drawFrente = async (x, y) => {
      // Fondo blanco
      doc.setFillColor(255,255,255); doc.roundedRect(x,y,CW,CH,2,2,'F');
      // Borde exterior azul oscuro
      doc.setDrawColor(15,35,90); doc.setLineWidth(0.8); doc.roundedRect(x,y,CW,CH,2,2);
      // Franja superior azul con texto
      doc.setFillColor(15,35,90); doc.roundedRect(x,y,CW,11,2,2,'F');
      doc.setFillColor(15,35,90); doc.rect(x,y+7,CW,4,'F');
      // Franja inferior azul
      doc.setFillColor(15,35,90); doc.rect(x,y+CH-7,CW,7,'F');
      doc.setFillColor(15,35,90); doc.roundedRect(x,y+CH-9,CW,9,2,2,'F');
      doc.setFillColor(15,35,90); doc.rect(x,y+CH-7,CW,7,'F');
      // Borde inferior redondeado
      // Línea naranja decorativa
      doc.setFillColor(220,150,0); doc.rect(x,y+11,CW,1.5,'F');
      // Línea verde decorativa superior a franja inferior
      doc.setFillColor(30,140,80); doc.rect(x,y+CH-9,CW,1.5,'F');

      // Logos en franja superior
      try {
        const psaB = await fetch('/img/psa.png').then(r=>r.blob());
        const psaD = await new Promise(ok=>{const fr=new FileReader();fr.onload=()=>ok(fr.result);fr.readAsDataURL(psaB);});
        doc.addImage(psaD,'PNG',x+2,y+1,9,9);
      } catch {}
      try {
        const issaB = await fetch('/img/issa.png').then(r=>r.blob());
        const issaD = await new Promise(ok=>{const fr=new FileReader();fr.onload=()=>ok(fr.result);fr.readAsDataURL(issaB);});
        doc.addImage(issaD,'PNG',x+CW-11,y+1,9,9);
      } catch {}

      // Título en franja superior
      doc.setFont('helvetica','bold'); doc.setFontSize(5.5); doc.setTextColor(255,255,255);
      doc.text('POLICÍA DE SEGURIDAD AEROPORTUARIA', x+CW/2, y+5, {align:'center'});
      doc.setFontSize(4.5); doc.setFont('helvetica','normal'); doc.setTextColor(200,220,255);
      doc.text('CREDENCIAL AVSEC — PSA/ISSA', x+CW/2, y+9.5, {align:'center'});

      // ── Zona de datos (fondo blanco) ──
      // Número de permiso destacado
      doc.setFillColor(15,35,90); doc.roundedRect(x+3,y+13.5,CW-6,6.5,1,1,'F');
      doc.setFont('helvetica','bold'); doc.setFontSize(7); doc.setTextColor(255,200,0);
      doc.text('PERMISO N°: '+numPermiso.trim().toUpperCase(), x+CW/2, y+18, {align:'center'});

      // Nombre apellido — grande y claro
      doc.setFont('helvetica','bold'); doc.setFontSize(9); doc.setTextColor(10,20,60);
      doc.text(user.apellido.toUpperCase()+',', x+CW/2, y+26.5, {align:'center'});
      doc.setFontSize(8); doc.text(user.nombre, x+CW/2, y+32, {align:'center'});

      // Jerarquía
      if(user.rango) {
        doc.setFont('helvetica','normal'); doc.setFontSize(5.5); doc.setTextColor(60,80,140);
        doc.text(user.rango.slice(0,38), x+CW/2, y+36.5, {align:'center'});
      }

      // Datos en 2 columnas
      doc.setFont('helvetica','normal'); doc.setFontSize(5); doc.setTextColor(60,60,70);
      doc.text('DNI: '+(user.dni||'—'), x+5, y+40.5);
      doc.text('Leg: '+user.legajo, x+CW/2+2, y+40.5);
      doc.text((user.organismo||''), x+5, y+44);
      doc.text((user.aeropuerto||'').slice(0,22), x+CW/2+2, y+44);

      // Código único de verificación
      doc.setFontSize(4); doc.setTextColor(100,100,120);
      doc.text('Verificación: '+verCode, x+CW/2, y+47.5, {align:'center'});

      // Franja inferior: texto blanco
      doc.setFont('helvetica','bold'); doc.setFontSize(5); doc.setTextColor(255,255,255);
      doc.text('PSA  ·  ISSA  ·  '+hoy, x+CW/2, y+CH-3, {align:'center'});
    };

    // ─── DORSO BLANCO con QR y capacitaciones ───
    const drawDorso = async (x, y) => {
      doc.setFillColor(255,255,255); doc.roundedRect(x,y,CW,CH,2,2,'F');
      doc.setDrawColor(15,35,90); doc.setLineWidth(0.8); doc.roundedRect(x,y,CW,CH,2,2);
      doc.setFillColor(15,35,90); doc.roundedRect(x,y,CW,9,2,2,'F');
      doc.setFillColor(15,35,90); doc.rect(x,y+6,CW,3,'F');
      doc.setFillColor(220,150,0); doc.rect(x,y+9,CW,1.2,'F');

      doc.setFont('helvetica','bold'); doc.setFontSize(5.5); doc.setTextColor(255,255,255);
      doc.text('CAPACITACIONES AVSEC VIGENTES', x+CW/2, y+6, {align:'center'});

      // QR — texto plano legible con etiquetas, separado por "|" (se lee directo al escanear, sin ir a ninguna web)
      let qrDrawn=false;
      try {
        const serie = verCode.split('-')[1] || '';
        const partes = [
          'SISTEMA: SINCA',
          'CREDENCIAL: ' + verCode,
          'TITULAR: ' + user.apellido + ', ' + user.nombre,
          'LEGAJO: ' + user.legajo,
          'DNI: ' + (user.dni || 'S/D'),
          'PERMISO: ' + numPermiso.trim(),
          'SERIE: ' + serie,
          'ENTE: ' + (user.organismo || 'PSA'),
          'EMISION: ' + hoy.split('-').reverse().join('/'),
        ];
        if (vigentes.length === 0) {
          partes.push('CURSOS: SIN CAPACITACIONES VIGENTES');
        } else {
          // Limitar a 6 cursos en el QR para que se mantenga escaneable (denso pero legible)
          const maxQR = 6;
          vigentes.slice(0, maxQR).forEach(c => {
            const cod = (c.curso_cod||'').replace('COD-PSA ','COD ');
            const ap = c.issued_at ? c.issued_at.slice(0,10).split('-').reverse().join('/') : '—';
            const vce = c.vencimiento ? c.vencimiento.split('-').reverse().join('/') : 'S/V';
            partes.push('CURSO: ' + cod + ' | CERT: ' + c.code + ' | CAPACITACION: ' + ap + ' | VENCIMIENTO: ' + vce);
          });
          if (vigentes.length > maxQR) partes.push('(+' + (vigentes.length-maxQR) + ' capacitaciones mas — ver plataforma SINCA)');
        }
        const qrText = partes.join(' | ');
        const qrUrl='https://api.qrserver.com/v1/create-qr-code/?size=260x260&data='+encodeURIComponent(qrText);
        const qrBlob=await fetch(qrUrl).then(r=>r.blob());
        const qrB64=await new Promise(ok=>{const fr=new FileReader();fr.onload=()=>ok(fr.result);fr.readAsDataURL(qrBlob);});
        doc.setFillColor(255,255,255); doc.rect(x+2,y+11,22,22,'F');
        doc.addImage(qrB64,'PNG',x+2.5,y+11.5,21,21);
        qrDrawn=true;
      } catch {}

      // Capacitaciones vigentes — columna derecha (2 líneas por curso, SIN superposición)
      const xC = x+(qrDrawn?26:3), yC=y+12, wC=CW-(qrDrawn?28:4);
      doc.setFont('helvetica','bold'); doc.setFontSize(4.5); doc.setTextColor(15,35,90);
      doc.text('CAPACITACIONES:', xC, yC);
      if(vigentes.length===0) {
        doc.setFont('helvetica','normal'); doc.setFontSize(4); doc.setTextColor(120,120,120);
        doc.text('Sin capacitaciones vigentes', xC, yC+5);
      } else {
        // Cada curso ocupa 2 renglones: línea 1 (código - nombre) + línea 2 (emisión - vencimiento)
        const disponible = CH - 24; // espacio vertical disponible en esta zona
        const fs = vigentes.length<=3?4.3:vigentes.length<=5?3.8:vigentes.length<=8?3.3:2.8;
        const rowH = vigentes.length<=3?7.5:vigentes.length<=5?6.5:vigentes.length<=8?5.5:4.8;
        doc.setFont('helvetica','normal'); doc.setFontSize(fs);
        const maxV = Math.max(1, Math.floor(disponible / rowH));
        vigentes.slice(0,maxV).forEach((c,i)=>{
          const yBase = yC + 4 + i*rowH;
          const cod = (c.curso_cod||'').replace('COD-PSA ','COD ');
          const nombreCorto = (c.curso_nombre||'').slice(0, wC>60?38:26);
          const vce = c.vencimiento ? _fmtFecha(c.vencimiento) : 'S/V';
          const ap = c.issued_at ? _fmtFecha(c.issued_at.slice(0,10)) : '—';
          const diasRest = c.vencimiento ? (new Date(c.vencimiento)-new Date())/(1000*3600*24) : -1;
          const col = diasRest<0 ? [200,50,50] : diasRest<90 ? [180,120,0] : [20,120,60];
          // Línea 1: código - nombre
          doc.setTextColor(...col); doc.setFont('helvetica','bold');
          doc.text('• '+cod, xC, yBase);
          doc.setTextColor(50,50,55); doc.setFont('helvetica','normal');
          doc.text('- '+nombreCorto, xC+ (cod.length*1.7+4), yBase);
          // Línea 2: emisión - vencimiento
          doc.setTextColor(90,90,100); doc.setFontSize(Math.max(fs-0.8, 2.6));
          doc.text('Emisión: '+ap+'   Vence: '+vce, xC+2, yBase+3.3);
          doc.setFontSize(fs);
        });
        if(vigentes.length>maxV) {
          doc.setFontSize(3.3); doc.setTextColor(120,120,120);
          doc.text('... y '+(vigentes.length-maxV)+' más', xC, yC+4+maxV*rowH);
        }
      }

      // Código de verificación
      doc.setFillColor(245,246,250); doc.rect(x+2,y+CH-11,CW-4,8,'F');
      doc.setDrawColor(180,190,210); doc.setLineWidth(0.2); doc.rect(x+2,y+CH-11,CW-4,8);
      doc.setFont('courier','bold'); doc.setFontSize(5); doc.setTextColor(15,35,90);
      doc.text('COD. VERIFICACIÓN: '+verCode, x+CW/2, y+CH-7.5, {align:'center'});
      doc.setFont('helvetica','normal'); doc.setFontSize(4); doc.setTextColor(100,100,120);
      doc.text('Escanear QR para verificar autenticidad en plataforma SINCA', x+CW/2, y+CH-4.5, {align:'center'});
      doc.text('FRENTE: datos del titular  |  DORSO: capacitaciones y QR de verificación', x+CW/2, y+CH-2, {align:'center'});
    };

    // ─── Página 1: FRENTE ───
    doc.setFont('helvetica','bold'); doc.setFontSize(9); doc.setTextColor(30,50,100);
    doc.text('▸  FRENTE DE LA CREDENCIAL  ◂', PW/2, oy-5, {align:'center'});
    await drawFrente(ox, oy);
    drawCuts(ox, oy, CW, CH);

    // Nota de tamaño
    doc.setFont('helvetica','normal'); doc.setFontSize(7); doc.setTextColor(120,130,140);
    doc.text('Tamaño exacto: 85.6 mm ancho × 54 mm alto (CR80 — igual a tarjeta de crédito)', PW/2, oy+CH+8, {align:'center'});
    doc.text('Imprimir a escala 100% (sin ajuste de página). Recortar y laminar.', PW/2, oy+CH+13, {align:'center'});
    doc.text('Código único de verificación: '+verCode, PW/2, oy+CH+18, {align:'center'});

    // ─── Página 2: DORSO ───
    doc.addPage();
    doc.setFont('helvetica','normal'); doc.setFontSize(8); doc.setTextColor(100,110,120);
    doc.text('Para impresión doble faz: reintroducir la hoja e imprimir esta página.', PW/2, 12, {align:'center'});
    doc.text('El DORSO quedará al respaldo del FRENTE cuando se corte la credencial.', PW/2, 17, {align:'center'});
    doc.setFont('helvetica','bold'); doc.setFontSize(9); doc.setTextColor(30,50,100);
    doc.text('▸  DORSO DE LA CREDENCIAL  ◂', PW/2, oy-5, {align:'center'});
    await drawDorso(ox, oy);
    drawCuts(ox, oy, CW, CH);

    doc.save('Credencial_'+user.apellido+'_'+user.legajo+'_'+verCode+'.pdf');

    // Registrar la credencial en la BD (la nueva reemplaza a las anteriores)
    try {
      await fetch('/api/credenciales/registrar', {
        method: 'POST',
        headers: { 'Content-Type':'application/json', 'Authorization':'Bearer '+API.token },
        body: JSON.stringify({ ver_code: verCode, num_permiso: numPermiso.trim() })
      });
    } catch(e) { console.warn('No se pudo registrar la credencial:', e.message); }
  }
,

  /* ---------- Curso: pantalla de niveles ---------- */
  async openCourse(id) {
    this.courseId = id;
    App.show('screen-course');
    const el = document.getElementById('course-detail');
    el.innerHTML = '<p class="hint">Cargando curso…</p>';
    try {
      const { course: c, lessons, attempts, todas_completas } = await API.course(id);
      this.currentCourse = c;
      document.getElementById('course-cod-top').textContent = c.cod;

      const teoAtts = attempts.filter(a => a.tipo !== 'practico');
      const praAtts = attempts.filter(a => a.tipo === 'practico');
      const teoriaOk = teoAtts.some(a => a.passed);
      const teoriaAgotada = teoAtts.length >= 2 && !teoriaOk;
      const practicoOk = praAtts.some(a => a.passed);
      const practicoFallado = praAtts.some(a => !a.passed);

      const nivelIcon = l => l.completed ? '✔' : l.unlocked ? '▶' : '🔒';
      const nivelCls = l => l.completed ? 'done' : l.unlocked ? 'open' : 'locked';

      el.innerHTML = `
        <div class="course-head">
          <div>
            <h1>${c.nombre}</h1>
            <p class="menu-sub">${c.cod} · ${c.horas} hs · Nota mínima ${c.nota_min} % ·
              ${c.vigencia_meses ? `Vigencia ${c.vigencia_meses} meses` : 'Sin recurrencia fija'}
              ${c.simulador ? ' · Práctico en simulador (AEI 40 %, condición excluyente)' : ''}</p>
            ${c.observaciones ? `<p class="hint">${c.observaciones}</p>` : ''}
          </div>
        </div>

        <h2 class="section-title">Aula virtual — Niveles</h2>
        <p class="hint">Cada nivel se desbloquea al superar el anterior. El orden de los niveles es propio de su cursada.
        Los videos no pueden pausarse ni adelantarse, y el tiempo de visualización queda registrado.</p>
        <div class="levels">
          ${lessons.map(l => `
            <button class="level ${nivelCls(l)}" ${l.unlocked && !l.completed ? `data-lesson="${l.id}"` : l.completed ? `data-lesson="${l.id}" data-review="1"` : 'disabled'}>
              <span class="level-n mono">${nivelIcon(l)} N${l.nivel}</span>
              <span class="level-t">${l.titulo}</span>
              <span class="level-meta mono">${l.tipo === 'video' ? '🎬 video' : '📖 lectura'} · ${l.duracion_s}s ${l.completed ? '· completado' : ''}</span>
            </button>`).join('')}
        </div>

        <h2 class="section-title">Evaluación</h2>
        <div class="eval-row">
          <div class="eval-card">
            <strong>Examen teórico</strong>
            <span class="hint">${c.preguntas_examen || 10} preguntas aleatorias del banco · versión única por alumno · 1 recuperatorio</span>
            <span>${teoriaOk ? '<span class="badge-pass">APROBADO</span>'
              : teoriaAgotada ? '<span class="badge-fail">SIN INSTANCIAS (contacte al docente)</span>'
              : `<span class="pill">Intento ${teoAtts.length + 1} de 2</span>`}</span>
            <button class="btn-primary" id="btn-exam" ${teoriaOk || teoriaAgotada || !todas_completas ? 'disabled' : ''}>
              ${!todas_completas ? 'Complete todos los niveles para rendir' : 'Rendir examen teórico'}
            </button>
          </div>
          ${c.simulador ? `
          <div class="eval-card">
            <strong>Examen práctico — Simulador de Rayos X</strong>
            <span class="hint">20 imágenes aleatorias cronometradas · AEI = 40 % del puntaje y condición excluyente · sin recuperatorio</span>
            <span>${practicoOk ? '<span class="badge-pass">APROBADO</span>'
              : practicoFallado ? '<span class="badge-fail">DESAPROBADO (el docente puede rehabilitar la cursada)</span>'
              : '<span class="pill">Pendiente</span>'}</span>
            <button class="btn-primary" id="btn-practical" ${!teoriaOk || practicoOk || practicoFallado ? 'disabled' : ''}>
              ${!teoriaOk ? 'Apruebe la teoría primero' : 'Rendir práctico en simulador'}
            </button>
          </div>` : ''}
        </div>

        <div id="eppt-section"></div>

        ${attempts.length ? `
        <h2 class="section-title">Historial de instancias</h2>
        <table class="list-table"><thead><tr><th>Fecha</th><th>Instancia</th><th>Nota</th><th>AEI</th><th>Resultado</th></tr></thead>
        <tbody>${attempts.map(a => `
          <tr><td class="mono">${a.created_at}</td><td>${a.tipo}</td><td>${a.score_pct} %</td>
          <td>${a.aei_ok === null || a.aei_ok === undefined ? '—' : a.aei_ok ? 'Detectados' : '<span class="badge-fail">NO detectado</span>'}</td>
          <td>${a.passed ? '<span class="badge-pass">APROBADA</span>' : '<span class="badge-fail">DESAPROBADA</span>'}</td></tr>`).join('')}
        </tbody></table>` : ''}
      `;

      el.querySelectorAll('[data-lesson]').forEach(b => b.addEventListener('click', () =>
        this.openLesson(Number(b.dataset.lesson), !!b.dataset.review)));
      const be = document.getElementById('btn-exam');
      if (be) be.addEventListener('click', () => this.startExam());
      const bp = document.getElementById('btn-practical');
      if (bp) bp.addEventListener('click', () => App.startPractical(this.courseId));
      this.renderEppt();
    } catch (e) { el.innerHTML = `<p class="error">${e.message}</p>`; }
  },

  /* ---------- EPPT del alumno ---------- */
  async renderEppt() {
    const box = document.getElementById('eppt-section');
    if (!box) return;
    try {
      const { regla, eppt, entries } = await API.epptMio(this.courseId);
      if (!regla) { box.innerHTML = ''; return; }
      if (!eppt) {
        box.innerHTML = `<h2 class="section-title">Entrenamiento Práctico en el Puesto de Trabajo (EPPT)</h2>
          <p class="hint">${regla.apendice} · ${regla.requerido} ${regla.tipo} · plazo ${regla.plazo_dias} días corridos desde la aprobación de los exámenes.
          Se habilita automáticamente al aprobar la teoría${this.currentCourse?.simulador ? ' y el práctico' : ''}. Firma: ${regla.firmante}.</p>`;
        return;
      }
      const pct = Math.min(100, Math.round((eppt.horas_firmadas / eppt.requerido) * 100));
      box.innerHTML = `
        <h2 class="section-title">EPPT — ${eppt.apendice}</h2>
        <p class="hint">${eppt.requerido} ${eppt.tipo} requeridas · vence el <b>${eppt.deadline}</b> ·
          estado: ${eppt.estado === 'completo' ? '<span class="badge-pass">COMPLETO</span>'
                 : eppt.estado === 'vencido' ? '<span class="badge-fail">VENCIDO (el docente debe rehabilitar la cursada)</span>'
                 : '<span class="pill">EN CURSO</span>'}</p>
        <div class="eppt-bar"><div style="width:${pct}%"></div></div>
        <p class="hint">${eppt.horas_firmadas} de ${eppt.requerido} ${eppt.tipo} con firma dual (${pct} %). Las jornadas las carga y firma su supervisor en el puesto; usted firma su conformidad aquí.</p>
        ${entries.map(e => `
          <div class="eppt-entry">
            <b>${e.fecha}</b> · ${e.horas} ${eppt.tipo === 'actividades' ? 'actividad(es)' : 'hs'} ·
            Supervisor: ${e.sup_apellido}, ${e.sup_nombre} (Leg. ${e.sup_legajo})
            ${e.rubrica.length ? `<br><small class="hint">${e.rubrica.map(r => `${r.item}: <b>${r.calif}</b>`).join(' · ')}</small>` : ''}
            ${e.observaciones ? `<br><small class="hint">Obs.: ${e.observaciones}</small>` : ''}
            <div class="firmas">
              <span class="firma-ok">✔ Firmado por supervisor (${(e.firma_sup_at || '').slice(0, 16)})</span>
              ${e.firma_alu_at ? `<span class="firma-ok">✔ Conformidad del cursante (${e.firma_alu_at.slice(0, 16)})</span>`
                : `<button class="btn-ghost" data-firmar="${e.id}">Firmar conformidad ✍</button>`}
            </div>
          </div>`).join('')}`;
      box.querySelectorAll('[data-firmar]').forEach(b => b.addEventListener('click', async () => {
        const password = prompt('Firma electrónica de conformidad — reingrese su contraseña:');
        if (password === null) return;
        try {
          const r = await API.epptFirmarAlumno(Number(b.dataset.firmar), password);
          if (r.curso_aprobado) alert('¡EPPT completo! El curso quedó APROBADO y su certificado fue emitido.');
          this.openCourse(this.courseId);
        } catch (e) { alert(e.message); }
      }));
    } catch { box.innerHTML = ''; }
  },

  /* ---------- Unidad: reproductor bloqueado / lectura cronometrada ---------- */
  async openLesson(lessonId, review) {
    this.lessonId = lessonId;
    App.show('screen-lesson');
    const stage = document.getElementById('lesson-stage');
    const status = document.getElementById('lesson-status');
    stage.innerHTML = '<p class="hint">Iniciando unidad…</p>';
    document.getElementById('checkpoint-modal').classList.add('hidden');
    try {
      let { session_id, lesson, already_completed } = await API.lessonStart(lessonId);
      // Modo demo: duración máxima 5 segundos para demostración ágil
      if (API.user?.usuario === 'demo' && lesson && lesson.duracion_s > 5) {
        lesson = { ...lesson, duracion_s: 5 };
      }
      this.session = session_id;
      document.getElementById('lesson-title-top').textContent = lesson.titulo;

      if (lesson.tipo === 'pdf' && lesson.video_url) {
        const pdfSrc = lesson.video_url + '?token=' + encodeURIComponent(API.token);
        stage.innerHTML = `
          <div class="player-shell">
            <div class="player-warning">📄 MATERIAL DIDÁCTICO — PDF. Tiempo mínimo de lectura registrado. Descarga y captura de pantalla bloqueadas.</div>
            <div class="player-frame" style="height:70vh;user-select:none;-webkit-user-select:none;pointer-events:auto">
              <iframe src="${pdfSrc}" style="width:100%;height:100%;border:none" sandbox="allow-scripts allow-same-origin" oncontextmenu="return false"></iframe>
            </div>
          </div>`;
        // Simular tiempo de lectura del PDF
        let elapsed = 0;
        const interval = setInterval(() => {
          elapsed++;
          if (elapsed >= lesson.duracion_s) { clearInterval(interval); this._videoDone(); }
        }, 1000);
        this._pdfInterval = interval;
      } else if (lesson.tipo === 'imagen' && lesson.video_url) {
        // Cargar imagen con token de autenticación y crear blob URL
        stage.innerHTML = `<div class="player-shell">
          <div class="player-warning">🖼 MATERIAL DIDÁCTICO — Imagen. Tiempo mínimo de visualización registrado.</div>
          <div class="player-frame" style="text-align:center;padding:20px">
            <div id="img-loading" style="color:var(--muted);padding:40px">Cargando imagen…</div>
          </div></div>`;
        try {
          const imgUrl = lesson.video_url + (lesson.video_url.includes('?') ? '&' : '?') + 'token=' + encodeURIComponent(API.token);
          const imgResp = await fetch(imgUrl);
          if (imgResp.ok) {
            const blob = await imgResp.blob();
            const blobUrl = URL.createObjectURL(blob);
            const frame = stage.querySelector('.player-frame');
            if (frame) frame.innerHTML = `<img src="${blobUrl}" style="max-width:100%;max-height:70vh;border-radius:8px;display:block;margin:0 auto" oncontextmenu="return false" draggable="false">`;
          } else {
            // Si falla el auth, intentar sin token (imagen pública)
            const frame = stage.querySelector('.player-frame');
            if (frame) frame.innerHTML = `<img src="${lesson.video_url}" style="max-width:100%;max-height:70vh;border-radius:8px;display:block;margin:0 auto" oncontextmenu="return false">`;
          }
        } catch(e) {
          const frame = stage.querySelector('.player-frame');
          if (frame) frame.innerHTML = `<img src="${lesson.video_url}" style="max-width:100%;max-height:70vh;border-radius:8px;display:block;margin:0 auto">`;
        }
        let elapsed = 0;
        const interval = setInterval(() => {
          elapsed++;
          if (elapsed >= lesson.duracion_s) { clearInterval(interval); this._videoDone(); }
        }, 1000);
        this._pdfInterval = interval;
      } else if (lesson.tipo === 'pptx' && lesson.video_url) {
        // Construir la URL completa del archivo para el visor de Office Online
        const absUrl = window.location.origin + lesson.video_url + '?token=' + encodeURIComponent(API.token);
        // Microsoft Office Online Viewer — funciona con archivos públicamente accesibles
        // Como el archivo requiere auth, usamos Google Docs Viewer como alternativa
        const viewerUrl = 'https://view.officeapps.live.com/op/embed.aspx?src=' + encodeURIComponent(window.location.origin + lesson.video_url);
        stage.innerHTML = `
          <div class="player-shell">
            <div class="player-warning">📊 MATERIAL DIDÁCTICO — Presentación PowerPoint. Tiempo mínimo de revisión registrado. Solo visualización.</div>
            <div class="player-frame" style="height:70vh;user-select:none;-webkit-user-select:none">
              <iframe src="${viewerUrl}" frameborder="0" style="width:100%;height:100%;border:none" sandbox="allow-scripts allow-same-origin allow-forms" oncontextmenu="return false" allowfullscreen></iframe>
            </div>
            <p class="hint" style="text-align:center;margin-top:6px;font-size:11px">Si el visor no carga, el archivo estará disponible en red interna con acceso restringido.</p>
          </div>`;
        let elapsed = 0;
        const interval = setInterval(() => {
          elapsed++;
          const bar = document.getElementById('player-bar');
          if (bar) bar.style.width = Math.min(100, elapsed / lesson.duracion_s * 100) + '%';
          if (elapsed >= lesson.duracion_s) { clearInterval(interval); this._videoDone(); }
        }, 1000);
        this._pdfInterval = interval;
      } else if (lesson.tipo === 'archivo' && lesson.video_url) {
        stage.innerHTML = `
          <div class="player-shell">
            <div class="player-warning">📁 MATERIAL DIDÁCTICO — Archivo adjunto.</div>
            <div class="player-frame" style="text-align:center;padding:40px">
              <div style="font-size:48px">📁</div>
              <p>${lesson.titulo}</p>
              <a href="${lesson.video_url}" target="_blank" class="btn-primary" style="margin-top:12px;display:inline-block">Descargar archivo ↗</a>
            </div>
          </div>`;
        let elapsed = 0;
        const interval = setInterval(() => {
          elapsed++;
          if (elapsed >= lesson.duracion_s) { clearInterval(interval); this._videoDone(); }
        }, 1000);
        this._pdfInterval = interval;
      } else if (lesson.tipo === 'video' && String(lesson.video_url || '').startsWith('youtube:')) {
        const ytId = lesson.video_url.slice(8);
        stage.innerHTML = `
          <div class="player-shell">
            <div class="player-warning">🔒 VISUALIZACIÓN OBLIGATORIA (YouTube institucional) — sin pausa, sin adelantar. Tiempo registrado en el servidor.</div>
            <div class="player-frame"><div id="yt-holder"></div>
              <div class="player-blocker" id="player-blocker"><button class="btn-primary" id="btn-play">▶ Iniciar visualización</button></div>
              <div class="player-progress"><div id="player-bar"></div></div>
            </div>
          </div>`;
        this._wireYouTube(ytId, lesson, review);
      } else if (lesson.tipo === 'video' && lesson.video_url) {
        stage.innerHTML = `
          <div class="player-shell">
            <div class="player-warning">🔒 VISUALIZACIÓN OBLIGATORIA — el video no puede pausarse ni adelantarse. Tiempo registrado en el servidor.</div>
            <div class="player-frame">
              <video id="lesson-video" src="${lesson.video_url}" playsinline disablepictureinpicture controlslist="nodownload noplaybackrate"></video>
              <div class="player-blocker" id="player-blocker"><button class="btn-primary" id="btn-play">▶ Iniciar visualización</button></div>
              <div class="player-progress"><div id="player-bar"></div></div>
            </div>
          </div>`;
        this._wireLockedVideo(lesson, review);
      } else {
        // Lectura con tiempo mínimo real (validado además en servidor)
        const min = lesson.duracion_s;
        stage.innerHTML = `
          <div class="reader-shell">
            <div class="player-warning">📖 LECTURA OBLIGATORIA — tiempo mínimo de permanencia: ${min} s (registrado en el servidor).</div>
            <article class="reader">${lesson.contenido}</article>
            <button class="btn-primary" id="btn-read-done" disabled>Continuar (espere <span id="read-count">${min}</span> s)</button>
          </div>`;
        const btn = document.getElementById('btn-read-done');
        const cnt = document.getElementById('read-count');
        let left = min;
        const t = setInterval(() => {
          left--; status.textContent = `Lectura: ${left} s restantes`;
          if (cnt) cnt.textContent = left;
          if (left <= 0) {
            clearInterval(t);
            btn.disabled = false;
            btn.textContent = review ? 'Finalizar repaso' : 'Continuar al control de atención';
            status.textContent = 'Tiempo mínimo cumplido';
          }
        }, 1000);
        btn.addEventListener('click', () => review ? Campus.openCourse(Campus.courseId) : this._videoDone());
      }
    } catch (e) {
      stage.innerHTML = `<p class="error">${e.message}</p><button class="btn-ghost" onclick="Campus.openCourse(Campus.courseId)">Volver</button>`;
    }
  },

  _wireLockedVideo(lesson, review) {
    const v = document.getElementById('lesson-video');
    const blocker = document.getElementById('player-blocker');
    const bar = document.getElementById('player-bar');
    const status = document.getElementById('lesson-status');
    let maxTime = 0, started = false;

    document.getElementById('btn-play').addEventListener('click', () => {
      blocker.classList.add('gone');
      started = true;
      v.play().catch(() => {});
    });

    // Anti-fraude del reproductor
    v.addEventListener('pause', () => { if (started && !v.ended) v.play().catch(() => {}); });
    v.addEventListener('seeking', () => { if (v.currentTime > maxTime + 0.5) v.currentTime = maxTime; });
    v.addEventListener('ratechange', () => { if (v.playbackRate !== 1) v.playbackRate = 1; });
    v.addEventListener('contextmenu', e => e.preventDefault());
    v.addEventListener('timeupdate', () => {
      if (v.currentTime > maxTime) maxTime = v.currentTime;
      const p = v.duration ? (maxTime / v.duration) * 100 : 0;
      bar.style.width = p + '%';
      status.textContent = `Visualizado: ${Math.floor(maxTime)} s / ${Math.floor(v.duration || lesson.duracion_s)} s`;
    });
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && started && !v.ended) v.play().catch(() => {});
    });
    v.addEventListener('ended', () => {
      status.textContent = 'Visualización completa';
      if (review) { Campus.openCourse(Campus.courseId); return; }
      this._videoDone();
    });
  },

  _wireYouTube(ytId, lesson, review) {
    const status = document.getElementById('lesson-status');
    const bar = document.getElementById('player-bar');
    const blocker = document.getElementById('player-blocker');
    let player = null, maxTime = 0, started = false, watchdog = null;

    const build = () => {
      player = new YT.Player('yt-holder', {
        videoId: ytId, width: '100%', height: '480',
        playerVars: { controls: 0, disablekb: 1, rel: 0, fs: 0, modestbranding: 1, iv_load_policy: 3, playsinline: 1 },
        events: {
          onReady: () => { status.textContent = 'Listo para iniciar'; },
          onStateChange: e => {
            if (e.data === YT.PlayerState.PAUSED && started) player.playVideo();      // sin pausa
            if (e.data === YT.PlayerState.ENDED) {
              clearInterval(watchdog);
              status.textContent = 'Visualización completa';
              if (review) Campus.openCourse(Campus.courseId); else this._videoDone();
            }
          },
          onPlaybackRateChange: () => player.setPlaybackRate(1)                        // velocidad fija
        }
      });
    };
    if (window.YT && YT.Player) build();
    else {
      window.onYouTubeIframeAPIReady = build;
      const s = document.createElement('script');
      s.src = 'https://www.youtube.com/iframe_api';
      s.onerror = () => { status.textContent = '✘ No se pudo cargar YouTube. Verifique la conexión o use video local.'; };
      document.head.appendChild(s);
    }
    document.getElementById('btn-play').addEventListener('click', () => {
      if (!player) return;
      blocker.classList.add('gone'); started = true; player.playVideo();
      watchdog = setInterval(() => {
        if (!player.getCurrentTime) return;
        const t = player.getCurrentTime(), d = player.getDuration() || lesson.duracion_s;
        if (t > maxTime + 2) player.seekTo(maxTime, true);                             // sin adelantar
        else if (t > maxTime) maxTime = t;
        if (player.getPlayerState() === YT.PlayerState.PAUSED) player.playVideo();
        bar.style.width = (d ? (maxTime / d) * 100 : 0) + '%';
        status.textContent = `Visualizado: ${Math.floor(maxTime)} s / ${Math.floor(d)} s`;
      }, 500);
    });
  },

  async _videoDone() {
    try {
      const r = await API.lessonVideoDone(this.lessonId, this.session);
      if (r.completed) { this.openCourse(this.courseId); return; }
      this._showCheckpoint(r.question);
    } catch (e) {
      const status = document.getElementById('lesson-status');
      status.textContent = e.message;
      alert(e.message + '\n\nDeberá visualizar la unidad nuevamente.');
      this.openLesson(this.lessonId, false);
    }
  },

  _showCheckpoint(q) {
    const modal = document.getElementById('checkpoint-modal');
    document.getElementById('checkpoint-q').textContent = q.pregunta;
    const opts = document.getElementById('checkpoint-opts');
    document.getElementById('checkpoint-msg').classList.add('hidden');
    opts.innerHTML = q.opciones.map((o, i) =>
      `<button class="checkpoint-opt" data-i="${i}">${String.fromCharCode(65 + i)}. ${o}</button>`).join('');
    modal.classList.remove('hidden');
    opts.querySelectorAll('button').forEach(b => b.addEventListener('click', async () => {
      opts.querySelectorAll('button').forEach(x => x.disabled = true);
      try {
        const r = await API.lessonCheckpoint(this.lessonId, this.session, Number(b.dataset.i));
        if (r.correct) {
          b.classList.add('right');
          setTimeout(() => { modal.classList.add('hidden'); this.openCourse(this.courseId); }, 700);
        } else {
          b.classList.add('wrong');
          const m = document.getElementById('checkpoint-msg');
          m.textContent = r.mensaje; m.classList.remove('hidden');
          setTimeout(() => { modal.classList.add('hidden'); this.openLesson(this.lessonId, false); }, 2200);
        }
      } catch (e) { alert(e.message); modal.classList.add('hidden'); this.openCourse(this.courseId); }
    }));
  },

  /* ---------- Examen teórico ---------- */
  async startExam() {
    // Bloqueo: los exámenes solo se pueden rendir desde PC con cámara
    if (typeof App !== 'undefined' && typeof PWA !== 'undefined') {
      if (!App.checkExamAllowed()) return;
    }
    {
      Proctor.begin(this.courseId, 'teorico',
        () => this._examScreen(),
        () => this.openCourse(this.courseId));
      return;
    }
    this._examScreen();
  },

  async _examScreen() {
    Proctor.onBlock = () => { Campus.openCourse(Campus.courseId); };
    App.show('screen-exam');
    const cont = document.getElementById('exam-questions');
    cont.innerHTML = '<p class="hint">Generando su versión única del examen…</p>';
    try {
      const { session_id, questions, intento, nota_min } = await API.quizGet(this.courseId);
      this.examSession = session_id;
      this.examStart = Date.now();
      document.getElementById('exam-info').textContent = `Intento ${intento}/2 · Aprueba con ${nota_min} % · ${questions.length} preguntas`;
      this.examQuestions = questions;
      this.examAnswers = new Array(questions.length).fill(null);
      this.examCurrentQ = 0;

      // Crear layout del examen: panel izquierdo (cámara+alertas) + área central (pregunta)
      cont.innerHTML = '';
      cont.style.cssText = 'display:flex;height:calc(100vh - 56px);overflow:hidden;gap:0';

      // Panel lateral izquierdo — cámara 1/4
      const camPanel = document.createElement('div');
      camPanel.id = 'exam-cam-panel';
      camPanel.style.cssText = 'width:240px;min-width:240px;background:#080c14;border-right:1px solid rgba(242,140,26,.2);display:flex;flex-direction:column;padding:12px;gap:10px;overflow-y:auto;flex-shrink:0';
      camPanel.innerHTML =
        '<div style="font-size:10px;font-weight:700;color:var(--orange);text-transform:uppercase;letter-spacing:.07em">🎥 Supervisión IA</div>'
        + '<video id="proctor-preview" autoplay muted playsinline style="width:100%;border-radius:8px;border:2px solid rgba(242,140,26,.25);background:#000;aspect-ratio:4/3;object-fit:cover"></video>'
        + '<div id="side-proctor-status" style="font-size:10px;color:var(--muted);line-height:1.4">Iniciando cámara…</div>'
        + '<div style="border-top:1px solid var(--line);padding-top:8px">'
        +   '<div style="font-size:10px;font-weight:600;color:var(--muted);margin-bottom:6px">Progreso</div>'
        +   '<div id="side-progress" style="display:flex;flex-wrap:wrap;gap:3px"></div>'
        + '</div>'
        + '<div style="border-top:1px solid var(--line);padding-top:8px">'
        +   '<div style="font-size:10px;font-weight:600;color:var(--muted);margin-bottom:6px">Alertas</div>'
        +   '<div id="side-alarms" style="font-size:10px;display:flex;flex-direction:column;gap:3px;max-height:180px;overflow-y:auto"></div>'
        + '</div>';
      cont.appendChild(camPanel);

      // Panel central — pregunta 3/4
      const qPanel = document.createElement('div');
      qPanel.id = 'exam-q-panel';
      qPanel.style.cssText = 'flex:1;overflow-y:auto;padding:28px 40px;background:var(--chassis)';
      cont.appendChild(qPanel);

      this._renderCurrentQ(qPanel);
    } catch (e) {
      cont.innerHTML = `<p class="error">${e.message}</p>`;
      document.getElementById('btn-exam-submit').classList.add('hidden');
      return;
    }
  },

  _renderCurrentQ(cont) {
    const qPanel = document.getElementById('exam-q-panel') || cont;
    const qi = this.examCurrentQ;
    const q = this.examQuestions[qi];   // ← variable restaurada
    const total = this.examQuestions.length;
    const answered = this.examAnswers.filter(a=>a!==null).length;

    // Actualizar panel lateral
    const sideProgress = document.getElementById('side-progress');
    if (sideProgress) {
      sideProgress.innerHTML = this.examQuestions.map((_, i) => {
        const ans = this.examAnswers[i] !== null;
        const cur = i === qi;
        return `<span style="display:inline-block;width:20px;height:20px;margin:2px;border-radius:4px;text-align:center;line-height:20px;font-size:10px;font-weight:700;background:${cur?'var(--orange)':ans?'rgba(46,184,122,.3)':'rgba(255,255,255,.08)'};color:${cur?'#000':'var(--text)'}">${i+1}</span>`;
      }).join('');
    }

    qPanel.innerHTML = `
      <div style="max-width:760px;margin:0 auto;padding:20px 24px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px">
          <span style="font-size:13px;color:var(--muted)">Pregunta <b style="color:var(--text)">${qi+1}</b> de ${total}</span>
          <span style="font-size:13px;color:var(--muted)">Respondidas: <b style="color:var(--green)">${answered}</b>/${total}</span>
        </div>
        <fieldset class="exam-q" style="margin-bottom:24px;border:none;padding:0">
          <legend style="font-size:17px;font-weight:600;line-height:1.5;margin-bottom:18px;display:block"><b>${qi+1}.</b> ${q.pregunta}</legend>
          ${q.opciones.map((o, oi) => `
            <label class="exam-opt" style="display:flex;align-items:flex-start;gap:12px;padding:12px 16px;margin-bottom:8px;background:${this.examAnswers[qi]===oi?'rgba(61,130,232,.2)':'var(--panel)'};border:1.5px solid ${this.examAnswers[qi]===oi?'var(--blue)':'var(--line)'};border-radius:10px;cursor:pointer;transition:all .15s">
              <input type="radio" name="q${qi}" value="${oi}" ${this.examAnswers[qi]===oi?'checked':''} style="margin-top:3px;accent-color:var(--blue)" aria-label="Opción ${String.fromCharCode(65+oi)}: ${o.replace(/"/g,'')}">
              <span><b>${String.fromCharCode(65+oi)}.</b> ${o}</span>
            </label>`).join('')}
        </fieldset>
        <div style="display:flex;justify-content:space-between;align-items:center;margin-top:8px">
          <button class="btn-ghost" id="btn-q-prev" ${qi===0?'disabled style="opacity:.4"':''}>← Anterior</button>
          <div style="display:flex;gap:8px">
            ${qi<total-1
              ? `<button class="btn-primary" id="btn-q-next" style="width:auto;padding:10px 24px">Siguiente →</button>`
              : `<button class="btn-primary" id="btn-exam-submit-now" style="width:auto;padding:10px 24px;background:linear-gradient(135deg,var(--green),#1a7a50)">Entregar examen ✔</button>`}
          </div>
        </div>
      </div>`;

    // Guardar respuesta al seleccionar
    qPanel.querySelectorAll(`input[name="q${qi}"]`).forEach(inp => {
      inp.addEventListener('change', () => {
        this.examAnswers[qi] = Number(inp.value);
        this._renderCurrentQ(qPanel);
      });
    });

    const prevBtn = document.getElementById('btn-q-prev');
    if (prevBtn) prevBtn.addEventListener('click', () => { if (qi>0) { this.examCurrentQ--; this._renderCurrentQ(qPanel); } });

    const nextBtn = document.getElementById('btn-q-next');
    if (nextBtn) nextBtn.addEventListener('click', () => { this.examCurrentQ++; this._renderCurrentQ(qPanel); });

    const submitNow = document.getElementById('btn-exam-submit-now');
    if (submitNow) submitNow.addEventListener('click', () => this.submitExam());

    // Ocultar el botón original de entregar (ahora usamos el inline)
    const origSubmit = document.getElementById('btn-exam-submit');
    if (origSubmit) origSubmit.classList.add('hidden');
  },

  async submitExam() {
    const answers = this.examAnswers
      ? this.examAnswers.map(a => a !== null ? a : -1)
      : [...document.querySelectorAll('.exam-q')].map((b,i) => {
          const sel = b.querySelector(`input[name="q${i}"]:checked`);
          return sel ? Number(sel.value) : -1;
        });
    const sinResp = answers.filter(a=>a===-1).length;
    if (sinResp > 0 && !confirm(`Quedan ${sinResp} preguntas sin responder. ¿Entregar igual?`)) return;
    try {
      const r = await API.quizSubmit(this.courseId, {
        session_id: this.examSession, answers,
        duration_s: Math.round((Date.now() - this.examStart) / 1000),
        proctor_session_id: Proctor.sessionId || undefined
      });
      await Proctor.end();
      App.showTheoryResult(r);
    } catch (e) { alert(e.message); }
  },

  /* ══════════════════════════════════════════════════════════════════
     Mi perfil — edición de datos propios y cambio de contraseña
     Disponible para todos los roles sin excepción.
  ══════════════════════════════════════════════════════════════════ */
  async renderPerfil() {
    const el = document.getElementById('view-perfil');
    el.innerHTML = '<p class="hint">Cargando…</p>';
    try {
      const { user, perfil_gemelo, enrollments, certificates } = await API.me();
      const hoy = new Date().toISOString().slice(0, 10);
      const cVigentes  = (certificates||[]).filter(c => !c.anulado && (!c.vencimiento || c.vencimiento >= hoy)).length;
      const enrActivos = (enrollments||[]).filter(e => e.activo).length;

      el.innerHTML = `
        <div style="max-width:680px;margin:0 auto;padding:22px 16px 60px">
          <h1 style="margin-bottom:4px">Mi perfil</h1>
          <p class="hint" style="margin-bottom:24px">Podés actualizar tus datos de contacto y cambiar tu contraseña en cualquier momento.</p>

          <div style="background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:20px;margin-bottom:16px;display:flex;align-items:center;gap:18px;flex-wrap:wrap">
            <div style="width:56px;height:56px;border-radius:50%;background:var(--blue);display:flex;align-items:center;justify-content:center;font-size:22px;font-weight:800;color:#fff;flex-shrink:0">${(user.apellido||'?')[0]}</div>
            <div style="flex:1;min-width:0">
              <div style="font-size:20px;font-weight:700">${user.apellido}, ${user.nombre}</div>
              <div class="mono" style="font-size:13px;color:var(--muted);margin-top:2px">${user.legajo} · ${user.role.charAt(0).toUpperCase()+user.role.slice(1)}</div>
              ${perfil_gemelo ? `<div style="margin-top:6px;font-size:12px"><span style="background:rgba(61,130,232,.15);color:var(--blue);padding:2px 10px;border-radius:20px;border:1px solid rgba(61,130,232,.3)">Perfil dual activo — ${perfil_gemelo.role}: ${perfil_gemelo.legajo}</span></div>` : ''}
            </div>
            <div style="display:flex;gap:10px;flex-shrink:0">
              <div style="text-align:center;padding:10px 16px;background:var(--panel-2);border-radius:8px"><b style="font-size:18px;display:block">${enrActivos}</b><span class="hint" style="font-size:11px">${enrActivos===1?'curso':'cursos'}</span></div>
              <div style="text-align:center;padding:10px 16px;background:var(--panel-2);border-radius:8px"><b style="font-size:18px;display:block;color:var(--ok)">${cVigentes}</b><span class="hint" style="font-size:11px">cert. vigentes</span></div>
            </div>
          </div>

          <div style="background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:18px;margin-bottom:16px">
            <div style="font-weight:700;font-size:14px;margin-bottom:12px;display:flex;align-items:center;gap:8px">
              <span>Datos institucionales</span>
              <span class="hint" style="font-size:11px;font-weight:400">(solo el administrador puede modificarlos)</span>
            </div>
            <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:10px;font-size:13px">
              ${[['Legajo',user.legajo],['DNI',user.dni||'—'],['Nombre',user.nombre],['Apellido',user.apellido],['Rango',user.rango||'—'],['Organismo',user.organismo||'—']].map(([l,v])=>`<div><span class="hint" style="display:block;font-size:11px">${l}</span><b>${v}</b></div>`).join('')}
            </div>
          </div>

          <div style="background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:18px;margin-bottom:16px">
            <div style="font-weight:700;font-size:14px;margin-bottom:14px">Datos de contacto y función</div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
              <label style="font-size:13px;color:var(--muted)">Aeropuerto asignado<input id="pf-aeropuerto" value="${user.aeropuerto||''}" placeholder="Ej: Ezeiza, Aeroparque…" style="margin-top:4px;width:100%;box-sizing:border-box"></label>
              <label style="font-size:13px;color:var(--muted)">Dependencia<input id="pf-dependencia" value="${user.dependencia||''}" placeholder="Ej: Dirección de Operaciones" style="margin-top:4px;width:100%;box-sizing:border-box"></label>
              <label style="font-size:13px;color:var(--muted);grid-column:1/-1">Función / Cargo<input id="pf-funcion" value="${user.funcion||''}" placeholder="Ej: Oficial de seguridad, Inspector…" style="margin-top:4px;width:100%;box-sizing:border-box"></label>
            </div>
            <div style="margin-top:14px;display:flex;align-items:center;gap:10px;flex-wrap:wrap">
              <button class="btn-primary" id="btn-guardar-perfil" style="width:auto">Guardar cambios</button>
              <span id="perfil-ok" style="font-size:13px;display:none;color:var(--ok)">✔ Datos actualizados</span>
              <span id="perfil-err" style="font-size:13px;display:none;color:var(--alert)"></span>
            </div>
          </div>

          <div style="background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:18px">
            <div style="font-weight:700;font-size:14px;margin-bottom:14px">Cambiar contraseña</div>
            <p class="hint" style="font-size:12px;margin-bottom:14px">Necesitás ingresar tu contraseña actual para confirmar el cambio.</p>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
              <label style="font-size:13px;color:var(--muted)">Contraseña actual<input type="password" id="pw-actual" autocomplete="current-password" style="margin-top:4px;width:100%;box-sizing:border-box"></label>
              <div></div>
              <label style="font-size:13px;color:var(--muted)">Nueva contraseña<input type="password" id="pw-nuevo" autocomplete="new-password" style="margin-top:4px;width:100%;box-sizing:border-box"></label>
              <label style="font-size:13px;color:var(--muted)">Repetir nueva contraseña<input type="password" id="pw-nuevo2" autocomplete="new-password" style="margin-top:4px;width:100%;box-sizing:border-box"></label>
            </div>
            <div id="pw-strength" style="height:4px;border-radius:2px;margin:10px 0;background:var(--line);overflow:hidden"><div id="pw-bar" style="height:100%;width:0;transition:width .3s,background .3s"></div></div>
            <div style="margin-top:4px;display:flex;align-items:center;gap:10px;flex-wrap:wrap">
              <button class="btn-primary" id="btn-cambiar-pw" style="width:auto">Cambiar contraseña</button>
              <span id="pw-ok" style="font-size:13px;display:none;color:var(--ok)">✔ Contraseña actualizada</span>
              <span id="pw-err" style="font-size:13px;display:none;color:var(--alert)"></span>
            </div>
          </div>
        </div>`;

      const pwBar = document.getElementById('pw-bar');
      document.getElementById('pw-nuevo').addEventListener('input', function() {
        const v = this.value;
        const s = [v.length>=8,/[A-Z]/.test(v),/[0-9]/.test(v),/[^A-Za-z0-9]/.test(v),v.length>=12].filter(Boolean).length;
        pwBar.style.width  = (s*20)+'%';
        pwBar.style.background = ['','var(--alert)','var(--organic)','var(--organic)','var(--ok)','var(--ok)'][s]||'var(--alert)';
      });

      document.getElementById('btn-guardar-perfil').addEventListener('click', async () => {
        const btn=document.getElementById('btn-guardar-perfil');
        const ok=document.getElementById('perfil-ok');
        const err=document.getElementById('perfil-err');
        btn.disabled=true; ok.style.display='none'; err.style.display='none';
        try {
          const r = await API.updateMe({
            aeropuerto: document.getElementById('pf-aeropuerto').value,
            dependencia: document.getElementById('pf-dependencia').value,
            funcion: document.getElementById('pf-funcion').value,
          });
          if (r.ok) { ok.style.display='inline'; setTimeout(()=>ok.style.display='none',3000); }
          else throw new Error(r.error||'Error al guardar');
        } catch(e) { err.textContent=e.message; err.style.display='inline'; }
        btn.disabled=false;
      });

      document.getElementById('btn-cambiar-pw').addEventListener('click', async () => {
        const btn=document.getElementById('btn-cambiar-pw');
        const ok=document.getElementById('pw-ok');
        const err=document.getElementById('pw-err');
        const pwA=document.getElementById('pw-actual').value;
        const pwN=document.getElementById('pw-nuevo').value;
        const pwN2=document.getElementById('pw-nuevo2').value;
        ok.style.display='none'; err.style.display='none';
        if (!pwA) { err.textContent='Ingresá tu contraseña actual.'; err.style.display='inline'; return; }
        if (pwN.length<6) { err.textContent='La nueva contraseña debe tener al menos 6 caracteres.'; err.style.display='inline'; return; }
        if (pwN!==pwN2) { err.textContent='Las contraseñas nuevas no coinciden.'; err.style.display='inline'; return; }
        btn.disabled=true;
        try {
          const r = await API.changePassword(pwA, pwN);
          if (r.ok) {
            ok.style.display='inline';
            ['pw-actual','pw-nuevo','pw-nuevo2'].forEach(id=>document.getElementById(id).value='');
            pwBar.style.width='0';
            setTimeout(()=>ok.style.display='none',4000);
          } else throw new Error(r.error||'Error al cambiar la contraseña');
        } catch(e) { err.textContent=e.message; err.style.display='inline'; }
        btn.disabled=false;
      });

      ['pw-actual','pw-nuevo','pw-nuevo2'].forEach(id => {
        document.getElementById(id)?.addEventListener('keydown', e => { if (e.key==='Enter') document.getElementById('btn-cambiar-pw').click(); });
      });

    } catch(e) { el.innerHTML = '<p class="error">'+e.message+'</p>'; }
  }

};
