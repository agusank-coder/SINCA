/* ============================================================
 * eppt_pdf.js — Generador de documentos PDF del EPPT
 *   - Acta de reprobación (al reprobar el EPPT)
 *   - Constancia de EPPT completo (analítico de jornadas firmadas)
 * ============================================================ */

async function generateActaReprobacionEPPT(data) {
  if (!window.jspdf) { alert('jsPDF no disponible'); return; }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const W = 210, M = 18;

  // Encabezado
  try { doc.addImage('/img/psa.png', 'PNG', M, 10, 20, 20); } catch {}
  try { doc.addImage('/img/issa.png', 'PNG', W - M - 20, 10, 20, 20); } catch {}
  doc.setFont('helvetica','bold'); doc.setFontSize(13); doc.setTextColor(20,40,80);
  doc.text('POLICÍA DE SEGURIDAD AEROPORTUARIA', W/2, 15, {align:'center'});
  doc.setFontSize(10); doc.setFont('helvetica','normal'); doc.setTextColor(60,80,120);
  doc.text('Instituto Superior de Seguridad Aeroportuaria (ISSA)', W/2, 21, {align:'center'});
  doc.text('Entrenamiento Práctico en el Puesto de Trabajo — PSA/ISSA', W/2, 27, {align:'center'});
  doc.setDrawColor(20,40,80); doc.setLineWidth(0.5); doc.line(M, 32, W-M, 32);

  // Título del acta
  doc.setFont('helvetica','bold'); doc.setFontSize(14); doc.setTextColor(180,20,20);
  doc.text('ACTA DE NO ACREDITACIÓN', W/2, 42, {align:'center'});
  doc.setFontSize(11); doc.setTextColor(20,40,80);
  doc.text('Entrenamiento Práctico en el Puesto de Trabajo (EPPT)', W/2, 50, {align:'center'});
  doc.setFontSize(10); doc.setTextColor(80,80,80);
  doc.text(`N° de Acta: ${data.num_doc || 'Sin número'}`, W/2, 57, {align:'center'});

  doc.line(M, 60, W-M, 60);
  let y = 70;

  // Datos del agente
  doc.setFont('helvetica','bold'); doc.setFontSize(11); doc.setTextColor(20,40,80);
  doc.text('DATOS DEL AGENTE:', M, y);
  y += 7;
  doc.setFont('helvetica','normal'); doc.setFontSize(10); doc.setTextColor(40,40,40);
  const u = data.usuario;
  const rows1 = [
    ['Apellido y Nombre:', `${u.apellido}, ${u.nombre}`],
    ['Jerarquía:', u.rango || '—'],
    ['DNI:', u.dni || '—'],
    ['Legajo:', u.legajo],
    ['Organismo:', u.organismo || '—'],
    ['Aeropuerto:', u.aeropuerto || '—'],
    ['Dependencia:', u.dependencia || '—'],
  ];
  rows1.forEach(([k,v]) => { doc.setFont('helvetica','bold'); doc.text(k, M+2, y); doc.setFont('helvetica','normal'); doc.text(v, M+55, y); y+=6; });

  y += 4;
  doc.setFont('helvetica','bold'); doc.setFontSize(11); doc.setTextColor(20,40,80);
  doc.text('DATOS DEL EPPT:', M, y); y += 7;
  doc.setFont('helvetica','normal'); doc.setFontSize(10); doc.setTextColor(40,40,40);
  const ep = data.eppt;
  const rows2 = [
    ['Especialidad:', ep.apendice],
    ['Horas/actividades requeridas:', `${ep.requerido} ${ep.tipo}`],
    ['Horas/actividades acreditadas:', `${data.entries.reduce((s,e)=>s+(e.firma_sup_at&&e.firma_alu_at?e.horas:0),0)} (con firma dual)`],
    ['Período:', `${data.entries[0]?.fecha||'—'}  al  ${data.entries[data.entries.length-1]?.fecha||'—'}`],
    ['Vencimiento del plazo:', ep.deadline],
    ['Estado:', 'NO ACREDITADO'],
    ['Motivo:', ep.motivo_cierre || '—'],
  ];
  rows2.forEach(([k,v]) => { doc.setFont('helvetica','bold'); doc.text(k, M+2, y); doc.setFont('helvetica','normal'); doc.text(String(v).slice(0,80), M+70, y); y+=6; });

  y += 4;
  doc.setFillColor(255,240,240); doc.roundedRect(M, y, W-2*M, 20, 2, 2, 'F');
  doc.setFont('helvetica','bold'); doc.setFontSize(10); doc.setTextColor(150,20,20);
  doc.text('El agente queda en situación NO OPERATIVO hasta nueva instrucción. El Director del Centro', W/2, y+7, {align:'center'});
  doc.text('deberá determinar la reasignación de funciones o la recursada íntegra.', W/2, y+14, {align:'center'});
  y += 28;

  // Tabla de jornadas (si hay)
  if (data.entries.length) {
    doc.setFont('helvetica','bold'); doc.setFontSize(11); doc.setTextColor(20,40,80);
    doc.text('JORNADAS REGISTRADAS:', M, y); y += 6;
    doc.setFillColor(30,60,120); doc.setTextColor(255,255,255); doc.setFontSize(8.5);
    ['Fecha','Hs','Puesto','Rúbrica','Sup. firmó','Alumno firmó'].forEach((h,i) => {
      const xs=[M,M+20,M+30,M+65,M+110,M+150]; doc.text(h,xs[i],y);
    });
    doc.setFillColor(255,255,255); y += 5; doc.setTextColor(40,40,40);
    data.entries.forEach(e => {
      if (y > 265) { doc.addPage(); y = 20; }
      const rub = e.rubrica.filter(r=>r.calif&&r.calif!=='N/A').map(r=>r.item.split(' ')[0]+':'+r.calif).join(' ');
      doc.text(e.fecha,M,y); doc.text(String(e.horas),M+20,y);
      doc.text((e.puesto||'').slice(0,18),M+30,y);
      doc.text(rub.slice(0,28),M+65,y);
      doc.text(e.firma_sup_at?'✔ '+e.firma_sup_at.slice(0,10):'—',M+110,y);
      doc.text(e.firma_alu_at?'✔ '+e.firma_alu_at.slice(0,10):'—',M+150,y);
      y += 5.5;
      doc.setDrawColor(200,210,220); doc.line(M,y,W-M,y); y += 1;
    });
  }

  // Firmas
  y = Math.max(y+12, 230);
  if (y > 265) { doc.addPage(); y = 30; }
  doc.setDrawColor(60,80,120);
  doc.line(M+10, y+10, M+60, y+10); doc.line(W/2+10, y+10, W/2+60, y+10);
  doc.setFontSize(8.5); doc.setTextColor(80,80,80);
  doc.text('Supervisor / Evaluador de terreno', M+10, y+15);
  doc.text('Director del Centro de Capacitación', W/2+10, y+15);

  doc.setFontSize(7.5); doc.setTextColor(120,120,120);
  doc.text(`Documento generado: ${_fmtFechaHora(new Date().toISOString())}`, M, 287);
  doc.text(`SINCA · PSA/ISSA · ${data.num_doc||''}`, W-M, 287, {align:'right'});

  doc.save(`ActaEPPT_${u.apellido}_${u.legajo}_${new Date().toISOString().slice(0,10)}.pdf`);
}

