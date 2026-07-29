/**
 * tests/load_proctor.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Prueba de carga: simula N exámenes supervisados en simultáneo,
 * donde cada uno escribe un evento de proctor cada CHECK_MS milisegundos
 * durante DURACION_S segundos — replicando exactamente la carga real del frontend.
 *
 * Mide: latencia p50/p95/p99, throughput (eventos/s), errores y bloqueos SQLITE_BUSY.
 *
 * Uso:
 *   node tests/load_proctor.js                   # corridas de 15, 30 y 50 exámenes
 *   node tests/load_proctor.js --concurrentes 20 # solo 20 exámenes
 *   node tests/load_proctor.js --dry-run          # muestra la config sin correr
 * ─────────────────────────────────────────────────────────────────────────────
 */

'use strict';

const http   = require('node:http');
const path   = require('node:path');
const fs     = require('node:fs');
const os     = require('node:os');
const crypto = require('node:crypto');

// ── Parámetros de la simulación ────────────────────────────────────────────
const CHECK_MS   = 700;   // intervalo real del proctor en el frontend (ms entre eventos)
const DURACION_S = 15;    // segundos que dura cada corrida (reducido para 300 simultáneos)
const ESCENARIOS = [50, 100, 200, 300]; // exámenes simultáneos a probar

// Solo tipos registrados en PROCTOR_WEIGHTS del servidor
const TIPOS_EVENTO = [
  'mirada_desviada',      // 15 pts — el más frecuente en un examen real
  'sin_rostro',           // 20 pts — alumno mira para costado
  'movimiento_erratico',  // 20 pts — cabeza nerviosa
  'posible_captura',      // 20 pts — pérdida de foco
  'salida_pestana',       // 15 pts — cambio de ventana
];

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const onlyN  = args.includes('--concurrentes')
  ? Number(args[args.indexOf('--concurrentes') + 1]) : null;

// ── Setup del servidor ─────────────────────────────────────────────────────
let baseUrl, server, db, stmts;

async function setupServidor() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sinca-load-'));
  process.env.DATA_DIR_OVERRIDE = tmpDir;

  // Limpiar caché por si se re-usa
  Object.keys(require.cache).forEach(k => {
    if (k.includes(path.sep + 'db.js') || k.includes(path.sep + 'server.js')) delete require.cache[k];
  });

  const imported = require('../server.js');
  db    = imported.db;
  stmts = imported.stmts;

  return new Promise((resolve, reject) => {
    server = http.createServer(imported.app);
    server.listen(0, '127.0.0.1', () => {
      baseUrl = `http://127.0.0.1:${server.address().port}`;
      resolve(tmpDir);
    });
    server.on('error', reject);
  });
}

function teardownServidor(tmpDir) {
  return new Promise(resolve => {
    server.close(() => {
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
      resolve();
    });
  });
}

// ── HTTP helper ────────────────────────────────────────────────────────────
function req(method, endpoint, body, token) {
  return new Promise((resolve, reject) => {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = 'Bearer ' + token;
    const data = body ? Buffer.from(JSON.stringify(body)) : null;
    if (data) headers['Content-Length'] = data.length;

    const u = new URL(baseUrl + endpoint);
    const r = http.request({ hostname: u.hostname, port: u.port, path: u.pathname,
      method, headers }, (res) => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(raw) }); }
        catch { resolve({ status: res.statusCode, body: raw }); }
      });
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

// ── Crear un alumno con sesión de proctor lista ────────────────────────────
async function crearAlumnoConProctor(i, courseId, admTok) {
  const legajo = `LOAD${String(i).padStart(4, '0')}`;
  const dniNum = (10000000 + i * 7 + 13) % 90000000 + 10000000;
  const dni    = String(dniNum);

  // Pre-autorizar DNI
  await req('POST', '/api/admin/dni-autorizados/bulk',
    { registros: [{ dni, organismo: 'PSA' }] }, admTok);

  // Registrar alumno
  const rr = await req('POST', '/api/register', {
    legajo, dni, nombre: 'Carga', apellido: 'Test',
    password: 'test1234', rango: 'Oficial'
  });
  if (!rr.body.token) throw new Error(`register ${legajo}: ${JSON.stringify(rr.body)}`);
  const token = rr.body.token;
  const userId = rr.body.user.id;

  // Inscribir al curso
  const ri = await req('POST', '/api/admin/enroll-direct',
    { user_id: userId, course_id: courseId }, admTok);
  if (!ri.body.enrollment_id) throw new Error(`enroll ${legajo}: ${JSON.stringify(ri.body)}`);

  // Abrir sesión de proctor
  const rp = await req('POST', '/api/proctor/start',
    { course_id: courseId, contexto: 'teorico' }, token);
  if (!rp.body.session_id) throw new Error(`proctor/start ${legajo}: ${JSON.stringify(rp.body)}`);

  return { token, sessionId: rp.body.session_id };
}

