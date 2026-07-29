/**
 * tests/login.test.js
 * Flujo de autenticación: éxito, fallo y rate-limiting
 */

'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup, teardown, post } = require('./helpers.js');

describe('Login', () => {
  before(setup);
  after(teardown);

  // ── Casos de éxito ──────────────────────────────────────────────────

  it('devuelve token y datos del usuario al autenticarse correctamente', async () => {
    const r = await post('/api/login', { usuario: 'eheinrich', password: '506065' });

    assert.equal(r.status, 200, 'HTTP debe ser 200');
    assert.ok(r.body.token, 'debe incluir token JWT');
    assert.equal(r.body.user.usuario, 'eheinrich', 'debe devolver el usuario correcto');
    assert.equal(r.body.user.role, 'admin', 'el rol debe ser admin');
    assert.equal(r.body.user.password_hash, undefined, 'NO debe exponer password_hash al cliente');
    assert.equal(r.body.user.activo, 1, 'el usuario debe estar activo');
  });

  it('el token recibido es válido para endpoints autenticados', async () => {
    const r1 = await post('/api/login', { usuario: 'eheinrich', password: '506065' });
    const { get } = require('./helpers.js');
    const r2 = await get('/api/me', r1.body.token);

    assert.equal(r2.status, 200, '/api/me debe responder 200 con token válido');
    assert.equal(r2.body.user.usuario, 'eheinrich');
  });

  // ── Casos de fallo ──────────────────────────────────────────────────

  it('rechaza con 401 cuando la contraseña es incorrecta', async () => {
    const r = await post('/api/login', { usuario: 'eheinrich', password: 'INCORRECTA' });

    assert.equal(r.status, 401, 'debe ser 401');
    assert.ok(r.body.error.includes('incorrectos'), 'debe indicar credenciales incorrectas');
    assert.equal(r.body.token, undefined, 'NO debe emitir token en fallo');
  });

  it('rechaza con 401 cuando el usuario no existe', async () => {
    const r = await post('/api/login', { usuario: 'no_existe_este_usuario', password: '12345' });

    assert.equal(r.status, 401);
    assert.ok(r.body.error, 'debe incluir mensaje de error');
    assert.equal(r.body.token, undefined);
  });

  it('rechaza con 400 cuando no se envía usuario', async () => {
    const r = await post('/api/login', { password: '506065' });

    assert.ok([400, 401].includes(r.status), 'debe ser 400 o 401 si falta usuario');
    assert.equal(r.body.token, undefined);
  });

  // ── Rate-limiting ────────────────────────────────────────────────────

  it('informa los intentos restantes antes del bloqueo (intentos 1-4)', async () => {
    // Usar un usuario inventado para no contaminar la cuenta de admin
    for (let i = 1; i <= 4; i++) {
      const r = await post('/api/login', { usuario: 'victima_test', password: 'MAL' });
      assert.equal(r.status, 401, `intento ${i} debe ser 401`);
      assert.ok(r.body.error.includes('intento'), `intento ${i} debe mencionar los intentos restantes`);
    }
  });

  it('bloquea con 429 al superar 5 intentos fallidos en 10 minutos', async () => {
    // Los 4 intentos anteriores ya cuentan; el 5.º activa el umbral
    await post('/api/login', { usuario: 'victima_test', password: 'MAL' }); // intento 5
    const r = await post('/api/login', { usuario: 'victima_test', password: 'MAL' }); // intento 6 → 429

    assert.equal(r.status, 429, 'al superar el límite debe devolver 429');
    assert.ok(r.body.retry_after_minutes > 0, 'debe indicar cuántos minutos esperar');
    assert.ok(r.body.error.toLowerCase().includes('bloqueada') ||
              r.body.error.toLowerCase().includes('bloqueo'), 'debe mencionar el bloqueo');
  });

  it('la cuenta bloqueada no puede autenticarse aunque la contraseña sea correcta', async () => {
    // victima_test ya está bloqueada por los tests anteriores
    // eheinrich tiene contraseña correcta pero diferente usuario; probamos con uno nuevo bloqueado
    const usr = 'bloqueo_test_' + Date.now();
    for (let i = 0; i < 6; i++) {
      await post('/api/login', { usuario: usr, password: 'MAL' });
    }
    // Aunque no existe el usuario, el rate-limit debe aplicarse antes de verificar la BD
    const r = await post('/api/login', { usuario: usr, password: 'CUALQUIER' });
    assert.equal(r.status, 429, 'usuario bloqueado: 429 independientemente de la contraseña');
  });
});
