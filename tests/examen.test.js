/**
 * tests/examen.test.js
 * Flujo de examen teórico — comportamiento real del servidor:
 * - GET  /api/courses/:id/quiz  → 200 + { session_id, questions }
 * - POST /api/courses/:id/quiz  → 201 + { score_pct, passed, certificate? }
 *   (el quiz genera una NUEVA sesión en cada GET — no es idempotente,
 *    lo que importa es que las sesiones no se puedan reutilizar)
 */

'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup, teardown, post, get, adminToken, crearUsuarioPrueba, getDb, completarLecciones } = require('./helpers.js');

let COURSE_ID;  // curso sin EPPT, determinado dinámicamente

describe('Examen teórico', () => {
  before(setup);
  after(teardown);

  let admTok;

  before(async () => {
    admTok = await adminToken();
    const db = getDb();
    const curso = db.prepare(
      "SELECT id FROM courses WHERE activo=1 AND cod NOT IN ('COD-PSA 001','COD-PSA 001/A','COD-PSA 002','COD-PSA 002/A','COD-PSA 008','COD-PSA 009') LIMIT 1"
    ).get();
    assert.ok(curso, 'debe existir al menos un curso activo sin EPPT');
    COURSE_ID = curso.id;
  });

  async function prepararAlumno(legajo) {
    const u  = await crearUsuarioPrueba(legajo);
    const ri = await post('/api/admin/enroll-direct', { user_id: u.userId, course_id: COURSE_ID }, admTok);
    assert.ok(ri.status === 201, `enroll-direct debe devolver 201, recibido: ${ri.status}`);
    completarLecciones(ri.body.enrollment_id, COURSE_ID);
    return u;
  }

  // ── Obtener examen ─────────────────────────────────────────────────────

  it('GET /api/courses/:id/quiz devuelve sesión con preguntas sin revelar la respuesta correcta', async () => {
    const alumno = await prepararAlumno('EXM001');
    const r = await get(`/api/courses/${COURSE_ID}/quiz`, alumno.token);

    assert.equal(r.status, 200,                           `debe ser 200 — ${JSON.stringify(r.body)}`);
    assert.ok(r.body.session_id,                          'debe incluir session_id');
    assert.ok(Array.isArray(r.body.questions),            'questions debe ser array');
    assert.ok(r.body.questions.length > 0,                'debe haber al menos una pregunta');
    assert.ok(r.body.questions[0].pregunta,               'cada pregunta debe tener enunciado');
    assert.ok(Array.isArray(r.body.questions[0].opciones),'cada pregunta debe tener opciones');
    assert.equal(r.body.questions[0].correcta, undefined, 'NO debe exponer la respuesta correcta al cliente');
  });

  it('cada sesión de examen tiene un session_id único (anti-replay por diseño)', async () => {
    const alumno = await prepararAlumno('EXM002');
    const r1 = await get(`/api/courses/${COURSE_ID}/quiz`, alumno.token);
    // Consumir la primera sesión
    await post(`/api/courses/${COURSE_ID}/quiz`,
      { session_id: r1.body.session_id, answers: r1.body.questions.map(() => 0) }, alumno.token);
    // El alumno desaprobó: puede pedir recuperatorio con nueva sesión
    const r2 = await get(`/api/courses/${COURSE_ID}/quiz`, alumno.token);
    assert.ok(r2.body.session_id, 'debe poder obtener una nueva sesión para el recuperatorio');
    assert.notEqual(r1.body.session_id, r2.body.session_id,
      'cada instancia de examen debe tener un session_id diferente');
  });

  it('alumno NO inscripto recibe error al intentar iniciar el examen', async () => {
    const sinInscripcion = await crearUsuarioPrueba('EXM003');
    const r = await get(`/api/courses/${COURSE_ID}/quiz`, sinInscripcion.token);
    assert.ok([400, 403, 404].includes(r.status),
      `debe recibir 400/403/404, recibido: ${r.status} — ${JSON.stringify(r.body)}`);
  });

  // ── Enviar respuestas ──────────────────────────────────────────────────

  it('respuestas CORRECTAS → aprobado, score >= nota_min, certificado emitido', async () => {
    const alumno = await prepararAlumno('EXM004');
    const rq = await get(`/api/courses/${COURSE_ID}/quiz`, alumno.token);
    assert.equal(rq.status, 200, `GET quiz falló: ${JSON.stringify(rq.body)}`);

    const db      = getDb();
    const qs      = db.prepare('SELECT payload FROM quiz_sessions WHERE id=?').get(rq.body.session_id);
    const answers = JSON.parse(qs.payload).map(p => p.correcta);

    const rs = await post(`/api/courses/${COURSE_ID}/quiz`,
      { session_id: rq.body.session_id, answers }, alumno.token);

    assert.equal(rs.status, 201,        `POST quiz debe devolver 201 — ${JSON.stringify(rs.body)}`);
    assert.equal(rs.body.passed, true,  'debe aprobar con respuestas correctas');
    assert.ok(rs.body.score_pct >= 60, 'score debe superar el umbral mínimo');
    assert.ok(rs.body.certificate,     'debe incluir el certificado emitido');
  });

  it('respuestas INCORRECTAS → desaprobado', async () => {
    const alumno = await prepararAlumno('EXM005');
    const rq = await get(`/api/courses/${COURSE_ID}/quiz`, alumno.token);
    assert.equal(rq.status, 200, `GET quiz falló: ${JSON.stringify(rq.body)}`);

    // Índice 99 es siempre inválido → incorrecto
    const answers = rq.body.questions.map(() => 99);
    const rs = await post(`/api/courses/${COURSE_ID}/quiz`,
      { session_id: rq.body.session_id, answers }, alumno.token);

    assert.equal(rs.status, 201);
    assert.equal(rs.body.passed, false, 'debe desaprobar con índices inválidos');
    assert.equal(rs.body.certificate ?? null, null, 'no debe emitir certificado si desaprobó');
  });

  it('no se puede reutilizar la misma session_id (anti-replay)', async () => {
    const alumno = await prepararAlumno('EXM006');
    const rq = await get(`/api/courses/${COURSE_ID}/quiz`, alumno.token);
    assert.equal(rq.status, 200, `GET quiz falló: ${JSON.stringify(rq.body)}`);

    const answers = rq.body.questions.map(() => 0);

    // Primer envío — debe ser aceptado
    const r1 = await post(`/api/courses/${COURSE_ID}/quiz`,
      { session_id: rq.body.session_id, answers }, alumno.token);
    assert.equal(r1.status, 201, `primer envío debe ser 201, recibido: ${r1.status}`);

    // Segundo envío con la misma sesión — debe rechazarse
    const r2 = await post(`/api/courses/${COURSE_ID}/quiz`,
      { session_id: rq.body.session_id, answers }, alumno.token);
    assert.ok([400, 403, 409].includes(r2.status),
      `reenvío con misma session_id debe rechazarse (400/403/409), recibido: ${r2.status} — ${JSON.stringify(r2.body)}`);
  });
});
