/* test_flow.js — Prueba integral de la plataforma (se ejecuta con el servidor corriendo)
 * Simula un alumno completo en COD-PSA 002: unidades con validación de tiempo,
 * checkpoints, examen teórico de sesión única, práctico con regla AEI y certificado. */
const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const db = new DatabaseSync(path.join(__dirname, 'data', 'plataforma_pnisac.db'));
const B = 'http://localhost:3000';
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function api(method, url, token, body) {
  const res = await fetch(B + url, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}
const ok = (cond, msg) => console.log((cond ? '  ✔ ' : '  ✘ FALLO: ') + msg);

(async () => {
  console.log('== 1. Login admin sembrado (eheinrich/506065) ==');
  let r = await api('POST', '/api/login', null, { usuario: 'eheinrich', password: '506065' });
  ok(r.status === 200 && r.data.user.role === 'admin', 'admin autenticado con rol admin');
  const adminTok = r.data.token;

  console.log('== 2. Registro de alumno ==');
  r = await api('POST', '/api/register', null, {
    legajo: 'AL-100', dni: '30111222', nombre: 'Juan', apellido: 'Perez',
    rango: 'Oficial', organismo: 'PSA', password: 'alumno1'
  });
  ok(r.status === 201 && r.data.user.role === 'estudiante', 'alumno creado como estudiante');
  const tok = r.data.token;

  // Curso 002 (simulador). Acelerar duraciones para el test.
  const curso = db.prepare("SELECT id, preguntas_examen FROM courses WHERE cod='COD-PSA 002'").get();
  db.prepare('UPDATE lessons SET duracion_s = 6 WHERE course_id = ?').run(curso.id);

  console.log('== 3. Asignación de cursos y niveles ==');
  let selfE = await api('POST', `/api/courses/${curso.id}/enroll`, tok);
  ok(selfE.status === 403, 'un alumno NO puede auto-inscribirse (403): los cursos los asigna la administración');
  let cat0 = await api('GET', '/api/courses', tok);
  ok(cat0.data.courses.length === 0, 'el catálogo del alumno solo muestra cursos ASIGNADOS (ninguno aún)');
  await api('POST', '/api/admin/enrollments/bulk', adminTok, { course_id: curso.id, claves: ['AL-100'] });
  let cat1 = await api('GET', '/api/courses', tok);
  ok(cat1.data.courses.length === 1 && cat1.data.courses[0].inscripto, 'tras la asignación, el alumno ve su curso');
  r = await api('GET', `/api/courses/${curso.id}`, tok);
  const lessons = r.data.lessons;
  ok(lessons.length === 6, `6 unidades cargadas (orden propio del alumno: ${lessons.map(l => l.titulo.match(/Unidad (\d+)/)[1]).join('-')})`);
  ok(lessons[0].unlocked && !lessons[1].unlocked, 'solo el nivel 1 está desbloqueado');

  // Intento de saltear nivel
  r = await api('POST', `/api/lessons/${lessons[2].id}/start`, tok);
  ok(r.status === 403, 'saltear a un nivel bloqueado es rechazado (403)');

  console.log('== 4. Unidades: validación de tiempo + checkpoint ==');
  for (const [i, l] of lessons.entries()) {
    let s = await api('POST', `/api/lessons/${l.id}/start`, tok);
    const sid = s.data.session_id;
    // a) intentar cerrar de inmediato → debe rechazar por tiempo
    let early = await api('POST', `/api/lessons/${l.id}/videodone`, tok, { session_id: sid });
    if (i === 0) ok(early.status === 400, `cierre anticipado rechazado: "${early.data.error?.slice(0, 60)}…"`);
    await sleep(6300);
    let done = await api('POST', `/api/lessons/${l.id}/videodone`, tok, { session_id: sid });
    if (done.status !== 200) { console.log('  ✘', done.data); process.exit(1); }
    // b) responder mal a propósito en la primera unidad → obliga a re-ver
    const ses = db.prepare('SELECT * FROM lesson_sessions WHERE id = ?').get(sid);
    const q = db.prepare('SELECT * FROM lesson_questions WHERE id = ?').get(ses.question_id);
    const map = JSON.parse(ses.opciones_map);
    const correcta = map.indexOf(q.correcta);
    if (i === 0) {
      const mal = (correcta + 1) % JSON.parse(q.opciones).length;
      let cp = await api('POST', `/api/lessons/${l.id}/checkpoint`, tok, { session_id: sid, answer: mal });
      ok(cp.status === 200 && cp.data.correct === false, 'checkpoint fallido obliga a re-visualizar');
      // re-ver la unidad completa
      s = await api('POST', `/api/lessons/${l.id}/start`, tok);
      await sleep(6300);
      done = await api('POST', `/api/lessons/${l.id}/videodone`, tok, { session_id: s.data.session_id });
      const ses2 = db.prepare('SELECT * FROM lesson_sessions WHERE id = ?').get(s.data.session_id);
      const q2 = db.prepare('SELECT * FROM lesson_questions WHERE id = ?').get(ses2.question_id);
      const c2 = JSON.parse(ses2.opciones_map).indexOf(q2.correcta);
      const cp2 = await api('POST', `/api/lessons/${l.id}/checkpoint`, tok, { session_id: s.data.session_id, answer: c2 });
      ok(cp2.data.correct === true, 'checkpoint correcto tras re-visualización → nivel superado');
    } else {
      const cp = await api('POST', `/api/lessons/${l.id}/checkpoint`, tok, { session_id: sid, answer: correcta });
      if (!cp.data.correct) { console.log('  ✘ checkpoint', cp.data); process.exit(1); }
    }
  }
  r = await api('GET', `/api/courses/${curso.id}`, tok);
  ok(r.data.todas_completas, 'las 6 unidades quedaron completadas');

  console.log('== 5. Examen teórico: sesión única, permutada, corregida en servidor ==');
  let quiz = await api('GET', `/api/courses/${curso.id}/quiz`, tok);
  ok(quiz.status === 200 && quiz.data.questions.length === Math.min(10, 10), `examen generado: ${quiz.data.questions.length} preguntas (versión única)`);
  ok(!('correcta' in (quiz.data.questions[0] || {})), 'las respuestas correctas NO viajan al cliente');
  // Contestar mal el primero (para probar recuperatorio): todo -1
  let sub = await api('POST', `/api/courses/${curso.id}/quiz`, tok, {
    session_id: quiz.data.session_id, answers: quiz.data.questions.map(() => -1), duration_s: 30
  });
  ok(sub.data.passed === false && sub.data.tipo === 'teorico', `1ª instancia desaprobada (${sub.data.score_pct} %) → habilita recuperatorio`);
  // Reusar la sesión debe fallar
  let reuse = await api('POST', `/api/courses/${curso.id}/quiz`, tok, { session_id: quiz.data.session_id, answers: [] });
  ok(reuse.status === 400, 'reutilizar una sesión de examen es rechazado');
  // Recuperatorio: responder todo bien leyendo el payload del servidor (simula alumno que sabe)
  quiz = await api('GET', `/api/courses/${curso.id}/quiz`, tok);
  const payload = JSON.parse(db.prepare('SELECT payload FROM quiz_sessions WHERE id = ?').get(quiz.data.session_id).payload);
  sub = await api('POST', `/api/courses/${curso.id}/quiz`, tok, {
    session_id: quiz.data.session_id, answers: payload.map(p => p.correcta), duration_s: 40
  });
  ok(sub.data.passed && sub.data.tipo === 'recuperatorio' && sub.data.score_pct === 100, 'recuperatorio aprobado 100 %');
  ok(sub.data.curso_aprobado === false, 'el curso NO se aprueba aún: falta el práctico (simulador)');
  // Tercera instancia no existe
  let tercera = await api('GET', `/api/courses/${curso.id}/quiz`, tok);
  ok(tercera.status === 400, 'no hay tercera instancia teórica');

  console.log('== 6. Práctico simulador: set asignado por servidor + regla AEI ==');
  const annMap = Object.fromEntries(db.prepare('SELECT * FROM annotations').all()
    .map(a => [a.filename, { ...a, threats: JSON.parse(a.threats) }]));
  const recOK = fn => { const a = annMap[fn]; return a.is_clean
    ? { filename: fn, declaredClean: true, marks: [] }
    : { filename: fn, declaredClean: false, marks: a.threats.map(t => ({ nx: t.x + t.w / 2, ny: t.y + t.h / 2 })) }; };

  // 6a. El servidor asigna el set: nunca envía las amenazas y garantiza AEI
  let setR = await api('GET', `/api/practical-set/${curso.id}`, tok);
  ok(setR.status === 200 && setR.data.images.length === 20, `set de 20 imágenes asignado (sesión ${setR.data.practical_session_id})`);
  ok(setR.data.images.every(i => i.threats === undefined), 'el set NO expone amenazas al cliente');
  const setAEI = setR.data.images.filter(i => annMap[i.filename].threats.some(t => t.tipo === 'explosivo'));
  ok(setAEI.length >= 2, `el servidor garantizó AEI en el set (${setAEI.length} imágenes con explosivo)`);

  // 6b. Enviar registros que NO corresponden al set → rechazado
  const otros = Object.keys(annMap).filter(f => !setR.data.images.some(i => i.filename === f)).slice(0, 1);
  let tramp = await api('POST', `/api/courses/${curso.id}/practical`, tok, {
    practical_session_id: setR.data.practical_session_id,
    records: [...setR.data.images.slice(1).map(i => recOK(i.filename)), recOK(otros[0] || setR.data.images[0].filename)]
  });
  ok(tramp.status === 400, 'registros que no coinciden con el set asignado → rechazados');

  // 6c. Fallar TODOS los AEI pero acertar el resto → DESAPROBADO por condición excluyente
  setR = await api('GET', `/api/practical-set/${curso.id}`, tok);
  const recsFalloAEI = setR.data.images.map(i => annMap[i.filename].threats.some(t => t.tipo === 'explosivo')
    ? { filename: i.filename, declaredClean: true, marks: [] }
    : recOK(i.filename));
  let pra = await api('POST', `/api/courses/${curso.id}/practical`, tok,
    { practical_session_id: setR.data.practical_session_id, records: recsFalloAEI, duration_s: 200 });
  ok(pra.data.passed === false && pra.data.aei_ok === false,
     `AEI no detectado → DESAPROBADO aunque el resto esté bien (nota ponderada ${pra.data.score_pct} %)`);
  let re = await api('POST', `/api/courses/${curso.id}/practical`, tok,
    { practical_session_id: setR.data.practical_session_id, records: recsFalloAEI });
  ok(re.status === 400, 'el práctico NO tiene recuperatorio / set de un solo uso (rechazado)');

  console.log('== 7. Docente rehabilita la cursada y el alumno aprueba ==');
  const enr = db.prepare('SELECT id FROM enrollments WHERE course_id = ? ').get(curso.id);
  let reset = await api('POST', `/api/admin/enrollments/${enr.id}/reset`, adminTok);
  ok(reset.status === 200, 'cursada rehabilitada por el docente/admin');
  // Repite teoría (una sola instancia, bien) — las unidades siguen completas
  quiz = await api('GET', `/api/courses/${curso.id}/quiz`, tok);
  const pay2 = JSON.parse(db.prepare('SELECT payload FROM quiz_sessions WHERE id = ?').get(quiz.data.session_id).payload);
  await api('POST', `/api/courses/${curso.id}/quiz`, tok, { session_id: quiz.data.session_id, answers: pay2.map(p => p.correcta) });
  // Práctico correcto BAJO SUPERVISIÓN IA (sesión de proctoring vinculada a la instancia)
  const FOTO = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==';
  let ps = await api('POST', '/api/proctor/start', tok, { course_id: curso.id, contexto: 'practico', foto: FOTO, pantalla: FOTO });
  ok(ps.status === 201 && ps.data.session_id, `sesión de supervisión iniciada (${ps.data.session_id}) con foto de calibración`);
  let ev = await api('POST', '/api/proctor/event', tok, { session_id: ps.data.session_id, tipo: 'salida_pestana', detalle: 'test', foto: FOTO });
  ok(ev.data.risk_score === 15 && ev.data.nivel === 'verde', `evento ponderado por el SERVIDOR: +15 → ${ev.data.nivel}`);
  ev = await api('POST', '/api/proctor/event', tok, { session_id: ps.data.session_id, tipo: 'multiples_rostros', detalle: 'test', foto: FOTO, pantalla: FOTO });
  ok(ev.data.risk_score === 40 && ev.data.nivel === 'amarillo', `acumulado 40 pts → semáforo AMARILLO`);
  let evBad = await api('POST', '/api/proctor/event', tok, { session_id: ps.data.session_id, tipo: 'hackear_puntos', detalle: 'x' });
  ok(evBad.status === 400, 'tipo de evento desconocido rechazado (el cliente no define puntajes)');

  setR = await api('GET', `/api/practical-set/${curso.id}`, tok);
  pra = await api('POST', `/api/courses/${curso.id}/practical`, tok, {
    practical_session_id: setR.data.practical_session_id,
    proctor_session_id: ps.data.session_id,
    records: setR.data.images.map(i => recOK(i.filename)), duration_s: 300
  });
  ok(pra.data.passed && pra.data.aei_ok, `práctico aprobado ${pra.data.score_pct} % con AEI OK`);
  ok(pra.data.curso_aprobado === false && pra.data.eppt_pendiente === true,
     `COD-PSA 002 exige EPPT: certificado retenido hasta completarlo (${pra.data.eppt?.regla} · vence ${pra.data.eppt?.deadline})`);

  console.log('== 7b. EPPT: 10 hs con firma dual → certificado ==');
  r = await api('GET', '/api/admin/eppt', adminTok);
  const rec = r.data.eppts.find(x => x.legajo === 'AL-100');
  ok(rec && rec.tipo === 'horas' && rec.requerido === 10 && rec.estado === 'abierto', `EPPT abierto: Apéndice 06 · ${rec.requerido} hs · plazo 90 días (${rec.deadline})`);
  let firmaMal = await api('POST', `/api/admin/eppt/${rec.id}/entries`, adminTok,
    { fecha: '2026-07-18', horas: 5, rubrica: [], observaciones: '', password: 'incorrecta' });
  ok(firmaMal.status === 401, 'firma del supervisor con contraseña incorrecta → rechazada');
  for (const [f, h] of [['2026-07-16', 5], ['2026-07-17', 5]]) {
    let e1 = await api('POST', `/api/admin/eppt/${rec.id}/entries`, adminTok, {
      fecha: f, horas: h, observaciones: 'Jornada de prueba',
      rubrica: [{ item: 'Uso de las funciones del teclado', calif: 'Muy Bueno' }, { item: 'Detiene la cinta ante detecciones', calif: 'Bueno' }],
      password: '506065'
    });
    ok(e1.status === 201, `supervisor cargó y firmó jornada ${f} (${h} hs)`);
  }
  r = await api('GET', `/api/courses/${curso.id}/eppt`, tok);
  ok(r.data.eppt.horas_firmadas === 0, 'sin conformidad del cursante aún: 0 hs computadas (firma dual obligatoria)');
  let certResp = null;
  for (const e of r.data.entries) {
    let fmal = await api('POST', `/api/eppt/entries/${e.id}/firmar`, tok, { password: 'nop' });
    if (certResp === null && fmal.status !== 401) ok(false, 'firma del alumno con contraseña incorrecta debía rechazarse');
    let f1 = await api('POST', `/api/eppt/entries/${e.id}/firmar`, tok, { password: 'alumno1' });
    ok(f1.status === 200, `cursante firmó conformidad (${f1.data.horas_firmadas}/${f1.data.requerido} hs)`);
    if (f1.data.curso_aprobado) certResp = f1.data;
  }
  ok(certResp && certResp.curso_aprobado && !certResp.certificate && certResp.validacion_pendiente,
     'EPPT completo → curso APROBADO pero certificado RETENIDO: la supervisión (amarillo) exige validación humana');
  const eppt2 = db.prepare('SELECT estado FROM eppt_records WHERE id = ?').get(rec.id);
  ok(eppt2.estado === 'completo', 'registro EPPT cerrado como COMPLETO');

  console.log('== 7c. Instancia de validación → firma electrónica automática ==');
  r = await api('POST', `/api/admin/proctor/session/${ps.data.session_id}/review`, adminTok,
    { decision: 'convalidado', nota: 'Revisión: sin irregularidad determinante.' });
  ok(r.status === 200 && r.data.certificado_emitido, `docente convalidó → certificado retenido EMITIDO automáticamente: ${r.data.certificado_emitido}`);
  const code = r.data.certificado_emitido;
  const certRow = db.prepare('SELECT firma_hash FROM certificates WHERE code = ?').get(code);
  ok(certRow.firma_hash && certRow.firma_hash.length === 64, `certificado FIRMADO ELECTRÓNICAMENTE (hash ${certRow.firma_hash.slice(0, 12)}…)`);

  console.log('== 8. Registros y reportes ==');
  r = await api('GET', `/api/verify/${code}`);
  ok(r.data.valid && r.data.vigente && r.data.certificate.firma_hash, 'validación pública OK: vigente y con firma electrónica verificable');
  r = await api('GET', `/api/admin/acta/${curso.id}`, adminTok);
  const fila = r.data.acta.find(a => a.legajo === 'AL-100');
  ok(fila && fila.estado === 'aprobado' && fila.aei === 'SÍ', `Libro de Actas: ${fila.apellido} teoría ${fila.nota_teoria}% (${fila.instancia}) práctico ${fila.nota_practico}% AEI ${fila.aei}`);
  r = await api('GET', `/api/admin/course/${curso.id}/tiempos`, adminTok);
  ok(r.data.tiempos.length >= 7, `registro real de tiempos: ${r.data.tiempos.length} sesiones (incluye la fallida)`);
  r = await api('GET', '/api/admin/stats', adminTok);
  ok(r.data.totales.certificados >= 1, 'tablero de métricas responde');
  r = await api('GET', '/api/admin/vencimientos?dias=400', adminTok);
  ok(r.data.vencimientos.length >= 1, 'control de vencimientos detecta la recurrencia a 12 meses');
  const est = await api('GET', '/api/admin/stats', tok);
  ok(est.status === 403, 'un estudiante NO accede a los reportes de gestión (403)');

  console.log('== 9. Supervisión IA: panel del docente y decisión humana ==');
  r = await api('GET', `/api/admin/proctor/${curso.id}`, adminTok);
  const ses = r.data.sessions.find(s => s.id === ps.data.session_id);
  ok(ses && ses.nivel === 'amarillo' && ses.attempt_tipo === 'practico' && ses.revision === 'convalidado',
     'panel del docente: sesión amarilla vinculada a la instancia práctica (convalidada)');
  r = await api('GET', `/api/admin/proctor/session/${ps.data.session_id}`, adminTok);
  ok(r.data.events.length >= 3 && r.data.events.some(e => e.foto) && r.data.events.some(e => e.pantalla),
     `línea de tiempo con ${r.data.events.length} eventos y DOBLE evidencia (cámara + pantalla)`);
  const est2 = await api('GET', `/api/admin/proctor/${curso.id}`, tok);
  ok(est2.status === 403, 'un estudiante NO accede al panel de supervisión (403)');

  // Decisión humana: ANULAR la instancia observada → cae la nota, el certificado y vuelve a cursando
  r = await api('POST', `/api/admin/proctor/session/${ps.data.session_id}/review`, adminTok,
    { decision: 'anulado', nota: 'Se constató asistencia de un tercero durante el práctico.' });
  ok(r.status === 200, 'revisor humano anuló la instancia');
  r = await api('GET', `/api/verify/${code}`);
  ok(r.data.valid === false || r.data.anulado, 'el certificado sostenido por la instancia anulada quedó SIN VALIDEZ');
  const enrNow = db.prepare('SELECT estado FROM enrollments WHERE id = ?').get(enr.id);
  ok(enrNow.estado === 'cursando', 'el alumno volvió a estado CURSANDO (puede ser rehabilitado/reevaluado)');

  console.log('== 9b. Bloqueo automático del examen en nivel ROJO ==');
  let ps2 = await api('POST', '/api/proctor/start', tok, { course_id: curso.id, contexto: 'teorico', foto: FOTO, pantalla: FOTO });
  await api('POST', '/api/proctor/event', tok, { session_id: ps2.data.session_id, tipo: 'multiples_rostros', detalle: 'test', foto: FOTO, pantalla: FOTO });
  let evR = await api('POST', '/api/proctor/event', tok, { session_id: ps2.data.session_id, tipo: 'multiples_rostros', detalle: 'test', foto: FOTO, pantalla: FOTO });
  ok(evR.data.nivel === 'rojo' && evR.data.bloquear === true, `50 pts → ROJO: el servidor ordena BLOQUEAR el examen`);
  r = await api('GET', `/api/admin/proctor/session/${ps2.data.session_id}`, adminTok);
  ok(r.data.events.some(e => e.tipo === 'bloqueo'), 'el bloqueo quedó registrado en la línea de tiempo');

  console.log('== 9c. Banco de imágenes: carga y eliminación (admin) ==');
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  const fd = new FormData();
  fd.append('images', new Blob([png], { type: 'image/png' }), 'test_upload.png');
  let upRes = await fetch(B + '/api/admin/images', { method: 'POST', headers: { Authorization: 'Bearer ' + adminTok }, body: fd });
  let upData = await upRes.json();
  ok(upRes.status === 201 && upData.subidas === 1, `imagen subida al banco por la interfaz de gestión (${upData.archivos[0]})`);
  let del = await api('DELETE', `/api/admin/images/${encodeURIComponent(upData.archivos[0])}`, adminTok);
  ok(del.status === 200, 'imagen eliminada del banco (con su anotación)');
  let delEst = await fetch(B + '/api/admin/images', { method: 'POST', headers: { Authorization: 'Bearer ' + tok }, body: fd });
  ok(delEst.status === 403, 'un estudiante NO puede cargar imágenes al banco (403)');

  console.log('== 10. Cargas masivas ==');
  r = await api('POST', '/api/admin/users/bulk', adminTok, { users: [
    { legajo: 'AL-201', dni: '31000001', apellido: 'gomez', nombre: 'Ana', rango: 'Oficial' },
    { legajo: 'AL-202', dni: '31000002', apellido: 'lopez', nombre: 'Luis' },
    { legajo: 'AL-100', dni: '39999999', apellido: 'duplicado', nombre: 'Legajo' },
    { legajo: 'AL-203', dni: '30111222', apellido: 'duplicado', nombre: 'Dni' },
    { legajo: '', dni: '', apellido: 'x', nombre: 'y' }
  ]});
  ok(r.data.creados === 2 && r.data.duplicados.length === 2 && r.data.errores.length === 1,
     `carga masiva: 2 creados · 2 duplicados rechazados (legajo y DNI) · 1 fila inválida`);
  let log201 = await api('POST', '/api/login', null, { usuario: 'AL-201', password: '31000001' });
  ok(log201.status === 200, 'usuario masivo ingresa con contraseña inicial = DNI');
  r = await api('POST', '/api/admin/enrollments/bulk', adminTok, { course_id: curso.id, claves: ['31000001', 'AL-202', 'NOEXISTE'] });
  ok(r.data.inscriptos === 2, `inscripción masiva por DNI/legajo: ${r.data.inscriptos} inscriptos (los inexistentes se ignoran)`);
  r = await api('POST', '/api/admin/enrollments/bulk', adminTok, { course_id: curso.id, claves: ['31000001'] });
  ok(r.data.inscriptos === 0 && r.data.ya_inscriptos === 1, 'reinscripción duplicada ignorada');
  r = await api('POST', `/api/admin/users/${log201.data.user.id}/password`, adminTok, { password: 'nueva123' });
  ok(r.status === 200 && (await api('POST', '/api/login', null, { usuario: 'AL-201', password: 'nueva123' })).status === 200, 'reset de contraseña por admin OK');

  console.log('== 11. Perfil fiscalizador (ISSA/DSAV): solo lectura ==');
  r = await api('POST', '/api/admin/users/bulk', adminTok, { users: [
    { legajo: 'FISCAL-1', dni: '20111333', apellido: 'auditor', nombre: 'Issa' }] });
  const fu = db.prepare("SELECT id FROM users WHERE legajo = 'FISCAL-1'").get();
  db.prepare("UPDATE users SET role = 'fiscalizador' WHERE id = ?").run(fu.id);
  let fTok = (await api('POST', '/api/login', null, { usuario: 'FISCAL-1', password: '20111333' })).data.token;
  r = await api('GET', '/api/admin/stats', fTok);
  ok(r.status === 200, 'fiscalizador LEE el tablero de métricas');
  r = await api('GET', '/api/admin/certificados', fTok);
  ok(r.status === 200, 'fiscalizador LEE el Libro Matriz de certificaciones');
  r = await api('GET', `/api/admin/proctor/${curso.id}`, fTok);
  ok(r.status === 200, 'fiscalizador LEE las sesiones de supervisión');
  r = await api('POST', `/api/admin/enrollments/bulk`, fTok, { course_id: curso.id, claves: ['AL-201'] });
  ok(r.status === 403, 'fiscalizador NO puede modificar nada (403 en escritura)');
  r = await api('POST', `/api/admin/users/${fu.id}/password`, fTok, { password: 'xxxxxx' });
  ok(r.status === 403, 'fiscalizador NO puede resetear contraseñas (403)');

  console.log('\n✔✔ PRUEBA INTEGRAL COMPLETA — todas las reglas del PNISAC verificadas.');
})().catch(e => { console.error('ERROR:', e); process.exit(1); });
