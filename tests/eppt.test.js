/**
 * tests/eppt.test.js
 * Flujo EPPT — rutas y estructura real del servidor
 * Ruta de carga: POST /api/admin/eppt/:id/entries (requiere password del supervisor)
 * Ruta de firma alumno: POST /api/eppt/entries/:id/firmar
 */

'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup, teardown, post, get, adminToken, crearUsuarioPrueba, getDb, completarLecciones } = require('./helpers.js');

describe('EPPT — Entrenamiento Práctico en el Puesto de Trabajo', () => {
  before(setup);
  after(teardown);

  let admTok, alumnoTok, alumnoId, supTok, courseId, epptRecId;

  before(async () => {
    admTok = await adminToken();

    const u = await crearUsuarioPrueba('EPP001');
    alumnoTok = u.token; alumnoId = u.userId;

    const s = await crearUsuarioPrueba('EPP002', 'supervisor');
    supTok = s.token;

    // Usar cualquier curso activo (el EPPT se puede abrir manualmente)
    const db = getDb();
    const curso = db.prepare('SELECT id FROM courses WHERE activo=1 LIMIT 1').get();
    assert.ok(curso, 'debe existir al menos un curso activo');
    courseId = curso.id;

    // Inscribir alumno
    const ri = await post('/api/admin/enroll-direct',
      { user_id: alumnoId, course_id: courseId }, admTok);
    assert.ok(ri.body.ok || ri.body.enrollment_id);

    // Crear el registro EPPT directamente en la BD (simula la apertura post-aprobación)
    const enr = db.prepare('SELECT id FROM enrollments WHERE user_id=? AND course_id=? AND activo=1').get(alumnoId, courseId);
    db.prepare(`INSERT OR IGNORE INTO eppt_records
      (enrollment_id, apendice, requerido, tipo, deadline, estado, ciclo)
      VALUES (?,?,?,?,?,?,1)`
    ).run(enr.id, 'Apéndice 05', 4, 'horas',
      new Date(Date.now() + 90*86400000).toISOString().slice(0,10), 'abierto');

    const rec = db.prepare('SELECT id FROM eppt_records WHERE enrollment_id=?').get(enr.id);
    assert.ok(rec, 'debe existir el registro de EPPT');
    epptRecId = rec.id;
  });

  it('GET /api/admin/eppt devuelve los EPPT pendientes del supervisor', async () => {
    const r = await get('/api/admin/eppt', supTok);
    assert.equal(r.status, 200);
    assert.ok(Array.isArray(r.body.eppts), 'debe devolver array de EPPTs');
  });

  it('el supervisor puede cargar una jornada de práctica con su contraseña', async () => {
    const hoy = new Date().toISOString().slice(0, 10);
    const r = await post(`/api/admin/eppt/${epptRecId}/entries`, {
      fecha: hoy,
      hora_inicio: '08:00', hora_fin: '12:00',
      puesto: 'Control de Acceso — Terminal A',
      horas: 4, rubrica: [], observaciones: 'Jornada de prueba',
      password: 'pass1234'
    }, supTok);
    assert.equal(r.status, 201, `debe responder 201, recibido: ${r.status} — ${JSON.stringify(r.body)}`);
    assert.ok(r.body.ok);
  });

  it('rechaza una jornada con fecha FUTURA', async () => {
    const pasado_manana = new Date(Date.now() + 2*86400000).toISOString().slice(0, 10);
    const r = await post(`/api/admin/eppt/${epptRecId}/entries`, {
      fecha: pasado_manana, hora_inicio: '08:00', hora_fin: '12:00',
      puesto: 'Test', horas: 4, rubrica: [], password: 'pass1234'
    }, supTok);
    assert.ok([400, 422].includes(r.status),
      `fecha futura debe rechazarse con 400/422, recibido: ${r.status}`);
    assert.ok(r.body.error, 'debe incluir mensaje de error');
  });

  it('rechaza la carga de jornada con contraseña incorrecta del supervisor', async () => {
    const ayer = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const r = await post(`/api/admin/eppt/${epptRecId}/entries`, {
      fecha: ayer, hora_inicio: '08:00', hora_fin: '12:00',
      puesto: 'Test', horas: 4, rubrica: [], password: 'INCORRECTA'
    }, supTok);
    assert.ok([400, 401, 403].includes(r.status),
      `contraseña incorrecta debe rechazarse, recibido: ${r.status}`);
  });

  it('el alumno puede firmar su conformidad en la jornada cargada', async () => {
    // Obtener la entry que existe (la cargada en el test anterior)
    const db = getDb();
    const entry = db.prepare(
      'SELECT id FROM eppt_entries WHERE eppt_id=? ORDER BY id DESC LIMIT 1'
    ).get(epptRecId);
    assert.ok(entry, 'debe existir al menos una jornada cargada');

    const r = await post(`/api/eppt/entries/${entry.id}/firmar`,
      { password: 'pass1234' }, alumnoTok);
    assert.equal(r.status, 200,
      `el alumno debe poder firmar, recibido: ${r.status} — ${JSON.stringify(r.body)}`);
    assert.ok(r.body.ok || r.body.horas_firmadas !== undefined, 'debe confirmar la firma');

    // Verificar que el hash quedó guardado en la BD
    const updated = db.prepare('SELECT firma_alu_hash FROM eppt_entries WHERE id=?').get(entry.id);
    assert.ok(updated.firma_alu_hash?.length >= 32, 'debe guardar el hash SHA-256 de la firma del alumno');
  });

  it('verifica que la firma del supervisor también está en la BD (firma dual)', async () => {
    const db = getDb();
    const entry = db.prepare(
      'SELECT firma_sup_hash, firma_alu_hash FROM eppt_entries WHERE eppt_id=? ORDER BY id DESC LIMIT 1'
    ).get(epptRecId);
    assert.ok(entry.firma_sup_hash?.length >= 32, 'debe tener hash SHA-256 del supervisor');
    assert.ok(entry.firma_alu_hash?.length >= 32, 'debe tener hash SHA-256 del alumno');
  });

  it('el alumno no puede firmar dos veces la misma jornada (doble firma rechazada)', async () => {
    const db = getDb();
    const entry = db.prepare(
      'SELECT id FROM eppt_entries WHERE eppt_id=? AND firma_alu_hash IS NOT NULL ORDER BY id DESC LIMIT 1'
    ).get(epptRecId);
    assert.ok(entry, 'debe existir una jornada ya firmada por el alumno');

    const r = await post(`/api/eppt/entries/${entry.id}/firmar`,
      { password: 'pass1234' }, alumnoTok);
    assert.ok([400, 409, 403].includes(r.status),
      `doble firma debe rechazarse, recibido: ${r.status}`);
    assert.ok(r.body.error);
  });

  it('otro alumno no puede firmar la jornada de un EPPT ajeno', async () => {
    const otro = await crearUsuarioPrueba('EPP003');
    const db = getDb();
    const entry = db.prepare(
      'SELECT id FROM eppt_entries WHERE eppt_id=? ORDER BY id ASC LIMIT 1'
    ).get(epptRecId);
    assert.ok(entry);

    const r = await post(`/api/eppt/entries/${entry.id}/firmar`,
      { password: 'pass1234' }, otro.token);
    assert.ok([400, 403, 404].includes(r.status),
      `otro alumno no debe poder firmar un EPPT ajeno, recibido: ${r.status}`);
  });
});
