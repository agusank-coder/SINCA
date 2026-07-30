/* certificate.js v27 — Certificado con firmas de instructor y supervisores EPPT */

const _logoCache = {};
async function _loadImg(url) {
  if (_logoCache[url]) return _logoCache[url];
  try {
    const b = await fetch(url).then(r=>r.blob());
    return await new Promise(ok=>{ const fr=new FileReader(); fr.onload=()=>{ _logoCache[url]=fr.result; ok(fr.result); }; fr.readAsDataURL(b); });
  } catch { return null; }
}
/**
 * Obtener resultados clínicos de la base de datos
 * @param {number} clinical_exam_id - ID del examen clínico
 * @returns {Promise<Array>} resultados clínicos
 */
async function obtenerResultadosClinicosDelCertificado(clinical_exam_id) {
  try {
    const response = await fetch(`/api/resultados-clinicos/${clinical_exam_id}`);
    if (!response.ok) return [];
    const data = await response.json();
    return data.resultados || [];
  } catch (err) {
    console.error('Error obteniendo resultados clínicos:', err);
    return [];
  }
}

/**
 * Obtener resultados psicotécnico de la base de datos
 * @param {number} clinical_exam_id - ID del examen clínico
 * @returns {Promise<Array>} resultados psicotécnico
 */
async function obtenerResultadosPsicotecnicoCertificado(clinical_exam_id) {
  try {
    const response = await fetch(`/api/resultados-psicotecnico/${clinical_exam_id}`);
    if (!response.ok) return [];
    const data = await response.json();
    return data.resultados || [];
  } catch (err) {
    console.error('Error obteniendo resultados psicotécnico:', err);
    return [];
  }
}

/**
 * Cargar datos completos del certificado (parámetros + firma)
 * @param {number} certificate_id - ID del certificado
 * @returns {Promise<Object>} datos completos
 */
async function cargarDatosCertificadoCompleto(certificate_id) {
  try {
    const response = await fetch(`/api/certificado/${certificate_id}`);
    if (!response.ok) return null;
    const data = await response.json();
    return data.certificado || null;
  } catch (err) {
    console.error('Error cargando datos del certificado:', err);
    return null;
  }
}
async function generateCertificate(cert, esReimpresion=false) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit:'mm', format:'a4', orientation:'landscape' });
  const W=297, H=210;