async function generateConstanciaEPPT(data) {
  if (!window.jspdf) { alert('jsPDF no disponible'); return; }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const W = 210, M = 18;

  try { doc.addImage('/img/psa.png', 'PNG', M, 10, 20, 20); } catch {}
  try { doc.addImage('/img/issa.png', 'PNG', W-M-20, 10, 20, 20); } catch {}
  doc.setFont('helvetica','bold'); doc.setFontSize(13); doc.setTextColor(20,40,80);
  doc.text('POLICÍA DE SEGURIDAD AEROPORTUARIA', W/2, 15, {align:'center'});
  doc.setFontSize(10); doc.setFont('helvetica','normal'); doc.setTextColor(60,80,120);
  doc.text('Instituto Superior de Seguridad Aeroportuaria (ISSA)', W/2, 21, {align:'center'});
  doc.setDrawColor(20,40,80); doc.setLineWidth(0.5); doc.line(M, 26, W-M, 26);

  doc.setFont('helvetica','bold'); doc.setFontSize(14); doc.setTextColor(10,80,10);
  doc.text('CONSTANCIA DE ACREDITACIÓN', W/2, 36, {align:'center'});
  doc.setFontSize(11); doc.setTextColor(20,40,80);
  doc.text('Entrenamiento Práctico en el Puesto de Trabajo (EPPT)', W/2, 44, {align:'center'});
  doc.setFontSize(10); doc.setTextColor(80,80,80);
  doc.text(`N°: ${data.num_doc || '—'}`, W/2, 51, {align:'center'});
  doc.line(M, 55, W-M, 55);

  let y = 65;
  const u = data.usuario; const ep = data.eppt; const c = data.curso;

  doc.setFont('helvetica','bold'); doc.setFontSize(11); doc.setTextColor(20,40,80);
  doc.text('SE CERTIFICA QUE:', M, y); y += 8;
  doc.setFont('helvetica','normal'); doc.setFontSize(11); doc.setTextColor(30,30,30);
  doc.text(`${u.rango ? u.rango + ' ' : ''}${u.apellido}, ${u.nombre}`, W/2, y, {align:'center'}); y+=6;
  doc.setFontSize(10);
  doc.text(`DNI: ${u.dni||'—'}  ·  Legajo: ${u.legajo}  ·  ${u.organismo||''}`, W/2, y, {align:'center'}); y+=5;
  doc.text(`${u.aeropuerto||''}${u.dependencia?' · '+u.dependencia:''}`, W/2, y, {align:'center'}); y+=10;

  doc.setFontSize(11);
  doc.text(`ha completado satisfactoriamente el Entrenamiento Práctico en el Puesto de Trabajo`, W/2, y, {align:'center'}); y+=6;
  doc.setFont('helvetica','bold');
  doc.text(ep.apendice, W/2, y, {align:'center'}); y+=7;
  doc.setFont('helvetica','normal');
  doc.text(`correspondiente al ${c.cod} — ${c.nombre}`, W/2, y, {align:'center'}); y+=7;
  const horasFirmadas = data.entries.reduce((s,e)=>s+(e.firma_sup_at&&e.firma_alu_at?e.horas:0),0);
  doc.text(`acreditando ${horasFirmadas} ${ep.tipo} de práctica efectiva con firma dual`, W/2, y, {align:'center'}); y+=7;
  doc.text(`en el período: ${data.entries[0]?.fecha||'—'} al ${data.entries[data.entries.length-1]?.fecha||'—'}`, W/2, y, {align:'center'}); y+=12;

  // Tabla de jornadas
  doc.setFont('helvetica','bold'); doc.setFontSize(10); doc.setTextColor(20,40,80);
  doc.text('REGISTRO DE JORNADAS:', M, y); y+=6;
  // Encabezados
  doc.setFillColor(20,40,80); doc.rect(M, y, W-2*M, 7, 'F');
  doc.setTextColor(255,255,255); doc.setFontSize(8);
  ['Fecha','Hs','Puesto','Supervisor (Legajo)','Firma Sup.','Conf. Alumno'].forEach((h,i)=>{
    const xs=[M+1,M+20,M+30,M+72,M+122,M+155]; doc.text(h,xs[i],y+5);
  });
  y+=9; doc.setTextColor(40,40,40); doc.setFont('helvetica','normal');

  data.entries.forEach((e,idx)=>{
    if (y>265){doc.addPage();y=20;}
    if (idx%2===0) { doc.setFillColor(245,248,255); doc.rect(M,y-1,W-2*M,6,'F'); }
    doc.text(e.fecha,M+1,y+3.5);
    doc.text(String(e.horas),M+20,y+3.5);
    doc.text((e.puesto||'').slice(0,20),M+30,y+3.5);
    doc.text((e.sup_apellido||'')+(e.sup_legajo?' ('+e.sup_legajo+')':''),M+72,y+3.5);
    doc.setTextColor(e.firma_sup_at?10:180, e.firma_sup_at?120:20, 10);
    doc.text(e.firma_sup_at?'✔ '+e.firma_sup_at.slice(0,10):'Pendiente',M+122,y+3.5);
    doc.setTextColor(e.firma_alu_at?10:180, e.firma_alu_at?120:20, 10);
    doc.text(e.firma_alu_at?'✔ '+e.firma_alu_at.slice(0,10):'Pendiente',M+155,y+3.5);
    doc.setTextColor(40,40,40); y+=6;
  });

  // Hashes de integridad
  y+=5; doc.setFont('helvetica','bold'); doc.setFontSize(9); doc.setTextColor(20,40,80);
  doc.text('INTEGRIDAD DOCUMENTAL (hashes de firma electrónica, Ley N° 25.506):', M, y); y+=5;
  doc.setFont('courier','normal'); doc.setFontSize(6); doc.setTextColor(80,80,80);
  data.entries.slice(0,8).forEach(e=>{
    if (y>278){doc.addPage();y=20;}
    if (e.firma_sup_hash) { const hashFull = e.firma_sup_hash||''; doc.setFontSize(5.5); doc.text(`${e.fecha} SHA-256: `, M, y); y+=3.5; doc.text(hashFull, M, y); y+=4.5; doc.setFontSize(7.5); }
  });

  // Firmas finales
  y=Math.max(y+8,240); if(y>270){doc.addPage();y=30;}
  const supervisores=[...new Set(data.entries.filter(e=>e.firma_sup_at).map(e=>e.sup_apellido+' ('+e.sup_legajo+')'))];
  const nSups=Math.min(supervisores.length,3);
  const colW=(W-2*M)/Math.max(nSups,1);
  for(let i=0;i<nSups;i++){
    const x=M+i*colW+colW*0.1;
    doc.line(x,y+8,x+colW*0.8,y+8);
    doc.setFontSize(8); doc.setTextColor(60,60,60);
    doc.text(supervisores[i].slice(0,24), x+colW*0.4, y+12, {align:'center'});
    doc.text('Supervisor AVSEC certificado', x+colW*0.4, y+16, {align:'center'});
  }
  // ── Bloque de firma electrónica del emisor del documento ──────────────
  const emisorPdf = API.user || {};
  const emisorNombrePdf = emisorPdf.apellido ? emisorPdf.apellido + ', ' + emisorPdf.nombre : 'Usuario no identificado';
  const emisorLegajoPdf = emisorPdf.legajo || '—';
  const emisionTs = _fmtFechaHora(new Date().toISOString());

  // Hash SHA-256 real del contenido del documento
  let firmaDocHash = 'no disponible';
  try {
    const base = [
      'EPPT_CONSTANCIA', u.legajo, emisorLegajoPdf, emisionTs,
      (data.num_doc||''),
      data.entries.map(e => e.id + '|' + (e.firma_sup_hash||'') + '|' + (e.firma_alu_hash||'')).join(';')
    ].join('|');
    const enc = new TextEncoder().encode(base);
    const buf = await crypto.subtle.digest('SHA-256', enc);
    firmaDocHash = Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,'0')).join('');
  } catch {}

  // Bloque visual de firma
  if (y > 225) { doc.addPage(); y = 20; }
  y += 10;
  doc.setFillColor(240,244,255); doc.setDrawColor(20,40,80); doc.setLineWidth(0.4);
  doc.rect(M, y, W-2*M, 33, 'FD');
  doc.setFontSize(8); doc.setFont('helvetica','bold'); doc.setTextColor(20,40,80);
  doc.text('FIRMA ELECTRÓNICA DEL EMISOR (Ley N° 25.506)', M+3, y+6);
  doc.setDrawColor(180,190,220); doc.setLineWidth(0.2); doc.line(M+2, y+8, W-M-2, y+8);
  doc.setFont('helvetica','normal'); doc.setTextColor(40,40,40); doc.setFontSize(7.5);
  doc.text('Emitido por: ' + emisorNombrePdf + '   ·   Legajo: ' + emisorLegajoPdf + '   ·   Rol: ' + (emisorPdf.role||'').toUpperCase(), M+3, y+14);
  doc.text('Fecha y hora de emisión: ' + emisionTs, M+3, y+20);
  doc.setFont('helvetica','bold'); doc.text('Hash SHA-256:', M+3, y+26);
  doc.setFont('courier','normal'); doc.setFontSize(6.5); doc.setTextColor(0,100,60);
  doc.text(firmaDocHash.slice(0,44), M+28, y+26);
  if (firmaDocHash.length > 44) doc.text(firmaDocHash.slice(44), M+28, y+30);

  doc.setFontSize(7); doc.setFont('helvetica','normal'); doc.setTextColor(120,120,120);
  doc.text(`Emitido: ${emisionTs} · SINCA · PSA/ISSA · ${data.num_doc||''}`, W/2, 294, {align:'center'});

  doc.save(`ConstanciaEPPT_${u.apellido}_${u.legajo}_${new Date().toISOString().slice(0,10)}.pdf`);
}