// ── Estadísticas ───────────────────────────────────────────────────────────
function percentil(arr, p) {
  const s = [...arr].sort((a, b) => a - b);
  const i = Math.ceil((p / 100) * s.length) - 1;
  return s[Math.max(0, i)];
}

function stats(latencias) {
  if (!latencias.length) return { p50: 0, p95: 0, p99: 0, min: 0, max: 0, avg: 0 };
  const sum = latencias.reduce((a, b) => a + b, 0);
  return {
    min:  Math.min(...latencias),
    avg:  Math.round(sum / latencias.length),
    p50:  percentil(latencias, 50),
    p95:  percentil(latencias, 95),
    p99:  percentil(latencias, 99),
    max:  Math.max(...latencias),
  };
}

// ── Corrida de un escenario ────────────────────────────────────────────────
async function correrEscenario(nConcurrentes) {
  process.stdout.write(`\n  Preparando ${nConcurrentes} alumnos...`);
  const t0Setup = Date.now();

  // Obtener el primer curso disponible
  const admR   = await req('POST', '/api/login', { usuario: 'eheinrich', password: '506065' });
  const admTok = admR.body.token;
  // GET /api/admin/courses — el token va en header, no en body
  const crR    = await req('GET', '/api/admin/courses', null, admTok);
  if (!crR.body.courses?.length) throw new Error('No hay cursos disponibles: ' + JSON.stringify(crR.body));
  const courseId = crR.body.courses[0].id;

  // Acumular alumnos entre escenarios: offset global para evitar colisiones de legajos
  if (!correrEscenario._offset) correrEscenario._offset = 0;
  const offset = correrEscenario._offset;
  correrEscenario._offset += nConcurrentes;

  // Crear alumnos en lotes de 20 para no saturar el servidor con 300 conexiones simultáneas
  const LOTE = 20;
  const alumnos = [];
  for (let base = 0; base < nConcurrentes; base += LOTE) {
    const fin = Math.min(base + LOTE, nConcurrentes);
    const lote = await Promise.all(
      Array.from({ length: fin - base }, (_, i) => crearAlumnoConProctor(offset + base + i + 1, courseId, admTok))
    );
    alumnos.push(...lote);
    process.stdout.write('.');
  }
  const setupMs = Date.now() - t0Setup;
  process.stdout.write(` OK (${setupMs}ms)\n`);

  // ── Fase de carga ──────────────────────────────────────────────────────
  process.stdout.write(`  Corriendo ${nConcurrentes} exámenes por ${DURACION_S}s...`);
  const latencias = [];
  let  totalOk    = 0;
  let  totalErr   = 0;
  let  sqliteBusy = 0;

  const t0Carga = Date.now();
  const finCarga = t0Carga + DURACION_S * 1000;

  // Cada alumno envía un evento por ciclo de CHECK_MS ms
  const trabajadores = alumnos.map(async ({ token, sessionId }, i) => {
    let tipoIdx = 0;
    while (Date.now() < finCarga) {
      const tIni = Date.now();
      // Alternar tipos de evento para simular comportamiento real
      const tipo = TIPOS_EVENTO[tipoIdx % TIPOS_EVENTO.length];
      tipoIdx++;
      try {
        const r = await req('POST', '/api/proctor/event',
          { session_id: sessionId, tipo, detalle: `sim ${i} t=${Date.now()}` },
          token
        );
        const lat = Date.now() - tIni;
        latencias.push(lat);
        if (r.status === 200) {
          totalOk++;
        } else {
          totalErr++;
          const msg = r.body?.error || String(r.body);
          if (msg.includes('SQLITE_BUSY') || msg.includes('database is locked')) sqliteBusy++;
        }
      } catch (e) {
        totalErr++;
        if (e.message.includes('SQLITE_BUSY') || e.message.includes('locked')) sqliteBusy++;
      }
      // Esperar hasta el próximo ciclo (descontando el tiempo de la request)
      const elapsed = Date.now() - tIni;
      const wait = Math.max(0, CHECK_MS - elapsed);
      if (wait > 0) await new Promise(r => setTimeout(r, wait));
    }
  });

  await Promise.all(trabajadores);
  const durRealMs = Date.now() - t0Carga;

  process.stdout.write(' OK\n');

  const throughput = ((totalOk + totalErr) / (durRealMs / 1000)).toFixed(1);
  const s = stats(latencias);

  return {
    nConcurrentes,
    duracionMs: durRealMs,
    totalEventos: totalOk + totalErr,
    totalOk, totalErr, sqliteBusy,
    throughput: parseFloat(throughput),
    latencias: s,
    tasaError: totalErr > 0 ? ((totalErr / (totalOk + totalErr)) * 100).toFixed(2) + '%' : '0.00%',
  };
}

