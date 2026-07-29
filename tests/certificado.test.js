/**
 * tests/certificado.test.js
 * Emisión automática al aprobar, campos obligatorios, código único,
 * endpoint de descarga, anulación y control de acceso.
 *
 * Usa un curso sin EPPT para que el certificado se emita en el mismo acto de aprobar.
 * Ruta anulación: POST /api/admin/certificates/:id/anular  (id numérico, no code)
 */

'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup, teardown, post, get, adminToken, crearUsuarioPrueba, getDb, completarLecciones } = require('./helpers.js');

describe('Certificado', () => {
  before(setup);
  after(teardown);

  let admTok, alumnoTok, alumnoId, courseId, certCode, certId;

  before(async () => {
    admTok = await adminToken();
    const u = await crearUsuarioPrueba('CERT001');
    alumnoTok = u.token; alumnoId = u.userId;

    // Elegir dinámicamente un curso SIN EPPT (certifica directamente al aprobar)
    const db = getDb();
    const curso = db.prepare(
      "SELECT id FROM courses WHERE activo=1 AND cod NOT IN ('COD-PSA 001','COD-PSA 001/A','COD-PSA 002','COD-PSA 002/A','COD-PSA 008','COD-PSA 009') LIMIT 1"
    ).get();
    assert.ok(curso, 'debe existir al menos un curso activo sin EPPT');
    courseId = curso.id;

    // Inscribir y completar lecciones
    const ri = await post('/api/admin/enroll-direct', { user_id: alumnoId, course_id: courseId }, admTok);
    assert.ok(ri.body.ok || ri.body.enrollment_id);
    const enr = db.prepare('SELECT id FROM enrollments WHERE user_id=? AND course_id=? AND activo=1').get(alumnoId, courseId);
    completarLecciones(enr.id, courseId);
  });

  // ── Caso de éxito: emisión automática al aprobar ──────────────────────

  it('al aprobar el examen se emite el certificado automáticamente', async () => {
    // Obtener la sesión de examen
    const rq = await get(`/api/courses/${courseId}/quiz`, alumnoTok);
    assert.equal(rq.status, 200, `quiz falló: ${JSON.stringify(rq.body)}`);

    // Leer las respuestas correctas desde la BD del servidor
    const db = getDb();
    const qs = db.prepare('SELECT payload FROM quiz_sessions WHERE id=?').get(rq.body.session_id);
    const answers = JSON.parse(qs.payload).map(p => p.correcta);

    // Enviar respuestas y verificar aprobación con certificado
    const rs = await post(`/api/courses/${courseId}/quiz`,
      { session_id: rq.body.session_id, answers }, alumnoTok);
    // El quiz submit devuelve 201 (recurso creado: intento de examen + certificado)
    assert.equal(rs.status, 201, `submit debe ser 201 — ${JSON.stringify(rs.body)}`);
    assert.equal(rs.body.passed, true,           'debe aprobar');
    assert.ok(rs.body.certificate,               'debe emitirse el certificado automáticamente');
    assert.ok(rs.body.certificate.code,          'el certificado debe tener código');

    // El certificado llega en rs.body.certificate con todos sus campos
    certCode = rs.body.certificate?.code;
    certId   = rs.body.certificate?.id;
    assert.ok(certCode, `el server debe haber emitido certificate.code — body: ${JSON.stringify(rs.body)}`);
    assert.ok(certId,   `el server debe haber emitido certificate.id   — body: ${JSON.stringify(rs.body)}`);
  });

  // ── Campos obligatorios ────────────────────────────────────────────────

  it('el certificado emitido tiene todos los campos obligatorios en la BD', async () => {
    assert.ok(certCode, 'este test requiere que el anterior haya emitido el certificado');
    const cert = getDb().prepare('SELECT * FROM certificates WHERE code=?').get(certCode);

    assert.ok(cert,                          'debe existir en la BD');
    assert.ok(cert.code,                     'debe tener código único');
    assert.equal(cert.user_id, alumnoId,     'debe referenciar al alumno correcto');
    assert.equal(cert.course_id, courseId,   'debe referenciar al curso correcto');
    assert.ok(cert.score_pct != null,        'debe tener score_pct');
    assert.ok(cert.firma_hash?.length >= 32, 'debe tener hash SHA-256 de firma electrónica');
    assert.equal(cert.anulado, 0,            'no debe estar anulado recién emitido');
  });

  // ── Código único ──────────────────────────────────────────────────────

  it('el código del certificado es único en la BD (no se duplica)', async () => {
    assert.ok(certCode, 'requiere certCode del test de emisión');
    const n = getDb().prepare('SELECT COUNT(*) AS n FROM certificates WHERE code=?').get(certCode).n;
    assert.equal(n, 1, `el código debe aparecer exactamente 1 vez, encontrado: ${n}`);
  });

  // ── Endpoint de consulta ──────────────────────────────────────────────

  it('GET /api/certificates/:code devuelve los datos completos del certificado', async () => {
    assert.ok(certCode, 'requiere certCode');
    const r = await get(`/api/certificates/${certCode}`, alumnoTok);
    assert.equal(r.status, 200, `debe ser 200 — ${JSON.stringify(r.body)}`);
    assert.ok(r.body.certificate,                     'debe incluir el objeto certificate');
    assert.equal(r.body.certificate.code, certCode,  'el código debe coincidir');
  });

  it('GET /api/certificates/:code devuelve 404 para un código inexistente', async () => {
    const r = await get('/api/certificates/CERT-XXXX-NO-EXISTE-9999', alumnoTok);
    assert.equal(r.status, 404, 'debe ser 404 para código inexistente');
  });

  // ── Anulación ─────────────────────────────────────────────────────────

  it('el administrador puede anular un certificado indicando motivo', async () => {
    assert.ok(certId, 'requiere certId del test de emisión');
    // El endpoint recibe el id NUMÉRICO (no el code)
    const r = await post(`/api/admin/certificates/${certId}/anular`,
      { motivo: 'Prueba automatizada — test de anulación' }, admTok);
    assert.equal(r.status, 200, `anulación falló: ${JSON.stringify(r.body)}`);
    assert.ok(r.body.ok, 'debe confirmar la anulación con ok:true');

    // Verificar en BD
    const cert = getDb().prepare('SELECT anulado FROM certificates WHERE id=?').get(certId);
    assert.equal(cert.anulado, 1, 'debe quedar marcado anulado=1 en la BD');
  });

  it('el certificado anulado ya no aparece como vigente en /api/me del alumno', async () => {
    const me = await get('/api/me', alumnoTok);
    const vigentes = (me.body.certificates ?? []).filter(c => c.code === certCode && !c.anulado);
    assert.equal(vigentes.length, 0, 'el certificado anulado no debe aparecer como vigente');
  });

  // ── Control de acceso ─────────────────────────────────────────────────

  it('otro alumno no puede ver certificados ajenos en su /api/me', async () => {
    const otro = await crearUsuarioPrueba('CERT002');
    const me   = await get('/api/me', otro.token);
    const ajenos = (me.body.certificates ?? []).filter(c => c.code === certCode);
    assert.equal(ajenos.length, 0, 'otro alumno no debe ver certificados ajenos en /api/me');
  });
});