// Cargar datos clínicos si hay clinical_exam_id
  if(cert.clinical_exam_id) {
    const datosCompletos = await cargarDatosCertificadoCompleto(cert.id);
    if(datosCompletos) {
      cert.parametros_clinicos = datosCompletos.parametros_clinicos || [];
      cert.psicotecnico = datosCompletos.psicotecnico || [];
      cert.numero_credencial = datosCompletos.numero_credencial;
    }
  }
  // Fondo blanco
  doc.setFillColor(255,255,255); doc.rect(0,0,W,H,'F');
  // Borde exterior doble
  doc.setDrawColor(20,50,120); doc.setLineWidth(1.5); doc.rect(6,6,W-12,H-12);
  doc.setDrawColor(200,150,20); doc.setLineWidth(0.4); doc.rect(8,8,W-16,H-16);
  // Franja superior azul
  doc.setFillColor(20,50,120); doc.rect(6,6,W-12,30,'F');
  // Franja inferior azul
  doc.setFillColor(20,50,120); doc.rect(6,H-24,W-12,18,'F');
  // Línea dorada
  doc.setFillColor(200,150,20); doc.rect(6,36,W-12,2.5,'F');
  // Línea verde
  doc.setFillColor(30,140,80); doc.rect(6,H-27,W-12,2.5,'F');

  // Marca de agua de TEXTO (no imagen) — seguridad
  try {
    doc.setGState(new doc.GState({opacity:0.04}));
    doc.setFont('helvetica','bold'); doc.setFontSize(15); doc.setTextColor(20,50,120);
    const wLines = [cert.code||'SINCA', 'SINCA PSA/ISSA', cert.code||'DOCUMENTO OFICIAL'];
    for(let r=0;r<4;r++) for(let c=0;c<3;c++) doc.text(wLines[(r+c)%3], 20+c*90, 50+r*48, {angle:30});
    doc.setGState(new doc.GState({opacity:1}));
  } catch {}

  // Logos
  const psaImg = await _loadImg('/img/psa.png');
  const issaImg = await _loadImg('/img/issa.png');
  if(psaImg) doc.addImage(psaImg,'PNG',14,8,24,24);
  if(issaImg) doc.addImage(issaImg,'PNG',W-38,8,24,24);

  // Encabezado (sobre franja azul)
  doc.setFont('helvetica','bold'); doc.setFontSize(13); doc.setTextColor(255,255,255);
  doc.text('POLICIA DE SEGURIDAD AEROPORTUARIA', W/2, 17, {align:'center'});
  doc.setFont('helvetica','normal'); doc.setFontSize(9); doc.setTextColor(200,220,255);
  doc.text('Instituto Superior de Seguridad Aeroportuaria (ISSA)', W/2, 23, {align:'center'});
  doc.text('SINCA — Sistema Institucional de Capacitacion y Acreditacion', W/2, 29, {align:'center'});

  // Título con mejor jerarquía visual
  doc.setFont('times','bold'); doc.setFontSize(30); doc.setTextColor(18,45,110);
  doc.text('CERTIFICADO DE APROBACION', W/2, 51, {align:'center'});
  // Ornamento bajo el título
  doc.setDrawColor(200,150,20); doc.setLineWidth(0.6);
  doc.line(W/2-45, 56, W/2+45, 56);
  doc.setFillColor(200,150,20); doc.circle(W/2, 56, 1.2, 'F');
  doc.setFont('helvetica','italic'); doc.setFontSize(11); doc.setTextColor(90,90,95);
  doc.text('Se certifica que', W/2, 65, {align:'center'});

  // Nombre del titular
  let yN=74;
  if(cert.rango) {
    doc.setFont('helvetica','normal'); doc.setFontSize(11); doc.setTextColor(90,110,150);
    doc.text(cert.rango, W/2, yN, {align:'center'}); yN+=10;
  }
  doc.setFont('times','bolditalic'); doc.setFontSize(24); doc.setTextColor(12,30,80);
  doc.text((cert.apellido||'')+', '+(cert.nombre||''), W/2, yN, {align:'center'});
  doc.setDrawColor(200,150,20); doc.setLineWidth(0.5);
  doc.line(W*0.3, yN+4, W*0.7, yN+4);

  // Datos del titular
  const yD=yN+11;
  doc.setFont('helvetica','normal'); doc.setFontSize(10); doc.setTextColor(70,70,75);
  doc.text('DNI: '+(cert.dni||'—')+'    Legajo: '+cert.legajo+'    '+(cert.organismo||''), W/2, yD, {align:'center'});
  let yAero = yD;
  if(cert.aeropuerto) { doc.setFontSize(9); doc.setTextColor(110,110,115); doc.text(cert.aeropuerto, W/2, yD+5.5, {align:'center'}); yAero = yD+5.5; }

  const yC = yAero+13;
  doc.setFont('helvetica','italic'); doc.setFontSize(11); doc.setTextColor(90,90,95);
  doc.text('ha aprobado satisfactoriamente el', W/2, yC, {align:'center'});
  const nomCurso=(cert.curso_cod||'')+(cert.curso_nombre?' — '+cert.curso_nombre:'');
  doc.setFont('helvetica','bold'); doc.setFontSize(14); doc.setTextColor(18,45,110);
  const lines=doc.splitTextToSize(nomCurso, W-110);
  doc.text(lines, W/2, yC+9, {align:'center'});
  const yPost=yC+9+lines.length*7.5;

  doc.setFont('helvetica','normal'); doc.setFontSize(10); doc.setTextColor(70,70,75);
  const fechaStr = _fmtFecha(cert.issued_at);
  doc.text('('+( cert.horas||0)+' hs/reloj)  ·  calificacion: '+cert.score_pct+' %  ·  '+fechaStr, W/2, yPost+5, {align:'center'});
  if(cert.vencimiento) {
    doc.setFont('helvetica','bold'); doc.setFontSize(10.5); doc.setTextColor(25,130,70);
    doc.text('Valida hasta el '+_fmtFecha(cert.vencimiento)+'  ·  instruccion recurrente SINCA', W/2, yPost+13, {align:'center'});
  }

  // ─── DATOS CLÍNICOS Y PSICOTÉCNICOS ───
  const yParam = yPost + 20;
  
  // Número de credencial único
  doc.setFont('helvetica','bold'); doc.setFontSize(11); doc.setTextColor(200,150,20);
  doc.text('Nº Credencial: ' + (cert.numero_credencial || 'N/A'), W/2, yParam, {align:'center'});
  
  // Sección de Parámetros Clínicos
  if(cert.parametros_clinicos && cert.parametros_clinicos.length > 0) {
    doc.setFont('helvetica','bold'); doc.setFontSize(10); doc.setTextColor(18,45,110);
    doc.text('PARÁMETROS CLÍNICOS Y LABORATORIO', 20, yParam + 12);
    
    let yParamRow = yParam + 18;
    doc.setFont('helvetica','normal'); doc.setFontSize(8); doc.setTextColor(70,70,75);
    
    cert.parametros_clinicos.forEach(param => {
      doc.text('• ' + param.nombre + ': ' + param.valor_resultado + ' ' + (param.unidad || ''), 25, yParamRow);
      if(param.observaciones) {
        doc.setFontSize(7); doc.setTextColor(100,100,105);
        doc.text('  Obs: ' + param.observaciones, 25, yParamRow + 3.5);
        yParamRow += 7;
      } else {
        yParamRow += 3.5;
      }
      // Indicar que fue firmado por profesional
      if(param.health_professional) {
        doc.setFontSize(7); doc.setTextColor(30,140,80);
        doc.text('  ✓ Firmado por ' + param.health_professional, 25, yParamRow);
        yParamRow += 3.5;
      }
    });
    yParamRow += 5;
  }
  
  // Sección de Perfil Psicotécnico
  if(cert.psicotecnico && cert.psicotecnico.length > 0) {
    doc.setFont('helvetica','bold'); doc.setFontSize(10); doc.setTextColor(18,45,110);
    doc.text('PERFIL PSICOTÉCNICO', 20, yParamRow);
    
    let yPsyRow = yParamRow + 6;
    doc.setFont('helvetica','normal'); doc.setFontSize(8); doc.setTextColor(70,70,75);
    
    cert.psicotecnico.forEach(psy => {
      const aptitud = psy.resultado === 'APTO' 
        ? '✓ APTO' 
        : '✗ NO APTO';
      const colorAptitud = psy.resultado === 'APTO' ? [30,140,80] : [200,30,30];
      
      doc.text('• ' + psy.nombre, 25, yPsyRow);
      doc.setTextColor(...colorAptitud);
      doc.text(aptitud, 180, yPsyRow);
      doc.setTextColor(70,70,75);
      
      if(psy.observaciones) {
        doc.setFontSize(7);
        doc.text('  Obs: ' + psy.observaciones, 25, yPsyRow + 3.5);
        yPsyRow += 7;
      } else {
        yPsyRow += 3.5;
      }
      
      if(psy.health_professional) {
        doc.setFontSize(7); doc.setTextColor(30,140,80);
        doc.text('  ✓ Evaluado por ' + psy.health_professional, 25, yPsyRow);
        yPsyRow += 3.5;
      }
    });
  }


  // ─── FIRMAS ───
  const YS = H-21;
  const supervisores = cert.supervisores||[];
  const instructor = cert.instructor;

  // Calcular posiciones de firmas
  // Izquierda: Instructor Nacional AVSEC (quien creó el curso o firma genérica)
  // Centro/derecha: Supervisores EPPT (los que firmaron las jornadas)
  const numFirmasSup = Math.min(supervisores.length, 2);
  const totalFirmas = 1 + numFirmasSup; // instructor + supervisores
  const colW = (W-20) / totalFirmas;

  doc.setDrawColor(60,80,140); doc.setLineWidth(0.5);
  doc.setFont('helvetica','normal'); doc.setFontSize(8.5);

  // Firma del instructor
  const x1 = 10 + colW*0.1;
  doc.line(x1, YS, x1+colW*0.8, YS);
  doc.setTextColor(255,255,255);
  if(instructor) {
    doc.setFont('helvetica','bold'); doc.setFontSize(8);
    doc.text(instructor.apellido+', '+instructor.nombre, x1+colW*0.4, YS+4, {align:'center'});
    doc.setFont('helvetica','normal'); doc.setFontSize(7.5);
    doc.text('Leg: '+instructor.legajo, x1+colW*0.4, YS+8, {align:'center'});
    doc.text('Instructor', x1+colW*0.4, YS+12, {align:'center'});
    // Hash de firma del instructor (si existe en el cert)
    if(cert.firma_hash) {
      doc.setFont('courier','normal'); doc.setFontSize(5.5); doc.setTextColor(180,200,255);
      doc.text('SHA-256: '+cert.firma_hash.slice(0,32), x1+colW*0.4, YS+16, {align:'center'});
    }
  } else {
    doc.text('Instructor', x1+colW*0.4, YS+5, {align:'center'});
    doc.setFontSize(7); doc.setTextColor(200,210,230);
    doc.text('(firma electronica aplicada al emitir)', x1+colW*0.4, YS+9, {align:'center'});
  }

  // Firmas de supervisores EPPT
  for(let i=0; i<numFirmasSup; i++) {
    const sup = supervisores[i];
    const xS = 10 + colW*(i+1) + colW*0.1;
    doc.setDrawColor(60,80,140); doc.line(xS, YS, xS+colW*0.8, YS);
    doc.setTextColor(255,255,255); doc.setFont('helvetica','bold'); doc.setFontSize(8);
    doc.text((sup.apellido||'')+', '+(sup.nombre||''), xS+colW*0.4, YS+4, {align:'center'});
    doc.setFont('helvetica','normal'); doc.setFontSize(7.5);
    doc.text('Leg: '+(sup.legajo||''), xS+colW*0.4, YS+8, {align:'center'});
    doc.text('Supervisor AVSEC certificado — EPPT', xS+colW*0.4, YS+12, {align:'center'});
    if(sup.firma_sup_hash) {
      doc.setFont('courier','normal'); doc.setFontSize(5.5); doc.setTextColor(180,200,255);
      doc.text('SHA-256: '+sup.firma_sup_hash.slice(0,32), xS+colW*0.4, YS+16, {align:'center'});
    }
  }

  // Si no hay supervisores: firma genérica
  if(numFirmasSup===0) {
    const xS=10+colW+colW*0.1;
    doc.setDrawColor(60,80,140); doc.line(xS, YS, xS+colW*0.8, YS);
    doc.setTextColor(255,255,255); doc.setFont('helvetica','normal'); doc.setFontSize(8.5);
    doc.text('Supervisor AVSEC certificado', xS+colW*0.4, YS+5, {align:'center'});
  }

  // Código y hash completo
  doc.setFont('courier','bold'); doc.setFontSize(9); doc.setTextColor(255,255,255);
  doc.text('Codigo de validacion: '+cert.code, W/2, H-10, {align:'center'});
  doc.setFont('courier','normal'); doc.setFontSize(6.5); doc.setTextColor(180,200,255);
  doc.text('SINCA · Firmado electronicamente — Ley N 25.506 — SHA-256: '+(cert.firma_hash||''), W/2, H-6, {align:'center'});
  if(esReimpresion) { doc.setFontSize(7); doc.text('REIMPRESION: '+_fmtFechaHora(new Date().toISOString()), W-16, H-2, {align:'right'}); }

  // QR
  try {
    const qrD='SINCA|'+cert.code+'|'+cert.apellido+','+cert.nombre+'|'+cert.legajo+'|'+(cert.curso_cod||'')+'|Vce:'+(cert.vencimiento||'SV');
    const qrUrl='https://api.qrserver.com/v1/create-qr-code/?size=120x120&data='+encodeURIComponent(qrD);
    const qrBlob=await fetch(qrUrl).then(r=>r.blob());
    const qrB64=await new Promise(ok=>{ const fr=new FileReader(); fr.onload=()=>ok(fr.result); fr.readAsDataURL(qrBlob); });
    doc.setFillColor(255,255,255); doc.rect(W-30,H-34,24,24,'F');
    doc.addImage(qrB64,'PNG',W-29,H-33,22,22);
  } catch {}

  // ─── PÁGINA 2: ANALÍTICO DE UNIDADES ───
  doc.addPage();
  doc.setFillColor(255,255,255); doc.rect(0,0,W,H,'F');
  doc.setDrawColor(20,50,120); doc.setLineWidth(1.5); doc.rect(6,6,W-12,H-12);
  doc.setFillColor(20,50,120); doc.rect(6,6,W-12,24,'F');
  doc.setFillColor(200,150,20); doc.rect(6,30,W-12,2,'F');

  if(psaImg) doc.addImage(psaImg,'PNG',10,8,16,16);
  if(issaImg) doc.addImage(issaImg,'PNG',W-26,8,16,16);

  doc.setFont('helvetica','bold'); doc.setFontSize(12); doc.setTextColor(255,255,255);
  doc.text('ANALITICO DE UNIDADES — '+(cert.curso_cod||''), W/2, 17, {align:'center'});
  doc.setFont('helvetica','normal'); doc.setFontSize(8); doc.setTextColor(200,220,255);
  doc.text((cert.apellido||'')+', '+(cert.nombre||'')+'  ·  Leg: '+cert.legajo+'  ·  Cod: '+cert.code, W/2, 23, {align:'center'});

  const lessons = cert.lecciones||[];
  let yL=38;
  // Encabezado tabla
  doc.setFillColor(240,244,255); doc.rect(10,yL,W-20,8,'F');
  doc.setFont('helvetica','bold'); doc.setFontSize(9); doc.setTextColor(20,50,120);
  doc.text('#', 16, yL+5.5); doc.text('Unidad', 28, yL+5.5);
  yL+=9; doc.setFont('helvetica','normal'); doc.setFontSize(9.5); doc.setTextColor(40,40,40);

  if(lessons.length===0) {
    doc.text('Sin detalle de unidades disponible. Ver programa en plataforma SINCA.', W/2, yL+6, {align:'center'});
    yL+=10;
  } else {
    lessons.forEach((l,i)=>{
      if(yL>H-32){doc.addPage();yL=20;}
      if(i%2===0){doc.setFillColor(248,250,255);doc.rect(10,yL,W-20,7.5,'F');}
      doc.setTextColor(50,50,55);
      doc.text(String(i+1), 16, yL+5.2);
      doc.text((l.titulo||'Unidad '+(i+1)).slice(0,80), 28, yL+5.2);
      yL+=7.5;
    });
  }

  // Firmas en el analítico también
  const yFA=Math.max(yL+10, H-32);
  doc.setDrawColor(20,50,120); doc.setLineWidth(0.3); doc.line(10,yFA,W-10,yFA);
  doc.setFont('helvetica','normal'); doc.setFontSize(8); doc.setTextColor(40,40,40);

  if(instructor) {
    doc.text(instructor.apellido+', '+instructor.nombre+' (Leg: '+instructor.legajo+')', W*0.25, yFA+5, {align:'center'});
    doc.text('Instructor', W*0.25, yFA+9, {align:'center'});
  } else {
    doc.text('Instructor', W*0.25, yFA+5, {align:'center'});
  }
  for(let i=0;i<numFirmasSup;i++){
    const sup=supervisores[i];
    const xPos=W*(0.55+i*0.22);
    doc.text((sup.apellido||'')+', '+(sup.nombre||'')+' (Leg: '+(sup.legajo||'')+')', xPos, yFA+5, {align:'center'});
    doc.text('Supervisor AVSEC — EPPT', xPos, yFA+9, {align:'center'});
  }

  doc.setFont('helvetica','normal'); doc.setFontSize(7); doc.setTextColor(80,80,80);
  doc.text('Cod: '+cert.code+'  ·  Emitido: '+fechaStr+'  ·  Ley N 25.506  ·  SHA-256: '+(cert.firma_hash||''), W/2, H-12, {align:'center'});
  doc.text('SINCA — PSA/ISSA — Este analitico certifica la totalidad de las unidades completadas.', W/2, H-8, {align:'center'});

  // ─── PÁGINA 3: TRAZABILIDAD EPPT ────────────────────────────────────────────
  const epptJornadas = cert.eppt_jornadas || [];
  if (epptJornadas.length > 0) {
    doc.addPage();
    doc.setFillColor(255,255,255); doc.rect(0,0,W,H,'F');
    doc.setDrawColor(20,50,120); doc.setLineWidth(1.5); doc.rect(6,6,W-12,H-12);
    doc.setFillColor(20,50,120); doc.rect(6,6,W-12,24,'F');
    doc.setFillColor(30,140,80); doc.rect(6,30,W-12,2,'F');
    if(psaImg) doc.addImage(psaImg,'PNG',10,8,16,16);
    if(issaImg) doc.addImage(issaImg,'PNG',W-26,8,16,16);

    doc.setFont('helvetica','bold'); doc.setFontSize(12); doc.setTextColor(255,255,255);
    doc.text('REGISTRO DE PRÁCTICAS (EPPT) — TRAZABILIDAD', W/2, 16, {align:'center'});
    doc.setFont('helvetica','normal'); doc.setFontSize(8); doc.setTextColor(200,220,255);
    doc.text(
      (cert.apellido||'')+', '+(cert.nombre||'')+'  ·  Leg: '+cert.legajo+
      '  ·  Cert: '+cert.code+(cert.eppt_num_doc ? '  ·  EPPT: '+cert.eppt_num_doc : ''),
      W/2, 23, {align:'center'});

    // Intro
    let yE = 38;
    doc.setFont('helvetica','italic'); doc.setFontSize(8.5); doc.setTextColor(60,60,80);
    doc.text(
      'Este registro vincula cada jornada de práctica certificada (EPPT) con el certificado '+cert.code+'. '+
      'Auditores pueden verificar cada firma en el panel SINCA mediante el hash SHA-256 correspondiente.',
      14, yE, { maxWidth: W-28, lineHeightFactor:1.4 });
    yE += 14;

    // Totales
    const totalHoras = epptJornadas.reduce((s,j)=>s+(Number(j.horas)||0),0);
    const totalJornadas = epptJornadas.length;
    doc.setFont('helvetica','normal'); doc.setFontSize(8.5); doc.setTextColor(20,50,120);
    doc.text(
      'Total de jornadas registradas: '+totalJornadas+'   ·   Total de horas acreditadas: '+totalHoras+' hs',
      14, yE);
    yE += 8;

    // Encabezado tabla
    doc.setFillColor(20,50,120); doc.rect(10,yE,W-20,8,'F');
    doc.setFont('helvetica','bold'); doc.setFontSize(7.5); doc.setTextColor(255,255,255);
    const colsX = [14, 44, 72, 110, 148, 186, 224];
    const colsT = ['N°','Fecha','Puesto','Horas','Supervisor','N° Jornada','Hash sup (parcial)'];
    colsT.forEach((t,i) => doc.text(t, colsX[i], yE+5.5));
    yE += 9;
    doc.setFont('helvetica','normal'); doc.setFontSize(7); doc.setTextColor(30,30,35);

    epptJornadas.forEach((j, idx) => {
      if (yE > H-28) { doc.addPage(); yE = 18; }
      if (idx % 2 === 0) { doc.setFillColor(245,248,255); doc.rect(10,yE,W-20,7,'F'); }
      doc.setTextColor(30,30,35);
      doc.text(String(idx+1),            colsX[0], yE+5);
      doc.text((j.fecha||'').slice(0,10), colsX[1], yE+5);
      doc.text((j.puesto||'—').slice(0,26), colsX[2], yE+5);
      doc.text((j.horas||0)+' hs',       colsX[3], yE+5);
      const supNom = ((j.sup_apellido||'')+', '+(j.sup_nombre||'')).slice(0,22);
      doc.text(supNom,                   colsX[4], yE+5);
      doc.text((j.numero_jornada||'—').slice(0,20), colsX[5], yE+5);
      // Hash parcial del supervisor (primeros 24 chars) — verificable en panel SINCA
      if (j.firma_sup_hash) {
        doc.setFont('courier','normal'); doc.setFontSize(6); doc.setTextColor(0,100,60);
        doc.text((j.firma_sup_hash||'').slice(0,28)+'…', colsX[6], yE+5);
        doc.setFont('helvetica','normal'); doc.setFontSize(7); doc.setTextColor(30,30,35);
      } else {
        doc.text('—', colsX[6], yE+5);
      }
      // Indicar si el alumno también firmó conformidad
      if (j.firma_alu_hash) {
        doc.setTextColor(0,120,60); doc.setFontSize(6.5);
        doc.text('✓ alumno', colsX[6], yE+5+4);
        doc.setTextColor(30,30,35); doc.setFontSize(7);
      }
      yE += (j.firma_alu_hash ? 9 : 7);
    });

    // Bloque de firma electrónica del certificado (vincula el cert con el EPPT)
    yE = Math.max(yE + 6, H - 36);
    doc.setDrawColor(20,50,120); doc.setLineWidth(0.4);
    doc.setFillColor(240,245,255); doc.rect(10, yE, W-20, 26, 'FD');
    doc.setFont('helvetica','bold'); doc.setFontSize(8); doc.setTextColor(20,50,120);
    doc.text('VINCULACIÓN CRIPTOGRÁFICA', 14, yE+7);
    doc.setDrawColor(180,190,220); doc.setLineWidth(0.2); doc.line(12, yE+9, W-12, yE+9);
    doc.setFont('helvetica','normal'); doc.setFontSize(7.5); doc.setTextColor(40,40,40);
    doc.text('Certificado N°: '+cert.code, 14, yE+14);
    doc.text('Registro EPPT: '+(cert.eppt_num_doc||cert.eppt_id||'—'), 14, yE+19);
    doc.setFont('courier','normal'); doc.setFontSize(6.5); doc.setTextColor(0,100,60);
    doc.text('Hash cert:  '+(cert.firma_hash||'—'), 14, yE+24);

    doc.setFont('helvetica','normal'); doc.setFontSize(7); doc.setTextColor(80,80,80);
    doc.text(
      'Todos los hashes son verificables en el panel de Firmas y Verificación del sistema SINCA.',
      W/2, H-8, {align:'center'});
  }

  doc.save('Certificado_'+(cert.curso_cod||'').replace(/\s/g,'')+'_'+cert.apellido+'_'+cert.code+'.pdf');
}