// ── Tablas de resultados ───────────────────────────────────────────────────
function imprimirTabla(resultados) {
  const div = '─'.repeat(110);
  console.log('\n' + div);
  console.log('  RESULTADOS — PRUEBA DE CARGA DE PROCTOR SINCA');
  console.log(div);
  console.log(`  ${'Escenario'.padEnd(12)} ${'Eventos/s'.padEnd(11)} ${'Total evt'.padEnd(11)} ${'Errores'.padEnd(10)} ${'BUSY'.padEnd(7)} ${'lat min'.padEnd(9)} ${'p50'.padEnd(9)} ${'p95'.padEnd(9)} ${'p99'.padEnd(9)} ${'max ms'.padEnd(8)}`);
  console.log('  ' + '─'.repeat(107));
  resultados.forEach(r => {
    const flag = r.totalErr > 0 ? ' ⚠' : ' ✔';
    console.log(
      `  ${(r.nConcurrentes + ' exámenes').padEnd(12)} ` +
      `${String(r.throughput).padEnd(11)} ` +
      `${String(r.totalEventos).padEnd(11)} ` +
      `${(r.totalErr + ' (' + r.tasaError + ')').padEnd(10)} ` +
      `${String(r.sqliteBusy).padEnd(7)} ` +
      `${String(r.latencias.min + 'ms').padEnd(9)} ` +
      `${String(r.latencias.p50 + 'ms').padEnd(9)} ` +
      `${String(r.latencias.p95 + 'ms').padEnd(9)} ` +
      `${String(r.latencias.p99 + 'ms').padEnd(9)} ` +
      `${String(r.latencias.max + 'ms').padEnd(8)}` + flag
    );
  });
  console.log('  ' + '─'.repeat(107));
}

