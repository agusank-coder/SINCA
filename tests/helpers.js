/**
 * helpers.js — Infraestructura de test para SINCA
 *
 * Estrategia: BD real en carpeta temporal, servidor en puerto 0 asignado por el SO.
 * Cada suite llama setup()/teardown() en sus before/after.
 */

'use strict';

const http = require('node:http');
const path = require('node:path');
const fs   = require('node:fs');
const os   = require('node:os');

let _server, _baseUrl, _tmpDir, _app, _db, _stmts;

function setup() {
  _tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sinca-test-'));
  process.env.DATA_DIR_OVERRIDE = _tmpDir;

  // Limpiar caché para obtener instancia fresca con la BD temporal
  Object.keys(require.cache).forEach(k => {
    if (k.includes(path.sep + 'db.js') || k.includes(path.sep + 'server.js')) {
      delete require.cache[k];
    }
  });

  const imported = require('../server.js');
  _app   = imported.app;
  _db    = imported.db;
  _stmts = imported.stmts;

  return new Promise((resolve, reject) => {
    _server = http.createServer(_app);
    _server.listen(0, '127.0.0.1', () => {
      const { port } = _server.address();
      _baseUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
    _server.on('error', reject);
  });
}

function teardown() {
  return new Promise((resolve) => {
    if (!_server) return resolve();
    _server.close(() => {
      try { fs.rmSync(_tmpDir, { recursive: true, force: true }); } catch {}
      resolve();
    });
  });
}

/** Acceso a la BD temporal del servidor bajo test */
function getDb()    { return _db; }
function getStmts() { return _stmts; }

/** http.request wrapper — construye la URL completa y parsea JSON */
function req(method, endpoint, body, token) {
  const url     = _baseUrl + endpoint;
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = 'Bearer ' + token;
  const data = body ? Buffer.from(JSON.stringify(body)) : null;
  if (data) headers['Content-Length'] = data.length;

  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const r = http.request({
      hostname: u.hostname, port: u.port,
      path: u.pathname + u.search,
      method, headers
    }, (res) => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => {
        let json;
        try { json = JSON.parse(raw); } catch { json = raw; }
        resolve({ status: res.statusCode, body: json, headers: res.headers });
      });
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

const get  = (ep, token)       => req('GET',  ep, null, token);
const post = (ep, body, token) => req('POST', ep, body, token);

/** Token del administrador semilla (eheinrich / 506065) */
async function adminToken() {
  const r = await post('/api/login', { usuario: 'eheinrich', password: '506065' });
  if (!r.body.token) throw new Error('adminToken falló: ' + JSON.stringify(r.body));
  return r.body.token;
}

/**
 * Crear un usuario de prueba via /api/register y devolver { userId, token }.
 * Para roles distintos de 'estudiante', usa el endpoint de cambio de rol de admin.
 */
async function crearUsuarioPrueba(legajo, rol = 'estudiante') {
  const admTok = await adminToken();

  // Generar un DNI único basado en el legajo para evitar colisiones entre tests
  const dniUnico = String(Math.abs(legajo.split('').reduce((h,c)=>(h*31+c.charCodeAt(0))|0, 0)) % 90000000 + 10000000);

  // Pre-autorizar el DNI único
  await post('/api/admin/dni-autorizados/bulk',
    { registros: [{ dni: dniUnico, organismo: 'PSA' }] }, admTok);

  // Abrir el registro temporalmente para el test (se cierra en teardown)
  await post('/api/admin/settings/registro', { abierto: true }, admTok);

  // Registrar el usuario
  const rr = await post('/api/register', {
    legajo, dni: dniUnico, nombre: 'Test', apellido: 'Usuario',
    password: 'pass1234', rango: 'Oficial Mayor'
  });
  if (!rr.body.token) throw new Error(`crearUsuario(${legajo}) falló: ` + JSON.stringify(rr.body));

  if (rol !== 'estudiante') {
    await post(`/api/admin/users/${rr.body.user.id}/role`, { role: rol }, admTok);
    // Re-loguearse para obtener un token con el rol actualizado
    const relogin = await post('/api/login', { usuario: legajo, password: 'pass1234' });
    if (!relogin.body.token) throw new Error(`relogin(${legajo}) falló: ` + JSON.stringify(relogin.body));
    return { userId: rr.body.user.id, token: relogin.body.token };
  }
  return { userId: rr.body.user.id, token: rr.body.token };
}

/** Marcar todas las lecciones de un curso como completadas para un enrollment */
function completarLecciones(enrollmentId, courseId) {
  const db = getDb();
  // lesson_progress solo tiene (enrollment_id, lesson_id, completed_at)
  const stmt = db.prepare('INSERT OR IGNORE INTO lesson_progress (enrollment_id, lesson_id) VALUES (?, ?)');
  const lecciones = db.prepare('SELECT id FROM lessons WHERE course_id=?').all(courseId);
  lecciones.forEach(l => { try { stmt.run(enrollmentId, l.id); } catch {} });
}

module.exports = { setup, teardown, req, get, post, adminToken, crearUsuarioPrueba, getDb, getStmts, completarLecciones };