/* ═══════════════════════════════════════════════════════════════
   CERTIFICADO DE APTITUD PSICOFÍSICA — PDF oficial verificable
   Número: APSF-XXXXX-AAAA-NNNN · SHA-256 · PSA/ISSA
═══════════════════════════════════════════════════════════════ */
async function generateAptoPDF(apto) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit:'mm', format:'a4', orientation:'portrait' });
  const W = 210, H = 297;
  const AZ = [20,50,120], OR = [184,134,11], VE = [21,92,58], RO = [163,45,45];

  // Fondo
  doc.setFillColor(255,255,255); doc.rect(0,0,W,H,'F');
  // Borde doble
  doc.setDrawColor(...AZ); doc.setLineWidth(1.2); doc.rect(8,8,W-16,H-16);
  doc.setDrawColor(...OR); doc.setLineWidth(0.4); doc.rect(11,11,W-22,H-22);

  // Encabezado
  const logoP = await _loadImg('/img/psa.png').catch(()=>null);
  const logoI = await _loadImg('/img/issa.png').catch(()=>null);
  if (logoP) doc.addImage(logoP,'PNG',16,14,22,22);
  if (logoI) doc.addImage(logoI,'PNG',W-38,14,22,22);

  doc.setFontSize(9); doc.setFont('helvetica','normal'); doc.setTextColor(...AZ);
  doc.text('POLICÍA DE SEGURIDAD AEROPORTUARIA', W/2,18,{align:'center'});
  doc.text('Instituto Superior de Seguridad Aeroportuaria', W/2,23,{align:'center'});

  // Línea dorada
  doc.setDrawColor(...OR); doc.setLineWidth(0.8); doc.line(16,37,W-16,37);

  // Título
  doc.setFont('helvetica','bold'); doc.setFontSize(17); doc.setTextColor(...AZ);
  doc.text('CERTIFICADO DE APTITUD PSICOFÍSICA', W/2,47,{align:'center'});
  doc.setFont('helvetica','normal'); doc.setFontSize(9); doc.setTextColor(80,80,80);
  doc.text('NORMATIVA AVSEC — PNISAC PSA', W/2,53,{align:'center'});

  // Número de certificado
  const numColor = apto.estado==='apto' ? VE : RO;
  doc.setFillColor(...numColor); doc.roundedRect(W/2-45,57,90,10,2,2,'F');
  doc.setFont('courier','bold'); doc.setFontSize(11); doc.setTextColor(255,255,255);
  doc.text(apto.numero || 'BORRADOR', W/2,63.5,{align:'center'});

  // Datos del agente
  doc.setFont('helvetica','normal'); doc.setFontSize(10); doc.setTextColor(30,30,30);
  const datosY = 76;
  const campo = (label, valor, x, y, w=80) => {
    doc.setFont('helvetica','bold'); doc.setFontSize(8); doc.setTextColor(80,80,80);
    doc.text(label.toUpperCase(), x, y);
    doc.setFont('helvetica','normal'); doc.setFontSize(10); doc.setTextColor(20,20,20);
    doc.text(String(valor||'—'), x, y+5);
    doc.setDrawColor(200,200,200); doc.setLineWidth(0.3); doc.line(x, y+6.5, x+w, y+6.5);
  };
  campo('Apellido y nombre', (apto.apellido||'')+(apto.nombre ? ', '+apto.nombre : ''), 16, datosY, 100);
  campo('Legajo / DNI', apto.legajo || '—', 125, datosY, 70);
  campo('Organismo', apto.organismo_tipo==='vigilador'?'Vigilador de Seguridad Privada':'Policía de Seguridad Aeroportuaria (PSA)', 16, datosY+14, 100);
  campo('Categoría', apto.organismo_tipo==='vigilador'?'Vigilador':'Personal Policial', 125, datosY+14, 70);

  // Estado y vigencia — recuadro destacado
  const estadoY = datosY+28;
  const eApto = apto.estado === 'apto';
  doc.setFillColor(...(eApto ? [235,245,235] : [250,235,235]));
  doc.setDrawColor(...(eApto ? VE : RO)); doc.setLineWidth(0.6);
  doc.roundedRect(16, estadoY, W-32, 22, 3, 3, 'FD');
  doc.setFont('helvetica','bold'); doc.setFontSize(14); doc.setTextColor(...(eApto?VE:RO));
  doc.text(eApto ? '✓  APTO PSICOFÍSICO' : '✗  NO APTO', W/2, estadoY+9, {align:'center'});
  doc.setFont('helvetica','normal'); doc.setFontSize(9); doc.setTextColor(50,50,50);
  doc.text(`Emitido: ${apto.emitido_at||'—'}   ·   Vence: ${apto.vence_at||'—'}   ·   Vigencia: ${apto.vigencia_meses} meses`, W/2, estadoY+17, {align:'center'});

  // Tabla de ítems
  const itemsY = estadoY+30;
  doc.setFont('helvetica','bold'); doc.setFontSize(10); doc.setTextColor(...AZ);
  doc.text('Detalle de evaluaciones realizadas', 16, itemsY);
  doc.setDrawColor(...AZ); doc.setLineWidth(0.3); doc.line(16, itemsY+2, W-16, itemsY+2);

  const items = apto.items || [];
  const cats = {};
  items.forEach(it => { if(!cats[it.categoria]) cats[it.categoria] = []; cats[it.categoria].push(it); });

  const catLabels = {
    psicologico:'Evaluación Psicológica', laboratorio:'Laboratorio',
    imagen:'Estudios de Imagen', cardiologia:'Cardiología',
    oftalmologico:'Oftalmología', auditivo:'Audiología'
  };

  let cy = itemsY+8;
  const colores = { apto:[21,92,58], no_apto:[163,45,45], pendiente:[100,100,100] };

  for (const [cat, citems] of Object.entries(cats)) {
    if (cy > H-50) break;
    // Cabecera de categoría
    doc.setFillColor(240,243,252); doc.rect(16, cy-4, W-32, 6, 'F');
    doc.setFont('helvetica','bold'); doc.setFontSize(8); doc.setTextColor(...AZ);
    doc.text((catLabels[cat]||cat).toUpperCase(), 18, cy);
    cy += 5;

    for (const it of citems) {
      if (cy > H-45) break;
      const col = colores[it.estado] || [100,100,100];
      doc.setFont('helvetica','normal'); doc.setFontSize(8); doc.setTextColor(30,30,30);
      doc.text('• '+it.item, 22, cy);
      doc.setFont('helvetica','bold'); doc.setTextColor(...col);
      doc.text(it.estado==='apto'?'APTO':it.estado==='no_apto'?'NO APTO':'PENDIENTE', 155, cy);
      if (it.resultado) {
        doc.setFont('helvetica','italic'); doc.setFontSize(7); doc.setTextColor(90,90,90);
        doc.text(it.resultado.slice(0,60), 22, cy+3.5);
        cy += 3;
      }
      cy += 5.5;
    }
    cy += 2;
  }

  // Firma
  const firmaY = Math.max(cy+4, H-55);
  doc.setDrawColor(180,180,180); doc.setLineWidth(0.3); doc.line(16,firmaY,W-16,firmaY);
  doc.setFont('helvetica','normal'); doc.setFontSize(8); doc.setTextColor(60,60,60);
  doc.text('Médico firmante:', 16, firmaY+6);
  doc.setFont('helvetica','bold'); doc.setFontSize(9); doc.setTextColor(20,20,20);
  doc.text(apto.medico_nombre||'—', 16, firmaY+11);
  doc.setFont('helvetica','normal'); doc.setFontSize(7); doc.setTextColor(90,90,90);
  doc.text('Firma electrónica — Ley N° 25.506', 16, firmaY+16);

  // Hash SHA-256
  if (apto.firma_hash) {
    doc.setFont('courier','normal'); doc.setFontSize(6.5); doc.setTextColor(120,120,120);
    const hashLinea1 = apto.firma_hash.slice(0,44);
    const hashLinea2 = apto.firma_hash.slice(44);
    doc.text('SHA-256: '+hashLinea1, 16, firmaY+21);
    if (hashLinea2) doc.text('         '+hashLinea2, 16, firmaY+24.5);
  }

  // QR placeholder y número
  doc.setFillColor(...AZ); doc.roundedRect(W-50, firmaY+2, 34, 18, 2, 2, 'F');
  doc.setFont('courier','bold'); doc.setFontSize(7); doc.setTextColor(255,255,255);
  doc.text('VERIFICAR EN:', W-33, firmaY+8, {align:'center'});
  doc.setFontSize(6.5);
  doc.text(apto.numero||'', W-33, firmaY+13, {align:'center'});

  // Pie
  doc.setFont('helvetica','normal'); doc.setFontSize(7); doc.setTextColor(130,130,130);
  doc.text('PSA / ISSA · Certificado de Aptitud Psicofísica · Verificable en la plataforma SINCA', W/2, H-12, {align:'center'});

  return doc;
}