function imprimirDiagnostico(resultados) {
  const maxBusy   = Math.max(...resultados.map(r => r.sqliteBusy));
  const maxErrPct = Math.max(...resultados.map(r => parseFloat(r.tasaError)));
  const maxP99    = Math.max(...resultados.map(r => r.latencias.p99));
  const ultimoR   = resultados[resultados.length - 1];

  console.log('\n  DIAGNÓSTICO\n  ' + '─'.repeat(60));

  if (maxBusy === 0 && maxErrPct < 1 && maxP99 < 500) {
    console.log(`  ✔  SQLite en modo WAL aguanta la carga simulada sin problemas.`);
    console.log(`     Cero errores SQLITE_BUSY. p99 más alto: ${maxP99}ms.`);
    console.log(`     La instancia actual (proceso único + WAL) es adecuada para`);
    console.log(`     ${ultimoR.nConcurrentes} exámenes simultáneos en este hardware.`);
  } else if (maxBusy > 0 || maxErrPct >= 1) {
    console.log(`  ⚠  SQLite empieza a mostrar contención a partir de cierto escenario.`);
    console.log(`     SQLITE_BUSY acumulado: ${maxBusy}   tasa de error máxima: ${maxErrPct}%`);
  } else if (maxP99 >= 500) {
    console.log(`  ⚠  Las latencias p99 superan 500ms — posible contención de escritura.`);
  }

  console.log('\n  CONFIGURACIÓN ACTUAL DE SQLite');
  try {
    const jm  = db.prepare("PRAGMA journal_mode").get();
    const syn  = db.prepare("PRAGMA synchronous").get();
    const cs   = db.prepare("PRAGMA cache_size").get();
    const bs   = db.prepare("PRAGMA page_size").get();
    const mmm  = db.prepare("PRAGMA mmap_size").get();
    console.log(`     journal_mode : ${Object.values(jm)[0]}`);
    console.log(`     synchronous  : ${Object.values(syn)[0]}  (0=OFF 1=NORMAL 2=FULL)`);
    console.log(`     cache_size   : ${Object.values(cs)[0]} páginas`);
    console.log(`     page_size    : ${Object.values(bs)[0]} bytes`);
    console.log(`     mmap_size    : ${Object.values(mmm)[0]} bytes`);
  } catch {}

  console.log('\n  AJUSTES RECOMENDADOS (sin cambiar la BD)\n  ' + '─'.repeat(60));
  console.log(`
  Si la carga crece y aparecen errores SQLITE_BUSY, aplicar en db.js
  (sin migrar a otro motor):

    db.exec('PRAGMA journal_mode = WAL;');        // ya activo ✔
    db.exec('PRAGMA synchronous = NORMAL;');      // reducir fsync (era FULL)
    db.exec('PRAGMA cache_size = -32000;');       // 32 MB de caché de páginas
    db.exec('PRAGMA mmap_size = 536870912;');     // 512 MB mmap para lecturas
    db.exec('PRAGMA wal_autocheckpoint = 1000;'); // checkpoint cada 1000 páginas
    db.exec('PRAGMA busy_timeout = 5000;');       // esperar 5 s antes de SQLITE_BUSY

  El ajuste más impactante para escrituras concurrentes es busy_timeout:
  en vez de fallar con SQLITE_BUSY inmediato, el writer espera hasta que
  el lock se libere. Para la arquitectura de SINCA (proceso Node único,
  un pool de requests secuenciales por el event loop), esto es suficiente.
  `);

  console.log('  CUÁNDO MIGRAR A POSTGRESQL\n  ' + '─'.repeat(60));
  console.log(`
  Considerá PostgreSQL si:
    ✗ El servidor se despliega detrás de un balanceador (múltiples procesos Node)
    ✗ La tasa de errores SQLITE_BUSY supera 1% en producción
    ✗ Se necesitan > 100 exámenes simultáneos en hardware de servidor compartido
    ✗ Se requiere replicación o failover automático

  Esfuerzo estimado de migración (para un desarrollador familiarizado con el código):
  ┌──────────────────────────────────────────────────────────────────────────────┐
  │  Tarea                                        │ Esfuerzo estimado            │
  ├──────────────────────────────────────────────────────────────────────────────┤
  │  Reemplazar node:sqlite por pg (node-postgres) │ 1-2 días                    │
  │  Ajustar tipos de datos y sintaxis SQL         │ 2-3 días (timestamps, UPSERT│
  │                                                │ AUTOINCREMENT→SERIAL, etc.) │
  │  Reemplazar WAL/PRAGMA por pg.conf             │ 0.5 días                    │
  │  Migrar datos existentes (pg_dump / COPY)      │ 0.5 días                    │
  │  Tests de regresión                            │ 1 día                       │
  │  TOTAL                                         │ 5-7 días hábiles            │
  └──────────────────────────────────────────────────────────────────────────────┘

  El cambio más costoso es que node:sqlite usa la API síncrona de DatabaseSync
  (node:sqlite nativo de Node.js 22) mientras que pg es completamente asíncrono
  (Promises). Esto requiere agregar async/await a todos los handlers de server.js
  que actualmente son síncronos por diseño.

  Para el escenario actual (despliegue en un servidor único de la PSA o ISSA),
  SQLite con WAL y busy_timeout es la opción más simple y suficiente.
  `);
}

// ── Main ───────────────────────────────────────────────────────────────────
(async () => {
  const escenarios = onlyN ? [onlyN] : ESCENARIOS;

  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log('║      SINCA — PRUEBA DE CARGA: PROCTOR DE EXÁMENES       ║');
  console.log('╚══════════════════════════════════════════════════════════╝');
  console.log(`  Escenarios  : ${escenarios.join(', ')} exámenes simultáneos`);
  console.log(`  Duración    : ${DURACION_S} s por escenario`);
  console.log(`  Intervalo   : ${CHECK_MS} ms entre eventos (igual que el frontend real)`);
  console.log(`  Eventos     : ${TIPOS_EVENTO.join(', ')}`);

  if (dryRun) { console.log('\n  --dry-run: sin ejecutar.\n'); return; }

  let tmpDir;
  try {
    tmpDir = await setupServidor();
    console.log(`  Servidor    : ${baseUrl}\n`);

    const resultados = [];
    for (const n of escenarios) {
      console.log(`  ── Escenario: ${n} exámenes simultáneos ──`);
      const r = await correrEscenario(n);
      resultados.push(r);
      // Sin reseteo entre escenarios: el mismo servidor/BD acumula la carga de forma realista
    }

    imprimirTabla(resultados);
    imprimirDiagnostico(resultados);

    // Guardar JSON con resultados crudos
    const outPath = path.join(__dirname, '..', 'load_results.json');
    fs.writeFileSync(outPath, JSON.stringify({ timestamp: new Date().toISOString(), resultados }, null, 2));
    console.log(`\n  Resultados JSON guardados en: ${outPath}\n`);

  } catch (e) {
    console.error('\n  ERROR:', e.message, e.stack);
    process.exitCode = 1;
  } finally {
    if (tmpDir) await teardownServidor(tmpDir);
  }
})();