/* ═══════════════════════════════════════════════════════════════
   ACTA DE EXAMEN CON DOBLE FIRMA — PDF oficial verificable
   Número: ACEX-XXXXX-AAAA-NNNN · SHA-256 · PSA/ISSA
═══════════════════════════════════════════════════════════════ */
async function generateActaExamenPDF(acta, detalle) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit:'mm', format:'a4', orientation:'portrait' });
  const W = 210, H = 297;
  const AZ = [20,50,120], OR = [184,134,11];
  const VE = [21,92,58], RO = [163,45,45];

  doc.setFillColor(255,255,255); doc.rect(0,0,W,H,'F');
  doc.setDrawColor(...AZ); doc.setLineWidth(1.2); doc.rect(8,8,W-16,H-16);
  doc.setDrawColor(...OR); doc.setLineWidth(0.4); doc.rect(11,11,W-22,H-22);

  const logoP = await _loadImg('/img/psa.png').catch(()=>null);
  if (logoP) doc.addImage(logoP,'PNG',16,14,20,20);

  doc.setFontSize(9); doc.setFont('helvetica','normal'); doc.setTextColor(...AZ);
  doc.text('POLICÍA DE SEGURIDAD AEROPORTUARIA', W/2,18,{align:'center'});
  doc.text('Instituto Superior de Seguridad Aeroportuaria', W/2,23,{align:'center'});
  doc.setDrawColor(...OR); doc.setLineWidth(0.8); doc.line(16,35,W-16,35);

  doc.setFont('helvetica','bold'); doc.setFontSize(16); doc.setTextColor(...AZ);
  doc.text('ACTA DE EXAMEN', W/2,44,{align:'center'});

  // Número de acta
  doc.setFillColor(...AZ); doc.roundedRect(W/2-40,48,80,9,2,2,'F');
  doc.setFont('courier','bold'); doc.setFontSize(10); doc.setTextColor(255,255,255);
  doc.text(acta.numero||'PENDIENTE', W/2,53.5,{align:'center'});

  // Datos del alumno y curso
  let cy = 65;
  const campo = (l,v,x,y,w=85) => {
    doc.setFont('helvetica','bold'); doc.setFontSize(7.5); doc.setTextColor(90,90,90);
    doc.text(l.toUpperCase(), x, y);
    doc.setFont('helvetica','normal'); doc.setFontSize(9.5); doc.setTextColor(20,20,20);
    doc.text(String(v||'—'), x, y+5);
    doc.setDrawColor(200,200,200); doc.setLineWidth(0.3); doc.line(x, y+6.5, x+w, y+6.5);
  };

  campo('Alumno', (detalle.alumno?.apellido||'')+(detalle.alumno?.nombre?', '+detalle.alumno.nombre:''), 16, cy, 110);
  campo('Legajo', detalle.alumno?.legajo||'—', 135, cy, 60);
  cy += 16;
  campo('Curso', detalle.curso_nombre||detalle.curso||'—', 16, cy, 110);
  campo('Código', detalle.curso||'—', 135, cy, 60);
  cy += 16;
  campo('Fecha y hora del examen', detalle.fecha||acta.created_at?.slice(0,16)||'—', 16, cy, 85);
  campo('Duración', detalle.duration_s ? Math.round(detalle.duration_s/60)+' min' : '—', 110, cy, 40);
  cy += 16;

  // Resultado destacado
  const aprobado = detalle.passed || acta.passed;
  doc.setFillColor(...(aprobado?[235,245,235]:[250,235,235]));
  doc.setDrawColor(...(aprobado?VE:RO)); doc.setLineWidth(0.8);
  doc.roundedRect(16, cy, W-32, 20, 3, 3, 'FD');
  doc.setFont('helvetica','bold'); doc.setFontSize(15); doc.setTextColor(...(aprobado?VE:RO));
  doc.text(aprobado?'APROBADO':'DESAPROBADO', W/2, cy+9, {align:'center'});
  doc.setFont('helvetica','normal'); doc.setFontSize(11); doc.setTextColor(40,40,40);
  const nota = detalle.score_pct ?? acta.score_pct ?? '—';
  const total = detalle.total_preguntas ?? '—';
  const correctas = detalle.respuestas_correctas ?? '—';
  doc.text(`Nota: ${nota}%   ·   Correctas: ${correctas} / ${total}`, W/2, cy+16, {align:'center'});
  cy += 28;

  // Desagregado (si hay detalle de preguntas)
  if (detalle.total_preguntas) {
    doc.setFont('helvetica','bold'); doc.setFontSize(9); doc.setTextColor(...AZ);
    doc.text('Resumen de resultados', 16, cy);
    doc.setDrawColor(...AZ); doc.setLineWidth(0.2); doc.line(16,cy+2,W-16,cy+2);
    cy += 7;
    doc.setFont('helvetica','normal'); doc.setFontSize(8.5); doc.setTextColor(40,40,40);
    doc.text(`Total de preguntas: ${total}`, 20, cy);
    doc.text(`Respuestas correctas: ${correctas}`, 80, cy);
    doc.text(`Nota obtenida: ${nota}%`, 145, cy);
    cy += 8;
  }

  // Firmas
  cy = Math.max(cy+10, H-75);
  doc.setDrawColor(180,180,180); doc.setLineWidth(0.3); doc.line(16,cy,W-16,cy);
  cy += 8;

  // Firma alumno
  doc.setFont('helvetica','bold'); doc.setFontSize(8); doc.setTextColor(60,60,60);
  doc.text('FIRMA DEL ALUMNO', 16, cy);
  doc.setFont('helvetica','normal'); doc.setFontSize(8.5); doc.setTextColor(20,20,20);
  doc.text(detalle.alumno?.apellido ? detalle.alumno.apellido+', '+detalle.alumno.nombre : '—', 16, cy+5);
  doc.setFont('helvetica','italic'); doc.setFontSize(7); doc.setTextColor(90,90,90);
  doc.text('Firmado electrónicamente al momento de entrega', 16, cy+10);
  if (acta.firma_alu_at) {
    doc.text('Fecha: '+acta.firma_alu_at.slice(0,16), 16, cy+14);
  }

  // Firma instructor
  doc.setFont('helvetica','bold'); doc.setFontSize(8); doc.setTextColor(60,60,60);
  doc.text('FIRMA DEL INSTRUCTOR TITULAR', W/2+5, cy);
  doc.setFont('helvetica','normal'); doc.setFontSize(8.5); doc.setTextColor(20,20,20);
  doc.text(acta.instructor_nombre||'—', W/2+5, cy+5);
  doc.setFont('helvetica','italic'); doc.setFontSize(7); doc.setTextColor(90,90,90);
  if (acta.firma_inst_at) {
    doc.text('Firmado: '+acta.firma_inst_at.slice(0,16), W/2+5, cy+10);
  } else {
    doc.text('Pendiente de firma del instructor', W/2+5, cy+10);
  }
  cy += 20;

  // Hash
  const hashAlu  = acta.firma_alu_hash  || '';
  const hashInst = acta.firma_inst_hash || '';
  doc.setFont('courier','normal'); doc.setFontSize(6); doc.setTextColor(130,130,130);
  if (hashAlu)  doc.text('Hash alumno:     '+hashAlu.slice(0,50),  16, cy);
  if (hashInst) doc.text('Hash instructor: '+hashInst.slice(0,50), 16, cy+4);

  // Pie
  doc.setFont('helvetica','normal'); doc.setFontSize(7); doc.setTextColor(130,130,130);
  doc.text('PSA / ISSA · Acta de Examen · Verificable por número de acta en la plataforma SINCA', W/2, H-12, {align:'center'});

  return doc;
}
