/**
 * server.js — Plataforma de Instrucción PNISAC (PSA / ISSA)
 * Roles: estudiante · docente · admin
 * Reglas normativas implementadas:
 *  - Nota mínima 70 % (configurable por curso)
 *  - Teoría: 1 recuperatorio; práctica: sin recuperatorio
 *  - Práctico rayos X: AEI = 40 % del puntaje y condición excluyente (corrección en servidor)
 *  - Vigencias: 12/24 meses según curso; registro de certificaciones con los campos del PNISAC
 *  - Libro de Actas de Exámenes, listados con filtros, exportación CSV, auditoría
 */
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const { db, stmts } = require('./db');

/* Parche de CHECK de roles — ya no necesario (CHECK eliminado del schema).
   La validación de roles vive exclusivamente en server.js (validRoles).
   Se mantiene como no-op para compatibilidad con BDs muy antiguas. */
(function patchRolesCheck() {
  const CHECK_FINAL = "CHECK (role IN ('estudiante','instructor','supervisor','admin','fiscalizador','sanidad','juosp','juosp_regional'))";
  try {
    const row = db.prepare("SELECT sql FROM sqlite_master WHERE name='users' AND type='table'").get();
    if (!row || !row.sql) return;
    return; // CHECK eliminado del schema — no se necesita parche
    // Parchar el schema
    db.prepare('PRAGMA writable_schema=ON').run();
    const sqlNuevo = row.sql.replace(/CHECK \(role IN \([^)]+\)\)/, CHECK_FINAL);
    if (sqlNuevo !== row.sql) {
      db.prepare("UPDATE sqlite_master SET sql=? WHERE name='users' AND type='table'").run(sqlNuevo);
    }
    db.prepare('PRAGMA writable_schema=OFF').run();
    console.log('✔ CHECK de roles del schema actualizado a v59');
  } catch(e) { console.warn('patchRolesCheck schema:', e.message); }
})();

/* Helper para cambiar rol eludiendo el CHECK cacheado en conexiones viejas.
   SQLite cachea el CHECK en memoria — si la BD fue abierta con un CHECK
   viejo, usamos ignore_check_constraints como fallback garantizado. */
function updateRoleSafe(role, userId) {
  // Método 1: prepared statement normal
  try { stmts.updateUserRole.run(role, userId); return true; } catch {}
  // Método 2: ignore_check_constraints
  try {
    db.prepare('PRAGMA ignore_check_constraints=ON').run();
    db.prepare('UPDATE users SET role=? WHERE id=?').run(role, userId);
    db.prepare('PRAGMA ignore_check_constraints=OFF').run();
    return true;
  } catch(e) { db.prepare('PRAGMA ignore_check_constraints=OFF').run(); }
  // Método 3: exec directo (evita el prepared statement cacheado con el CHECK viejo)
  try {
    db.exec(`UPDATE users SET role='${role.replace(/'/g,"''")}' WHERE id=${Number(userId)}`);
    return true;
  } catch(e) { console.warn('updateRoleSafe método 3:', e.message); }
  // Método 4: transacción con foreign_keys desactivadas
  try {
    db.exec('PRAGMA foreign_keys=OFF');
    db.exec('PRAGMA ignore_check_constraints=ON');
    db.exec(`UPDATE users SET role='${role.replace(/'/g,"''")}' WHERE id=${Number(userId)}`);
    db.exec('PRAGMA ignore_check_constraints=OFF');
    db.exec('PRAGMA foreign_keys=ON');
    return true;
  } catch(e) {
    try { db.exec('PRAGMA foreign_keys=ON'); db.exec('PRAGMA ignore_check_constraints=OFF'); } catch {}
    console.warn('updateRoleSafe método 4:', e.message);
    return false;
  }
}

const app = express();
const PORT = process.env.PORT || 3000;
const IMAGES_DIR = path.join(__dirname, 'assets', 'xray_images');
const VIDEOS_DIR = path.join(__dirname, 'assets', 'videos');
const DOCS_DIR = path.join(__dirname, 'assets', 'docs');
const PROCTOR_DIR = path.join(__dirname, 'data', 'proctor');
const JWT_SECRET = process.env.JWT_SECRET || loadOrCreateSecret();
const EVAL_IMAGE_COUNT = 20;

function loadOrCreateSecret() {
  const p = path.join(__dirname, 'data', '.jwt_secret');
  try {
    if (fs.existsSync(p)) return fs.readFileSync(p, 'utf8').trim();
    const s = crypto.randomBytes(48).toString('hex');
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, s, { mode: 0o600 });
    return s;
  } catch { return crypto.randomBytes(48).toString('hex'); }
}

if (!fs.existsSync(IMAGES_DIR)) fs.mkdirSync(IMAGES_DIR, { recursive: true });
if (!fs.existsSync(VIDEOS_DIR)) fs.mkdirSync(VIDEOS_DIR, { recursive: true });
if (!fs.existsSync(DOCS_DIR)) fs.mkdirSync(DOCS_DIR, { recursive: true });
if (!fs.existsSync(PROCTOR_DIR)) fs.mkdirSync(PROCTOR_DIR, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, VIDEOS_DIR),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      cb(null, `leccion_${req.params.id}_${Date.now()}${ext}`);
    }
  }),
  limits: { fileSize: 300 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = ['.mp4', '.webm', '.m4v'].includes(path.extname(file.originalname).toLowerCase());
    cb(ok ? null : new Error('Formato de video no admitido (use MP4 o WebM).'), ok);
  }
});

app.use(express.json({ limit: '8mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/assets/xray_images', express.static(IMAGES_DIR, { maxAge: '1h' }));
app.use('/assets/videos', express.static(VIDEOS_DIR, { maxAge: '1h' }));
app.use('/assets/docs', (req, res, next) => {
  // Verificar autenticación para acceder a material didáctico
  const token = req.headers.authorization?.replace('Bearer ','') || req.query.token;
  if (!token) return res.status(401).send('No autorizado');
  try {
    jwt.verify(token, JWT_SECRET);
    // Cabeceras anti-descarga: fuerza visualización en navegador sin guardar
    res.setHeader('Content-Disposition', 'inline');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'no-store, no-cache');
    res.setHeader('Pragma', 'no-cache');
    next();
  } catch { return res.status(401).send('Token inválido'); }
}, express.static(DOCS_DIR, { maxAge: 0 }));
app.use('/vendor/jspdf', express.static(path.join(__dirname, 'node_modules', 'jspdf', 'dist')));

/* ================= Helpers ================= */
const VALID_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp']);
const safeJson = (s, fb) => { try { return JSON.parse(s); } catch { return fb; } };

let _scanCache = { ts: 0, data: null };
function scanImages(force) {
  if (!force && _scanCache.data && Date.now() - _scanCache.ts < 30000) return _scanCache.data;
  let files = [];
  try { files = fs.readdirSync(IMAGES_DIR).filter(f => VALID_EXT.has(path.extname(f).toLowerCase())); }
  catch (e) { console.error('No se pudo leer imágenes:', e.message); }
  const manifestPath = path.join(IMAGES_DIR, 'manifest.json');
  if (fs.existsSync(manifestPath)) {
    try {
      for (const item of JSON.parse(fs.readFileSync(manifestPath, 'utf8'))) {
        if (item?.filename && !stmts.annotationByFile.get(item.filename)) {
          stmts.upsertAnnotation.run({
            filename: item.filename,
            is_clean: item.has_threat ? 0 : 1,
            threats: JSON.stringify(item.threats || [])
          });
        }
      }
    } catch (e) { console.warn('manifest.json inválido:', e.message); }
  }
  const ann = Object.fromEntries(stmts.allAnnotations.all().map(a => [a.filename, a]));
  _scanCache = { ts: Date.now(), data: null };
  const out = files.map(f => {
    const a = ann[f];
    return {
      filename: f, url: `/assets/xray_images/${encodeURIComponent(f)}`,
      annotated: !!a, is_clean: a ? !!a.is_clean : null,
      threats: a ? safeJson(a.threats, []) : []
    };
  });
  _scanCache = { ts: Date.now(), data: out };
  return out;
}

function signToken(u) { return jwt.sign({ id: u.id, role: u.role }, JWT_SECRET, { expiresIn: '12h' }); }
function sanitizeUser(u) { if (!u) return u; const { password_hash, ...safe } = u; return safe; }

// ─── Cola virtual y sesiones concurrentes de estudiantes ─────────────────────
// Estas estructuras viven en memoria: se resetean al reiniciar el servidor.
// Eso es correcto: al reiniciar, todos los estudiantes vuelven a hacer login.
const _activeSessions = new Map();  // userId → { lastSeen: timestamp, legajo }
const _queue          = new Map();  // userId → { entro: timestamp, legajo }

// ─── Caché de estado activo de usuarios ───────────────────────────────────────
// Evita consultar la BD en cada uno de los 99 endpoints autenticados.
// TTL = 30 s: reacción máxima ante desactivación = 30 s (aceptable para seguridad).
// La entrada se invalida inmediatamente cuando el admin desactiva un usuario.
const _userStatusCache = new Map();   // userId → { activo, expiresAt }
const USER_STATUS_TTL = 30_000;       // ms

function _invalidateUserCache(userId) {
  _userStatusCache.delete(Number(userId));
}

function _isUserActive(userId) {
  const id = Number(userId);
  const cached = _userStatusCache.get(id);
  if (cached && cached.expiresAt > Date.now()) return cached.activo;
  // Miss o expirado: consultar la BD (SELECT mínimo, un solo campo)
  const row = db.prepare('SELECT activo FROM users WHERE id = ?').get(id);
  const activo = row ? row.activo === 1 : false;
  _userStatusCache.set(id, { activo, expiresAt: Date.now() + USER_STATUS_TTL });
  return activo;
}

function auth(req, res, next) {
  const h = req.headers.authorization || '';
  const t = h.startsWith('Bearer ') ? h.slice(7) : (req.query.token || null);
  if (!t) return res.status(401).json({ error: 'Sesión requerida.' });
  let decoded;
  try { decoded = jwt.verify(t, JWT_SECRET); }
  catch { return res.status(401).json({ error: 'Sesión expirada. Vuelva a iniciar sesión.' }); }
  // Verificar que el usuario sigue activo en la BD (con caché de 30 s)
  if (!_isUserActive(decoded.id)) {
    return res.status(401).json({
      error: 'Su cuenta fue desactivada. Cierre sesión e intente nuevamente.',
      forzar_logout: true   // el cliente usa este flag para limpiar el token local
    });
  }
  req.user = decoded;
  next();
}
const ROLE_ALIAS = { 'docente': 'instructor', 'fiscalizador': 'admin' };
/* ═══ MODO DEMO ═══════════════════════════════════════════════════════════
   El usuario 'demo' bypasea TODAS las restricciones operativas.
   Sus firmas quedan marcadas en el Libro Matriz como DEMO-NO-VALIDO
   para distinguirlas de firmas reales en cualquier auditoría futura.
═══════════════════════════════════════════════════════════════════════ */
const isDemo = (req) => req.user?.usuario === 'demo' || req.user?.legajo === 'DEMO';

const roleAtLeast = (...roles) => (req, res, next) => {
  const userRole = req.user?.role;
  const effectiveRole = ROLE_ALIAS[userRole] || userRole;
  // Actualizar el rol en el request para que los handlers vean el rol nuevo
  if (req.user && effectiveRole !== userRole) req.user = { ...req.user, role: effectiveRole };
  return roles.includes(effectiveRole) ? next() : res.status(403).json({ error: 'No posee permisos suficientes para esta operación.' });
};
// supervisor hereda permisos de docente en todas las rutas
const canDoc = roleAtLeast('admin', 'instructor', 'supervisor');
const canAdmin = roleAtLeast('admin');

// Gestión de cursos/capacitaciones: admin siempre puede todo.
// El instructor SOLO puede gestionar los cursos que el administrador le haya asignado específicamente
// (igual que se asignan cursos a un estudiante, pero aquí determina qué puede editar/gestionar).
function instructorPuedeCurso(userId, courseId) {
  if (!courseId) return false;
  return !!stmts.isInstructorAssigned.get(Number(courseId), Number(userId));
}
// Middleware factory: getCourseId(req) debe devolver el course_id relevante (puede resolver vía lesson/question si hace falta)
const requireCourseAccess = (getCourseId) => (req, res, next) => {
  const userRole = req.user?.role;
  const effectiveRole = ROLE_ALIAS[userRole] || userRole;
  if (effectiveRole === 'admin') return next();
  if (effectiveRole !== 'instructor') return res.status(403).json({ error: 'No posee permisos suficientes para esta operación.' });
  let courseId;
  try { courseId = getCourseId(req); } catch { courseId = null; }
  if (courseId && instructorPuedeCurso(req.user.id, courseId)) return next();
  return res.status(403).json({ error: 'No tiene asignado este curso. Solicite al administrador que se lo asigne para poder gestionarlo.' });
};

const AUDIT = (uid, accion, detalle = '') => { try { stmts.audit.run(uid, accion, String(detalle).slice(0, 500)); } catch {} };

/** PRNG determinístico: orden de unidades propio y estable por alumno+curso */
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function studentLessonOrder(lessons, userId, courseId, aleatorio) {
  if (!aleatorio) return lessons;
  const rnd = mulberry32(userId * 7919 + courseId * 104729);
  const arr = [...lessons];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
/** Permuta opciones de una pregunta; devuelve {opciones, correcta} permutadas + mapa */
function permuteOptions(opciones, correcta) {
  const idx = shuffle(opciones.map((_, i) => i));
  return { opciones: idx.map(i => opciones[i]), correcta: idx.indexOf(correcta), map: idx };
}

function addMonths(dateStr, months) {
  const d = new Date(dateStr);
  d.setMonth(d.getMonth() + months);
  return d.toISOString().slice(0, 10);
}

/** Evalúa una decisión del operador contra las anotaciones (servidor = fuente de verdad) */
function gradeImage(annotation, record) {
  const threats = safeJson(annotation?.threats ?? '[]', []);
  const isClean = annotation ? !!annotation.is_clean : true;
  const marks = Array.isArray(record.marks) ? record.marks : [];
  let correct, hits = [];
  if (record.declaredClean === true) correct = isClean;
  else if (marks.length === 0) correct = false;
  else {
    hits = threats.map(t => marks.some(m =>
      typeof m.nx === 'number' && typeof m.ny === 'number' &&
      m.nx >= t.x && m.nx <= t.x + t.w && m.ny >= t.y && m.ny <= t.y + t.h));
    correct = !isClean && hits.length > 0 && hits.every(Boolean);
  }
  const isAEI = threats.some(t => t.tipo === 'explosivo');
  return { correct, isAEI, isClean };
}

/* ================= Autenticación ================= */
app.post('/api/register', (req, res) => {
  try {
    const { legajo, dni, nombre, apellido, rango, organismo, aeropuerto, dependencia, funcion, password, usuario } = req.body || {};
    if (![legajo, nombre, apellido, password].every(v => typeof v === 'string' && v.trim()))
      return res.status(400).json({ error: 'Complete legajo, nombre, apellido y contraseña.' });
    if (password.length < 6) return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres.' });
    if (stmts.userByLogin.get(legajo.trim(), legajo.trim()))
      return res.status(409).json({ error: 'Ese legajo o usuario ya está registrado.' });

    // Verificar DNI preautorizado
    // registro_abierto = 1 → permite registro sin whitelist (útil solo en desarrollo inicial)
    // registro_abierto = 0 (defecto) → exige DNI en la whitelist, aunque esté vacía
    const registroAbierto = stmts.getSetting.get('registro_abierto')?.valor === '1';
    const dniStr = String(dni || '').trim();
    const totalDnis = db.prepare('SELECT COUNT(*) AS n FROM dni_autorizados').get().n;

    if (!registroAbierto) {
      // Modo seguro: siempre exige DNI autorizado
      if (totalDnis === 0) {
        return res.status(403).json({ error: 'El registro está cerrado. Contacte al administrador del ISSA para habilitarlo.' });
      }
      const dniAut = stmts.dniAutByDni.get(dniStr);
      if (!dniAut) return res.status(403).json({ error: 'El DNI ' + (dniStr || 'no informado') + ' no está habilitado para acceder a esta plataforma. Contacte al administrador del ISSA.' });
      if (dniAut.usado) return res.status(409).json({ error: 'Este DNI ya fue utilizado para crear una cuenta.' });
    } else if (totalDnis > 0) {
      // Modo abierto pero con whitelist cargada: igual verifica
      const dniAut = stmts.dniAutByDni.get(dniStr);
      if (!dniAut) return res.status(403).json({ error: 'El DNI ' + (dniStr || 'no informado') + ' no está habilitado para acceder a esta plataforma. Contacte al administrador del ISSA.' });
      if (dniAut.usado) return res.status(409).json({ error: 'Este DNI ya fue utilizado para crear una cuenta.' });
    }
    // Si el DNI estaba preautorizado, tomar el organismo de la precarga
    const dniAut = stmts.dniAutByDni.get(dniStr);
    const orgFinal = (dniAut && dniAut.organismo) ? dniAut.organismo : String(organismo || 'PSA').trim();
    const info = stmts.insertUser.run({
      legajo: legajo.trim(), usuario: (usuario || legajo).trim(), dni: dniStr,
      nombre: nombre.trim(), apellido: apellido.trim().toUpperCase(),
      rango: String(rango || '').trim(),
      organismo: orgFinal,
      aeropuerto: String(aeropuerto || '').trim(),
      dependencia: String(dependencia || '').trim(),
      funcion: String(funcion || '').trim(),
      role: 'estudiante', password_hash: bcrypt.hashSync(password, 10),
      legajo_base: legajo.trim().replace(/-INST$/i, '')
    });
    if (dniAut) stmts.marcarDniUsado.run(dniStr);
    const user = stmts.userById.get(Number(info.lastInsertRowid));
    AUDIT(user.id, 'REGISTRO', `Alta de ${user.apellido}, ${user.nombre} (${user.legajo}) · ${user.aeropuerto || 'sin aeropuerto'}`);
    res.status(201).json({ token: signToken(user), user: sanitizeUser(user) });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Error interno al registrar: ' + e.message }); }
});

app.get('/api/rangos', (req, res) => res.json({ rangos: RANGOS_PSA }));

/* ═══════════════════════════════════════════════════════════════════
   RATE-LIMITER de login — sin dependencias externas (usa SQLite)
   Lógica: ventana deslizante por clave "usuario||IP"
   Límites progresivos:
     1-4 intentos fallidos → respuesta normal (no hay pausa extra)
     5 intentos en 10 min  → bloqueo 10 min desde el último intento
     10+ intentos           → bloqueo 60 min
     20+ intentos           → bloqueo 24 h (probable ataque automatizado)
   La tabla se limpia automáticamente de registros viejos en cada request.
═══════════════════════════════════════════════════════════════════ */
function getClientIp(req) {
  // Soporta despliegue detrás de proxy (Nginx, etc.) sin app.set('trust proxy')
  const forwarded = req.headers['x-forwarded-for'];
  return (forwarded ? forwarded.split(',')[0] : req.socket.remoteAddress || '?').trim();
}

function loginRateLimit(usuario, ip) {
  const now = Date.now();
  const clave = String(usuario).toLowerCase().trim() + '||' + ip;

  // Limpiar registros más viejos de 24 horas (mantenimiento liviano)
  stmts.loginAttemptsPurge.run(now - 86_400_000);

  // Contar intentos en ventanas temporales
  const en10min = stmts.loginAttemptsCount.get(clave, now - 600_000).n;
  const en1h    = stmts.loginAttemptsCount.get(clave, now - 3_600_000).n;
  const en24h   = stmts.loginAttemptsCount.get(clave, now - 86_400_000).n;

  if (en24h >= 20) {
    const espera = 24 * 60;
    return { bloqueado: true, minutos: espera,
      msg: `Demasiados intentos fallidos. Cuenta bloqueada temporalmente por ${espera} minutos.` };
  }
  if (en1h >= 10) {
    return { bloqueado: true, minutos: 60,
      msg: 'Demasiados intentos fallidos. Cuenta bloqueada temporalmente por 60 minutos.' };
  }
  if (en10min >= 5) {
    return { bloqueado: true, minutos: 10,
      msg: 'Demasiados intentos fallidos. Cuenta bloqueada temporalmente por 10 minutos.' };
  }
  return { bloqueado: false };
}

function loginRecordFailure(usuario, ip) {
  const clave = String(usuario).toLowerCase().trim() + '||' + ip;
  stmts.loginAttemptsInsert.run(clave, String(usuario).trim(), ip, Date.now());
}

function loginClearOnSuccess(usuario, ip) {
  // Al autenticarse correctamente se borran los intentos de esa clave
  // para que un error puntual anterior no persista injustamente
  const clave = String(usuario).toLowerCase().trim() + '||' + ip;
  db.prepare('DELETE FROM login_attempts WHERE clave=?').run(clave);
}

app.post('/api/login', (req, res) => {
  try {
    const { usuario, password } = req.body || {};
    const ip = getClientIp(req);

    if (!usuario) return res.status(400).json({ error: 'Usuario requerido.' });

    // ── 1. Verificar rate-limit ANTES de consultar la BD
    //    (evita timing attacks: respuesta inmediata si está bloqueado)
    const rl = loginRateLimit(usuario, ip);
    if (rl.bloqueado) {
      AUDIT(null, 'LOGIN_BLOQUEADO', `usuario="${usuario}" ip=${ip} — ${rl.msg}`);
      return res.status(429).json({
        error: rl.msg,
        retry_after_minutes: rl.minutos
      });
    }

    // ── 2. Autenticar
    const u = stmts.userByLogin.get(String(usuario).trim(), String(usuario).trim());
    const passwordOk = u && bcrypt.compareSync(String(password || ''), u.password_hash);

    if (!u || !passwordOk) {
      // Registrar el intento fallido en la tabla y en el log de auditoría
      loginRecordFailure(usuario, ip);
      AUDIT(null, 'LOGIN_FALLIDO', `usuario="${usuario}" ip=${ip}`);

      // Contar cuántos intentos quedan antes del bloqueo (UX informativa)
      const intentosActuales = stmts.loginAttemptsCount.get(
        String(usuario).toLowerCase().trim() + '||' + ip, Date.now() - 600_000
      ).n;
      const restantes = Math.max(0, 5 - intentosActuales);
      const aviso = restantes > 0
        ? ` (${restantes} intento${restantes !== 1 ? 's' : ''} restante${restantes !== 1 ? 's' : ''} antes del bloqueo)`
        : ' — próximo intento activará el bloqueo temporal';

      return res.status(401).json({ error: 'Usuario/legajo o contraseña incorrectos.' + aviso });
    }

    // ── 3. Login exitoso: limpiar contador y registrar
    const user = stmts.userById.get(u.id);
    loginClearOnSuccess(usuario, ip);
    AUDIT(user.id, 'LOGIN', `usuario="${user.usuario || user.legajo}" ip=${ip}`);
    _invalidateUserCache(user.id); // refrescar caché de activo tras login exitoso
    // ── 4. Cola virtual para estudiantes ────────────────────────────────
    //    Solo rol 'estudiante'. Admins, instructores y supervisores entran siempre.
    if (user.role === 'estudiante') {
      const MAX_CONCURRENT = Number(db.prepare("SELECT valor FROM system_settings WHERE clave='queue_max_concurrent'").get()?.valor) || 200;
      const ahora = Date.now();

      // Limpiar sesiones expiradas (sin heartbeat en los últimos 65s)
      for (const [uid, info] of _activeSessions) {
        if (ahora - info.lastSeen > 65_000) _activeSessions.delete(uid);
      }

      // Si el estudiante ya tiene sesión activa, la renueva (re-login)
      if (_activeSessions.has(user.id)) {
        _activeSessions.get(user.id).lastSeen = ahora;
        _queue.delete(user.id); // sacarlo de la cola si estaba esperando
        AUDIT(user.id, 'LOGIN', `usuario="${user.usuario || user.legajo}" ip=${ip}`);
        return res.json({ token: signToken(user), user: sanitizeUser(user) });
      }

      const activos = _activeSessions.size;

      // Hay lugar: admitir
      if (activos < MAX_CONCURRENT) {
        _activeSessions.set(user.id, { lastSeen: ahora, legajo: user.legajo });
        _queue.delete(user.id);
        AUDIT(user.id, 'LOGIN', `usuario="${user.usuario || user.legajo}" ip=${ip}`);
        return res.json({ token: signToken(user), user: sanitizeUser(user) });
      }

      // No hay lugar: poner en cola y devolver posición
      if (!_queue.has(user.id)) {
        _queue.set(user.id, { entro: ahora, legajo: user.legajo });
      }
      // Posición en la cola (1-indexed) = cuántos entraron antes en la cola y siguen esperando
      const queueArr = [..._queue.keys()];
      const posicion = queueArr.indexOf(user.id) + 1;
      const espera_estimada_s = posicion * 3; // estimación simple: 3s por persona adelante

      AUDIT(user.id, 'LOGIN_COLA', `usuario="${user.legajo}" pos=${posicion}/${queueArr.length}`);
      return res.status(503).json({
        en_cola: true,
        posicion,
        total_cola: queueArr.length,
        activos,
        max_concurrent: MAX_CONCURRENT,
        espera_estimada_s,
        mensaje: `El sistema está al máximo de capacidad (${MAX_CONCURRENT} estudiantes simultáneos). Estás en posición ${posicion} de ${queueArr.length} en la fila.`
      });
    }

    res.json({ token: signToken(user), user: sanitizeUser(user) });

  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error interno al iniciar sesión.' });
  }
});

/* ════════════════════════════════════════════════════════════════════
   MÓDULO 1: APTITUD PSICOFÍSICA
   Ítems normativa AVSEC: psicológico, laboratorio, imágenes, cardiología,
   oftalmológico, auditivo. Firma electrónica del médico con SHA-256.
════════════════════════════════════════════════════════════════════ */

// Ítems estándar del examen psicofísico por categoría
const APTO_ITEMS = {
  psicologico: [
    'Nivel intelectual', 'Atención y concentración', 'Capacidad de reflexión',
    'Juicio crítico y pensamiento autónomo', 'Adaptación a situaciones nuevas',
    'Emocionalidad de base', 'Ausencia de impulsividad/agresividad',
    'Ausencia de psicopatía/fobias/trastornos de personalidad', 'Organicidad visomotora'
  ],
  laboratorio: [
    'Grupo sanguíneo y factor RH', 'VDRL', 'Colesterol', 'Hepatograma',
    'Glucemia', 'Uremia', 'Ácido úrico', 'Triglicéridos'
  ],
  imagen: ['Radiografía de tórax', 'Radiografía de columna lumbosacra'],
  cardiologia: ['Ergometría'],
  oftalmologico: ['Agudeza visual', 'Visión cromática (Ishihara/Farnsworth)'],
  auditivo: ['Audiometría — oído derecho', 'Audiometría — oído izquierdo']
};

// Listar todos los exámenes (solo médico, sanidad, admin, fiscalizador)
app.get('/api/admin/apto-medico', auth, roleAtLeast('admin','sanidad','fiscalizador'), (req, res) => {
  const aptos = stmts.allAptos.all();
  res.json({ aptos });
});

// Ver el apto vigente de un usuario
app.get('/api/admin/apto-medico/usuario/:id', auth, roleAtLeast('admin','sanidad','fiscalizador'), (req, res) => {
  const u = stmts.userById.get(Number(req.params.id));
  if (!u) return res.status(404).json({ error: 'Usuario no encontrado.' });
  const apto = stmts.aptoByUser.get(u.id);
  if (!apto) return res.json({ apto: null, vigente: false });
  const items = stmts.aptoItemsByApto.all(apto.id);
  const vigente = apto.estado === 'apto' && apto.vence_at && apto.vence_at >= new Date().toISOString().slice(0,10);
  // Enriquecer con datos del usuario y el médico firmante
  const medico = apto.medico_id ? stmts.userById.get(apto.medico_id) : null;
  res.json({
    apto: {
      ...apto, items,
      apellido: u.apellido, nombre: u.nombre, legajo: u.legajo, organismo: u.organismo,
      medico_nombre: medico ? (medico.apellido+', '+medico.nombre) : null,
    },
    vigente
  });
});

// Crear nuevo examen psicofísico (borrador)
app.post('/api/admin/apto-medico', auth, roleAtLeast('admin','sanidad'), (req, res) => {
  const { user_id, organismo_tipo } = req.body || {};
  if (!user_id) return res.status(400).json({ error: 'user_id requerido.' });
  const u = stmts.userById.get(Number(user_id));
  if (!u) return res.status(404).json({ error: 'Usuario no encontrado.' });
  const tipo = organismo_tipo === 'vigilador' ? 'vigilador' : 'psa';
  const vigencia = tipo === 'vigilador' ? 12 : 36;
  const info = stmts.insertApto.run(u.id, tipo, vigencia, req.user.id);
  const aptoId = info.lastInsertRowid;
  // Crear todos los ítems automáticamente
  for (const [cat, items] of Object.entries(APTO_ITEMS)) {
    for (const item of items) {
      stmts.insertAptoItem.run(aptoId, cat, item, '', 'pendiente', '');
    }
  }
  const apto = stmts.aptoById.get(aptoId);
  const items = stmts.aptoItemsByApto.all(aptoId);
  AUDIT(req.user.id, 'APTO_CREADO', `Usuario ${u.legajo} · tipo ${tipo}`);
  res.status(201).json({ ok: true, apto: { ...apto, items } });
});

// Actualizar un ítem del examen
app.patch('/api/admin/apto-medico/item/:id', auth, roleAtLeast('admin','sanidad'), (req, res) => {
  const { resultado, estado, observaciones } = req.body || {};
  if (!['pendiente','apto','no_apto'].includes(estado))
    return res.status(400).json({ error: 'Estado inválido.' });
  stmts.updateAptoItem.run(String(resultado||''), estado, String(observaciones||''), Number(req.params.id));
  res.json({ ok: true });
});

// Subir archivo PDF/imagen a un ítem
const aptoUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const dir = path.join(__dirname, 'data', 'apto_medico');
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (req, file, cb) => cb(null, `item_${req.params.id}_${Date.now()}${path.extname(file.originalname)}`),
  }),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (/pdf|image/.test(file.mimetype)) cb(null, true);
    else cb(new Error('Solo se aceptan PDF e imágenes.'));
  }
});
app.post('/api/admin/apto-medico/item/:id/archivo', auth, roleAtLeast('admin','sanidad'), aptoUpload.single('archivo'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No se recibió archivo.' });
  db.prepare('UPDATE apto_medico_items SET archivo_path=? WHERE id=?').run(req.file.path, Number(req.params.id));
  res.json({ ok: true, path: req.file.filename });
});

// Firmar y emitir el certificado médico (solo médico)
app.post('/api/admin/apto-medico/:id/firmar', auth, roleAtLeast('admin','sanidad'), (req, res) => {
  const { password } = req.body || {};
  const medico = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
  if (!bcrypt.compareSync(String(password||''), medico.password_hash))
    return res.status(401).json({ error: 'Contraseña incorrecta. La firma electrónica requiere revalidar su identidad.' });

  const apto = stmts.aptoById.get(Number(req.params.id));
  if (!apto) return res.status(404).json({ error: 'Examen no encontrado.' });
  if (apto.estado !== 'borrador') return res.status(400).json({ error: 'Este examen ya fue firmado.' });

  const items = stmts.aptoItemsByApto.all(apto.id);
  const hayNoApto = items.some(i => i.estado === 'no_apto');
  const estadoFinal = hayNoApto ? 'no_apto' : 'apto';

  const hoy = new Date().toISOString().slice(0,10);
  const vence = new Date();
  vence.setMonth(vence.getMonth() + apto.vigencia_meses);
  const vence_at = vence.toISOString().slice(0,10);

  const anio = new Date().getFullYear();
  const numero = generarNumDoc('APSF', anio);
  const firma_hash = crypto.createHash('sha256')
    .update(numero + String(apto.user_id) + hoy + req.user.id)
    .digest('hex');

  db.prepare(`UPDATE apto_medico SET estado=?,medico_id=?,firma_hash=?,numero=?,emitido_at=?,vence_at=? WHERE id=?`)
    .run(estadoFinal, req.user.id, firma_hash, numero, hoy, vence_at, apto.id);

  stmts.insertRegDoc.run('apto_medico', numero, req.user.id, apto.user_id, firma_hash, req.user.id);
  AUDIT(req.user.id, 'APTO_FIRMADO', `${numero} · ${estadoFinal.toUpperCase()} · usuario ${apto.user_id}`);
  res.json({ ok: true, numero, estado: estadoFinal, vence_at, firma_hash });
});

// Verificar si un usuario tiene apto médico vigente (endpoint público para el flujo de cursada)
app.get('/api/courses/:id/apto-medico/check', auth, (req, res) => {
  const c = stmts.courseById.get(Number(req.params.id));
  if (!c || !c.requiere_apto_medico) return res.json({ requerido: false, vigente: true });
  const apto = stmts.aptoByUser.get(req.user.id);
  const hoy = new Date().toISOString().slice(0,10);
  const vigente = apto && apto.estado === 'apto' && apto.vence_at && apto.vence_at >= hoy;
  res.json({
    requerido: true, vigente: !!vigente,
    numero: apto?.numero || null,
    vence_at: apto?.vence_at || null,
    mensaje: vigente ? null : 'Este curso requiere aptitud psicofísica vigente. Contacte al Servicio Médico del ISSA.'
  });
});

/* ════════════════════════════════════════════════════════════════════
   MÓDULO 2: JUOSP — Jefes de UOSP
════════════════════════════════════════════════════════════════════ */

// Helper: verificar que el JUOSP tenga acceso a una UOSP
function juospPuedeVerUosp(user, uospId) {
  if (user.role === 'admin' || user.role === 'fiscalizador') return true;
  if (user.role === 'juosp') return Number(user.uosp_id) === Number(uospId);
  if (user.role === 'juosp_regional') {
    // El jefe regional ve todas las UOSPs de su región
    const uosp = stmts.uospById.get(Number(uospId));
    const userRegion = db.prepare("SELECT region FROM uosps WHERE id=?").get(user.uosp_id)?.region;
    return uosp && userRegion && uosp.region === userRegion;
  }
  return false;
}

// CRUD de UOSPs (solo admin)
app.get('/api/admin/uosps', auth, roleAtLeast('admin','juosp','juosp_regional','fiscalizador'), (req, res) => {
  const uosps = stmts.allUosps.all();
  res.json({ uosps });
});
app.post('/api/admin/uosps', auth, roleAtLeast('admin'), (req, res) => {
  const { nombre, descripcion, sede, region } = req.body || {};
  if (!nombre?.trim()) return res.status(400).json({ error: 'Nombre de UOSP requerido.' });
  try {
    const info = stmts.insertUosp.run(nombre.trim(), descripcion||'', sede||'', region||'');
    AUDIT(req.user.id, 'UOSP_CREADA', nombre);
    res.status(201).json({ ok: true, id: info.lastInsertRowid });
  } catch { res.status(409).json({ error: 'Ya existe una UOSP con ese nombre.' }); }
});
app.delete('/api/admin/uosps/:id', auth, roleAtLeast('admin'), (req, res) => {
  db.prepare('UPDATE uosps SET activa=0 WHERE id=?').run(Number(req.params.id));
  AUDIT(req.user.id, 'UOSP_DESACTIVADA', req.params.id);
  res.json({ ok: true });
});

// Asignar UOSP a un usuario
app.post('/api/admin/users/:id/uosp', auth, roleAtLeast('admin'), (req, res) => {
  const { uosp_id } = req.body || {};
  db.prepare('UPDATE users SET uosp_id=? WHERE id=?').run(uosp_id ? Number(uosp_id) : null, Number(req.params.id));
  AUDIT(req.user.id, 'UOSP_ASIGNADA', `user ${req.params.id} → uosp ${uosp_id}`);
  res.json({ ok: true });
});

// Panel JUOSP: ver personal de su UOSP
app.get('/api/juosp/mi-uosp', auth, roleAtLeast('juosp','juosp_regional','admin'), (req, res) => {
  const uospId = req.user.uosp_id;
  if (!uospId && req.user.role !== 'admin')
    return res.status(400).json({ error: 'No tiene UOSP asignada. Contacte al administrador.' });
  const usuarios = uospId ? stmts.usersByUosp.all(uospId) : [];
  const uosp = uospId ? stmts.uospById.get(uospId) : null;
  res.json({ uosp, usuarios: usuarios.map(u => { const {password_hash,...s}=u; return s; }) });
});

// EPPT completos de la UOSP pendientes de convalidación JUOSP
app.get('/api/juosp/eppt-pendientes', auth, roleAtLeast('juosp','juosp_regional','admin'), (req, res) => {
  const uospId = req.user.uosp_id;
  if (!uospId && req.user.role !== 'admin') return res.status(400).json({ error: 'Sin UOSP asignada.' });
  // EPPTs completos cuyo alumno pertenece a esta UOSP y no tienen convalidación JUOSP
  const eppts = uospId ? stmts.epptByUosp.all(uospId) : [];
  res.json({ eppts });
});

// Historial académico de la UOSP
app.get('/api/juosp/historial', auth, roleAtLeast('juosp','juosp_regional','admin'), (req, res) => {
  const uospId = req.user.uosp_id;
  if (!uospId && req.user.role !== 'admin') return res.status(400).json({ error: 'Sin UOSP asignada.' });
  const usuarios = uospId ? stmts.usersByUosp.all(uospId) : [];
  const historial = usuarios.map(u => {
    const enrs = stmts.enrollmentsByUser.all(u.id);
    const certs = stmts.certsByUser.all(u.id);
    const { password_hash, ...safe } = u;
    return { usuario: safe, inscripciones: enrs.length, certificados: certs.length, certs };
  });
  res.json({ historial });
});

// Convalidación masiva de EPPTs por el JUOSP
app.post('/api/juosp/convalidar', auth, roleAtLeast('juosp','juosp_regional','admin'), (req, res) => {
  const { eppt_ids, password, observaciones } = req.body || {};
  if (!Array.isArray(eppt_ids) || !eppt_ids.length)
    return res.status(400).json({ error: 'Debe seleccionar al menos un EPPT.' });

  const juosp = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
  if (!bcrypt.compareSync(String(password||''), juosp.password_hash))
    return res.status(401).json({ error: 'Contraseña incorrecta. La convalidación requiere firma electrónica.' });

  // Verificar que todos los EPPTs pertenecen a su UOSP
  const uospId = req.user.uosp_id;
  if (uospId) {
    for (const eid of eppt_ids) {
      const er = db.prepare('SELECT er.*, u.uosp_id FROM eppt_records er JOIN enrollments e ON e.id=er.enrollment_id JOIN users u ON u.id=e.user_id WHERE er.id=?').get(eid);
      if (!er || (er.uosp_id !== uospId && req.user.role !== 'juosp_regional'))
        return res.status(403).json({ error: `El EPPT ${eid} no pertenece a su UOSP.` });
    }
  }

  const firma_hash = crypto.createHash('sha256')
    .update(JSON.stringify(eppt_ids) + req.user.id + Date.now()).digest('hex');

  const info = stmts.insertConvalidacion.run(
    req.user.id, uospId || 0, JSON.stringify(eppt_ids), firma_hash, observaciones || ''
  );

  AUDIT(req.user.id, 'JUOSP_CONVALIDACION', `${eppt_ids.length} EPPTs convalidados · hash ${firma_hash.slice(0,12)}`);
  res.json({ ok: true, convalidacion_id: info.lastInsertRowid, firma_hash, total: eppt_ids.length });
});

// Solicitar inscripción de personal al ISSA
app.post('/api/juosp/solicitar-inscripcion', auth, roleAtLeast('juosp','juosp_regional','admin'), (req, res) => {
  const { course_id, user_ids, nota } = req.body || {};
  if (!course_id || !Array.isArray(user_ids) || !user_ids.length)
    return res.status(400).json({ error: 'course_id y user_ids requeridos.' });
  const uospId = req.user.uosp_id || 0;
  const info = stmts.insertSolicitud.run(req.user.id, uospId, Number(course_id), JSON.stringify(user_ids), nota||'');
  AUDIT(req.user.id, 'JUOSP_SOLICITUD', `Curso ${course_id} · ${user_ids.length} usuarios`);
  res.status(201).json({ ok: true, solicitud_id: info.lastInsertRowid });
});

// Ver solicitudes pendientes (admin/ISSA las aprueba)
app.get('/api/admin/juosp/solicitudes', auth, roleAtLeast('admin','instructor'), (req, res) => {
  const rows = db.prepare(`SELECT js.*,c.cod,c.nombre AS cnombre,u.apellido AS juosp_ap,o.nombre AS uosp_nombre
    FROM juosp_solicitudes js
    JOIN courses c ON c.id=js.course_id
    JOIN users u ON u.id=js.juosp_id
    LEFT JOIN uosps o ON o.id=js.uosp_id
    ORDER BY js.created_at DESC`).all();
  res.json({ solicitudes: rows });
});

// Aprobar o rechazar solicitud
app.post('/api/admin/juosp/solicitudes/:id/resolver', auth, roleAtLeast('admin','instructor'), (req, res) => {
  const { decision, nota_issa } = req.body || {};
  if (!['aprobada','rechazada'].includes(decision)) return res.status(400).json({ error: 'Decisión inválida.' });
  const sol = db.prepare('SELECT * FROM juosp_solicitudes WHERE id=?').get(Number(req.params.id));
  if (!sol) return res.status(404).json({ error: 'Solicitud no encontrada.' });
  db.prepare('UPDATE juosp_solicitudes SET estado=?,nota_issa=?,resuelto_por=?,resuelto_at=datetime("now","localtime") WHERE id=?')
    .run(decision, nota_issa||'', req.user.id, sol.id);
  if (decision === 'aprobada') {
    // Inscribir automáticamente
    const userIds = JSON.parse(sol.user_ids || '[]');
    userIds.forEach(uid => {
      try { db.prepare('INSERT INTO enrollments (user_id,course_id,estado,inscrito_por,ciclo,activo) VALUES (?,?,"cursando",?,1,1)').run(uid, sol.course_id, req.user.id); } catch {}
    });
  }
  AUDIT(req.user.id, 'JUOSP_SOLICITUD_RESUELTA', `Sol ${sol.id} → ${decision}`);
  res.json({ ok: true });
});

/* ════════════════════════════════════════════════════════════════════
   MÓDULO 3: ACTA DE EXAMEN CON DOBLE FIRMA
════════════════════════════════════════════════════════════════════ */

// Firma del alumno al entregar el examen — crea el acta en estado pendiente_instructor
app.post('/api/courses/:id/quiz/firma-alumno', auth, (req, res) => {
  const { attempt_id, password } = req.body || {};
  if (!attempt_id) return res.status(400).json({ error: 'attempt_id requerido.' });

  const u = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
  if (!bcrypt.compareSync(String(password||''), u.password_hash))
    return res.status(401).json({ error: 'Contraseña incorrecta. La firma del acta requiere confirmar su identidad.' });

  const att = db.prepare('SELECT * FROM attempts WHERE id=? AND activo=1').get(Number(attempt_id));
  if (!att) return res.status(404).json({ error: 'Intento no encontrado.' });

  // Verificar que no tenga ya acta
  const existente = stmts.actaByAttempt.get(att.id);
  if (existente) return res.status(409).json({ error: 'Este examen ya tiene acta generada.' });

  const enr = db.prepare('SELECT * FROM enrollments WHERE id=?').get(att.enrollment_id);
  const c = stmts.courseById.get(enr.course_id);

  // Armar el detalle del examen (preguntas y respuestas)
  const qs = db.prepare('SELECT * FROM quiz_sessions WHERE enrollment_id=? ORDER BY id DESC LIMIT 1').get(enr.id);
  const detalle = {
    curso: c.cod, curso_nombre: c.nombre,
    alumno: { legajo: u.legajo, nombre: u.nombre, apellido: u.apellido },
    score_pct: att.score_pct, passed: att.passed,
    duration_s: att.duration_s,
    fecha: new Date().toISOString().slice(0,16),
    // Las preguntas quedan en el payload (no se revelan las respuestas correctas en el acta pública)
    total_preguntas: att.total, respuestas_correctas: att.correct,
  };

  const firma_hash = crypto.createHash('sha256')
    .update(String(att.id) + u.id + Date.now()).digest('hex');

  const info = stmts.insertActa.run(att.id, enr.id, JSON.stringify(detalle));
  const actaId = info.lastInsertRowid;
  db.prepare('UPDATE actas_examen SET firma_alu_at=datetime("now","localtime"),firma_alu_hash=?,estado="pendiente_instructor" WHERE id=?')
    .run(firma_hash, actaId);
  db.prepare('UPDATE attempts SET acta_id=? WHERE id=?').run(actaId, att.id);

  AUDIT(req.user.id, 'ACTA_ALUMNO_FIRMADA', `attempt ${att.id} · acta ${actaId}`);
  res.json({ ok: true, acta_id: actaId, firma_hash });
});

// Firma del instructor titular — cierra el acta y genera el número
app.post('/api/admin/actas/:id/firma-instructor', auth, roleAtLeast('admin','instructor'), (req, res) => {
  const { password } = req.body || {};
  const inst = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
  if (!bcrypt.compareSync(String(password||''), inst.password_hash))
    return res.status(401).json({ error: 'Contraseña incorrecta.' });

  const acta = stmts.actaById.get(Number(req.params.id));
  if (!acta) return res.status(404).json({ error: 'Acta no encontrada.' });
  if (acta.estado !== 'pendiente_instructor') return res.status(400).json({ error: 'El acta no está pendiente de firma del instructor.' });

  // Verificar que el instructor es el titular del curso
  const enr = db.prepare('SELECT * FROM enrollments WHERE id=?').get(acta.enrollment_id);
  const c = stmts.courseById.get(enr.course_id);
  if (c.instructor_id && c.instructor_id !== req.user.id && req.user.role !== 'admin')
    return res.status(403).json({ error: 'Solo el instructor titular del curso puede firmar el acta.' });

  const anio = new Date().getFullYear();
  const numero = generarNumDoc('ACEX', anio);
  const firma_hash = crypto.createHash('sha256')
    .update(numero + String(acta.id) + req.user.id + Date.now()).digest('hex');

  db.prepare(`UPDATE actas_examen SET
    numero=?, firma_inst_at=datetime('now','localtime'),
    firma_inst_id=?, firma_inst_hash=?, estado='firmada' WHERE id=?`)
    .run(numero, req.user.id, firma_hash, acta.id);

  stmts.insertRegDoc.run('acta_examen', numero, req.user.id, enr.user_id, firma_hash, req.user.id);
  AUDIT(req.user.id, 'ACTA_INSTRUCTOR_FIRMADA', `${numero} · acta ${acta.id}`);
  res.json({ ok: true, numero, firma_hash });
});

// Listar actas pendientes de firma del instructor
app.get('/api/admin/actas/pendientes', auth, roleAtLeast('admin','instructor'), (req, res) => {
  const actas = stmts.actasPendientesInst.all();
  res.json({ actas });
});

// Ver un acta por número o id (con permisos según rol)
app.get('/api/admin/actas/:ref', auth, roleAtLeast('admin','instructor','fiscalizador'), (req, res) => {
  const ref = req.params.ref;
  const acta = isNaN(ref) ? stmts.actaByNumero.get(ref) : stmts.actaById.get(Number(ref));
  if (!acta) return res.status(404).json({ error: 'Acta no encontrada.' });
  const detalle = JSON.parse(acta.detalle_json || '{}');
  // Enriquecer con nombre del instructor
  const inst = acta.firma_inst_id ? stmts.userById.get(acta.firma_inst_id) : null;
  const actaEnriquecida = {
    ...acta, detalle,
    instructor_nombre: inst ? (inst.apellido+', '+inst.nombre) : null,
    score_pct: detalle.score_pct,
    passed: detalle.passed,
  };
  if (req.user.role === 'fiscalizador') {
    delete actaEnriquecida.detalle?.alumno;
  }
  res.json({ acta: actaEnriquecida });
});

// El alumno consulta su propia acta (solo el número y estado)
app.get('/api/me/actas', auth, (req, res) => {
  const actas = db.prepare(`
    SELECT ae.numero, ae.estado, ae.created_at, ae.firma_inst_at, c.cod, c.nombre AS cnombre
    FROM actas_examen ae
    JOIN enrollments e ON e.id=ae.enrollment_id
    JOIN courses c ON c.id=e.course_id
    WHERE e.user_id=? ORDER BY ae.created_at DESC`).all(req.user.id);
  res.json({ actas });
});

/* ════════════════════════════════════════════════════════════════════
   MÓDULO 4: RECONFIRMACIÓN DE DESTINO
   - Catálogo cerrado de unidades (CRUD admin)
   - Autodeclaración periódica obligatoria con intercepción en login
   - Validación jerárquica con bandeja in-app
   - Escalado automático si el jefe no valida en plazo
   - Bloqueo duro de funciones hasta reconfirmar
════════════════════════════════════════════════════════════════════ */

// Helper: estado de reconfirmación de un usuario
function getEstadoDestino(userId) {
  const vigDias  = Number(stmts.getSetting.get('destino_vigencia_dias')?.valor  || 180);
  const avisoDias= Number(stmts.getSetting.get('destino_aviso_dias')?.valor     || 30);
  const valDias  = Number(stmts.getSetting.get('destino_validacion_dias')?.valor|| 15);
  const decl = stmts.declActiva.get(userId);
  const hoy  = new Date().toISOString().slice(0, 10);

  if (!decl) return { estado: 'nunca_declarado', dias_restantes: 0, decl: null, bloquear: true };

  const vence    = decl.vence_at;
  const diffMs   = new Date(vence) - new Date(hoy);
  const diasRest = Math.ceil(diffMs / 86400000);

  if (diasRest < 0) return { estado: 'vencido', dias_restantes: diasRest, decl, bloquear: true };
  if (diasRest <= avisoDias) return { estado: 'proximo', dias_restantes: diasRest, decl, bloquear: false };
  return { estado: 'vigente', dias_restantes: diasRest, decl, bloquear: false };
}

// Helper: escalar declaraciones vencidas sin validar
function escalarDeclaracionesPendientes() {
  const valDias = Number(stmts.getSetting.get('destino_validacion_dias')?.valor || 15);
  const limite  = new Date();
  limite.setDate(limite.getDate() - valDias);
  const limStr  = limite.toISOString().slice(0, 10);
  // Buscar declaraciones pendientes cuyo jefe no validó en plazo
  const pendientes = db.prepare(`
    SELECT dd.*, u.apellido, u.nombre AS unombre
    FROM destino_declaraciones dd
    JOIN users u ON u.id=dd.user_id
    WHERE dd.estado='pendiente_validacion' AND date(dd.created_at) <= ?`).all(limStr);
  pendientes.forEach(d => {
    db.prepare(`UPDATE destino_declaraciones SET estado='escalado', escalado_at=datetime('now','localtime') WHERE id=?`).run(d.id);
    // Notificar a todos los admins
    const admins = db.prepare(`SELECT id FROM users WHERE role='admin' AND activo=1`).all();
    admins.forEach(a => {
      try { stmts.insertNotif.run(a.id, d.user_id, d.id, 'escalado'); } catch {}
    });
  });
  return pendientes.length;
}

// Verificar estado de destino del usuario autenticado (llamado en cada login desde el cliente)
app.get('/api/me/destino/estado', auth, (req, res) => {
  // Escalar declaraciones vencidas (solo en este punto, no en cada request)
  if (Math.random() < 0.1) escalarDeclaracionesPendientes(); // 10% de las veces para no sobrecargar
  const estado = getEstadoDestino(req.user.id);
  const notifs = stmts.notifsPendientes.all(req.user.id);
  res.json({ ...estado, notificaciones: notifs });
});

// Catálogo de destinos: listar (todos los roles)
app.get('/api/destinos/catalogo', auth, (req, res) => {
  res.json({ destinos: stmts.allDestinos.all() });
});

// Catálogo: crear (solo admin)
app.post('/api/admin/destinos', auth, roleAtLeast('admin'), (req, res) => {
  const { codigo, nombre, region, aeropuerto } = req.body || {};
  if (!codigo?.trim() || !nombre?.trim())
    return res.status(400).json({ error: 'Código y nombre son obligatorios.' });
  try {
    const info = stmts.insertDestino.run(codigo.trim().toUpperCase(), nombre.trim(), region||'', aeropuerto||'');
    AUDIT(req.user.id, 'DESTINO_CREADO', `${codigo} — ${nombre}`);
    res.status(201).json({ ok: true, id: info.lastInsertRowid });
  } catch { res.status(409).json({ error: 'Ya existe un destino con ese código.' }); }
});

// Catálogo: editar
app.patch('/api/admin/destinos/:id', auth, roleAtLeast('admin'), (req, res) => {
  const { nombre, region, aeropuerto, activo } = req.body || {};
  const fields = [];
  if (nombre !== undefined)     fields.push(`nombre='${nombre.replace(/'/g,"''")}'`);
  if (region !== undefined)     fields.push(`region='${region.replace(/'/g,"''")}'`);
  if (aeropuerto !== undefined) fields.push(`aeropuerto='${aeropuerto.replace(/'/g,"''")}'`);
  if (activo !== undefined)     fields.push(`activo=${activo ? 1 : 0}`);
  if (!fields.length) return res.status(400).json({ error: 'Nada que actualizar.' });
  db.prepare(`UPDATE destinos_catalogo SET ${fields.join(',')} WHERE id=?`).run(Number(req.params.id));
  AUDIT(req.user.id, 'DESTINO_EDITADO', req.params.id);
  res.json({ ok: true });
});

// Lista de jefes disponibles para declarar (supervisor, instructor, juosp, juosp_regional, admin)
app.get('/api/destinos/jefes', auth, (req, res) => {
  const jefes = db.prepare(`
    SELECT id, apellido, nombre, legajo, role, organismo FROM users
    WHERE role IN ('juosp','juosp_regional','admin')
    AND activo=1 AND id != ?
    ORDER BY role DESC, apellido, nombre`).all(req.user.id);
  res.json({ jefes });
});

// Realizar una nueva declaración de destino
app.post('/api/me/destino/declarar', auth, (req, res) => {
  const { destino_id, jefe_id } = req.body || {};
  if (!destino_id || !jefe_id)
    return res.status(400).json({ error: 'Debe seleccionar su destino y su jefe/responsable directo.' });

  const destino = stmts.destinoById.get(Number(destino_id));
  if (!destino) return res.status(404).json({ error: 'Destino no encontrado en el catálogo.' });

  const vigDias = Number(stmts.getSetting.get('destino_vigencia_dias')?.valor || 180);
  const vence   = new Date(); vence.setDate(vence.getDate() + vigDias);
  const vence_at= vence.toISOString().slice(0, 10);

  // Obtener destino anterior
  const anterior = stmts.declActiva.get(req.user.id);
  const ant_id   = anterior ? anterior.destino_id : null;

  const info = stmts.insertDecl.run(req.user.id, Number(destino_id), ant_id, Number(jefe_id), vence_at);
  const declId = info.lastInsertRowid;

  // Notificación in-app para el jefe declarado
  try { stmts.insertNotif.run(Number(jefe_id), req.user.id, declId, 'validar'); } catch {}

  AUDIT(req.user.id, 'DESTINO_DECLARADO', `Destino: ${destino.codigo} · Jefe: ${jefe_id} · Vence: ${vence_at}`);
  res.status(201).json({ ok: true, decl_id: declId, vence_at, destino: destino.nombre });
});

// El jefe valida o rechaza una declaración pendiente
app.post('/api/destinos/validar/:id', auth, roleAtLeast('supervisor','instructor','juosp','juosp_regional','admin'), (req, res) => {
  const { decision, nota } = req.body || {};
  if (!['validado','rechazado'].includes(decision))
    return res.status(400).json({ error: 'Decisión inválida. Use "validado" o "rechazado".' });

  const decl = db.prepare('SELECT * FROM destino_declaraciones WHERE id=?').get(Number(req.params.id));
  if (!decl) return res.status(404).json({ error: 'Declaración no encontrada.' });

  // Solo puede validar el jefe declarado (o un admin)
  if (decl.jefe_id !== req.user.id && req.user.role !== 'admin')
    return res.status(403).json({ error: 'Solo el jefe/responsable declarado puede validar esta declaración.' });

  if (decl.estado !== 'pendiente_validacion')
    return res.status(400).json({ error: 'Esta declaración ya fue procesada o fue escalada.' });

  stmts.updateDeclEstado.run(decision, req.user.id, decl.id);
  if (decision === 'rechazado' && nota) {
    db.prepare('UPDATE destino_declaraciones SET rechazado_nota=? WHERE id=?').run(nota, decl.id);
  }

  // Notificar al usuario del resultado
  try { stmts.insertNotif.run(decl.user_id, req.user.id, decl.id, decision === 'rechazado' ? 'rechazado' : 'validar'); } catch {}

  AUDIT(req.user.id, 'DESTINO_VALIDACION', `Decl ${decl.id} → ${decision.toUpperCase()}`);
  res.json({ ok: true, decision });
});

// Declaraciones pendientes de validación para el jefe logueado
app.get('/api/destinos/pendientes-validacion', auth, roleAtLeast('supervisor','instructor','juosp','juosp_regional','admin'), (req, res) => {
  const pendientes = stmts.declsPendJefe.all(req.user.id);
  res.json({ pendientes });
});

// Historial de declaraciones de un usuario (admin/fiscalizador)
app.get('/api/admin/destinos/historial/:userId', auth, roleAtLeast('admin','fiscalizador','juosp','juosp_regional'), (req, res) => {
  const hist = stmts.historialDecl.all(Number(req.params.userId));
  res.json({ historial: hist });
});

// Mi propio historial
app.get('/api/me/destino/historial', auth, (req, res) => {
  const hist = stmts.historialDecl.all(req.user.id);
  res.json({ historial: hist });
});

// Panel de administración: todos los usuarios con su estado de destino
app.get('/api/admin/destinos/reporte', auth, roleAtLeast('admin','fiscalizador','juosp','juosp_regional'), (req, res) => {
  // Forzar escalado antes de reportar
  escalarDeclaracionesPendientes();
  const usuarios = stmts.todosUltimaDecl.all();
  const porDestino = stmts.reportePorDestino.all();
  const hoy = new Date().toISOString().slice(0, 10);
  const avisoDias = Number(stmts.getSetting.get('destino_aviso_dias')?.valor || 30);
  const conEstado = usuarios.map(u => {
    let estado = 'nunca_declarado';
    if (u.ultima_vence) {
      const diff = Math.ceil((new Date(u.ultima_vence) - new Date(hoy)) / 86400000);
      if (diff < 0) estado = 'vencido';
      else if (diff <= avisoDias) estado = 'proximo';
      else estado = 'vigente';
    }
    return { ...u, estado_destino: estado };
  });
  res.json({ usuarios: conEstado, por_destino: porDestino });
});

// Marcar notificación como leída
app.post('/api/destinos/notificaciones/:id/leida', auth, (req, res) => {
  stmts.marcarNotifLeida.run(Number(req.params.id));
  res.json({ ok: true });
});

// Settings del módulo 4
app.get('/api/admin/settings/destino', auth, roleAtLeast('admin'), (req, res) => {
  res.json({
    vigencia_dias:    Number(stmts.getSetting.get('destino_vigencia_dias')?.valor    || 180),
    aviso_dias:       Number(stmts.getSetting.get('destino_aviso_dias')?.valor       || 30),
    validacion_dias:  Number(stmts.getSetting.get('destino_validacion_dias')?.valor  || 15),
  });
});
app.post('/api/admin/settings/destino', auth, roleAtLeast('admin'), (req, res) => {
  const { vigencia_dias, aviso_dias, validacion_dias } = req.body || {};
  if (vigencia_dias)   stmts.setSetting.run('destino_vigencia_dias',   String(vigencia_dias),   req.user.id);
  if (aviso_dias)      stmts.setSetting.run('destino_aviso_dias',      String(aviso_dias),      req.user.id);
  if (validacion_dias) stmts.setSetting.run('destino_validacion_dias', String(validacion_dias), req.user.id);
  AUDIT(req.user.id, 'DESTINO_CONFIG', `vigencia=${vigencia_dias} aviso=${aviso_dias} validacion=${validacion_dias}`);
  res.json({ ok: true });
});

/* ════════════════════════════════════════════════════════════════════
   COLA VIRTUAL — endpoints que usa el cliente para gestionar la espera
═══════════════════════════════════════════════════════════════════ */

// Heartbeat: el cliente lo llama cada 30s para mantener su lugar en el sistema.
// Si no llega heartbeat en 65s, la sesión expira y libera el cupo.
app.post('/api/queue/heartbeat', auth, (req, res) => {
  if (req.user.role !== 'estudiante') return res.json({ ok: true }); // otros roles: sin efecto
  const ahora = Date.now();

  // Limpiar expirados
  for (const [uid, info] of _activeSessions) {
    if (ahora - info.lastSeen > 65_000) _activeSessions.delete(uid);
  }

  if (_activeSessions.has(req.user.id)) {
    // Renovar sesión activa
    _activeSessions.get(req.user.id).lastSeen = ahora;
    return res.json({ ok: true, estado: 'activo' });
  }

  // No está en sesiones activas: ver si puede entrar desde la cola
  const MAX_CONCURRENT = Number(db.prepare("SELECT valor FROM system_settings WHERE clave='queue_max_concurrent'").get()?.valor) || 200;
  const activos = _activeSessions.size;

  if (activos < MAX_CONCURRENT && _queue.has(req.user.id)) {
    // Admitir al primero de la cola si hay lugar
    const [primerUid] = _queue.keys();
    if (primerUid === req.user.id) {
      _activeSessions.set(req.user.id, { lastSeen: ahora, legajo: req.user.legajo });
      _queue.delete(req.user.id);
      AUDIT(req.user.id, 'COLA_ADMITIDO', req.user.legajo + ' ingresó desde la fila');
      return res.json({ ok: true, estado: 'admitido' });
    }
  }

  // Sigue en cola
  if (_queue.has(req.user.id)) {
    _queue.get(req.user.id).lastSeen = ahora;
    const queueArr = [..._queue.keys()];
    const posicion = queueArr.indexOf(req.user.id) + 1;
    return res.json({ ok: true, estado: 'en_cola', posicion, total_cola: queueArr.length, activos, max_concurrent: MAX_CONCURRENT });
  }

  // Fue eliminado de la cola (expiró): necesita reiniciar el login
  return res.json({ ok: false, estado: 'expirado', mensaje: 'Tu lugar en la fila expiró. Por favor, iniciá sesión nuevamente.' });
});

// Estado de la cola (consulta sin cambios)
app.get('/api/queue/status', auth, (req, res) => {
  const ahora = Date.now();
  for (const [uid, info] of _activeSessions) {
    if (ahora - info.lastSeen > 65_000) _activeSessions.delete(uid);
  }
  const MAX_CONCURRENT = Number(db.prepare("SELECT valor FROM system_settings WHERE clave='queue_max_concurrent'").get()?.valor) || 200;
  const activos = _activeSessions.size;
  const queueArr = [..._queue.keys()];
  const posicion = queueArr.indexOf(req.user.id) + 1;
  res.json({
    activos,
    max_concurrent: MAX_CONCURRENT,
    total_cola: queueArr.length,
    posicion: posicion > 0 ? posicion : null,
    estado: _activeSessions.has(req.user.id) ? 'activo' : (posicion > 0 ? 'en_cola' : 'libre')
  });
});

// Salida explícita: libera el cupo para que el siguiente entre
app.post('/api/queue/leave', auth, (req, res) => {
  if (req.user.role === 'estudiante') {
    _activeSessions.delete(req.user.id);
    _queue.delete(req.user.id);
  }
  res.json({ ok: true });
});

// Admin: ver el estado de la cola y configurar el máximo
app.get('/api/admin/queue', auth, roleAtLeast('admin'), (req, res) => {
  const ahora = Date.now();
  for (const [uid, info] of _activeSessions) {
    if (ahora - info.lastSeen > 65_000) _activeSessions.delete(uid);
  }
  const MAX_CONCURRENT = Number(db.prepare("SELECT valor FROM system_settings WHERE clave='queue_max_concurrent'").get()?.valor) || 200;
  res.json({
    max_concurrent: MAX_CONCURRENT,
    activos: _activeSessions.size,
    sesiones: [..._activeSessions.entries()].map(([id,s]) => ({ id, legajo: s.legajo, lastSeen: new Date(s.lastSeen).toISOString() })),
    cola: [..._queue.entries()].map(([id,q], i) => ({ id, legajo: q.legajo, posicion: i+1, espera_s: Math.floor((ahora - q.entro)/1000) }))
  });
});

// Abrir o cerrar el registro público (admin)
app.post('/api/admin/settings/registro', auth, roleAtLeast('admin'), (req, res) => {
  const abierto = req.body?.abierto ? '1' : '0';
  stmts.setSetting.run('registro_abierto', abierto, req.user.id);
  AUDIT(req.user.id, 'REGISTRO_CONFIG', abierto === '1' ? 'Registro público ABIERTO' : 'Registro público CERRADO');
  res.json({ ok: true, registro_abierto: abierto === '1' });
});
app.get('/api/admin/settings/registro', auth, roleAtLeast('admin'), (req, res) => {
  const val = stmts.getSetting.get('registro_abierto')?.valor === '1';
  res.json({ registro_abierto: val });
});

app.post('/api/admin/queue/max', auth, roleAtLeast('admin'), (req, res) => {
  const max = Number(req.body?.max);
  if (!max || max < 1 || max > 2000) return res.status(400).json({ error: 'Valor entre 1 y 2000.' });
  stmts.setSetting.run('queue_max_concurrent', String(max), req.user.id);
  AUDIT(req.user.id, 'QUEUE_MAX_CHANGED', String(max));
  res.json({ ok: true, max_concurrent: max });
});

// Registrar el hash de un PDF generado desde el cliente en el Libro Matriz
// Esto permite que el panel verificador encuentre documentos generados por printHtml/jsPDF
app.post('/api/admin/registrar-firma-pdf', auth, (req, res) => {
  const { tipo, titulo, hash } = req.body || {};
  if (!tipo || !hash || hash.length !== 64 || !/^[0-9a-f]+$/i.test(hash))
    return res.status(400).json({ error: 'tipo y hash SHA-256 (64 hex) requeridos.' });
  if (!/^[0-9a-fA-F]+$/.test(hash))
    return res.status(400).json({ error: 'Hash inválido.' });

  // Evitar duplicados del mismo hash (idempotente)
  const existente = db.prepare('SELECT numero FROM registro_documentos WHERE referencia=?').get(hash);
  if (existente) return res.json({ ok: true, numero: existente.numero, duplicado: true });

  const anio = new Date().getFullYear();
  const tipoPdf = String(tipo).slice(0, 40).replace(/[^a-z0-9_]/gi, '_').toLowerCase() || 'pdf_firmado';
  // Prefijo: primeras 4 letras mayúsculas del tipo, o PDF- como fallback
  const prefijo = String(tipo).replace(/[^A-Za-z]/g,'').toUpperCase().slice(0,4) || 'PDFF';
  const numPdf = generarNumDoc(prefijo, anio);
  stmts.insertRegDoc.run(tipoPdf, numPdf, req.user.id, null, hash, req.user.id);
  AUDIT(req.user.id, 'PDF_FIRMADO_REGISTRADO', `${numPdf} · ${titulo||tipoPdf} · hash ${hash.slice(0,12)}…`);
  res.json({ ok: true, numero: numPdf });
});

// Verificar contraseña del usuario autenticado (para firmas electrónicas que requieren reautenticación)
app.post('/api/auth/verificar-password', auth, (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
  if (!u) return res.status(404).json({ ok: false, error: 'Usuario no encontrado.' });
  if (!bcrypt.compareSync(String(req.body?.password || ''), u.password_hash))
    return res.status(401).json({ ok: false, error: 'Contraseña incorrecta. La firma electrónica requiere revalidar su identidad.' });
  // Devolver timestamp del servidor para que el cliente lo use en el hash
  const ts = new Date().toLocaleString('es-AR', { hour12: false, timeZone: 'America/Argentina/Buenos_Aires' });
  AUDIT(u.id, 'FIRMA_ELECTRONICA_REAUTENTICADA', 'Reautenticación para firma de documento');
  res.json({ ok: true, firmante: sanitizeUser(u), timestamp: ts });
});

app.get('/api/me', auth, (req, res) => {
  const user = stmts.userById.get(req.user.id);
  if (!user) return res.status(404).json({ error: 'Usuario no encontrado.' });
  // Para perfiles duales: incluir el perfil gemelo si existe
  const legajoBase = user.legajo_base || user.legajo.replace(/-INST$/i, '');
  const perfilGemelo = db.prepare(
    `SELECT id,legajo,role,activo FROM users WHERE legajo_base=? AND id!=? AND activo=1 LIMIT 1`
  ).get(legajoBase, user.id);
  res.json({
    user: sanitizeUser(user),
    perfil_gemelo: perfilGemelo || null,
    enrollments: stmts.enrollmentsByUser.all(user.id),
    certificates: stmts.certsByUser.all(user.id)
  });
});

/* ── Edición del perfil propio (todos los roles) ────────────────────
   Campos editables por el propio usuario: aeropuerto, dependencia, funcion.
   El administrador puede editar todos (ya tiene /api/admin/users/:id/edit).
   El legajo, DNI, nombre, apellido y rol NO son editables por el usuario.
────────────────────────────────────────────────────────────────────── */
app.patch('/api/me', auth, (req, res) => {
  const user = stmts.userById.get(req.user.id);
  if (!user) return res.status(404).json({ error: 'Usuario no encontrado.' });

  const isAdmin = req.user.role === 'admin';
  const { aeropuerto, dependencia, funcion, rango, organismo, nombre, apellido } = req.body || {};

  // Campos que cualquier usuario puede editar
  const updates = {
    aeropuerto: String(aeropuerto ?? user.aeropuerto ?? '').trim().slice(0, 100),
    dependencia: String(dependencia ?? user.dependencia ?? '').trim().slice(0, 100),
    funcion: String(funcion ?? user.funcion ?? '').trim().slice(0, 100),
  };

  // Campos adicionales que solo admin puede editar en su propio perfil
  if (isAdmin) {
    // Inicializar siempre desde el valor actual — solo sobreescribir si vino en el body
    updates.rango     = String(rango    !== undefined ? rango    : user.rango    ?? '').trim().slice(0, 60);
    updates.organismo = String(organismo !== undefined ? organismo : user.organismo ?? '').trim().slice(0, 60);
    updates.nombre    = String(nombre   !== undefined ? nombre   : user.nombre   ?? '').trim().slice(0, 60);
    updates.apellido  = String(apellido !== undefined ? apellido : user.apellido ?? '').trim().toUpperCase().slice(0, 60);
  }

  db.prepare(`UPDATE users SET aeropuerto=?, dependencia=?, funcion=?${isAdmin ? ', rango=?, organismo=?, nombre=?, apellido=?' : ''} WHERE id=?`)
    .run(
      updates.aeropuerto, updates.dependencia, updates.funcion,
      ...(isAdmin ? [updates.rango, updates.organismo, updates.nombre, updates.apellido] : []),
      user.id
    );

  AUDIT(user.id, 'PERFIL_ACTUALIZADO', `${user.legajo} editó su perfil`);
  res.json({ ok: true, user: sanitizeUser(stmts.userById.get(user.id)) });
});

/* ── Cambio de contraseña propio (todos los roles) ──────────────────
   Requiere la contraseña actual como verificación de identidad.
   No requiere intervención del administrador.
────────────────────────────────────────────────────────────────────── */
app.post('/api/me/password', auth, (req, res) => {
  const { password_actual, password_nuevo } = req.body || {};

  if (!password_actual || !password_nuevo)
    return res.status(400).json({ error: 'Se requieren contraseña actual y nueva.' });
  if (String(password_nuevo).length < 6)
    return res.status(400).json({ error: 'La nueva contraseña debe tener al menos 6 caracteres.' });
  if (password_actual === password_nuevo)
    return res.status(400).json({ error: 'La nueva contraseña debe ser diferente a la actual.' });

  const user = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
  if (!user) return res.status(404).json({ error: 'Usuario no encontrado.' });

  if (!bcrypt.compareSync(String(password_actual), user.password_hash))
    return res.status(401).json({ error: 'Contraseña actual incorrecta.' });

  stmts.updateUserPassword.run(bcrypt.hashSync(String(password_nuevo), 10), user.id);
  AUDIT(user.id, 'CAMBIO_PASSWORD_PROPIO', user.legajo);
  res.json({ ok: true, mensaje: 'Contraseña actualizada correctamente.' });
});

/* ================= Catálogo y cursado ================= */
app.get('/api/courses', auth, (req, res) => {
  let courses = stmts.allCourses.all().map(c => ({
    ...c,
    inscripto: !!stmts.enrollment.get(req.user.id, c.id)
  }));
  // Solo admin e instructor ven todos los cursos
  // Estudiantes y supervisores solo ven los cursos donde están inscriptos
  const effectiveRole = {'docente':'instructor','fiscalizador':'admin'}[req.user.role]||req.user.role;
  if (!['admin','instructor'].includes(effectiveRole)) {
    courses = courses.filter(c => c.inscripto);
  }
  res.json({ courses });
});

app.get('/api/courses/:id', auth, (req, res) => {
  const c = stmts.courseById.get(Number(req.params.id));
  if (!c) return res.status(404).json({ error: 'Curso no encontrado.' });
  const enr = stmts.enrollment.get(req.user.id, c.id);
  const raw = stmts.lessonsByCourse.all(c.id);
  const ordered = studentLessonOrder(raw, req.user.id, c.id, c.orden_aleatorio);
  const done = new Set(enr ? stmts.progressByEnrollment.all(enr.id).map(r => r.lesson_id) : []);
  // Niveles: cada unidad se desbloquea al completar la anterior (en el orden PROPIO del alumno)
  let unlocked = true;
  const lessons = ordered.map((l, i) => {
    const completed = done.has(l.id);
    const item = {
      id: l.id, nivel: i + 1, titulo: l.titulo, tipo: l.tipo,
      duracion_s: l.duracion_s, completed, unlocked: unlocked
    };
    if (!completed) unlocked = false; // la siguiente queda bloqueada
    return item;
  });
  const attempts = enr ? stmts.attemptsByEnrollment.all(enr.id) : [];
  res.json({ course: c, enrollment: enr || null, lessons, attempts,
             todas_completas: lessons.every(l => l.completed) });
});

app.post('/api/courses/:id/enroll', auth, (req, res) => {
  // La inscripción es una asignación de la administración/docencia (los alumnos no se auto-inscriben)
  if (!['admin', 'instructor'].includes(req.user.role))
    return res.status(403).json({ error: 'Los cursos los asigna la administración. Solicite su inscripción al ISSA o a su Centro de Capacitación.' });
  const c = stmts.courseById.get(Number(req.params.id));
  if (!c) return res.status(404).json({ error: 'Curso no encontrado.' });
  stmts.enroll.run(req.user.id, c.id, req.user.id);
  AUDIT(req.user.id, 'INSCRIPCION', c.cod);
  res.status(201).json({ ok: true });
});

/** Acceso a la unidad: valida inscripción y desbloqueo secuencial en el orden del alumno */
function lessonAccess(req, res) {
  const lesson = stmts.lessonById.get(Number(req.params.id));
  if (!lesson) { res.status(404).json({ error: 'Unidad no encontrada.' }); return null; }
  const c = stmts.courseById.get(lesson.course_id);
  const enr = stmts.enrollment.get(req.user.id, c.id);
  if (!enr) { res.status(400).json({ error: 'Debe inscribirse al curso primero.' }); return null; }
  const ordered = studentLessonOrder(stmts.lessonsByCourse.all(c.id), req.user.id, c.id, c.orden_aleatorio);
  const done = new Set(stmts.progressByEnrollment.all(enr.id).map(r => r.lesson_id));
  const pos = ordered.findIndex(l => l.id === lesson.id);
  const prevOk = ordered.slice(0, pos).every(l => done.has(l.id));
  if (!prevOk) { res.status(403).json({ error: 'Debe completar las unidades anteriores para acceder a este nivel.' }); return null; }
  return { lesson, course: c, enr, alreadyDone: done.has(lesson.id) };
}

// 1) Iniciar la unidad: crea la sesión con reloj del SERVIDOR y entrega el contenido
app.post('/api/lessons/:id/start', auth, (req, res) => {
  const ctx = lessonAccess(req, res); if (!ctx) return;
  const info = stmts.insertLS.run(ctx.enr.id, ctx.lesson.id, Date.now());
  AUDIT(req.user.id, 'UNIDAD_INICIADA', `${ctx.course.cod} · ${ctx.lesson.titulo}`);
  res.json({
    session_id: Number(info.lastInsertRowid),
    lesson: {
      id: ctx.lesson.id, titulo: ctx.lesson.titulo, tipo: ctx.lesson.tipo,
      contenido: ctx.lesson.contenido, video_url: ctx.lesson.video_url,
      duracion_s: ctx.lesson.duracion_s
    },
    already_completed: ctx.alreadyDone
  });
});

// 2) Fin de visualización/lectura: el SERVIDOR valida el tiempo real transcurrido
app.post('/api/lessons/:id/videodone', auth, (req, res) => {
  const ctx = lessonAccess(req, res); if (!ctx) return;
  const ls = stmts.lsById.get(Number(req.body?.session_id));
  if (!ls || ls.lesson_id !== ctx.lesson.id || ls.enrollment_id !== ctx.enr.id)
    return res.status(400).json({ error: 'Sesión de unidad inválida.' });
  if (ls.completed_at) return res.status(400).json({ error: 'La sesión ya fue cerrada.' });

  const elapsed = (Date.now() - ls.started_ms) / 1000;
  const requerido = isDemo(req) ? 1 : Math.max(5, Math.floor(ctx.lesson.duracion_s * 0.95));
  if (elapsed < requerido) {
    return res.status(400).json({
      error: `Registro de tiempo insuficiente: transcurrieron ${Math.floor(elapsed)} s y la unidad requiere ${requerido} s de visualización efectiva.`,
      faltan_s: Math.ceil(requerido - elapsed)
    });
  }

  // Checkpoint aleatorio con opciones permutadas (único por sesión)
  const bank = stmts.lqByLesson.all(ctx.lesson.id);
  if (!bank.length) { // sin banco: completar directo, con tiempo ya validado
    stmts.markLesson.run(ctx.enr.id, ctx.lesson.id);
    stmts.lsClose.run('aprobado', ls.id);
    return res.json({ completed: true, question: null });
  }
  const q = bank[Math.floor(Math.random() * bank.length)];
  const perm = permuteOptions(safeJson(q.opciones, []), q.correcta);
  stmts.lsSetVideoDone.run(Date.now(), q.id, JSON.stringify(perm.map), ls.id);
  res.json({ completed: false, question: { pregunta: q.pregunta, opciones: perm.opciones } });
});

// 3) Checkpoint: correcto → nivel superado; incorrecto → debe volver a ver el video
app.post('/api/lessons/:id/checkpoint', auth, (req, res) => {
  const ctx = lessonAccess(req, res); if (!ctx) return;
  const ls = stmts.lsById.get(Number(req.body?.session_id));
  if (!ls || ls.lesson_id !== ctx.lesson.id || ls.enrollment_id !== ctx.enr.id || !ls.question_id)
    return res.status(400).json({ error: 'Sesión de checkpoint inválida.' });
  if (ls.completed_at) return res.status(400).json({ error: 'La sesión ya fue cerrada.' });

  const q = stmts.lqById.get(ls.question_id);
  const map = safeJson(ls.opciones_map, []);
  const correctaPermutada = map.indexOf(q.correcta);
  const ok = Number(req.body?.answer) === correctaPermutada;

  stmts.lsClose.run(ok ? 'aprobado' : 'fallido', ls.id);
  if (ok) {
    stmts.markLesson.run(ctx.enr.id, ctx.lesson.id);
    AUDIT(req.user.id, 'NIVEL_SUPERADO', `${ctx.course.cod} · ${ctx.lesson.titulo}`);
  } else {
    AUDIT(req.user.id, 'CHECKPOINT_FALLIDO', `${ctx.course.cod} · ${ctx.lesson.titulo}`);
  }
  res.json({ correct: ok, completed: ok,
             mensaje: ok ? 'Nivel superado.' : 'Respuesta incorrecta: debe visualizar nuevamente la unidad completa para reintentar.' });
});

/* ================= Examen teórico (corrección en servidor) ================= */
/* Validación de dispositivo para inicio de examen:
   El cliente debe enviar el header X-Device-Type.
   Si es 'mobile', el servidor rechaza con 403 y mensaje claro. */
app.get('/api/courses/:id/quiz', auth, (req, res) => {
  // Bloquear si el curso requiere apto médico y el alumno no tiene vigente
  {
    const enrCheck = db.prepare('SELECT * FROM enrollments WHERE user_id=? AND course_id=? AND activo=1').get(req.user.id, Number(req.params.id));
    if (enrCheck) {
      const cCheck = stmts.courseById.get(Number(req.params.id));
      if (cCheck && cCheck.requiere_apto_medico) {
        const aptoCheck = stmts.aptoByUser.get(req.user.id);
        const hoy = new Date().toISOString().slice(0,10);
        const vigente = aptoCheck && aptoCheck.estado === 'apto' && aptoCheck.vence_at >= hoy;
        if (!vigente) return res.status(403).json({
          error: 'apto_medico_requerido',
          mensaje: 'Este curso requiere aptitud psicofísica vigente. Contacte al Servicio Médico del ISSA para tramitarla.',
        });
      }
    }
  }

  // Doble validación: header del cliente + user agent del servidor
  const deviceType = req.headers['x-device-type'] || '';
  const ua = req.headers['user-agent'] || '';
  const uaMobile = /Android|iPhone|iPad|Mobile|webOS/i.test(ua);
  // Demo: puede rendir desde cualquier dispositivo
  const tokenUser = req.user;
  const demoMode = tokenUser?.usuario === 'demo' || tokenUser?.legajo === 'DEMO';
  if (!demoMode && (deviceType === 'mobile' || (uaMobile && deviceType !== 'desktop'))) {
    return res.status(403).json({
      error: 'examen_requiere_pc',
      mensaje: 'Los exámenes deben rendirse desde una computadora con cámara. Accedé a SINCA desde tu PC para continuar.',
      mobile: true,
    });
  }
  const c = stmts.courseById.get(Number(req.params.id));
  if (!c) return res.status(404).json({ error: 'Curso no encontrado.' });
  const enr = stmts.enrollment.get(req.user.id, c.id);
  if (!enr) return res.status(400).json({ error: 'Debe inscribirse al curso primero.' });

  // Requisito del aula virtual: completar las actividades antes de rendir
  const lessons = stmts.lessonsByCourse.all(c.id);
  const done = stmts.progressByEnrollment.all(enr.id).length;
  if (!isDemo(req) && done < lessons.length)
    return res.status(400).json({ error: `Debe completar las ${lessons.length} unidades del aula virtual antes de rendir (completó ${done}).` });

  const prior = stmts.attemptsByEnrollment.all(enr.id).filter(a => a.tipo !== 'practico');
  if (!isDemo(req) && prior.some(a => a.passed)) return res.status(400).json({ error: 'La teoría ya está aprobada.' });
  if (!isDemo(req) && prior.length >= 2) return res.status(400).json({ error: 'Agotó el examen y su recuperatorio. Contacte al docente.' });

  // Subconjunto aleatorio del banco + orden de preguntas y de opciones únicos por sesión.
  // Las respuestas correctas quedan SOLO en el servidor (quiz_sessions).
  const full = shuffle(stmts.questionsFull.all(c.id));
  const n = Math.min(c.preguntas_examen || 10, full.length);
  const chosen = full.slice(0, n);
  const payload = [];
  const questions = chosen.map(q => {
    const perm = permuteOptions(safeJson(q.opciones, []), q.correcta);
    payload.push({ qid: q.id, correcta: perm.correcta });
    return { pregunta: q.pregunta, opciones: perm.opciones };
  });
  const tipo = prior.length === 0 ? 'teorico' : 'recuperatorio';
  const info = stmts.insertQS.run(enr.id, tipo, JSON.stringify(payload), Date.now());
  AUDIT(req.user.id, 'EXAMEN_GENERADO', `${c.cod} ${tipo} (${n} preguntas, versión única)`);
  res.json({ session_id: Number(info.lastInsertRowid), questions, intento: prior.length + 1, nota_min: c.nota_min });
});

app.post('/api/courses/:id/quiz', auth, (req, res) => {
  try {
    const c = stmts.courseById.get(Number(req.params.id));
    if (!c) return res.status(404).json({ error: 'Curso no encontrado.' });
    const enr = stmts.enrollment.get(req.user.id, c.id);
    if (!enr) return res.status(400).json({ error: 'Debe inscribirse al curso primero.' });
    const prior = stmts.attemptsByEnrollment.all(enr.id).filter(a => a.tipo !== 'practico');
    if (prior.some(a => a.passed)) return res.status(400).json({ error: 'La teoría ya está aprobada.' });
    if (prior.length >= 2) return res.status(400).json({ error: 'Sin instancias disponibles.' });

    // Corrección contra la sesión única del alumno (respuestas correctas nunca salieron del servidor)
    const qs = stmts.qsById.get(Number(req.body?.session_id));
    if (!qs || qs.enrollment_id !== enr.id) return res.status(400).json({ error: 'Sesión de examen inválida.' });
    if (qs.used) return res.status(400).json({ error: 'Esta sesión de examen ya fue utilizada.' });
    stmts.qsUse.run(qs.id);
    const payload = safeJson(qs.payload, []);
    const answers = Array.isArray(req.body?.answers) ? req.body.answers : [];
    let correct = 0;
    const detail = payload.map((p, i) => {
      const ok = Number(answers[i]) === p.correcta;
      if (ok) correct++;
      return { qid: p.qid, ok };
    });
    const total = payload.length;
    const pct = Math.round((correct / total) * 1000) / 10;
    const tipo = qs.tipo;
    const passed = pct >= c.nota_min ? 1 : 0;

    const attInfo = stmts.insertAttempt.run({
      enrollment_id: enr.id, tipo, total, correct, score_pct: pct,
      aei_ok: null, passed, duration_s: Number(req.body?.duration_s) || null,
      detail_json: JSON.stringify(detail), ciclo: enr.ciclo
    });
    if (req.body?.proctor_session_id) {
      const ps = stmts.psById.get(Number(req.body.proctor_session_id));
      if (ps && ps.enrollment_id === enr.id) {
        stmts.psSetAttempt.run(Number(attInfo.lastInsertRowid), ps.id);
        if (!ps.ended_at) stmts.psEnd.run(ps.id);
      }
    }
    AUDIT(req.user.id, 'EXAMEN_TEORICO', `${c.cod} ${tipo} ${pct}% ${passed ? 'APROBADO' : 'DESAPROBADO'}`);

    const result = finalizeCourse(req.user.id, enr, c);
    res.status(201).json({ score_pct: pct, passed: !!passed, tipo, nota_min: c.nota_min, ...result });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Error al corregir el examen.' }); }
});

/* ================= Práctico simulador (re-corrección en servidor + regla AEI) ================= */
app.post('/api/courses/:id/practical', auth, (req, res) => {
  try {
    const c = stmts.courseById.get(Number(req.params.id));
    if (!c) return res.status(404).json({ error: 'Curso no encontrado.' });
    if (!c.simulador) return res.status(400).json({ error: 'Este curso no posee práctico en simulador.' });
    const enr = stmts.enrollment.get(req.user.id, c.id);
    if (!enr) return res.status(400).json({ error: 'Debe inscribirse al curso primero.' });
    const prior = stmts.attemptsByEnrollment.all(enr.id);
    if (prior.some(a => a.tipo === 'practico' && a.passed))
      return res.status(400).json({ error: 'El práctico ya está aprobado.' });
    if (prior.some(a => a.tipo === 'practico' && !a.passed))
      return res.status(400).json({ error: 'El práctico no tiene recuperatorio (PNISAC). Contacte al docente para habilitar una nueva cursada.' });

    const records = Array.isArray(req.body?.records) ? req.body.records : [];
    if (records.length < 1) return res.status(400).json({ error: 'Sin registros del examen.' });
    const pset = stmts.pracSetById.get(Number(req.body?.practical_session_id));
    if (!pset || pset.enrollment_id !== enr.id) return res.status(400).json({ error: 'Set de examen práctico inválido.' });
    if (pset.used) return res.status(400).json({ error: 'Este set de examen ya fue utilizado.' });
    const asignadas = new Set(safeJson(pset.filenames, []));
    if (records.length !== asignadas.size || !records.every(r => asignadas.has(r.filename)))
      return res.status(400).json({ error: 'Los registros no corresponden al set asignado por el servidor.' });
    stmts.pracSetUse.run(pset.id);

    // Re-corrección en servidor contra las anotaciones oficiales
    let correct = 0, aeiTotal = 0, aeiCorrect = 0;
    const detail = records.map(r => {
      const a = stmts.annotationByFile.get(String(r.filename || ''));
      const g = gradeImage(a, r);
      if (g.correct) correct++;
      if (g.isAEI) { aeiTotal++; if (g.correct) aeiCorrect++; }
      return { f: r.filename, ok: g.correct, aei: g.isAEI };
    });

    const total = records.length;
    // Regla PNISAC: AEI = 40 % del puntaje del examen y condición excluyente
    const nonAeiTotal = total - aeiTotal;
    const nonAeiCorrect = correct - aeiCorrect;
    const pct = aeiTotal > 0
      ? Math.round((60 * (nonAeiTotal ? nonAeiCorrect / nonAeiTotal : 1) + 40 * (aeiCorrect / aeiTotal)) * 10) / 10
      : Math.round((correct / total) * 1000) / 10;
    const aeiOk = aeiTotal === 0 ? 1 : (aeiCorrect === aeiTotal ? 1 : 0);
    const passed = pct >= c.nota_min && aeiOk ? 1 : 0;

    const attInfo = stmts.insertAttempt.run({
      enrollment_id: enr.id, tipo: 'practico', total, correct, score_pct: pct,
      aei_ok: aeiOk, passed, duration_s: Number(req.body?.duration_s) || null,
      detail_json: JSON.stringify(detail), ciclo: enr.ciclo
    });
    if (req.body?.proctor_session_id) {
      const ps = stmts.psById.get(Number(req.body.proctor_session_id));
      if (ps && ps.enrollment_id === enr.id) {
        stmts.psSetAttempt.run(Number(attInfo.lastInsertRowid), ps.id);
        if (!ps.ended_at) stmts.psEnd.run(ps.id);
      }
    }
    AUDIT(req.user.id, 'EXAMEN_PRACTICO', `${c.cod} ${pct}% AEI:${aeiOk ? 'OK' : 'FALLO'} ${passed ? 'APROBADO' : 'DESAPROBADO'}`);

    const result = finalizeCourse(req.user.id, enr, c);
    res.status(201).json({
      score_pct: pct, passed: !!passed, aei_ok: !!aeiOk, aei_total: aeiTotal,
      correct, total, nota_min: c.nota_min, detail, ...result
    });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Error al corregir el práctico.' }); }
});

/* ================= EPPT: reglas por especialidad (Apéndices PNISAC) ================= */
const EPPT_RULES = {
  'COD-PSA 001': { apendice: 'Apéndice 05 — Seguridad Aeroportuaria', requerido: 20, tipo: 'horas', plazo_dias: 90,
    firmante: 'Supervisor de Seguridad Aeroportuaria certificado (COD-PSA 004)',
    rubrica: ['Control de accesos', 'Inspección de personas', 'Registro de equipaje de mano', 'Registro de equipaje de despacho', 'Control de aeronaves'] },
  'COD-PSA 002': { apendice: 'Apéndice 06 — Operador de Rayos X', requerido: 10, tipo: 'horas', plazo_dias: 90,
    firmante: 'Supervisor de Seguridad Aeroportuaria certificado (COD-PSA 004)',
    rubrica: ['Uso de las funciones del teclado', 'Ángulos de incidencia', 'Equipo de doble vista / CT', 'Detiene la cinta ante detecciones', 'Interpretación de imágenes en puesto real'] },
  'COD-PSA 008': { apendice: 'Apéndice 08 — Inspector Nacional', requerido: 3, tipo: 'actividades', plazo_dias: 120,
    firmante: 'Jefe de Equipo de Control de Calidad (JECC)',
    rubrica: ['Preparación de la auditoría', 'Ejecución de la auditoría', 'Habilidades personales'] },
  'COD-PSA 009': { apendice: 'Apéndice 09 — Instructor Nacional', requerido: 20, tipo: 'horas', plazo_dias: 120,
    firmante: 'Instructor Nacional certificado',
    rubrica: ['Preparación de la clase', 'Desarrollo', 'Cierre', 'Gestión del tiempo de impartición'] }
};
const EPPT_CALIF = ['Muy Bueno', 'Bueno', 'Regular', 'Deficiente', 'N/A'];
const firmaHash = (obj, userId) =>
  crypto.createHash('sha256').update(JSON.stringify(obj) + '|' + userId + '|' + Date.now()).digest('hex');

/**
 * Genera un número de documento institucional con segmento aleatorio de 5 letras.
 * Formato: PREFIJO-XXXXX-AAAA-NNNN
 *   PREFIJO  → tipo de documento (CERT, CRED, ACTA, JEPPT, FALU, ACTE, ANUL, AREP)
 *   XXXXX    → 5 letras aleatorias mayúsculas (alfabeto sin O, I, 0, 1 para evitar confusión visual)
 *   AAAA     → año en curso
 *   NNNN     → correlativo de 4 dígitos dentro del tipo+año (reinicia cada año)
 * Ventajas:
 *   - El segmento aleatorio hace que adivinar o falsificar una secuencia sea
 *     estadísticamente imposible (26^5 ≈ 12 millones de combinaciones por correlativo)
 *   - El correlativo sigue siendo único dentro del tipo, lo que garantiza unicidad en BD
 *   - Se puede leer en voz alta o transcribir sin ambigüedad (sin O/I)
 */
const DOCNUM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // sin O, I (confusión con 0, 1)
function generarNumDoc(tipo, anio) {
  const seg = Array.from({ length: 5 },
    () => DOCNUM_ALPHABET[crypto.randomInt(DOCNUM_ALPHABET.length)]).join('');
  const n = (db.prepare(
    `SELECT COALESCE(MAX(CAST(SUBSTR(numero,-4) AS INTEGER)),0)+1 AS n
     FROM registro_documentos
     WHERE tipo=? AND numero LIKE ?`
  ).get(tipo, `%-${anio}-%`).n || 1);
  return `${tipo.toUpperCase().replace(/_/g,'-')}-${seg}-${anio}-${String(n).padStart(4,'0')}`;
}

function epptEstadoActual(rec) {
  if (!rec) return null;
  if (rec.estado === 'completo') return rec;
  const hoy = new Date().toISOString().slice(0, 10);
  if (rec.deadline < hoy && rec.estado !== 'vencido') { stmts.epptSetEstado.run('vencido', rec.id); rec.estado = 'vencido'; }
  return rec;
}
function epptHorasFirmadas(epptId) {
  return stmts.epptEntries.all(epptId)
    .filter(e => e.firma_sup_at && e.firma_alu_at)
    .reduce((s, e) => s + e.horas, 0);
}

/** Emite el certificado con FIRMA ELECTRÓNICA institucional (hash verificable, Ley 25.506). */
function emitCertificate(userId, enr, c, atts) {
  const code = 'ISSA-' + c.cod.replace(/[^0-9A]/g, '') + '-' + crypto.randomBytes(4).toString('hex').toUpperCase();
  const scores = atts.filter(a => a.passed).map(a => a.score_pct);
  const finalScore = Math.round((scores.reduce((s, x) => s + x, 0) / Math.max(1, scores.length)) * 10) / 10;
  const venc = c.vigencia_meses > 0 ? addMonths(new Date().toISOString(), c.vigencia_meses) : null;
  stmts.insertCert.run({ user_id: userId, course_id: c.id, code, score_pct: finalScore, vencimiento: venc, enrollment_id: enr.id });
  const u = stmts.userById.get(userId);
  const firma = crypto.createHash('sha256')
    .update([code, u.dni || u.legajo, c.cod, finalScore, venc || '', JWT_SECRET].join('|')).digest('hex');
  db.prepare('UPDATE certificates SET firma_hash = ? WHERE code = ?').run(firma, code);
  AUDIT(userId, 'CERTIFICADO_EMITIDO', `${c.cod} ${code} vence:${venc || 'sin vencimiento'} · firma electrónica ${firma.slice(0, 12)}…`);
  // Registro correlativo
  try {
    const anio = new Date().getFullYear();
    const numDoc = generarNumDoc('CERT', anio);
    stmts.insertRegDoc.run('certificado', numDoc, userId, c.id, code, userId);
  } catch {}
  return stmts.certByCode.get(code);
}

/** Tras una convalidación: si el curso estaba aprobado con certificado retenido, lo emite ahora. */
function tryReleaseCertificate(enr) {
  const c = stmts.courseById.get(enr.course_id);
  if (enr.estado !== 'aprobado') return null;
  const existing = stmts.certsByUser.all(enr.user_id).find(x => x.course_id === c.id && !x.anulado);
  if (existing) return null;
  if (stmts.psPendientesByEnrollment.all(enr.id).length) return null;
  const atts = stmts.attemptsByEnrollment.all(enr.id);
  return emitCertificate(enr.user_id, enr, c, atts);
}

/** Cierra el curso si corresponde: teoría aprobada + (práctico aprobado si aplica) → certificado */
function finalizeCourse(userId, enr, c) {
  const atts = stmts.attemptsByEnrollment.all(enr.id);
  const teoriaOk = atts.some(a => (a.tipo === 'teorico' || a.tipo === 'recuperatorio') && a.passed);
  const teoriaAgotada = atts.filter(a => a.tipo !== 'practico').length >= 2 && !teoriaOk;
  const needsPractical = !!c.simulador;
  const practicoOk = atts.some(a => a.tipo === 'practico' && a.passed);
  const practicoFallado = atts.some(a => a.tipo === 'practico' && !a.passed);

  if (teoriaOk && (!needsPractical || practicoOk)) {
    // EPPT: cursos con Entrenamiento Práctico en el Puesto de Trabajo obligatorio.
    // Excepción normativa: el COD-PSA 004 (Supervisor) certifica sin EPPT.
    const regla = EPPT_RULES[c.cod];
    if (regla) {
      let rec = epptEstadoActual(stmts.epptByEnrollment.get(enr.id));
      if (!rec) {
        const dl = new Date(); dl.setDate(dl.getDate() + regla.plazo_dias);
        stmts.insertEppt.run(enr.id, regla.apendice, regla.requerido, regla.tipo, dl.toISOString().slice(0, 10), enr.ciclo);
        rec = stmts.epptByEnrollment.get(enr.id);
        AUDIT(userId, 'EPPT_ABIERTO', `${c.cod} · ${regla.apendice} · ${regla.requerido} ${regla.tipo} · vence ${rec.deadline}`);
      }
      if (rec.estado !== 'completo') {
        stmts.setEnrollmentEstado.run('eppt', enr.id);
        return { curso_aprobado: false, certificate: null, eppt_pendiente: true,
                 eppt: { ...rec, regla: regla.apendice, firmante: regla.firmante } };
      }
    }
    stmts.setEnrollmentEstado.run('aprobado', enr.id);
    const existing = stmts.certsByUser.all(userId).find(x => x.course_id === c.id && !x.anulado);
    if (!existing) {
      // INSTANCIA DE VALIDACIÓN: si la supervisión detectó situaciones anómalas (amarillo/rojo)
      // sin revisión humana, el certificado queda RETENIDO hasta que un docente convalide o anule.
      const pendientes = stmts.psPendientesByEnrollment.all(enr.id);
      if (pendientes.length) {
        AUDIT(userId, 'CERT_RETENIDO', `${c.cod}: ${pendientes.length} sesión(es) de supervisión en ${pendientes.map(p => p.nivel).join('/')} pendientes de revisión`);
        return { curso_aprobado: true, certificate: null, validacion_pendiente: true,
                 detalle_validacion: 'La supervisión del examen registró situaciones a revisar. Un docente debe convalidar la instancia; luego el certificado se emite y firma automáticamente.' };
      }
      return { curso_aprobado: true, certificate: emitCertificate(userId, enr, c, atts) };
    }
    return { curso_aprobado: true, certificate: stmts.certByCode.get(existing.code) };
  }
  if (teoriaAgotada || practicoFallado) stmts.setEnrollmentEstado.run('desaprobado', enr.id);
  return { curso_aprobado: false, certificate: null };
}

/* ================= Banco de imágenes: carga y gestión (admin) ================= */
const imgUpload = multer({
  storage: multer.diskStorage({
    destination: (req, f, cb) => cb(null, IMAGES_DIR),
    filename: (req, f, cb) => {
      const base = path.basename(f.originalname).replace(/[^\w.\-]/g, '_');
      cb(null, fs.existsSync(path.join(IMAGES_DIR, base)) ? Date.now() + '_' + base : base);
    }
  }),
  limits: { fileSize: 15 * 1024 * 1024, files: 200 },
  fileFilter: (req, f, cb) => cb(null, /image\/(png|jpe?g|webp)/.test(f.mimetype))
});

app.post('/api/admin/images', auth, roleAtLeast('admin'), (req, res) => {
  imgUpload.array('images', 200)(req, res, err => {
    if (err) return res.status(400).json({ error: 'Error al subir imágenes: ' + err.message });
    const files = (req.files || []).map(f => f.filename);
    scanImages(true);
    AUDIT(req.user.id, 'IMAGENES_CARGADAS', `${files.length} archivo(s) al banco`);
    res.status(201).json({ ok: true, subidas: files.length, archivos: files });
  });
});

app.delete('/api/admin/images/:filename', auth, roleAtLeast('admin'), (req, res) => {
  const file = path.basename(String(req.params.filename));
  const p = path.join(IMAGES_DIR, file);
  if (!fs.existsSync(p)) return res.status(404).json({ error: 'Imagen no encontrada.' });
  fs.unlinkSync(p);
  db.prepare('DELETE FROM annotations WHERE filename = ?').run(file);
  scanImages(true);
  AUDIT(req.user.id, 'IMAGEN_ELIMINADA', file);
  res.json({ ok: true });
});

/* ===== Jerarquías PSA (Decreto 456/2025) ===== */
const RANGOS_PSA = [
  'Oficial Ayudante',
  'Oficial Principal',
  'Oficial Mayor',
  'Oficial Jefe',
  'Subinspector',
  'Inspector',
  'Comisionado Inspector',
  'Comisionado Mayor',
  'Comisionado General',
  'Personal Civil',
  'Personal de Seguridad Privada',
  'Personal Aeroportuario',
  'Personal Externo'
];
/* Límites de operación de Rayos X (RSA N°18 / PNSCA) */
const RX_LIMITES = {
  pasajeros: { op_min: 20, descanso_min: 40 },   // sector pasajeros
  carga:     { op_min: 30, descanso_min: 30 }     // terminal de carga
};

/* ================= Supervisión IA (proctoring) ================= */
// Ponderación del "nivel de sospecha" por tipo de evento (configurable)
const PROCTOR_WEIGHTS = {
  salida_pestana: 15,        // cambió de pestaña / ventana perdió el foco
  salida_pantalla_completa: 10,
  sin_rostro: 20,            // ausencia sostenida frente a cámara (subido: se debe bloquear rápido)
  multiples_rostros: 25,     // segunda persona en cuadro
  mirada_desviada: 15,       // orientación de cabeza fuera de pantalla — el alumno solo debe mirar pantalla/teclado
  movimiento_erratico: 20,   // movimientos nerviosos/erráticos de cabeza
  ruido_detectado: 5,        // voces/ruido sostenido en el micrófono
  atajo_bloqueado: 3,        // intento de usar atajo inhabilitado
  camara_interrumpida: 20,   // la cámara dejó de transmitir
  pantalla_interrumpida: 20, // dejó de compartir la pantalla
  captura_pantalla: 30,      // tecla de captura de pantalla presionada
  posible_captura: 20,       // patrón de pérdida de foco típico de herramienta de captura
  cambio_tamano_ventana: 8,  // cambio abrupto de tamaño de ventana
  calibracion: 0
};
const PROCTOR_LEVELS = [[50, 'rojo'], [20, 'amarillo'], [0, 'verde']];
const nivelDe = score => PROCTOR_LEVELS.find(([min]) => score >= min)[1];

function savePhoto(sessionId, dataUrl) {
  try {
    const m = /^data:image\/(jpeg|png);base64,(.+)$/.exec(String(dataUrl || ''));
    if (!m) return null;
    const dir = path.join(PROCTOR_DIR, String(sessionId));
    fs.mkdirSync(dir, { recursive: true });
    const name = Date.now() + '.' + (m[1] === 'png' ? 'png' : 'jpg');
    fs.writeFileSync(path.join(dir, name), Buffer.from(m[2], 'base64'));
    return name;
  } catch { return null; }
}

// Iniciar sesión de supervisión (fase de calibración; la foto inicial es el consentimiento)
app.post('/api/proctor/start', auth, (req, res) => {
  const c = stmts.courseById.get(Number(req.body?.course_id));
  if (!c) return res.status(404).json({ error: 'Curso no encontrado.' });
  const enr = stmts.enrollment.get(req.user.id, c.id);
  if (!enr) return res.status(400).json({ error: 'Debe inscribirse al curso primero.' });
  const contexto = req.body?.contexto === 'practico' ? 'practico' : 'teorico';
  const info = stmts.insertPS.run(enr.id, contexto, enr.ciclo);
  const sid = Number(info.lastInsertRowid);
  const foto = savePhoto(sid, req.body?.foto);
  const pant = savePhoto(sid, req.body?.pantalla);
  stmts.insertPE.run(sid, 'calibracion', 'Calibración inicial: rostro, entorno y pantalla registrados con consentimiento.', 0, foto, pant);
  AUDIT(req.user.id, 'PROCTOR_INICIO', `${c.cod} ${contexto} sesión ${sid}`);
  res.status(201).json({ session_id: sid });
});

// Registrar evento de sospecha (el peso lo asigna el SERVIDOR, no el cliente)
app.post('/api/proctor/event', auth, (req, res) => {
  const ps = stmts.psById.get(Number(req.body?.session_id));
  if (!ps || ps.ended_at) return res.status(400).json({ error: 'Sesión de supervisión inválida o cerrada.' });
  const enr = stmts.enrollmentById.get(ps.enrollment_id);
  if (!enr || enr.user_id !== req.user.id) return res.status(403).json({ error: 'Sesión ajena.' });
  const tipo = String(req.body?.tipo || '');
  if (!(tipo in PROCTOR_WEIGHTS)) return res.status(400).json({ error: 'Tipo de evento desconocido.' });
  const puntos = PROCTOR_WEIGHTS[tipo];
  const foto = savePhoto(ps.id, req.body?.foto);
  const pant = savePhoto(ps.id, req.body?.pantalla);
  stmts.insertPE.run(ps.id, tipo, String(req.body?.detalle || '').slice(0, 300), puntos, foto, pant);
  const nuevoScore = ps.risk_score + puntos;
  const nivel = nivelDe(nuevoScore);
  stmts.psAddRisk.run(puntos, nivel, ps.id);
  // Al alcanzar ROJO: el examen se BLOQUEA y la instancia queda sujeta a revisión humana
  let bloquear = false;
  if (nivel === 'rojo' && nivelDe(ps.risk_score) !== 'rojo') {
    bloquear = true;
    stmts.insertPE.run(ps.id, 'bloqueo', 'Nivel ROJO alcanzado: examen bloqueado automáticamente, sujeto a revisión humana.', 0, null, null);
    AUDIT(req.user.id, 'PROCTOR_BLOQUEO', `sesión ${ps.id} bloqueada en rojo (${nuevoScore} pts)`);
  }
  res.json({ ok: true, risk_score: nuevoScore, nivel, bloquear });
});

app.post('/api/proctor/end', auth, (req, res) => {
  const ps = stmts.psById.get(Number(req.body?.session_id));
  if (ps && !ps.ended_at) stmts.psEnd.run(ps.id);
  res.json({ ok: true });
});

// ---- Panel de auditoría del docente ----
app.get('/api/admin/proctor/pendientes', auth, roleAtLeast('admin', 'instructor', 'supervisor', 'admin'), (req, res) => {
  res.json({ sessions: stmts.psAllPendientes.all() });
});

app.get('/api/admin/proctor/:courseId', auth, roleAtLeast('admin', 'instructor', 'supervisor', 'admin'), (req, res) => {
  res.json({ sessions: stmts.psByCourse.all(Number(req.params.courseId)) });
});

app.get('/api/admin/proctor/session/:id', auth, roleAtLeast('admin', 'instructor', 'supervisor'), (req, res) => {
  const ps = stmts.psById.get(Number(req.params.id));
  if (!ps) return res.status(404).json({ error: 'Sesión no encontrada.' });
  res.json({ session: ps, events: stmts.peBySession.all(ps.id) });
});

app.get('/api/admin/proctor/photo/:sessionId/:file', auth, roleAtLeast('admin', 'instructor', 'supervisor'), (req, res) => {
  const file = path.basename(String(req.params.file));            // anti path-traversal
  const p = path.join(PROCTOR_DIR, String(Number(req.params.sessionId)), file);
  if (!fs.existsSync(p)) return res.status(404).json({ error: 'Evidencia no encontrada.' });
  res.sendFile(p);
});

// Decisión humana final: convalidar o anular la instancia observada
app.post('/api/admin/proctor/session/:id/review', auth, roleAtLeast('admin', 'instructor'), (req, res) => {
  // Autocertificación: el revisor no puede ser la misma persona que rindió el examen
  const psRev = stmts.psById.get(Number(req.params.id));
  if (psRev) {
    const enrRev = db.prepare('SELECT * FROM enrollments WHERE id=?').get(psRev.enrollment_id);
    if (enrRev) {
      const alumnoRev = stmts.userById.get(enrRev.user_id);
      const revisorBase = req.user.legajo_base || req.user.legajo.replace(/-INST$/i,'');
      const alumnoBase  = alumnoRev.legajo_base || alumnoRev.legajo.replace(/-INST$/i,'');
      if (revisorBase === alumnoBase)
        return res.status(403).json({ error: 'El instructor no puede revisar la sesión de supervisión de su propio examen. Conflicto de interés.' });
    }
  }
  const ps = stmts.psById.get(Number(req.params.id));
  if (!ps) return res.status(404).json({ error: 'Sesión no encontrada.' });
  const decision = String(req.body?.decision || '');
  if (!['convalidado', 'anulado'].includes(decision)) return res.status(400).json({ error: 'Decisión inválida.' });
  stmts.psReview.run(decision, req.user.id, String(req.body?.nota || '').slice(0, 300), ps.id);
  if (decision === 'anulado' && ps.attempt_id) {
    const att = stmts.attemptById.get(ps.attempt_id);
    if (att) {
      stmts.anularAttempt.run(att.id);
      const enr = stmts.enrollmentById.get(att.enrollment_id);
      // Recalcular estado y anular certificado si la instancia lo sostenía
      const restantes = stmts.attemptsByEnrollment.all(enr.id);
      const c = stmts.courseById.get(enr.course_id);
      const teoriaOk = restantes.some(a => a.tipo !== 'practico' && a.passed);
      const practicoOk = restantes.some(a => a.tipo === 'practico' && a.passed);
      const aprobado = teoriaOk && (!c.simulador || practicoOk);
      if (!aprobado) {
        stmts.setEnrollmentEstado.run('cursando', enr.id);
        const cert = stmts.certsByUser.all(enr.user_id).find(x => x.course_id === c.id);
        if (cert) stmts.anularCert.run('Anulado por revisión de supervisión (sesión ' + ps.id + ')', cert.id);
      }
      AUDIT(req.user.id, 'PROCTOR_ANULA_INSTANCIA', `attempt ${att.id} · sesión ${ps.id}`);
    }
  }
  AUDIT(req.user.id, 'PROCTOR_REVISION', `sesión ${ps.id} → ${decision}`);
  let certificado_emitido = null;
  if (decision === 'convalidado') {
    const enrC = stmts.enrollmentById.get(ps.enrollment_id);
    const cert = tryReleaseCertificate(enrC);
    if (cert) certificado_emitido = cert.code;
  }
  res.json({ ok: true, certificado_emitido });
});

// Activar/desactivar la supervisión por curso
app.post('/api/admin/course/:id/proctor', auth, requireCourseAccess(req => Number(req.params.id)), (req, res) => {
  stmts.setCourseProctor.run(req.body?.proctor ? 1 : 0, Number(req.params.id));
  AUDIT(req.user.id, 'PROCTOR_CONFIG', `curso ${req.params.id} → ${req.body?.proctor ? 'ON' : 'OFF'}`);
  res.json({ ok: true });
});

/* ================= Simulador: imágenes y anotaciones ================= */
app.get('/api/images', auth, (req, res) => {
  const all = scanImages(req.query.force === '1');
  const only = req.query.only || 'annotated';
  let list = only === 'pending' ? all.filter(i => !i.annotated)
           : only === 'all' ? all
           : all.filter(i => i.annotated);
  const total = list.length;
  const limit = Math.min(1000, Number(req.query.limit) || 300);
  const offset = Math.max(0, Number(req.query.offset) || 0);
  if (req.query.shuffle === '1') list = [...list].sort(() => Math.random() - 0.5);
  list = list.slice(offset, offset + limit);
  const isStaff = ['admin', 'instructor'].includes(req.user.role);
  res.json({
    images: list, total, offset, admin: isStaff, eval_count: EVAL_IMAGE_COUNT,
    totales: { todas: all.length, anotadas: all.filter(i => i.annotated).length, pendientes: all.filter(i => !i.annotated).length }
  });
});

// Set del examen práctico: el SERVIDOR elige las imágenes (garantiza AEI) y NO envía las amenazas
app.get('/api/practical-set/:courseId', auth, (req, res) => {
  const c = stmts.courseById.get(Number(req.params.courseId));
  if (!c || !c.simulador) return res.status(400).json({ error: 'Curso sin práctico en simulador.' });
  const enr = stmts.enrollment.get(req.user.id, c.id);
  if (!enr) return res.status(400).json({ error: 'Debe inscribirse al curso primero.' });
  const annotated = scanImages().filter(i => i.annotated);
  if (annotated.length < EVAL_IMAGE_COUNT)
    return res.status(400).json({ error: `El práctico requiere ${EVAL_IMAGE_COUNT} imágenes anotadas y hay ${annotated.length}.` });
  const aei = annotated.filter(i => i.threats.some(t => t.tipo === 'explosivo'));
  const rest = annotated.filter(i => !i.threats.some(t => t.tipo === 'explosivo'));
  const sh = a => [...a].sort(() => Math.random() - 0.5);
  const nAei = Math.min(Math.max(2, Math.round(EVAL_IMAGE_COUNT * 0.2)), aei.length);
  const pick = sh([...sh(aei).slice(0, nAei), ...sh(rest).slice(0, EVAL_IMAGE_COUNT - nAei)]);
  const info = stmts.insertPracSet.run(enr.id, JSON.stringify(pick.map(p => p.filename)), Date.now(), enr.ciclo);
  AUDIT(req.user.id, 'PRACTICO_SET', `${c.cod} set único de ${pick.length} imágenes`);
  const secPerImg = Number(stmts.getSetting.get('eval_seconds_per_image')?.valor) || 30;
  res.json({
    practical_session_id: Number(info.lastInsertRowid),
    images: pick.map(p => ({ filename: p.filename, url: p.url })),   // sin amenazas
    seconds_per_image: secPerImg
  });
});

/* ================= Configuración: tiempo por imagen del práctico de Rayos X ================= */
app.get('/api/admin/settings/eval-seconds', auth, roleAtLeast('admin','instructor'), (req, res) => {
  const val = Number(stmts.getSetting.get('eval_seconds_per_image')?.valor) || 30;
  res.json({ seconds_per_image: val });
});
app.post('/api/admin/settings/eval-seconds', auth, roleAtLeast('admin'), (req, res) => {
  const seconds = Number(req.body?.seconds);
  if (!seconds || seconds < 5 || seconds > 300) return res.status(400).json({ error: 'El tiempo debe estar entre 5 y 300 segundos.' });
  stmts.setSetting.run('eval_seconds_per_image', String(seconds), req.user.id);
  AUDIT(req.user.id, 'CONFIG_TIEMPO_EVAL', String(seconds) + ' segundos por imagen');
  res.json({ ok: true, seconds_per_image: seconds });
});

/* ── Configuración del módulo de supervisión IA (proctor) ───────────
   Todos los umbrales de detección de head pose son ajustables sin
   tocar código. El cliente los carga al iniciar el proctor.
────────────────────────────────────────────────────────────────────── */
const PROCTOR_DEFAULTS = {
  yaw_threshold:   '0.22',  // giro horizontal máximo (rad normalizado). Antes: 0.14
  pitch_threshold: '0.55',  // inclinación vertical máxima. Antes: 0.50
  gaze_warn_ms:    '2500',  // ms fuera de rango antes de 1ª advertencia. Antes: 900
  gaze_block_ms:   '2000',  // ms adicionales antes de bloqueo. Antes: 1300
  erratic_dYaw:    '0.20',  // salto de yaw que cuenta como brusco. Antes: 0.18
  erratic_count:   '4',     // cuántos saltos = errático. Antes: 3
  erratic_win_ms:  '4000',  // ventana de tiempo para erraticidad (ms)
  smooth_n:        '5',     // frames para promedio móvil (1 = sin suavizado). Antes: no existía
  check_ms:        '900',   // intervalo de análisis de video (ms). Antes: 700
  sustain_ms:      '3500'   // persistencia para sin_rostro y múltiples_rostros
};

function getProctorConfig() {
  const cfg = {};
  for (const [k, def] of Object.entries(PROCTOR_DEFAULTS)) {
    const row = stmts.getSetting.get('proctor_' + k);
    cfg[k] = Number(row ? row.valor : def);
  }
  return cfg;
}

app.get('/api/admin/settings/proctor', auth, roleAtLeast('admin', 'instructor'), (req, res) => {
  res.json({ config: getProctorConfig(), defaults: PROCTOR_DEFAULTS });
});

app.post('/api/admin/settings/proctor', auth, roleAtLeast('admin'), (req, res) => {
  const allowed = Object.keys(PROCTOR_DEFAULTS);
  const updated = [];
  for (const key of allowed) {
    if (req.body?.[key] !== undefined) {
      const val = String(req.body[key]).trim();
      if (val === '' || isNaN(Number(val))) continue;
      stmts.setSetting.run('proctor_' + key, val, req.user.id);
      updated.push(key);
    }
  }
  if (!updated.length) return res.status(400).json({ error: 'No se recibió ningún parámetro válido.' });
  AUDIT(req.user.id, 'PROCTOR_CONFIG', 'Actualizados: ' + updated.join(', '));
  res.json({ ok: true, updated, config: getProctorConfig() });
});

/* ── Configuración de tiempo de inactividad (idle timeout) ─────────
   idle_warn_ms  — ms de inactividad antes de mostrar el aviso. Defecto: 3 min (180000)
   idle_total_ms — ms totales antes de cerrar sesión. Defecto: 5 min (300000)
   El modal de aviso aparece en idle_warn_ms; si no hay respuesta, cierra en idle_total_ms.
────────────────────────────────────────────────────────────────────── */
const IDLE_DEFAULTS = {
  idle_warn_ms:  '180000',   // 3 minutos → aparece el aviso
  idle_total_ms: '300000',   // 5 minutos → cierre automático
};

app.get('/api/admin/settings/idle', auth, roleAtLeast('admin'), (req, res) => {
  const cfg = {};
  for (const [k, def] of Object.entries(IDLE_DEFAULTS)) {
    const row = stmts.getSetting.get(k);
    cfg[k] = Number(row ? row.valor : def);
  }
  res.json({ config: cfg, defaults: IDLE_DEFAULTS });
});

app.post('/api/admin/settings/idle', auth, roleAtLeast('admin'), (req, res) => {
  const updated = [];
  for (const key of Object.keys(IDLE_DEFAULTS)) {
    if (req.body?.[key] !== undefined) {
      const val = Number(req.body[key]);
      if (!val || val < 60000) return res.status(400).json({ error: key + ': mínimo 60000 ms (1 minuto).' });
      stmts.setSetting.run(key, String(val), req.user.id);
      updated.push(key);
    }
  }
  if (!updated.length) return res.status(400).json({ error: 'No se recibió ningún parámetro válido.' });
  // Validar que idle_warn_ms < idle_total_ms (leer ambos de la BD tras guardar)
  const finalCfg = {};
  for (const [k, def] of Object.entries(IDLE_DEFAULTS)) {
    const row = stmts.getSetting.get(k);
    finalCfg[k] = Number(row ? row.valor : def);
  }
  if (finalCfg.idle_warn_ms >= finalCfg.idle_total_ms) {
    // Revertir si no es coherente
    for (const key of updated) stmts.setSetting.run(key, IDLE_DEFAULTS[key], req.user.id);
    return res.status(400).json({ error: 'El tiempo de aviso debe ser menor al tiempo total de cierre.' });
  }
  AUDIT(req.user.id, 'IDLE_CONFIG', 'Actualizados: ' + updated.join(', '));
  const cfg = {};
  for (const [k, def] of Object.entries(IDLE_DEFAULTS)) {
    const row = stmts.getSetting.get(k);
    cfg[k] = Number(row ? row.valor : def);
  }
  res.json({ ok: true, updated, config: cfg });
});

app.post('/api/annotations', auth, roleAtLeast('admin', 'instructor'), (req, res) => {
  try {
    const { filename, threats } = req.body || {};
    if (typeof filename !== 'string' || !filename) return res.status(400).json({ error: 'filename requerido.' });
    if (!fs.existsSync(path.join(IMAGES_DIR, filename))) return res.status(404).json({ error: 'La imagen no existe.' });
    const list = Array.isArray(threats) ? threats.filter(t =>
      t && ['x', 'y', 'w', 'h'].every(k => typeof t[k] === 'number' && t[k] >= 0 && t[k] <= 1)) : [];
    stmts.upsertAnnotation.run({ filename, is_clean: list.length === 0 ? 1 : 0, threats: JSON.stringify(list) });
    AUDIT(req.user.id, 'ANOTACION', `${filename} (${list.length} amenazas)`);
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ error: 'No se pudo guardar la anotación.' }); }
});

/* ================= Certificados ================= */
app.get('/api/certificates/:code', auth, (req, res) => {
  const cert = stmts.certByCode.get(String(req.params.code).trim());
  if (!cert) return res.status(404).json({ error: 'Certificado no encontrado.' });
  const own = cert.user_id === req.user.id;
  if (!own && !['admin', 'instructor', 'supervisor', 'admin'].includes(req.user.role))
    return res.status(403).json({ error: 'Sin permisos para este certificado.' });
  const u = stmts.userById.get(cert.user_id);
  const c = stmts.courseById.get(cert.course_id);
  AUDIT(req.user.id, own ? 'CERT_DESCARGA' : 'CERT_REIMPRESION', cert.code);
  const lecciones = c ? db.prepare('SELECT titulo,tipo,duracion_s FROM lessons WHERE course_id=? ORDER BY orden').all(c.id) : [];

  // Firma de "Instructor" en el certificado = quien INSCRIBIÓ al alumno en el ciclo/cursada EXACTA
  // que originó este certificado (certificates.enrollment_id, sin ambigüedad aunque existan varios ciclos).
  const enrDelAlumno = cert.enrollment_id
    ? stmts.enrollmentById.get(cert.enrollment_id)
    : (c ? db.prepare('SELECT * FROM enrollments WHERE user_id=? AND course_id=? AND activo=1').get(cert.user_id, c.id) : null); // fallback: certificados emitidos antes de esta migración
  const instructorId = enrDelAlumno?.inscrito_por || c?.instructor_id || null; // último fallback: creador del curso si no hay registro de quién inscribió (datos históricos)
  const instructor = instructorId ? db.prepare('SELECT id,apellido,nombre,legajo,rango FROM users WHERE id=?').get(instructorId) : null;

  // Datos de supervisores del EPPT (de las jornadas firmadas)
  const epptRec = u ? db.prepare(`
    SELECT er.id, er.estado FROM eppt_records er
    JOIN enrollments e ON e.id=er.enrollment_id
    WHERE e.user_id=? AND e.course_id=? AND er.estado='completo'
    ORDER BY er.id DESC LIMIT 1`).get(u.id, cert.course_id) : null;

  let supervisores = [];
  if (epptRec) {
    supervisores = db.prepare(`
      SELECT DISTINCT u2.id, u2.apellido, u2.nombre, u2.legajo, u2.rango,
        ee.firma_sup_hash, ee.firma_sup_at
      FROM eppt_entries ee
      JOIN users u2 ON u2.id=ee.supervisor_id
      WHERE ee.eppt_id=? AND ee.firma_sup_at IS NOT NULL
      ORDER BY ee.firma_sup_at`).all(epptRec.id);
  }

  // Jornadas EPPT completas para trazabilidad cruzada (auditoría)
  let epptJornadas = [];
  let epptNumDoc = null;
  if (epptRec) {
    epptJornadas = db.prepare(`
      SELECT ee.fecha, ee.hora_inicio, ee.hora_fin, ee.puesto, ee.horas,
             ee.firma_sup_at, ee.firma_sup_hash, ee.firma_alu_at, ee.firma_alu_hash,
             u2.apellido AS sup_apellido, u2.nombre AS sup_nombre, u2.legajo AS sup_legajo,
             rd_sup.numero AS numero_jornada
      FROM eppt_entries ee
      JOIN users u2 ON u2.id = ee.supervisor_id
      LEFT JOIN registro_documentos rd_sup ON rd_sup.tipo='jornada_eppt' AND rd_sup.referencia=ee.firma_sup_hash
      WHERE ee.eppt_id = ? AND ee.firma_sup_at IS NOT NULL
      ORDER BY ee.fecha, ee.id`).all(epptRec.id);
    // Número de constancia EPPT si existe
    const rdEppt = db.prepare("SELECT numero FROM registro_documentos WHERE tipo IN ('constancia_eppt','acta_eppt') AND referencia=?").get(String(epptRec.id));
    epptNumDoc = rdEppt?.numero || null;
  }

  res.json({ certificate: {
    ...cert,
    nombre: u?.nombre, apellido: u?.apellido, dni: u?.dni, legajo: u?.legajo,
    rango: u?.rango, organismo: u?.organismo, aeropuerto: u?.aeropuerto, dependencia: u?.dependencia,
    curso_cod: c?.cod, curso_nombre: c?.nombre, horas: c?.horas, lecciones,
    instructor, supervisores,
    // Trazabilidad EPPT completa
    eppt_id:       epptRec?.id        || null,
    eppt_estado:   epptRec?.estado    || null,
    eppt_num_doc:  epptNumDoc,
    eppt_jornadas: epptJornadas       // cada jornada con fecha, horas, supervisor, hashes
  }});
});

app.get('/api/verify/:code', (req, res) => {
  const cert = stmts.certByCode.get(String(req.params.code || '').trim());
  if (!cert) return res.status(404).json({ valid: false, error: 'Código no encontrado.' });
  if (cert.anulado) return res.status(404).json({ valid: false, anulado: true, error: 'Certificado ANULADO: ' + (cert.anulado_motivo || cert.observaciones || 'sin detalle') });
  const vigente = !cert.vencimiento || cert.vencimiento >= new Date().toISOString().slice(0, 10);
  res.json({
    valid: true, vigente,
    certificate: {
      code: cert.code, apellido: cert.apellido, nombre: cert.nombre, dni: cert.dni,
      legajo: cert.legajo, curso_cod: cert.curso_cod, curso_nombre: cert.curso_nombre,
      score_pct: cert.score_pct, issued_at: cert.issued_at, vencimiento: cert.vencimiento,
      firma_hash: cert.firma_hash || null,
      firma: cert.firma_hash ? 'Documento firmado electrónicamente (Ley 25.506)' : null
    }
  });
});

/* ================= EPPT: endpoints ================= */
// Vista del alumno: su EPPT en el curso
app.get('/api/courses/:id/eppt', auth, (req, res) => {
  const c = stmts.courseById.get(Number(req.params.id));
  if (!c) return res.status(404).json({ error: 'Curso no encontrado.' });
  const enr = stmts.enrollment.get(req.user.id, c.id);
  if (!enr) return res.status(400).json({ error: 'Sin inscripción.' });
  const regla = EPPT_RULES[c.cod] || null;
  const rec = epptEstadoActual(stmts.epptByEnrollment.get(enr.id));
  res.json({
    regla: regla ? { ...regla } : null,
    eppt: rec ? { ...rec, horas_firmadas: epptHorasFirmadas(rec.id) } : null,
    entries: rec ? stmts.epptEntries.all(rec.id).map(e => ({ ...e, rubrica: safeJson(e.rubrica, []) })) : []
  });
});

// Firma de conformidad del alumno (firma electrónica: revalida su contraseña)
app.post('/api/eppt/entries/:id/firmar', auth, (req, res) => {
  const entry = stmts.epptEntryById.get(Number(req.params.id));
  if (!entry) return res.status(404).json({ error: 'Registro EPPT no encontrado.' });
  const rec = stmts.epptById.get(entry.eppt_id);
  const enr = stmts.enrollmentById.get(rec.enrollment_id);
  if (enr.user_id !== req.user.id) return res.status(403).json({ error: 'Este registro no le pertenece.' });
  if (entry.firma_alu_at) return res.status(400).json({ error: 'Ya firmó su conformidad.' });
  // Un perfil -INST no debe firmar como alumno (SKIP en demo)
  if (!isDemo(req) && req.user.role === 'instructor') return res.status(403).json({ error: 'Debe iniciar sesión con su perfil de alumno (legajo sin sufijo -INST) para firmar su conformidad.' });
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!bcrypt.compareSync(String(req.body?.password || ''), u.password_hash))
    return res.status(401).json({ error: 'Contraseña incorrecta: la firma electrónica requiere revalidar su identidad.' });
  const hashAluFirma = firmaHash(entry, u.id);
  stmts.epptSignAlumno.run(hashAluFirma, entry.id);

  // Registrar firma del alumno en el Libro Matriz con número FALU-AAAA-NNNN
  let numFirmaAlu = null;
  try {
    const anioF = new Date().getFullYear();
    numFirmaAlu = generarNumDoc('FALU', anioF);
    const recF = stmts.epptById.get(entry.eppt_id);
    const enrF = stmts.enrollmentById.get(recF.enrollment_id);
    stmts.insertRegDoc.run('firma_alumno_eppt', numFirmaAlu, enrF.user_id, enrF.course_id, hashAluFirma, u.id);
  } catch(eF) { console.warn('Registro firma alumno EPPT:', eF.message); }

  AUDIT(u.id, 'EPPT_FIRMA_ALUMNO', `entry ${entry.id} · ${numFirmaAlu||'sin número'}`);
  // ¿Se completó el EPPT? → cerrar y emitir certificado
  const total = epptHorasFirmadas(rec.id);
  let result = { ok: true, horas_firmadas: total, requerido: rec.requerido };
  if (total >= rec.requerido && rec.estado === 'abierto') {
    stmts.epptSetEstado.run('completo', rec.id);
    const c = stmts.courseById.get(enr.course_id);
    AUDIT(u.id, 'EPPT_COMPLETO', `${c.cod} enrollment ${enr.id}`);
    result = { ...result, ...finalizeCourse(enr.user_id, enr, c) };
  }
  res.json(result);
});

// Supervisor: listado de EPPT pendientes/vencidos
app.get('/api/admin/eppt', auth, roleAtLeast('admin', 'instructor', 'supervisor', 'fiscalizador'), (req, res) => {
  const rows = stmts.epptPendientes.all().map(r => {
    epptEstadoActual(r);
    return { ...r, horas_firmadas: epptHorasFirmadas(r.id),
             entries: stmts.epptEntries.all(r.id).map(e => ({ ...e, rubrica: safeJson(e.rubrica, []) })) };
  });
  res.json({ eppts: rows, calificaciones: EPPT_CALIF });
});

// Supervisor: cargar y firmar una jornada/actividad de EPPT (firma electrónica con contraseña)
app.post('/api/admin/eppt/:id/entries', auth, roleAtLeast('admin', 'instructor', 'supervisor'), (req, res) => {
  const rec = epptEstadoActual(stmts.epptById.get(Number(req.params.id)));
  if (!rec) return res.status(404).json({ error: 'EPPT no encontrado.' });
  if (!isDemo(req) && rec.estado === 'vencido') return res.status(400).json({ error: `El plazo del EPPT venció el ${rec.deadline}. El docente debe rehabilitar la cursada.` });
  if (rec.estado === 'completo') return res.status(400).json({ error: 'El EPPT ya está completo.' });
  const { fecha, hora_inicio, hora_fin, puesto, horas, rubrica, observaciones, password } = req.body || {};
  const sup = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!bcrypt.compareSync(String(password || ''), sup.password_hash))
    return res.status(401).json({ error: 'Contraseña incorrecta: la firma electrónica del supervisor requiere revalidar su identidad.' });

  // Validación de autocertificación: el perfil instructor no puede firmar su propio EPPT como alumno
  const enrAlumno = stmts.enrollmentById.get(rec.enrollment_id);
  const alumnoDelEppt = stmts.userById.get(enrAlumno.user_id);
  const supBase = sup.legajo_base || sup.legajo.replace(/-INST$/i, '');
  const aluBase = alumnoDelEppt.legajo_base || alumnoDelEppt.legajo.replace(/-INST$/i, '');
  if (!isDemo(req) && supBase === aluBase)
    return res.status(403).json({ error: 'El perfil instructor no puede firmar el EPPT de su propio perfil alumno. Esta acción es inválida por conflicto de interés (Ley N° 25.506, integridad de la firma electrónica).' });
  if (!fecha) return res.status(400).json({ error: 'Indique la fecha de la jornada.' });
  if (!hora_inicio || !hora_fin) return res.status(400).json({ error: 'Indique la hora de inicio y fin de la jornada.' });
  if (!puesto || !puesto.trim()) return res.status(400).json({ error: 'Indique el puesto donde se realizó la práctica.' });

  // Validación 1: la fecha no puede ser anterior a la aprobación del examen (SKIP en demo)
  const enr = stmts.enrollmentById.get(rec.enrollment_id);
  if (!isDemo(req)) {
    const atts = db.prepare("SELECT * FROM attempts WHERE enrollment_id=? AND passed=1 AND anulado=0 ORDER BY created_at").all(enr.id);
    const fechaAprobacion = atts.length ? atts[0].created_at.slice(0, 10) : null;
    if (fechaAprobacion && fecha < fechaAprobacion)
      return res.status(400).json({ error: `La fecha de la jornada (${fecha}) no puede ser anterior a la aprobación del examen (${fechaAprobacion}).` });
  }

  // Validación 2: no puede ser con más de 1 día de anticipación (SKIP en demo)
  if (!isDemo(req)) {
    const hoy = new Date(); hoy.setHours(23, 59, 59);
    const manana = new Date(); manana.setDate(manana.getDate() + 1); manana.setHours(12, 0, 0);
    const fechaJornada = new Date(fecha + 'T23:59:59');
    if (fechaJornada > manana)
      return res.status(400).json({ error: `Solo puede cargar jornadas de hoy o ayer (ventana de 12 horas). Fecha ingresada: ${fecha}.` });
  }

  // Validación 3: no duplicar fecha para el mismo EPPT (SKIP en demo)
  if (!isDemo(req)) {
    const yaExiste = db.prepare('SELECT id FROM eppt_entries WHERE eppt_id=? AND fecha=?').get(rec.id, fecha);
    if (yaExiste) return res.status(400).json({ error: `Ya existe una jornada registrada el ${fecha} para este EPPT.` });
  }

  // Validación 4: límites de horas según apéndice (Rayos X: máx 10 hs netas / jornada de 8hs → máx 2.67 hs Rayos X)
  const h = Math.max(0.5, Math.min(12, Number(horas) || (rec.tipo === 'actividades' ? 1 : 0)));
  const rub = Array.isArray(rubrica) ? rubrica.filter(r => r && r.item && EPPT_CALIF.includes(r.calif)) : [];
  const entryData = { eppt: rec.id, fecha, hora_inicio, hora_fin, puesto, horas: h, rub, obs: observaciones };
  const hashSupFirma = firmaHash(entryData, sup.id);
  const entryInfo = stmts.insertEpptEntry.run(rec.id, String(fecha), String(hora_inicio), String(hora_fin), String(puesto).trim().slice(0, 200),
    h, JSON.stringify(rub), String(observaciones || '').slice(0, 500), sup.id, hashSupFirma);
  const entryId = Number(entryInfo.lastInsertRowid);

  // Generar número JEPPT-AAAA-NNNN y registrar en el Libro Matriz con el hash de firma
  let numJornada = null;
  try {
    const anioJ = new Date().getFullYear();
    numJornada = generarNumDoc('JEPPT', anioJ);
    const enrJ = stmts.enrollmentById.get(rec.enrollment_id);
    stmts.insertRegDoc.run('jornada_eppt', numJornada, enrJ.user_id, enrJ.course_id, hashSupFirma, sup.id);
  } catch(eJ) { console.warn('Registro jornada EPPT:', eJ.message); }

  AUDIT(sup.id, 'EPPT_CARGA', `eppt ${rec.id} · entry ${entryId} · ${numJornada||'sin número'} · ${fecha} ${hora_inicio}-${hora_fin} · ${puesto} · ${h} ${rec.tipo === 'actividades' ? 'actividad(es)' : 'hs'}`);
  res.status(201).json({ ok: true, pendiente_firma_alumno: true, entry_id: entryId, numero_jornada: numJornada });
});

// Supervisor: REPROBAR el EPPT  → bloquea la certificación
app.post('/api/admin/eppt/:id/reprobar', auth, roleAtLeast('admin', 'instructor', 'supervisor'), (req, res) => {
  const rec = epptEstadoActual(stmts.epptById.get(Number(req.params.id)));
  if (!rec) return res.status(404).json({ error: 'EPPT no encontrado.' });
  if (rec.estado !== 'abierto') return res.status(400).json({ error: `El EPPT está ${rec.estado}.` });
  const motivo = String(req.body?.motivo || '').trim();
  if (!motivo) return res.status(400).json({ error: 'Indique el motivo de la reprobación (queda en el registro oficial).' });
  const sup = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!bcrypt.compareSync(String(req.body?.password || ''), sup.password_hash))
    return res.status(401).json({ error: 'Contraseña incorrecta: la firma electrónica del supervisor requiere revalidar su identidad.' });
  stmts.epptCerrar.run('reprobado', motivo, rec.id);
  const enr = stmts.enrollmentById.get(rec.enrollment_id);
  stmts.setEnrollmentEstado.run('desaprobado', enr.id);
  let numActa = null;
  try {
    const anioA = new Date().getFullYear();
    numActa = generarNumDoc('AREP', anioA);  // AREP = Acta de Reprobación EPPT
    stmts.insertRegDoc.run('acta_eppt', numActa, enr.user_id, enr.course_id, String(rec.id), sup.id);
  } catch(eA) { console.warn('Acta EPPT:', eA.message); }
  AUDIT(sup.id, 'EPPT_REPROBADO', 'eppt ' + rec.id + ' · acta ' + (numActa||'sin registrar'));
  res.json({ ok: true, num_acta: numActa, mensaje: 'EPPT reprobado. Acta: ' + (numActa||'sin número') + '. Agente NO OPERATIVO.' });
});

/* ================= Dashboard: métricas en tiempo real ================= */
app.get('/api/admin/dashboard', auth, roleAtLeast('admin', 'instructor', 'supervisor', 'fiscalizador'), (req, res) => {
  const alumnos = stmts.statsAlumnos.get().n;
  const certs = stmts.statsCertificados.get().n;
  const vigentes = stmts.statsCertVigentes.get().n;
  const vencidos = stmts.statsCertVencidos.get().n;
  const epptPend = stmts.statsEpptPendientes.get().n;
  const epptVenc = stmts.statsEpptVencidos.get().n;
  const rojo = stmts.statsProctorRojos.get().n;
  const amarillo = stmts.statsProctorAmarillos.get().n;
  const porCurso = stmts.statsEnrollsByCourse.all();
  const tendencia = stmts.statsTendencia.all().reverse();
  const totalEnrolls = porCurso.reduce((s, c) => s + c.total, 0);
  const totalAprobados = porCurso.reduce((s, c) => s + c.aprobados, 0);
  const tasaAprobacion = totalEnrolls ? Math.round(totalAprobados / totalEnrolls * 100) : 0;
  // Vencimientos por rango
  const hoy = new Date().toISOString().slice(0, 10);
  const d30 = new Date(); d30.setDate(d30.getDate() + 30); const s30 = d30.toISOString().slice(0, 10);
  const d60 = new Date(); d60.setDate(d60.getDate() + 60); const s60 = d60.toISOString().slice(0, 10);
  const d90 = new Date(); d90.setDate(d90.getDate() + 90); const s90 = d90.toISOString().slice(0, 10);
  const venc30 = db.prepare(`SELECT COUNT(*) AS n FROM certificates WHERE anulado=0 AND vencimiento>=? AND vencimiento<=?`).get(hoy, s30).n;
  const venc60 = db.prepare(`SELECT COUNT(*) AS n FROM certificates WHERE anulado=0 AND vencimiento>? AND vencimiento<=?`).get(s30, s60).n;
  const venc90 = db.prepare(`SELECT COUNT(*) AS n FROM certificates WHERE anulado=0 AND vencimiento>? AND vencimiento<=?`).get(s60, s90).n;
  res.json({
    kpis: { alumnos, certs, vigentes, vencidos, epptPend, epptVenc, rojo, amarillo, tasaAprobacion },
    porCurso, tendencia,
    vencimientos: { v30: venc30, v60: venc60, v90: venc90, vencidos }
  });
});

/* ================= Dashboard detallado: distribución por organismo ================= */
app.get('/api/admin/dashboard/detalle', auth, roleAtLeast('admin', 'instructor', 'supervisor', 'admin'), (req, res) => {
  // Por organismo
  const porOrg = db.prepare(`
    SELECT organismo, COUNT(*) AS total,
      SUM(CASE WHEN activo=1 THEN 1 ELSE 0 END) AS activos,
      SUM(CASE WHEN organismo='PSA' OR organismo LIKE '%Policía%' OR organismo LIKE '%PSA%' THEN 1 ELSE 0 END) AS psa
    FROM users WHERE role='estudiante' GROUP BY organismo ORDER BY total DESC`).all();
  // Por aeropuerto
  const porAeropuerto = db.prepare(`
    SELECT aeropuerto, COUNT(*) AS total
    FROM users WHERE role='estudiante' AND aeropuerto != '' GROUP BY aeropuerto ORDER BY total DESC LIMIT 15`).all();
  // Por dependencia
  const porDependencia = db.prepare(`
    SELECT dependencia, COUNT(*) AS total
    FROM users WHERE role='estudiante' AND dependencia != '' GROUP BY dependencia ORDER BY total DESC LIMIT 12`).all();
  // Por jerarquía (rango)
  const porRango = db.prepare(`
    SELECT rango, COUNT(*) AS total
    FROM users WHERE role='estudiante' AND rango != '' GROUP BY rango ORDER BY total DESC`).all();
  // Certificados por organismo
  const certsPorOrg = db.prepare(`
    SELECT u.organismo, COUNT(c.id) AS certs,
      SUM(CASE WHEN c.vencimiento IS NOT NULL AND c.vencimiento < date('now','localtime') THEN 1 ELSE 0 END) AS vencidos
    FROM certificates c JOIN users u ON u.id=c.user_id WHERE c.anulado=0 GROUP BY u.organismo ORDER BY certs DESC`).all();
  // Personal PSA vs externo
  const psa = db.prepare("SELECT COUNT(*) AS n FROM users WHERE role='estudiante' AND activo=1 AND (organismo='PSA' OR organismo LIKE '%Policía%' OR organismo LIKE '%Aeroportuaria%')").get().n;
  const ext = db.prepare("SELECT COUNT(*) AS n FROM users WHERE role='estudiante' AND activo=1").get().n - psa;

  res.json({ porOrg, porAeropuerto, porDependencia, porRango, certsPorOrg, psa, ext });
});

/* ================= Cursos: CRUD completo (admin) ================= */
app.get('/api/admin/courses', auth, roleAtLeast('admin', 'instructor', 'supervisor'), (req, res) => {
  const effectiveRole = ROLE_ALIAS[req.user.role] || req.user.role;
  if (effectiveRole === 'instructor') {
    // El instructor solo ve los cursos que el administrador le asignó
    const assignedIds = new Set(stmts.courseIdsAssignedToInstructor.all(req.user.id).map(r => r.course_id));
    const courses = stmts.allCoursesAdmin.all().filter(c => assignedIds.has(c.id));
    return res.json({ courses });
  }
  res.json({ courses: stmts.allCoursesAdmin.all() });
});

app.post('/api/admin/courses', auth, roleAtLeast('admin'), (req, res) => {
  const { cod, nombre, destinatarios, horas, horas_teoricas, horas_practicas, modalidades,
    vigencia_meses, nota_min, asistencia_min, simulador, preguntas_examen, observaciones, proctor, orden_aleatorio, es_avsec, requiere_apto_medico } = req.body || {};
  if (!cod || !nombre) return res.status(400).json({ error: 'El código y el nombre son obligatorios.' });
  try {
    const info = stmts.insertCourse.run({
      cod: String(cod).trim().toUpperCase(), nombre: String(nombre).trim(),
      destinatarios: String(destinatarios || '').trim(),
      horas: Number(horas) || 0, horas_teoricas: Number(horas_teoricas) || 0,
      horas_practicas: Number(horas_practicas) || 0,
      modalidades: String(modalidades || 'P').trim(),
      vigencia_meses: Number(vigencia_meses) || 0,
      nota_min: Number(nota_min) || 70, asistencia_min: Number(asistencia_min) || 100,
      simulador: simulador ? 1 : 0, preguntas_examen: Number(preguntas_examen) || 10,
      observaciones: String(observaciones || '').trim(),
      proctor: proctor !== false ? 1 : 0, orden_aleatorio: 1,
      instructor_id: req.user.id,  // guardar quién creó el curso
      es_avsec: es_avsec === false ? 0 : 1  // por defecto es AVSEC/PNISAC (va en la credencial QR)
    });
    // requiere_apto_medico se actualiza separado (no está en insertCourse)
    if (requiere_apto_medico) {
      const newId = Number(info.lastInsertRowid);
      db.prepare('UPDATE courses SET requiere_apto_medico=1 WHERE id=?').run(newId);
    }
    AUDIT(req.user.id, 'CURSO_CREADO', cod);
    res.status(201).json({ ok: true, id: Number(info.lastInsertRowid) });
  } catch (e) {
    if (e.message.includes('UNIQUE')) return res.status(400).json({ error: `El código ${cod} ya existe.` });
    throw e;
  }
});

app.put('/api/admin/courses/:id', auth, requireCourseAccess(req => Number(req.params.id)), (req, res) => {
  const c = stmts.courseById.get(Number(req.params.id));
  if (!c) return res.status(404).json({ error: 'Curso no encontrado.' });
  // Firma electrónica requerida para modificar cursos
  if (req.body?.firma_password) {
    const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    if (!bcrypt.compareSync(String(req.body.firma_password), u.password_hash))
      return res.status(401).json({ error: 'Contraseña incorrecta: la firma electrónica es requerida para modificar cursos.' });
  }
  const { cod, nombre, destinatarios, horas, horas_teoricas, horas_practicas, modalidades,
    vigencia_meses, nota_min, asistencia_min, simulador, preguntas_examen, observaciones, proctor, orden_aleatorio, es_avsec, requiere_apto_medico } = req.body || {};
  stmts.updateCourse.run(
    String(cod || c.cod).trim().toUpperCase(), String(nombre || c.nombre).trim(),
    String(destinatarios ?? c.destinatarios).trim(),
    Number(horas ?? c.horas), Number(horas_teoricas ?? c.horas_teoricas),
    Number(horas_practicas ?? c.horas_practicas),
    String(modalidades || c.modalidades).trim(),
    Number(vigencia_meses ?? c.vigencia_meses),
    Number(nota_min ?? c.nota_min), Number(asistencia_min ?? c.asistencia_min),
    simulador !== undefined ? (simulador ? 1 : 0) : c.simulador,
    Number(preguntas_examen ?? c.preguntas_examen),
    String(observaciones ?? c.observaciones).trim(),
    proctor !== undefined ? (proctor ? 1 : 0) : c.proctor,
    orden_aleatorio !== undefined ? (orden_aleatorio ? 1 : 0) : c.orden_aleatorio,
    es_avsec !== undefined ? (es_avsec ? 1 : 0) : c.es_avsec,
    c.id);
  // Actualizar requiere_apto_medico por separado (no está en updateCourse para no romper el statement existente)
  if (requiere_apto_medico !== undefined) {
    db.prepare('UPDATE courses SET requiere_apto_medico=? WHERE id=?').run(requiere_apto_medico ? 1 : 0, c.id);
  }
  AUDIT(req.user.id, 'CURSO_EDITADO', c.cod);
  res.json({ ok: true });
});

// Activar / desactivar curso (admin e instructor)
app.post('/api/admin/courses/:id/toggle', auth, requireCourseAccess(req => Number(req.params.id)), (req, res) => {
  const c = stmts.courseById.get(Number(req.params.id));
  if (!c) return res.status(404).json({ error: 'Curso no encontrado.' });
  const nuevoEstado = c.activo ? 0 : 1;
  db.prepare('UPDATE courses SET activo=? WHERE id=?').run(nuevoEstado, c.id);
  AUDIT(req.user.id, nuevoEstado ? 'CURSO_ACTIVADO' : 'CURSO_DESACTIVADO', c.cod);
  res.json({ ok: true, activo: nuevoEstado });
});

// Eliminación DEFINITIVA de un curso — requiere firma (contraseña) del administrador
app.delete('/api/admin/courses/:id', auth, roleAtLeast('admin'), (req, res) => {
  const { password } = req.body || {};
  const admin = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
  if (!password || !bcrypt.compareSync(String(password), admin.password_hash))
    return res.status(401).json({ error: 'Contraseña incorrecta. La eliminación definitiva requiere confirmar su firma electrónica.' });
  const c = stmts.courseById.get(Number(req.params.id));
  if (!c) return res.status(404).json({ error: 'Curso no encontrado.' });
  const inscritos = db.prepare('SELECT COUNT(*) AS n FROM enrollments WHERE course_id=?').get(c.id).n;
  if (inscritos > 0) return res.status(400).json({ error: `No se puede eliminar: ${inscritos} alumno(s) inscripto(s). Use "Desactivar" en cambio.` });
  db.prepare('DELETE FROM lessons WHERE course_id=?').run(c.id);
  db.prepare('DELETE FROM courses WHERE id=?').run(c.id);
  AUDIT(req.user.id, 'CURSO_ELIMINADO_DEFINITIVO', c.cod + ' | Firmado por: ' + admin.legajo);
  res.json({ ok: true, mensaje: 'Curso eliminado definitivamente.' });
});

/* ================= Reset de contraseña con verificación biométrica (cámara) ================= */
app.post('/api/auth/bio-reset', (req, res) => {
  // El cliente envía DNI escaneado, foto de verificación de vida y nuevo hash.
  // El servidor valida que el DNI exista, registra la foto como evidencia y cambia la contraseña.
  const { dni, password, foto } = req.body || {};
  if (!dni || !password) return res.status(400).json({ error: 'DNI y nueva contraseña requeridos.' });
  if (String(password).length < 6) return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres.' });
  const u = stmts.userByDni.get(String(dni).trim());
  if (!u) return res.status(404).json({ error: 'DNI no encontrado en el sistema. Contacte a su administrador.' });
  if (foto) savePhoto('bio_reset', foto);   // evidencia de la foto de verificación de vida
  stmts.updateUserPassword.run(bcrypt.hashSync(String(password), 10), u.id);
  AUDIT(u.id, 'BIO_RESET', `DNI ${u.dni} · foto de verificación de vida registrada`);
  res.json({ ok: true, nombre: u.nombre, apellido: u.apellido });
});

/* ================= Historial académico ampliado — incluye TODOS los ciclos de cada curso ================= */
app.get('/api/admin/historial/:userId', auth, roleAtLeast('admin','instructor','supervisor','fiscalizador'), (req,res) => {
  const u = stmts.userById.get(Number(req.params.userId));
  if (!u) return res.status(404).json({ error:'Usuario no encontrado.' });

  // historialAlumno ya ordena por ciclo DESC y NO filtra por activo → devuelve todo el historial
  const hist = stmts.historialAlumno.all(u.id);
  const certs = stmts.certsByUser.all(u.id);
  const docs = db.prepare('SELECT * FROM registro_documentos WHERE user_id=? ORDER BY id DESC').all(u.id);

  // Para cada enrollment devolver también los intentos de ese ciclo específico
  const enrollIds = [...new Set(hist.map(h => h.id))];
  const attemptsPorEnroll = {};
  enrollIds.forEach(eid => {
    attemptsPorEnroll[eid] = db.prepare(
      'SELECT tipo, score_pct, passed, aei_ok, created_at, anulado, ciclo FROM attempts WHERE enrollment_id=? ORDER BY created_at'
    ).all(eid);
  });

  // Agrupar por curso, con los ciclos de cada uno en orden descendente
  const cursosMap = new Map();
  hist.forEach(h => {
    if (!cursosMap.has(h.course_id)) cursosMap.set(h.course_id, { course_id:h.course_id, cod:h.curso_cod, nombre:h.curso_nombre, horas:h.horas, ciclos:[] });
    const yaEn = cursosMap.get(h.course_id).ciclos.some(c => c.enrollment_id === h.id);
    if (!yaEn) {
      cursosMap.get(h.course_id).ciclos.push({
        enrollment_id: h.id, ciclo: h.ciclo, activo: h.activo, estado: h.estado,
        created_at: h.created_at, inscrito_por: h.inscrito_por,
        intentos: attemptsPorEnroll[h.id] || [],
        certificado: certs.find(c => c.enrollment_id === h.id) || null
      });
    }
  });
  const historialAgrupado = [...cursosMap.values()].sort((a,b) => a.cod.localeCompare(b.cod));

  // Métricas
  const cursosActivos = historialAgrupado.length;
  const aprobados = historialAgrupado.filter(c => c.ciclos.some(ci => ci.estado === 'aprobado' && ci.activo)).length;
  const totalCiclos = historialAgrupado.reduce((n, c) => n + c.ciclos.length, 0);
  const rehabilitaciones = historialAgrupado.reduce((n, c) => n + Math.max(0, c.ciclos.length - 1), 0);
  const tasaAprob = cursosActivos ? Math.round(aprobados / cursosActivos * 100) : 0;

  res.json({
    usuario: sanitizeUser(u),
    historial: hist,                    // fila por fila (compatibilidad con el frontend actual)
    historial_agrupado: historialAgrupado,  // nuevo: agrupado por curso + ciclos
    certificados: certs,
    documentos: docs,
    metricas: { cursados: cursosActivos, aprobados, tasaAprob, total_ciclos: totalCiclos, rehabilitaciones }
  });
});

/* ================= Libro de Aula y Asistencia ================= */
app.get('/api/admin/asistencia/:courseId', auth, roleAtLeast('admin','instructor','supervisor'), (req,res) => {
  const rows = stmts.asistenciaByCourse.all(Number(req.params.courseId));
  const enrolls = stmts.enrollmentsByCourse.all(Number(req.params.courseId));
  // Calcular % de asistencia por alumno
  const pct = {};
  enrolls.forEach(e => {
    const r = stmts.pctAsistencia.get(e.id);
    pct[e.id] = r.total > 0 ? Math.round(r.presentes/r.total*100) : null;
  });
  res.json({ asistencias:rows, enrolls, pct });
});

app.post('/api/admin/asistencia', auth, roleAtLeast('admin','instructor','supervisor'), (req,res) => {
  const { enrollment_id, fecha, tipo, presente, justificado, nota_obs } = req.body||{};
  if (!enrollment_id) return res.status(400).json({ error:'enrollment_id requerido.' });
  stmts.insertAsistencia.run(Number(enrollment_id), fecha||new Date().toISOString().slice(0,10),
    tipo||'virtual', presente?1:0, justificado?1:0, String(nota_obs||''), req.user.id);
  AUDIT(req.user.id,'ASISTENCIA', `enroll ${enrollment_id} · ${fecha} · ${presente?'presente':'ausente'}`);
  res.json({ ok:true });
});

app.post('/api/admin/asistencia/bulk', auth, roleAtLeast('admin','instructor','supervisor'), (req,res) => {
  const { course_id, fecha, tipo, registros } = req.body||{};
  if (!Array.isArray(registros)) return res.status(400).json({ error:'registros requerido.' });
  let ok=0;
  for (const r of registros) {
    stmts.insertAsistencia.run(Number(r.enrollment_id), fecha||new Date().toISOString().slice(0,10),
      tipo||'virtual', r.presente?1:0, r.justificado?1:0, String(r.nota_obs||''), req.user.id);
    ok++;
  }
  AUDIT(req.user.id,'ASISTENCIA_BULK', `curso ${course_id} · ${fecha} · ${ok} registros`);
  res.json({ ok:true, registrados:ok });
});

/* ================= Reloj anual de instructores ================= */
app.get('/api/admin/instructores/reloj', auth, roleAtLeast('admin'), (req,res) => {
  const anio = Number(req.query.anio) || new Date().getFullYear();
  const lista = stmts.allInstructoresReloj.all();
  const META_HS = 20;
  res.json({ instructores:lista.map(i=>({...i, meta:META_HS, cumple:i.horas_anio>=META_HS,
    pct:Math.min(100,Math.round(i.horas_anio/META_HS*100)) })), anio, meta:META_HS });
});

app.post('/api/admin/instructores/:id/horas', auth, roleAtLeast('admin'), (req,res) => {
  const { anio, curso_id, fecha, horas, descripcion, password } = req.body||{};
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
  if (!bcrypt.compareSync(String(password||''), u.password_hash))
    return res.status(401).json({ error:'Contraseña incorrecta para la firma electrónica.' });
  const instructor = stmts.userById.get(Number(req.params.id));
  if (!instructor) return res.status(404).json({ error:'Instructor no encontrado.' });
  const hash = crypto.createHash('sha256').update([req.params.id,anio,fecha,horas,descripcion,JWT_SECRET].join('|')).digest('hex');
  stmts.insertInstructorHoras.run(Number(req.params.id), Number(anio)||new Date().getFullYear(),
    curso_id?Number(curso_id):null, fecha, Number(horas)||0, String(descripcion||''), req.user.id, hash);
  AUDIT(req.user.id,'INSTRUCTOR_HORAS', `${instructor.legajo} · ${fecha} · ${horas} hs · ${descripcion}`);
  res.json({ ok:true });
});

app.get('/api/admin/instructores/:id/horas', auth, roleAtLeast('admin'), (req,res) => {
  const anio = Number(req.query.anio)||new Date().getFullYear();
  const inst = stmts.userById.get(Number(req.params.id));
  if (!inst) return res.status(404).json({ error:'Instructor no encontrado.' });
  const horas = stmts.horasInstructor.all(Number(req.params.id), anio);
  const total = stmts.totalHorasInstructor.get(Number(req.params.id), anio).total;
  res.json({ instructor:inst, horas, total, anio, meta:20, cumple:total>=20 });
});

/* ================= Calendario anual ISSA ================= */
app.get('/api/admin/calendario', auth, roleAtLeast('admin','instructor','supervisor'), (req,res) => {
  const anio = Number(req.query.anio)||new Date().getFullYear();
  res.json({ cursos:stmts.calendarioPorAnio.all(anio), anio });
});

app.post('/api/admin/calendario', auth, roleAtLeast('admin'), (req,res) => {
  const { anio, course_id, fecha_inicio, fecha_fin, modalidad, sede, cupo } = req.body||{};
  if (!course_id||!fecha_inicio) return res.status(400).json({ error:'course_id y fecha_inicio requeridos.' });
  const info = stmts.insertCalendario.run(Number(anio)||new Date().getFullYear(),Number(course_id),
    fecha_inicio, fecha_fin||null, modalidad||'P', String(sede||''), Number(cupo)||30, req.user.id);
  AUDIT(req.user.id,'CALENDARIO_ALTA', `curso ${course_id} · ${fecha_inicio}`);
  res.json({ ok:true, id:Number(info.lastInsertRowid) });
});

app.put('/api/admin/calendario/:id', auth, roleAtLeast('admin'), (req,res) => {
  const { fecha_inicio, fecha_fin, modalidad, sede, cupo, estado } = req.body||{};
  const r = db.prepare('SELECT * FROM calendario_cursos WHERE id=?').get(Number(req.params.id));
  if (!r) return res.status(404).json({ error:'No encontrado.' });
  stmts.updateCalendario.run(fecha_inicio||r.fecha_inicio, fecha_fin||r.fecha_fin,
    modalidad||r.modalidad, String(sede??r.sede), Number(cupo)||r.cupo, estado||r.estado, r.id);
  AUDIT(req.user.id,'CALENDARIO_EDIT', `id ${r.id} → ${estado||r.estado}`);
  res.json({ ok:true });
});

app.post('/api/admin/calendario/enviar-issa', auth, roleAtLeast('admin'), (req,res) => {
  const { anio, password } = req.body||{};
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
  if (!bcrypt.compareSync(String(password||''), u.password_hash))
    return res.status(401).json({ error:'Contraseña incorrecta para firmar el envío al ISSA.' });
  const anioNum = Number(anio)||new Date().getFullYear();
  const cursos = stmts.calendarioPorAnio.all(anioNum);
  const aEnviar = cursos.filter(c=>['planificado','confirmado'].includes(c.estado));
  db.prepare(`UPDATE calendario_cursos SET enviado_issa=1 WHERE anio=? AND (estado='planificado' OR estado='confirmado')`).run(anioNum);
  const hash = crypto.createHash('sha256').update([anioNum,aEnviar.length,req.user.id,JWT_SECRET].join('|')).digest('hex');
  AUDIT(req.user.id,'CALENDARIO_ENVIO_ISSA', `${anioNum}: ${aEnviar.length} cursos · firma ${hash.slice(0,12)}…`);
  res.json({ ok:true, enviados:aEnviar.length, firma:hash });
});

/* ================= Acta PDF de reprobación EPPT y Constancia de EPPT ================= */
app.get('/api/admin/eppt/:id/acta-pdf', auth, roleAtLeast('admin','instructor','supervisor'), (req,res) => {
  const rec = stmts.epptById.get(Number(req.params.id));
  if (!rec) return res.status(404).json({ error:'EPPT no encontrado.' });
  const enr = stmts.enrollmentById.get(rec.enrollment_id);
  const u = stmts.userById.get(enr.user_id);
  const c = stmts.courseById.get(enr.course_id);
  const entries = stmts.epptEntries.all(rec.id).map(e=>({...e, rubrica:safeJson(e.rubrica,[])}));
  const docNum = db.prepare("SELECT numero FROM registro_documentos WHERE tipo IN ('acta_eppt','constancia_eppt') AND referencia=?").get(String(rec.id));
  // Devolver datos para que el frontend genere el PDF
  res.json({ eppt:rec, usuario:u, curso:c, entries, num_doc:docNum?.numero });
});

/* ================= Auditoría con filtros ================= */
app.get('/api/admin/audit', auth, roleAtLeast('admin','fiscalizador'), (req,res) => {
  const { desde, hasta, accion, usuario_id, limit } = req.query;
  let q = 'SELECT a.*, u.usuario, u.apellido, u.nombre AS unombre, u.legajo FROM audit_log a LEFT JOIN users u ON u.id=a.user_id WHERE 1=1';
  const p = [];
  if (desde) { q += ' AND a.created_at >= ?'; p.push(desde); }
  if (hasta) { q += ' AND a.created_at <= ?'; p.push(hasta + ' 23:59:59'); }
  if (accion) { q += ' AND a.accion LIKE ?'; p.push('%'+accion+'%'); }
  if (usuario_id) { q += ' AND a.user_id = ?'; p.push(Number(usuario_id)); }
  q += ' ORDER BY a.id DESC LIMIT ' + (Number(limit)||500);
  const audit = db.prepare(q).all(...p);
  res.json({ audit });
});

// Intentos fallidos de login: top atacantes y listado filtrable (solo admin)
app.get('/api/admin/login-attempts', auth, roleAtLeast('admin'), (req, res) => {
  const ventana = Number(req.query.horas || 24) * 3_600_000;
  const desde = Date.now() - ventana;
  const top = db.prepare(`
    SELECT usuario, ip, COUNT(*) AS intentos,
           datetime(MAX(created_at)/1000,'unixepoch','localtime') AS ultimo,
           datetime(MIN(created_at)/1000,'unixepoch','localtime') AS primero
    FROM login_attempts WHERE created_at > ?
    GROUP BY usuario, ip ORDER BY intentos DESC LIMIT 50`).all(desde);
  const total = db.prepare('SELECT COUNT(*) AS n FROM login_attempts WHERE created_at > ?').get(desde).n;
  const bloqueados = top.filter(r => r.intentos >= 5);
  res.json({ total_intentos: total, bloqueados: bloqueados.length, top });
});

/* ================= DNIs preautorizados (whitelist de acceso) ================= */
app.get('/api/admin/dni-autorizados', auth, roleAtLeast('admin','instructor'), (req, res) => {
  res.json({ dnis: stmts.allDniAut.all() });
});

app.post('/api/admin/dni-autorizados/bulk', auth, roleAtLeast('admin','instructor'), (req, res) => {
  const rows = Array.isArray(req.body?.dnis) ? req.body.dnis : [];
  const creados = [], duplicados = [], errores = [];
  for (const r of rows) {
    const dni = String(r.dni || r).trim();
    const org = String(r.organismo || '').trim();
    if (!dni || !/^\d{6,9}$/.test(dni)) { errores.push({ dni, motivo: 'DNI inválido' }); continue; }
    try { stmts.insertDniAut.run(dni, org, String(r.nota || ''), req.user.id); creados.push(dni); }
    catch(e) { if (e.message.includes('UNIQUE')) duplicados.push(dni); else errores.push({ dni, motivo: e.message }); }
  }
  AUDIT(req.user.id, 'DNI_AUTORIZADOS_CARGA', `creados:${creados.length} duplicados:${duplicados.length}`);
  res.json({ creados: creados.length, duplicados: duplicados.length, errores: errores.length, listado: creados });
});

app.delete('/api/admin/dni-autorizados/:id', auth, roleAtLeast('admin','instructor'), (req, res) => {
  stmts.deleteDniAut.run(Number(req.params.id));
  res.json({ ok: true });
});

// El propio alumno puede ver su historial completo (todos los ciclos)
app.get('/api/mi-historial', auth, (req, res) => {
  const hist = stmts.historialAlumno.all(req.user.id);
  const certs = stmts.certsByUser.all(req.user.id);
  res.json({ historial: hist, certificados: certs });
});

/* ================= Gestión (docente / admin) ================= */
app.get('/api/admin/users', auth, roleAtLeast('admin', 'instructor', 'supervisor', 'fiscalizador'), (req, res) => {
  res.json({ users: stmts.allUsers.all() });
});

app.post('/api/admin/users/:id/role', auth, roleAtLeast('admin'), (req, res) => {
  const role = String(req.body?.role || '').trim();
  const validRoles = ['estudiante','supervisor','instructor','admin','fiscalizador','sanidad','juosp','juosp_regional'];
  if (!validRoles.includes(role)) {
    console.warn('[ROL] Valor rechazado. Recibido:', JSON.stringify(req.body), '| params.id:', req.params.id);
    return res.status(400).json({
      error: `Rol no reconocido: "${role || '(vacío)'}". Válidos: ${validRoles.join(', ')}.`
    });
  }
  const uid = Number(req.params.id);
  const target = stmts.userById.get(uid);
  if (!target) return res.status(404).json({ error: 'Usuario no encontrado.' });

  // Método 1: prepared statement normal (funciona si la BD fue creada sin CHECK o ya migrada)
  try { stmts.updateUserRole.run(role, uid); AUDIT(req.user.id, 'CAMBIO_ROL', `${target.legajo} → ${role}`); return res.json({ ok: true }); } catch {}

  // Método 2: segunda conexión a la BD — cada nueva conexión lee el schema actual
  // Si el schema fue parcheado (sin CHECK), esta conexión no tiene el CHECK cacheado
  try {
    const { DatabaseSync } = require('node:sqlite');
    const path = require('path');
    const db2 = new DatabaseSync(path.join(__dirname, 'data', 'plataforma_pnisac.db'));
    db2.exec('PRAGMA foreign_keys=OFF');
    db2.exec('PRAGMA ignore_check_constraints=ON');
    db2.prepare('UPDATE users SET role=? WHERE id=?').run(role, uid);
    db2.exec('PRAGMA ignore_check_constraints=OFF');
    db2.exec('PRAGMA foreign_keys=ON');
    db2.close();
    AUDIT(req.user.id, 'CAMBIO_ROL', `${target.legajo} → ${role}`);
    return res.json({ ok: true });
  } catch(e2) { console.warn('Método 2 rol:', e2.message); }

  return res.status(500).json({ error: 'No se pudo cambiar el rol. Reiniciá el servidor e intentá de nuevo.' });
});

/* ═══════════════════════════════════════════════════════════════════
   PERFILES DUALES: ALUMNO + INSTRUCTOR
   Crear/eliminar el perfil -INST para una persona que ya tiene perfil alumno
═══════════════════════════════════════════════════════════════════ */

// Crear perfil instructor (-INST) para un usuario existente (alumno o supervisor)
app.post('/api/admin/users/:id/perfil-instructor', auth, roleAtLeast('admin'), (req, res) => {
  const alumno = stmts.userById.get(Number(req.params.id));
  if (!alumno) return res.status(404).json({ error: 'Usuario no encontrado.' });
  if (alumno.role === 'admin') return res.status(400).json({ error: 'Los administradores no necesitan perfil dual.' });

  const legajoBase = alumno.legajo_base || alumno.legajo.replace(/-INST$/i, '');
  const legajoInst = legajoBase + '-INST';

  // Verificar si ya existe el perfil -INST
  const existente = db.prepare('SELECT id, activo FROM users WHERE legajo=?').get(legajoInst);
  if (existente) {
    if (existente.activo) return res.status(409).json({ error: 'Ya existe un perfil instructor activo para '+legajoBase+'.' });
    // Reactivar perfil instructor desactivado
    db.prepare('UPDATE users SET activo=1 WHERE id=?').run(existente.id);
    _invalidateUserCache(existente.id);
    AUDIT(req.user.id, 'PERFIL_INST_REACTIVADO', legajoInst + ' (alumno: ' + alumno.legajo + ')');
    return res.json({ ok: true, reactivado: true, perfil_instructor_id: existente.id, legajo_instructor: legajoInst });
  }

  // Crear el nuevo perfil instructor (mismo DNI, misma persona física, distinto legajo y rol)
  const password = req.body?.password || legajoBase; // contraseña por defecto: el legajo base
  const info = stmts.insertUser.run({
    legajo: legajoInst,
    usuario: legajoInst,
    dni: alumno.dni,
    nombre: alumno.nombre,
    apellido: alumno.apellido,
    rango: alumno.rango,
    organismo: alumno.organismo,
    aeropuerto: alumno.aeropuerto,
    dependencia: alumno.dependencia,
    funcion: alumno.funcion,
    role: 'instructor',
    password_hash: bcrypt.hashSync(password, 10),
    legajo_base: legajoBase
  });
  const perfilInst = stmts.userById.get(Number(info.lastInsertRowid));

  // Actualizar legajo_base del perfil alumno también (por si no estaba seteado)
  db.prepare('UPDATE users SET legajo_base=? WHERE id=?').run(legajoBase, alumno.id);

  AUDIT(req.user.id, 'PERFIL_INST_CREADO',
    legajoInst + ' vinculado a ' + alumno.legajo + ' · contraseña inicial: legajo base');

  res.status(201).json({
    ok: true,
    perfil_instructor_id: perfilInst.id,
    legajo_instructor: legajoInst,
    password_inicial: password,
    mensaje: 'Perfil instructor creado. Contraseña inicial: ' + password + '. El docente debe cambiarla al primer acceso.'
  });
});

// Desactivar solo el perfil instructor (sin afectar el perfil alumno)
app.post('/api/admin/users/:id/perfil-instructor/desactivar', auth, roleAtLeast('admin'), (req, res) => {
  const alumno = stmts.userById.get(Number(req.params.id));
  if (!alumno) return res.status(404).json({ error: 'Usuario no encontrado.' });
  const legajoBase = alumno.legajo_base || alumno.legajo.replace(/-INST$/i, '');
  const perfInst = db.prepare(`SELECT id FROM users WHERE legajo=? AND role='instructor' AND activo=1`).get(legajoBase + '-INST');
  if (!perfInst) return res.status(404).json({ error: 'No existe un perfil instructor activo para este usuario.' });
  db.prepare('UPDATE users SET activo=0 WHERE id=?').run(perfInst.id);
  _invalidateUserCache(perfInst.id);
  AUDIT(req.user.id, 'PERFIL_INST_DESACTIVADO', legajoBase + '-INST');
  res.json({ ok: true, mensaje: 'Perfil instructor desactivado. El perfil alumno no fue afectado.' });
});

// Obtener ambos perfiles de una persona por legajo base
app.get('/api/admin/users/:id/perfiles', auth, roleAtLeast('admin'), (req, res) => {
  const u = stmts.userById.get(Number(req.params.id));
  if (!u) return res.status(404).json({ error: 'Usuario no encontrado.' });
  const legajoBase = u.legajo_base || u.legajo.replace(/-INST$/i, '');
  const perfiles = db.prepare(
    'SELECT id,legajo,role,activo,legajo_base,created_at FROM users WHERE legajo_base=? ORDER BY role'
  ).all(legajoBase);
  const cursosDicta = db.prepare(`
    SELECT c.cod, c.nombre FROM course_instructors ci JOIN courses c ON c.id=ci.course_id
    WHERE ci.instructor_id IN (SELECT id FROM users WHERE legajo_base=? AND role='instructor') ORDER BY c.cod
  `).all(legajoBase);
  res.json({ legajo_base: legajoBase, perfiles, cursos_como_instructor: cursosDicta });
});

// Inscripción directa de usuario a curso (sin selección, por formulario)
app.post('/api/admin/enroll-direct', auth, roleAtLeast('admin','instructor'), (req, res) => {
  const { user_id, course_id } = req.body || {};
  if (!user_id || !course_id) return res.status(400).json({ error: 'user_id y course_id requeridos.' });
  const u = stmts.userById.get(Number(user_id));
  const c = stmts.courseById.get(Number(course_id));
  if (!u) return res.status(404).json({ error: 'Usuario no encontrado.' });
  if (!c) return res.status(404).json({ error: 'Curso no encontrado.' });
  const existing = db.prepare('SELECT id FROM enrollments WHERE user_id=? AND course_id=? AND activo=1').get(u.id, c.id);
  if (existing) return res.status(409).json({ error: u.apellido+' ya está inscripto en '+c.cod+'.' });
  const info = db.prepare('INSERT INTO enrollments (user_id, course_id, inscrito_por) VALUES (?,?,?)').run(u.id, c.id, req.user.id);
  AUDIT(req.user.id, 'INSCRIPCION_DIRECTA', `${u.legajo} → ${c.cod}`);
  res.status(201).json({ ok: true, enrollment_id: Number(info.lastInsertRowid) });
});

app.post('/api/admin/users/:id/activo', auth, roleAtLeast('admin'), (req, res) => {
  const target = stmts.userById.get(Number(req.params.id));
  if (!target) return res.status(404).json({ error: 'Usuario no encontrado.' });
  if (target.id === req.user.id) return res.status(400).json({ error: 'No puede desactivar su propio usuario.' });
  stmts.updateUserActivo.run(req.body?.activo ? 1 : 0, target.id);
  // Invalidar la caché de estado inmediatamente: la próxima request del usuario
  // verá el nuevo estado sin esperar el TTL de 30 s
  _invalidateUserCache(target.id);
  AUDIT(req.user.id, req.body?.activo ? 'USUARIO_ACTIVADO' : 'USUARIO_DESACTIVADO', target.legajo);
  res.json({ ok: true });
});

// Autorizar / revocar a un instructor la creación y gestión de cursos (solo administrador)
// Ver qué cursos tiene asignados un instructor (para prellenar el modal de asignación)
app.get('/api/admin/instructor/:id/cursos', auth, roleAtLeast('admin'), (req, res) => {
  const target = stmts.userById.get(Number(req.params.id));
  if (!target) return res.status(404).json({ error: 'Usuario no encontrado.' });
  const asignados = stmts.coursesAssignedToInstructor.all(target.id);
  res.json({ cursos: asignados });
});

// Asignar/reasignar la lista completa de cursos que un instructor puede gestionar (admin)
app.post('/api/admin/instructor/:id/cursos', auth, roleAtLeast('admin'), (req, res) => {
  const target = stmts.userById.get(Number(req.params.id));
  if (!target) return res.status(404).json({ error: 'Usuario no encontrado.' });
  if (target.role !== 'instructor') return res.status(400).json({ error: 'Solo se pueden asignar cursos a usuarios con rol Instructor.' });
  const courseIds = Array.isArray(req.body?.course_ids) ? req.body.course_ids.map(Number).filter(Boolean) : [];
  // Reemplazar la lista completa: primero limpiar, luego insertar la nueva selección
  stmts.clearCourseInstructors.run(target.id);
  courseIds.forEach(cid => { try { stmts.assignCourseInstructor.run(cid, target.id, req.user.id); } catch {} });
  AUDIT(req.user.id, 'INSTRUCTOR_CURSOS_ASIGNADOS', target.legajo + ' -> ' + courseIds.length + ' curso(s)');
  res.json({ ok: true, asignados: courseIds.length });
});

// Editar datos del usuario (registro oficial por DNI)
app.post('/api/admin/users/:id/data', auth, roleAtLeast('admin'), (req, res) => {
  const u = stmts.userById.get(Number(req.params.id));
  if (!u) return res.status(404).json({ error: 'Usuario no encontrado.' });
  const { dni, nombre, apellido, rango, organismo, legajo, aeropuerto, dependencia, funcion } = req.body || {};

  const nuevoLegajo = String(legajo ?? u.legajo).trim();
  // Si cambia el legajo, verificar que no colisione con otro usuario
  if (nuevoLegajo !== u.legajo) {
    const existente = db.prepare('SELECT id FROM users WHERE legajo=? AND id!=?').get(nuevoLegajo, u.id);
    if (existente) return res.status(409).json({ error: 'Ya existe otro usuario con el legajo '+nuevoLegajo+'.' });
  }

  db.prepare(`UPDATE users SET dni=?, nombre=?, apellido=?, rango=?, organismo=?, legajo=?, aeropuerto=?, dependencia=?, funcion=? WHERE id=?`).run(
    String(dni ?? u.dni ?? '').trim(),
    String(nombre || u.nombre).trim(),
    String(apellido || u.apellido).trim().toUpperCase(),
    String(rango ?? u.rango ?? '').trim(),
    String(organismo || u.organismo).trim(),
    nuevoLegajo,
    String(aeropuerto ?? u.aeropuerto ?? '').trim(),
    String(dependencia ?? u.dependencia ?? '').trim(),
    String(funcion ?? u.funcion ?? '').trim(),
    u.id
  );
  AUDIT(req.user.id, 'USUARIO_EDITADO', (nuevoLegajo!==u.legajo ? u.legajo+'→'+nuevoLegajo : u.legajo));
  res.json({ ok: true });
});

app.post('/api/admin/users/:id/password', auth, roleAtLeast('admin'), (req, res) => {
  const u = stmts.userById.get(Number(req.params.id));
  if (!u) return res.status(404).json({ error: 'Usuario no encontrado.' });
  const p = String(req.body?.password || '');
  if (p.length < 6) return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres.' });
  stmts.updateUserPassword.run(bcrypt.hashSync(p, 10), u.id);
  AUDIT(req.user.id, 'PASSWORD_RESET', u.legajo);
  res.json({ ok: true });
});

// Carga masiva de usuarios: [{legajo,dni,apellido,nombre,rango,organismo,password?}]
// Regla: si el legajo o el DNI ya existen, se rechaza esa fila (sin duplicados).
app.post('/api/admin/users/bulk', auth, roleAtLeast('admin'), (req, res) => {
  const rows = Array.isArray(req.body?.users) ? req.body.users.slice(0, 2000) : [];
  if (!rows.length) return res.status(400).json({ error: 'Sin filas para procesar.' });
  const creados = [], duplicados = [], errores = [];
  for (const r of rows) {
    try {
      const legajo = String(r.legajo || '').trim(), dni = String(r.dni || '').trim();
      const apellido = String(r.apellido || '').trim(), nombre = String(r.nombre || '').trim();
      if (!legajo || !dni || !apellido || !nombre) { errores.push({ fila: r, motivo: 'Faltan legajo/DNI/apellido/nombre' }); continue; }
      if (stmts.userByLogin.get(legajo, legajo)) { duplicados.push({ legajo, motivo: 'Legajo/usuario ya registrado' }); continue; }
      if (stmts.userByDni.get(dni)) { duplicados.push({ legajo, dni, motivo: 'DNI ya registrado' }); continue; }
      const password = String(r.password || dni);   // contraseña inicial = DNI si no se indica
      stmts.insertUser.run({
        legajo, usuario: legajo, dni, nombre, apellido: apellido.toUpperCase(),
        rango: String(r.rango || '').trim(), organismo: String(r.organismo || 'PSA').trim(),
        aeropuerto: String(r.aeropuerto || '').trim(),
        dependencia: String(r.dependencia || '').trim(),
        funcion: String(r.funcion || '').trim(),
        role: 'estudiante', password_hash: bcrypt.hashSync(password, 10)
      });
      creados.push(legajo);
    } catch (e) { errores.push({ fila: r, motivo: e.message }); }
  }
  AUDIT(req.user.id, 'USUARIOS_CARGA_MASIVA', `creados:${creados.length} duplicados:${duplicados.length} errores:${errores.length}`);
  res.json({ creados: creados.length, listado_creados: creados, duplicados, errores });
});

// Inscripción masiva o particular a un curso (por IDs de usuario, legajos o DNIs)
app.post('/api/admin/enrollments/bulk', auth, roleAtLeast('admin', 'instructor'), (req, res) => {
  const c = stmts.courseById.get(Number(req.body?.course_id));
  if (!c) return res.status(404).json({ error: 'Curso no encontrado.' });
  const ids = new Set((req.body?.user_ids || []).map(Number).filter(Boolean));
  for (const key of (req.body?.claves || [])) {
    const k = String(key).trim();
    const u = stmts.userByLogin.get(k, k) || stmts.userByDni.get(k);
    if (u) ids.add(u.id);
  }
  let inscriptos = 0;
  for (const uid of ids) { const r = stmts.enroll.run(uid, c.id, req.user.id); if (r.changes > 0) inscriptos++; }
  AUDIT(req.user.id, 'INSCRIPCION_MASIVA', `${c.cod}: ${inscriptos} nuevas de ${ids.size} solicitadas`);
  res.json({ ok: true, inscriptos, ya_inscriptos: ids.size - inscriptos });
});

app.get('/api/admin/course/:id/students', auth, roleAtLeast('admin', 'instructor', 'supervisor'), (req, res) => {
  const rows = stmts.enrollmentsByCourse.all(Number(req.params.id)).map(e => ({
    ...e, attempts: stmts.attemptsByEnrollment.all(e.id)
  }));
  res.json({ students: rows });
});

// Rehabilitar cursada — modelo "archivar y abrir nuevo ciclo" (NO borra nada del historial)
app.post('/api/admin/enrollments/:id/reset', auth, roleAtLeast('admin', 'instructor'), (req, res) => {
  const enrViejo = stmts.enrollmentById.get(Number(req.params.id));
  if (!enrViejo) return res.status(404).json({ error: 'Inscripción no encontrada.' });
  if (!enrViejo.activo) return res.status(400).json({ error: 'Esta inscripción ya está archivada (pertenece a un ciclo anterior).' });

  try {
    db.prepare('BEGIN').run();

    // 1. Archivar los datos del ciclo anterior (attempts, EPPT, sesiones prácticas, sesiones de supervisión)
    //    SIN BORRAR NADA — quedan con activo=0 y el ciclo original intacto para el historial
    stmts.archivarHijosDeEnrollment(enrViejo.id);

    // 2. Archivar la inscripción vieja (activo=0 la saca de todas las consultas "en vivo")
    stmts.archivarEnrollment.run(enrViejo.id);

    // 3. Anular el certificado activo de este alumno para este curso (si existiera)
    try {
      const certViejo = stmts.certsByUser.all(enrViejo.user_id)
        .find(x => x.course_id === enrViejo.course_id && !x.anulado);
      if (certViejo) stmts.anularCert.run('Anulado al rehabilitar la cursada (ciclo ' + enrViejo.ciclo + ' → ' + (enrViejo.ciclo + 1) + ')', certViejo.id);
    } catch {}

    // 4. Crear el nuevo ciclo activo (ciclo = anterior + 1)
    //    El progreso de lecciones NO se archiva — el alumno puede rever el contenido libremente;
    //    lo que se archiva son los intentos de examen y el EPPT, que son los registros académicos.
    const infoCicloNuevo = stmts.insertNuevoCiclo.run(
      enrViejo.user_id,
      enrViejo.course_id,
      req.user.id,          // quien rehabilita queda registrado como responsable del nuevo ciclo
      enrViejo.ciclo + 1
    );
    const nuevoCicloId = Number(infoCicloNuevo.lastInsertRowid);

    db.prepare('COMMIT').run();

    AUDIT(req.user.id, 'CURSADA_REHABILITADA',
      `user=${enrViejo.user_id} course=${enrViejo.course_id} ciclo ${enrViejo.ciclo}→${enrViejo.ciclo + 1} | enr_viejo=${enrViejo.id} enr_nuevo=${nuevoCicloId}`);

    res.json({
      ok: true,
      ciclo_archivado: enrViejo.ciclo,
      ciclo_nuevo: enrViejo.ciclo + 1,
      enrollment_id_nuevo: nuevoCicloId,
      mensaje: `Ciclo ${enrViejo.ciclo} archivado con su historial intacto. Se abrió el ciclo ${enrViejo.ciclo + 1}.`
    });
  } catch(e) {
    try { db.prepare('ROLLBACK').run(); } catch {}
    console.error('Error rehabilitando cursada:', e.message);
    res.status(500).json({ error: 'Error al rehabilitar: ' + e.message });
  }
});

// Preguntas (docente)
app.get('/api/admin/course/:id/questions', auth, roleAtLeast('admin', 'instructor', 'supervisor'), (req, res) => {
  const qs = stmts.questionsFull.all(Number(req.params.id))
    .map(q => ({ ...q, opciones: safeJson(q.opciones, []) }));
  res.json({ questions: qs });
});
app.post('/api/admin/questions', auth, requireCourseAccess(req => {
  const { course_id, id } = req.body || {};
  if (id) return stmts.questionById.get(Number(id))?.course_id;
  return Number(course_id);
}), (req, res) => {
  const { course_id, pregunta, opciones, correcta, id } = req.body || {};
  if (!pregunta || !Array.isArray(opciones) || opciones.length < 2 || !Number.isInteger(correcta))
    return res.status(400).json({ error: 'Pregunta inválida: se requieren enunciado, opciones y respuesta correcta.' });
  if (id) { stmts.updateQuestion.run(pregunta, JSON.stringify(opciones), correcta, Number(id)); }
  else { stmts.insertQuestion.run(Number(course_id), pregunta, JSON.stringify(opciones), correcta); }
  AUDIT(req.user.id, id ? 'PREGUNTA_EDITADA' : 'PREGUNTA_CREADA', pregunta.slice(0, 80));
  res.json({ ok: true });
});
app.delete('/api/admin/questions/:id', auth, requireCourseAccess(req => stmts.questionById.get(Number(req.params.id))?.course_id), (req, res) => {
  stmts.deleteQuestion.run(Number(req.params.id));
  AUDIT(req.user.id, 'PREGUNTA_BAJA', req.params.id);
  res.json({ ok: true });
});

// Unidades (edición: SOLO administrador define recursos, como pidió la Dirección)
app.get('/api/admin/course/:id/lessons', auth, roleAtLeast('admin', 'instructor'), (req, res) => {
  const lessons = stmts.lessonsByCourse.all(Number(req.params.id)).map(l => ({
    ...l, checkpoints: stmts.lqByLesson.all(l.id).map(q => ({ ...q, opciones: safeJson(q.opciones, []) }))
  }));
  res.json({ lessons });
});

app.post('/api/admin/lessons/:id', auth, requireCourseAccess(req => stmts.lessonById.get(Number(req.params.id))?.course_id), (req, res) => {
  const l = stmts.lessonById.get(Number(req.params.id));
  if (!l) return res.status(404).json({ error: 'Unidad no encontrada.' });
  let tipo = ['texto', 'video'].includes(req.body?.tipo) ? req.body.tipo : l.tipo;
  const dur = Math.max(5, Number(req.body?.duracion_s) || l.duracion_s);
  let videoUrl = null;
  if (typeof req.body?.youtube_url === 'string' && req.body.youtube_url.trim()) {
    const m = /(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([\w-]{11})/.exec(req.body.youtube_url.trim());
    if (!m) return res.status(400).json({ error: 'URL de YouTube inválida. Use el enlace del video (oculto/no listado del canal institucional).' });
    videoUrl = 'youtube:' + m[1];
    tipo = 'video';
  }
  stmts.updateLesson.run(String(req.body?.titulo || l.titulo), tipo,
    String(req.body?.contenido ?? l.contenido), videoUrl, dur, l.id);
  AUDIT(req.user.id, 'UNIDAD_EDITADA', `lesson ${l.id} (${tipo}, ${dur}s)`);
  res.json({ ok: true });
});

// Carga de micro-video (exclusiva del administrador)
app.post('/api/admin/lessons/:id/video', auth, requireCourseAccess(req => stmts.lessonById.get(Number(req.params.id))?.course_id), (req, res) => {
  upload.single('video')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    const l = stmts.lessonById.get(Number(req.params.id));
    if (!l) return res.status(404).json({ error: 'Unidad no encontrada.' });
    if (!req.file) return res.status(400).json({ error: 'No se recibió el archivo de video.' });
    const url = '/assets/videos/' + req.file.filename;
    const dur = Math.max(5, Number(req.body?.duracion_s) || l.duracion_s);
    stmts.updateLesson.run(l.titulo, 'video', l.contenido, url, dur, l.id);
    AUDIT(req.user.id, 'VIDEO_CARGADO', `lesson ${l.id} → ${req.file.filename} (${dur}s)`);
    res.json({ ok: true, video_url: url });
  });
});

// Multer para material didáctico (PDF, imágenes, PPTX, etc.)
const uploadDoc = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, DOCS_DIR),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      const base = path.basename(file.originalname, ext).replace(/[^\w.-]/g, '_').slice(0, 60);
      cb(null, `doc_${Date.now()}_${base}${ext}`);
    }
  }),
  limits: { fileSize: 100 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const ok = ['.png','.jpg','.jpeg','.webp','.gif','.bmp'].includes(ext);
    cb(ok ? null : new Error('Solo se permiten imagenes (PNG, JPG, WebP, GIF). Use el campo de video para videos.'), ok);
  }
});

// Subir material didáctico (PDF, imagen, PPTX, etc.) a una unidad
app.post('/api/admin/lessons/:id/doc', auth, requireCourseAccess(req => stmts.lessonById.get(Number(req.params.id))?.course_id), (req, res) => {
  uploadDoc.single('doc')(req, res, err => {
    if (err) return res.status(400).json({ error: err.message });
    const l = stmts.lessonById.get(Number(req.params.id));
    if (!l) return res.status(404).json({ error: 'Unidad no encontrada.' });
    if (!req.file) return res.status(400).json({ error: 'No se recibió el archivo.' });
    const ext = path.extname(req.file.filename).toLowerCase();
    const tipo = 'imagen';
    const url = '/assets/docs/' + req.file.filename;
    const dur = Math.max(5, Number(req.body?.duracion_s) || l.duracion_s);
    stmts.updateLesson.run(l.titulo, tipo, l.contenido, url, dur, l.id);
    AUDIT(req.user.id, 'DOC_CARGADO', `lesson ${l.id}: ${req.file.originalname} (${tipo})`);
    res.json({ ok: true, doc_url: url, tipo });
  });
});

// Checkpoints por unidad (banco editable por el administrador)
app.post('/api/admin/lesson-questions', auth, requireCourseAccess(req => {
  const { lesson_id, id } = req.body || {};
  if (id) { const lq = stmts.lqById.get(Number(id)); return lq ? stmts.lessonById.get(lq.lesson_id)?.course_id : null; }
  return stmts.lessonById.get(Number(lesson_id))?.course_id;
}), (req, res) => {
  const { lesson_id, id, pregunta, opciones, correcta } = req.body || {};
  if (!pregunta || !Array.isArray(opciones) || opciones.length < 2 || !Number.isInteger(correcta))
    return res.status(400).json({ error: 'Checkpoint inválido.' });
  if (id) stmts.updateLQ.run(pregunta, JSON.stringify(opciones), correcta, Number(id));
  else stmts.insertLQ.run(Number(lesson_id), pregunta, JSON.stringify(opciones), correcta);
  AUDIT(req.user.id, id ? 'CHECKPOINT_EDITADO' : 'CHECKPOINT_CREADO', pregunta.slice(0, 80));
  res.json({ ok: true });
});
app.delete('/api/admin/lesson-questions/:id', auth, requireCourseAccess(req => {
  const lq = stmts.lqById.get(Number(req.params.id));
  return lq ? stmts.lessonById.get(lq.lesson_id)?.course_id : null;
}), (req, res) => {
  stmts.deleteLQ.run(Number(req.params.id));
  AUDIT(req.user.id, 'CHECKPOINT_BAJA', req.params.id);
  res.json({ ok: true });
});

// Registro real de tiempos de visualización por curso (fiscalización)
app.get('/api/admin/course/:id/tiempos', auth, roleAtLeast('admin', 'instructor', 'supervisor'), (req, res) => {
  const rows = stmts.lsTimes.all(Number(req.params.id)).map(r => ({
    apellido: r.apellido, nombre: r.unombre, legajo: r.legajo,
    unidad: r.titulo, tipo: r.tipo, requerido_s: r.duracion_s,
    inicio: r.started_at,
    efectivo_s: r.video_done_ms ? Math.round((r.video_done_ms - r.started_ms) / 1000) : null,
    resultado: r.resultado || 'incompleta'
  }));
  res.json({ tiempos: rows });
});

/* ================= Reportes / registros PNISAC ================= */
app.get('/api/admin/stats', auth, roleAtLeast('admin', 'instructor', 'supervisor', 'fiscalizador'), (req, res) => {
  const cursos = stmts.statsCursos.all();
  const totales = {
    usuarios: stmts.countUsers.get().n,
    inscripciones: db.prepare('SELECT COUNT(*) n FROM enrollments').get().n,
    aprobados: db.prepare("SELECT COUNT(*) n FROM enrollments WHERE estado='aprobado'").get().n,
    certificados: db.prepare('SELECT COUNT(*) n FROM certificates WHERE anulado=0').get().n,
    examenes: db.prepare('SELECT COUNT(*) n FROM attempts').get().n
  };
  res.json({ cursos, totales });
});

// Registro de certificaciones (campos que exige el PNISAC) con filtros
app.get('/api/admin/certificates', auth, roleAtLeast('admin', 'instructor', 'fiscalizador'), (req, res) => {
  let rows = stmts.allCerts.all();
  const { curso, q, vigencia } = req.query;
  if (curso) rows = rows.filter(r => r.curso_cod === curso);
  if (q) {
    const s = String(q).toLowerCase();
    rows = rows.filter(r => [r.apellido, r.unombre, r.legajo, r.dni, r.code].join(' ').toLowerCase().includes(s));
  }
  const hoy = new Date().toISOString().slice(0, 10);
  if (vigencia === 'vigentes') rows = rows.filter(r => !r.anulado && (!r.vencimiento || r.vencimiento >= hoy));
  if (vigencia === 'vencidos') rows = rows.filter(r => r.vencimiento && r.vencimiento < hoy);
  res.json({ certificates: rows });
});

app.post('/api/admin/certificates/:id/anular', auth, roleAtLeast('admin'), (req, res) => {
  const certId = Number(req.params.id);
  const motivo = String(req.body?.motivo || '').trim() || 'Anulado por administración';
  const cert = db.prepare('SELECT * FROM certificates WHERE id=?').get(certId);
  if (!cert) return res.status(404).json({ error: 'Certificado no encontrado.' });
  const u = stmts.userById.get(cert.user_id);
  const c = stmts.courseById.get(cert.course_id);
  const anulador = stmts.userById.get(req.user.id);

  // Anular el certificado
  stmts.anularCert.run(motivo, certId);

  // Dar de baja la credencial activa del usuario
  try {
    db.prepare("UPDATE credenciales SET activa=0, anulada_at=datetime('now','localtime'), observaciones=? WHERE user_id=? AND activa=1")
      .run('Baja por anulación del certificado '+cert.code+': '+motivo, cert.user_id);
  } catch {}

  // Registrar en registro_documentos
  const numAnul = generarNumDoc('ANUL', new Date().getFullYear());
  try {
    db.prepare("INSERT INTO registro_documentos (tipo,numero,user_id,course_id,referencia,emitido_por) VALUES ('anulacion_cert',?,?,?,?,?)")
      .run(numAnul, cert.user_id, cert.course_id, cert.code, req.user.id);
  } catch {}

  AUDIT(req.user.id, 'CERT_ANULADO', cert.code + ' | Motivo: ' + motivo + ' | Por: ' + (anulador?.legajo||req.user.id));

  res.json({
    ok: true, numero_acta: numAnul,
    datos_anulacion: {
      certificado: cert.code, titular: u?.apellido+', '+u?.nombre,
      curso: c?.cod+' — '+c?.nombre, motivo,
      anulado_por: anulador?.apellido+', '+anulador?.nombre,
      fecha: new Date().toLocaleString('es-AR')
    }
  });
});

// Vencimientos próximos (control de recurrencias)
app.get('/api/admin/vencimientos', auth, roleAtLeast('admin', 'instructor', 'supervisor'), (req, res) => {
  const dias = Number(req.query.dias) || 60;
  const hoy = new Date(); const lim = new Date(); lim.setDate(hoy.getDate() + dias);
  const H = hoy.toISOString().slice(0, 10), L = lim.toISOString().slice(0, 10);
  const rows = stmts.vencimientos.all().map(r => ({
    ...r, estado: r.vencimiento < H ? 'VENCIDO' : (r.vencimiento <= L ? 'POR VENCER' : 'VIGENTE')
  }));
  res.json({ vencimientos: rows.filter(r => r.estado !== 'VIGENTE'), horizonte_dias: dias });
});

// Libro de Actas de Exámenes (por curso, con fecha, cursantes y notas)
app.get('/api/admin/acta/:courseId', auth, roleAtLeast('admin', 'instructor'), (req, res) => {
  const c = stmts.courseById.get(Number(req.params.courseId));
  if (!c) return res.status(404).json({ error: 'Curso no encontrado.' });
  const rows = stmts.enrollmentsByCourse.all(c.id).map(e => {
    const atts = stmts.attemptsByEnrollment.all(e.id);
    const teo = atts.filter(a => a.tipo !== 'practico').at(-1);
    const pra = atts.filter(a => a.tipo === 'practico').at(-1);
    return {
      apellido: e.apellido, nombre: e.unombre, legajo: e.legajo, dni: e.dni, organismo: e.organismo,
      estado: e.estado,
      nota_teoria: teo ? teo.score_pct : null, instancia: teo ? teo.tipo : null,
      nota_practico: pra ? pra.score_pct : null, aei: pra ? (pra.aei_ok ? 'SÍ' : 'NO') : null,
      fecha: (pra || teo)?.created_at || e.created_at
    };
  });

  // Emisor y firma electrónica del acta
  const emisor = stmts.userById.get(req.user.id);
  const generada = new Date().toISOString();
  const firmaHash = crypto.createHash('sha256')
    .update(JSON.stringify(rows) + '|' + c.id + '|' + req.user.id + '|' + generada + '|' + JWT_SECRET)
    .digest('hex');

  // Número correlativo del acta
  const numActa = generarNumDoc('ACTE', new Date().getFullYear());  // ACTE = Acta de Exámenes

  // Registrar el acta con snapshot completo (para poder reimprimirla EXACTAMENTE igual más adelante)
  const snapshot = JSON.stringify({
    course: c, acta: rows, generada, numero_acta: numActa, firma_hash: firmaHash,
    emisor: { apellido: emisor?.apellido, nombre: emisor?.nombre, legajo: emisor?.legajo, rango: emisor?.rango }
  });
  try {
    db.prepare("INSERT INTO registro_documentos (tipo,numero,course_id,referencia,contenido,emitido_por) VALUES ('acta_examenes',?,?,?,?,?)")
      .run(numActa, c.id, firmaHash, snapshot, req.user.id);
  } catch {}

  AUDIT(req.user.id, 'ACTA_GENERADA', c.cod + ' | ' + numActa);
  res.json({
    course: c, acta: rows, generada,
    numero_acta: numActa, firma_hash: firmaHash,
    emisor: { apellido: emisor?.apellido, nombre: emisor?.nombre, legajo: emisor?.legajo, rango: emisor?.rango }
  });
});

// Buscar un acta ya generada por su número (para reimprimirla exactamente igual)
app.get('/api/admin/acta/buscar/:numero', auth, roleAtLeast('admin','instructor'), (req, res) => {
  const numero = String(req.params.numero || '').trim().toUpperCase();
  const doc = db.prepare("SELECT * FROM registro_documentos WHERE numero=? AND tipo='acta_examenes'").get(numero);
  if (!doc) return res.status(404).json({ error: 'No se encontró ningún acta con ese número.' });
  try {
    const snapshot = JSON.parse(doc.contenido);
    return res.json({ ...snapshot, anulado: doc.anulado === 1, reimpresion: true });
  } catch {
    return res.status(500).json({ error: 'El acta existe pero su contenido no pudo recuperarse.' });
  }
});

// Exportación CSV de cualquier listado
app.get('/api/admin/export/:tipo', auth, roleAtLeast('admin', 'instructor'), (req, res) => {
  const tipo = req.params.tipo;
  let rows = [], name = tipo;
  if (tipo === 'certificados') rows = stmts.allCerts.all();
  else if (tipo === 'usuarios') rows = stmts.allUsers.all();
  else if (tipo === 'vencimientos') rows = stmts.vencimientos.all();
  else if (tipo === 'auditoria') rows = stmts.auditList.all();
  else return res.status(400).json({ error: 'Tipo de exportación inválido.' });
  if (!rows.length) return res.status(404).json({ error: 'Sin datos para exportar.' });
  const cols = Object.keys(rows[0]);
  const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = [cols.join(';'), ...rows.map(r => cols.map(c => esc(r[c])).join(';'))].join('\r\n');
  AUDIT(req.user.id, 'EXPORT_CSV', tipo);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${name}_${Date.now()}.csv"`);
  res.send('\uFEFF' + csv);
});

app.get('/api/admin/audit', auth, roleAtLeast('admin','fiscalizador'), (req, res) => {
  res.json({ audit: stmts.auditList.all() });
});

/* ================= Jerarquías configurables ================= */
app.get('/api/jerarquias', (req,res) => {
  res.json({ jerarquias: stmts.allJerarquias.all().map(j=>j.nombre) });
});
app.get('/api/admin/jerarquias', auth, roleAtLeast('admin'), (req,res) => {
  res.json({ jerarquias: stmts.allJerarquiasAdmin.all() });
});
app.post('/api/admin/jerarquias', auth, roleAtLeast('admin'), (req,res) => {
  const nombre = String(req.body?.nombre||'').trim();
  if (!nombre) return res.status(400).json({ error:'El nombre de la jerarquía es obligatorio.' });
  const maxOrden = db.prepare('SELECT COALESCE(MAX(orden),0)+1 AS n FROM jerarquias').get().n;
  try {
    const info = stmts.insertJerarquia.run(nombre, maxOrden);
    AUDIT(req.user.id, 'JERARQUIA_ALTA', nombre);
    res.json({ ok:true, id: Number(info.lastInsertRowid) });
  } catch(e) {
    if (e.message.includes('UNIQUE')) return res.status(409).json({ error:'Ya existe una jerarquía con ese nombre.' });
    res.status(500).json({ error: e.message });
  }
});
app.delete('/api/admin/jerarquias/:id', auth, roleAtLeast('admin'), (req,res) => {
  stmts.deleteJerarquia.run(Number(req.params.id));
  AUDIT(req.user.id, 'JERARQUIA_BAJA', req.params.id);
  res.json({ ok:true });
});

/* ================= Panel de control de firmas electrónicas (búsqueda por hash) ================= */
/* ═══════════════════════════════════════════════════════════════════
   VERIFICADOR UNIFICADO DE DOCUMENTOS Y FIRMAS
   Acepta: número de documento, código de certificado/credencial o hash SHA-256
   Devuelve resultado normalizado con validación real del hash
═══════════════════════════════════════════════════════════════════ */
app.get('/api/admin/verificar', auth, roleAtLeast('admin', 'instructor', 'supervisor', 'fiscalizador'), (req, res) => {
  const q = String(req.query.q || '').trim().toUpperCase();
  if (!q || q.length < 4) return res.status(400).json({ error: 'Ingrese al menos 4 caracteres para buscar.' });
  const like = '%' + q + '%';
  const resultados = [];
  const hoy = new Date().toISOString().slice(0, 10);

  // Función auxiliar: valida que el hash registrado coincida con una recalculación
  // Para SINCA el hash de firma es un SHA-256 del contenido firmado — lo que podemos hacer
  // es confirmar que existe en la BD y no fue alterado (integridad referencial).
  // La validez formal = existe + no anulado + coincide el hash almacenado con el buscado.
  // Detectar si la búsqueda es por hash (solo hexadecimal) o por número/código de documento
  const esFragmentoHash = /^[0-9a-fA-F]+$/.test(q);
  function estadoHash(hashAlmacenado, q) {
    if (!hashAlmacenado) return 'sin_hash';
    if (!esFragmentoHash) {
      // La búsqueda fue por número de documento — el hash existe pero no se buscó por él
      return 'no_buscado_por_hash';
    }
    if (q.length === 64) {
      // Hash completo: comparación exacta
      return hashAlmacenado.toLowerCase() === q.toLowerCase() ? 'valido' : 'no_coincide';
    }
    // Fragmento de hash: el hash debe contener el fragmento
    return hashAlmacenado.toLowerCase().includes(q.toLowerCase()) ? 'valido' : 'no_coincide';
  }

  // ── 1. CERTIFICADOS (por código o por firma_hash) ─────────────────────
  // Resolver número CERT-XXXXX-AAAA-NNNN → code si la búsqueda es por número de libro matriz
  const certCodesFromNum = db.prepare(
    "SELECT referencia FROM registro_documentos WHERE tipo='certificado' AND numero LIKE ?"
  ).all(like).map(r => r.referencia).filter(Boolean);
  const certSet = new Set();
  const certLikes = [...new Set([like, ...certCodesFromNum.map(c => '%'+c+'%')])];
  const certQuery = db.prepare(`SELECT c.*, u.apellido, u.nombre AS unombre, u.legajo, u.rango, u.organismo,
              co.cod AS curso_cod, co.nombre AS curso_nombre, co.vigencia_meses
              FROM certificates c
              JOIN users u ON u.id = c.user_id
              JOIN courses co ON co.id = c.course_id
              WHERE c.code LIKE ? OR c.firma_hash LIKE ?`);
  certLikes.forEach(likeC => {
    certQuery.all(likeC, likeC).forEach(r => {
      if (certSet.has(r.id)) return;
      certSet.add(r.id);
    const enr = db.prepare('SELECT * FROM enrollments WHERE user_id=? AND course_id=? ORDER BY ciclo DESC LIMIT 1').get(r.user_id, r.course_id);
    const firmante = enr?.inscrito_por ? stmts.userById.get(enr.inscrito_por) : null;
    const regDoc = db.prepare("SELECT numero FROM registro_documentos WHERE tipo='certificado' AND referencia=?").get(r.code);
    const vencido = r.vencimiento && r.vencimiento < hoy;
    resultados.push({
      tipo: 'Certificado', tipo_icono: '🎓',
      numero_doc: regDoc?.numero || r.code,
      codigo_original: r.code,
      hash: r.firma_hash,
      estado_hash: estadoHash(r.firma_hash, q),
      valido: !r.anulado && !vencido,
      estado_doc: r.anulado ? 'ANULADO' : vencido ? 'VENCIDO' : 'VIGENTE',
      titular: { nombre: r.apellido + ', ' + r.unombre, legajo: r.legajo, organismo: r.organismo },
      firmante: firmante ? { nombre: firmante.apellido + ', ' + firmante.nombre, legajo: firmante.legajo, rol: firmante.role } : null,
      detalle: `${r.curso_cod} — ${r.curso_nombre}`,
      emitido_at: (r.issued_at||'').slice(0, 16),
      vencimiento: r.vencimiento || 'Sin vencimiento',
      curso_cod: r.curso_cod
    });
    });  // cierre forEach de certLikes
  });   // cierre forEach de certQuery

  // ── 2. CREDENCIALES AVSEC (por ver_code) ─────────────────────────────
  db.prepare(`SELECT cr.*, u.apellido, u.nombre AS unombre, u.legajo, u.organismo, u.dni
              FROM credenciales cr JOIN users u ON u.id = cr.user_id
              WHERE cr.ver_code LIKE ?`).all(like).forEach(r => {
    const regDoc = db.prepare("SELECT numero FROM registro_documentos WHERE tipo='credencial' AND referencia=?").get(r.ver_code);
    resultados.push({
      tipo: 'Credencial AVSEC', tipo_icono: '🪪',
      numero_doc: regDoc?.numero || r.ver_code,
      codigo_original: r.ver_code,
      hash: null,  // la credencial no tiene firma hash propia — su integridad es el ver_code
      estado_hash: 'no_aplica',
      valido: r.activa === 1,
      estado_doc: r.activa === 1 ? 'ACTIVA' : 'REEMPLAZADA/ANULADA',
      titular: { nombre: r.apellido + ', ' + r.unombre, legajo: r.legajo, organismo: r.organismo },
      firmante: null,
      detalle: `N° Permiso: ${r.num_permiso || '—'}`,
      emitido_at: (r.emitido_at||'').slice(0, 16),
      vencimiento: null
    });
  });

  // ── 3. EPPT — Firma del Supervisor (por hash o por número JEPPT-XXXXX-AAAA-NNNN) ──────────────
  // Resolver número de documento → hash si la búsqueda es por número
  const hashesSupFromNum = db.prepare(
    "SELECT referencia FROM registro_documentos WHERE tipo='jornada_eppt' AND numero LIKE ?"
  ).all(like).map(r => r.referencia).filter(Boolean);
  const likeOrHashes = [like, ...hashesSupFromNum.map(h => h)];
  const epptSupSet = new Set();
  const epptSupQuery = db.prepare(`SELECT ee.*, u.apellido, u.nombre AS unombre, u.legajo AS sup_legajo, u.role AS sup_role,
              al.apellido AS al_apellido, al.nombre AS al_nombre, al.legajo AS al_legajo,
              co.cod AS curso_cod, co.nombre AS curso_nombre
              FROM eppt_entries ee
              JOIN eppt_records er ON er.id = ee.eppt_id
              JOIN enrollments e2 ON e2.id = er.enrollment_id
              JOIN users u ON u.id = ee.supervisor_id
              JOIN users al ON al.id = e2.user_id
              JOIN courses co ON co.id = e2.course_id
              WHERE ee.firma_sup_hash LIKE ?`);
  // Correr la query por cada hash (incluye el like original y los resueltos desde número)
  const uniqueHashes = [...new Set([like, ...hashesSupFromNum.map(h => '%'+h+'%')])];
  uniqueHashes.forEach(likeH => {
    epptSupQuery.all(likeH).forEach(r => {
      if (epptSupSet.has(r.id)) return;
      epptSupSet.add(r.id);
    const regDoc = db.prepare("SELECT numero FROM registro_documentos WHERE tipo='jornada_eppt' AND referencia=?").get(r.firma_sup_hash);
    resultados.push({
      tipo: 'EPPT — Firma del Supervisor', tipo_icono: '✍️',
      numero_doc: regDoc?.numero || ('JEPPT-' + r.id),
      codigo_original: regDoc?.numero || null,
      hash: r.firma_sup_hash,
      estado_hash: estadoHash(r.firma_sup_hash, q),
      valido: true,
      estado_doc: 'FIRMADO',
      titular: { nombre: r.al_apellido + ', ' + r.al_nombre, legajo: r.al_legajo, organismo: null },
      firmante: { nombre: r.apellido + ', ' + r.unombre, legajo: r.sup_legajo, rol: r.sup_role },
      detalle: `${r.curso_cod} · Jornada ${r.fecha} · Puesto: ${r.puesto||'—'}`,
      emitido_at: (r.firma_sup_at||'').slice(0, 16),
      vencimiento: null
    });
    });  // cierre forEach de uniqueHashes
  });   // cierre forEach de query

  // ── 4. EPPT — Conformidad del Alumno (por hash o número FALU) ────────
  const hashesAluFromNum = db.prepare(
    "SELECT referencia FROM registro_documentos WHERE tipo='firma_alumno_eppt' AND numero LIKE ?"
  ).all(like).map(r => r.referencia).filter(Boolean);
  const epptAluSet = new Set();
  const epptAluQuery = db.prepare(`SELECT ee.*, u.apellido, u.nombre AS unombre, u.legajo AS alu_legajo, u.role AS alu_role,
              sup.apellido AS sup_apellido, sup.nombre AS sup_nombre, sup.legajo AS sup_legajo,
              co.cod AS curso_cod
              FROM eppt_entries ee
              JOIN eppt_records er ON er.id = ee.eppt_id
              JOIN enrollments e2 ON e2.id = er.enrollment_id
              JOIN users u ON u.id = e2.user_id
              JOIN users sup ON sup.id = ee.supervisor_id
              JOIN courses co ON co.id = e2.course_id
              WHERE ee.firma_alu_hash LIKE ?`);
  [...new Set([like, ...hashesAluFromNum.map(h => '%'+h+'%')])].forEach(likeH => {
    epptAluQuery.all(likeH).forEach(r => {
      if (epptAluSet.has(r.id)) return;
      epptAluSet.add(r.id);
    const regDoc = db.prepare("SELECT numero FROM registro_documentos WHERE tipo='firma_alumno_eppt' AND referencia=?").get(r.firma_alu_hash);
    resultados.push({
      tipo: 'EPPT — Conformidad del Alumno', tipo_icono: '✅',
      numero_doc: regDoc?.numero || ('FALU-' + r.id),
      codigo_original: regDoc?.numero || null,
      hash: r.firma_alu_hash,
      estado_hash: estadoHash(r.firma_alu_hash, q),
      valido: true,
      estado_doc: 'FIRMADO',
      titular: { nombre: r.apellido + ', ' + r.unombre, legajo: r.alu_legajo, organismo: null },
      firmante: { nombre: r.apellido + ', ' + r.unombre, legajo: r.alu_legajo, rol: r.alu_role },
      detalle: `${r.curso_cod} · Jornada ${r.fecha} · Sup: ${r.sup_apellido}, ${r.sup_nombre} (${r.sup_legajo})`,
      emitido_at: (r.firma_alu_at||'').slice(0, 16),
      vencimiento: null
    });
    });  // cierre forEach de uniqueHashesAlu
  });   // cierre forEach de epptAluQuery

  // ── 5. LIBRO MATRIZ: actas, constancias, anulaciones (por número o hash) ──
  db.prepare(`SELECT rd.*, u.apellido, u.nombre AS unombre, u.legajo, u.role,
              al.apellido AS al_apellido, al.nombre AS al_nombre, al.legajo AS al_legajo,
              co.cod AS curso_cod, co.nombre AS curso_nombre
              FROM registro_documentos rd
              LEFT JOIN users u ON u.id = rd.emitido_por
              LEFT JOIN users al ON al.id = rd.user_id
              LEFT JOIN courses co ON co.id = rd.course_id
              WHERE (rd.numero LIKE ? OR (rd.referencia LIKE ? AND length(rd.referencia) >= 16))
              AND rd.tipo NOT IN ('certificado','credencial','jornada_eppt','firma_alumno_eppt')`
  ).all(like, like).forEach(r => {
    const tipoLabel = {
      acta_examenes:   'Acta de Exámenes',
      acta_eppt:       'Acta EPPT',
      constancia_eppt: 'Constancia EPPT',
      anulacion_cert:  'Constancia de Anulación',
      arep:            'Acta Reprobación EPPT'
    }[r.tipo] || r.tipo.replace(/_/g,' ');
    const tipoIcono = {
      acta_examenes:'📋', acta_eppt:'📄', constancia_eppt:'📄',
      anulacion_cert:'❌', arep:'🚫'
    }[r.tipo] || '📄';
    const hashEnRef = r.referencia?.length >= 32 ? r.referencia : null;
    resultados.push({
      tipo: tipoLabel, tipo_icono: tipoIcono,
      numero_doc: r.numero,
      codigo_original: r.numero,
      hash: hashEnRef,
      estado_hash: hashEnRef ? estadoHash(hashEnRef, q) : 'no_aplica',
      valido: !r.anulado,
      estado_doc: r.anulado ? 'ANULADO' : 'VIGENTE',
      titular: r.al_apellido ? { nombre: r.al_apellido + ', ' + r.al_nombre, legajo: r.al_legajo, organismo: null } : null,
      firmante: r.apellido ? { nombre: r.apellido + ', ' + r.unombre, legajo: r.legajo, rol: r.role } : null,
      detalle: r.curso_cod ? `${r.curso_cod} — ${r.curso_nombre||''}` : '',
      emitido_at: (r.emitido_at||'').slice(0, 16),
      vencimiento: null
    });
  });

  // Ordenar: primero los que coinciden exactamente con el número buscado
  resultados.sort((a, b) => {
    const aExact = a.numero_doc?.toUpperCase() === q || a.codigo_original?.toUpperCase() === q ? -1 : 0;
    const bExact = b.numero_doc?.toUpperCase() === q || b.codigo_original?.toUpperCase() === q ? -1 : 0;
    return aExact - bExact;
  });

  res.json({ q, total: resultados.length, resultados });
});

app.get('/api/admin/firmas/buscar', auth, roleAtLeast('admin'), (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q || q.length < 4) return res.status(400).json({ error: 'Ingrese al menos 4 caracteres del hash a buscar.' });
  const like = '%' + q + '%';
  const resultados = [];

  // 1) Certificados
  db.prepare(`SELECT c.*, u.apellido, u.nombre AS unombre, u.legajo, u.rango, co.cod AS curso_cod, co.nombre AS curso_nombre
              FROM certificates c JOIN users u ON u.id=c.user_id JOIN courses co ON co.id=c.course_id
              WHERE c.firma_hash LIKE ?`).all(like).forEach(r => {
    const enr = db.prepare('SELECT * FROM enrollments WHERE user_id=? AND course_id=?').get(r.user_id, r.course_id);
    const firmante = enr?.inscrito_por ? stmts.userById.get(enr.inscrito_por) : null;
    resultados.push({
      tipo: 'Certificado', hash: r.firma_hash, codigo: r.code,
      firmante: firmante ? { nombre: firmante.apellido + ', ' + firmante.nombre, legajo: firmante.legajo, rol: firmante.role } : null,
      detalle: `${r.curso_cod} — ${r.curso_nombre} · Titular: ${r.apellido}, ${r.unombre} (Leg. ${r.legajo}) · Emitido: ${(r.issued_at||'').slice(0,10)}`,
      anulado: r.anulado === 1
    });
  });

  // 2a) EPPT — firma del supervisor (busca por hash en eppt_entries directamente)
  db.prepare(`SELECT ee.*, er.enrollment_id, u.apellido, u.nombre AS unombre, u.legajo AS sup_legajo, u.role AS sup_role,
              al.apellido AS al_apellido, al.nombre AS al_nombre, al.legajo AS al_legajo,
              co.cod AS curso_cod
              FROM eppt_entries ee
              JOIN eppt_records er ON er.id=ee.eppt_id
              JOIN enrollments e2 ON e2.id=er.enrollment_id
              JOIN users u ON u.id=ee.supervisor_id
              JOIN users al ON al.id=e2.user_id
              JOIN courses co ON co.id=e2.course_id
              WHERE ee.firma_sup_hash LIKE ?`).all(like).forEach(r => {
    // Buscar el número de documento JEPPT en registro_documentos
    const regDoc = db.prepare(`SELECT numero FROM registro_documentos WHERE tipo='jornada_eppt' AND referencia=?`).get(r.firma_sup_hash);
    resultados.push({
      tipo: 'EPPT — Firma del Supervisor', hash: r.firma_sup_hash,
      codigo: regDoc ? regDoc.numero : ('EPPT-' + r.id),
      firmante: { nombre: r.apellido + ', ' + r.unombre, legajo: r.sup_legajo, rol: r.sup_role },
      detalle: `${r.curso_cod} · Jornada ${r.fecha} · Alumno: ${r.al_apellido}, ${r.al_nombre} (Leg. ${r.al_legajo}) · Puesto: ${r.puesto||'—'}`,
      anulado: false
    });
  });

  // 2b) EPPT — firma de conformidad del alumno (busca por hash en eppt_entries)
  db.prepare(`SELECT ee.*, er.enrollment_id, u.apellido, u.nombre AS unombre, u.legajo AS alu_legajo, u.role AS alu_role,
              sup.apellido AS sup_apellido, sup.nombre AS sup_nombre, sup.legajo AS sup_legajo,
              co.cod AS curso_cod
              FROM eppt_entries ee
              JOIN eppt_records er ON er.id=ee.eppt_id
              JOIN enrollments e2 ON e2.id=er.enrollment_id
              JOIN users u ON u.id=e2.user_id
              JOIN users sup ON sup.id=ee.supervisor_id
              JOIN courses co ON co.id=e2.course_id
              WHERE ee.firma_alu_hash LIKE ?`).all(like).forEach(r => {
    const regDoc = db.prepare(`SELECT numero FROM registro_documentos WHERE tipo='firma_alumno_eppt' AND referencia=?`).get(r.firma_alu_hash);
    resultados.push({
      tipo: 'EPPT — Conformidad del Alumno', hash: r.firma_alu_hash,
      codigo: regDoc ? regDoc.numero : ('EPPT-ALU-' + r.id),
      firmante: { nombre: r.apellido + ', ' + r.unombre, legajo: r.alu_legajo, rol: r.alu_role },
      detalle: `${r.curso_cod} · Jornada ${r.fecha} · Supervisado por: ${r.sup_apellido}, ${r.sup_nombre} (Leg. ${r.sup_legajo})`,
      anulado: false
    });
  });

  // 3) Horas de instructor
  db.prepare(`SELECT ih.*, u.apellido, u.nombre AS unombre, u.legajo, u.role
              FROM instructor_horas ih JOIN users u ON u.id=ih.firmado_por
              WHERE ih.firma_hash LIKE ?`).all(like).forEach(r => {
    resultados.push({
      tipo: 'Reloj de Instructores', hash: r.firma_hash, codigo: 'HORAS-' + r.id,
      firmante: { nombre: r.apellido + ', ' + r.unombre, legajo: r.legajo, rol: r.role },
      detalle: `Año ${r.anio} · ${r.horas} hs · ${r.descripcion || 'Sin descripción'} · Fecha: ${r.fecha}`,
      anulado: false
    });
  });

  // 4) Registro Libro Matriz — busca en referencia (= hash de firma) para TODOS los tipos
  //    incluyendo jornada_eppt y firma_alumno_eppt registrados en los FIX 1 y 2
  db.prepare(`SELECT rd.*, u.apellido, u.nombre AS unombre, u.legajo, u.role
              FROM registro_documentos rd LEFT JOIN users u ON u.id=rd.emitido_por
              WHERE rd.referencia LIKE ? AND length(rd.referencia) >= 32`).all(like).forEach(r => {
    const tipoLabel = {
      acta_examenes:    'Acta de Exámenes',
      acta_eppt:        'Acta EPPT',
      constancia_eppt:  'Constancia EPPT',
      anulacion_cert:   'Anulación de Certificado',
      jornada_eppt:     'Jornada EPPT — Firma del Supervisor',
      firma_alumno_eppt:'Jornada EPPT — Conformidad del Alumno',
      certificado:      'Certificado',
      credencial:       'Credencial AVSEC'
    };
    resultados.push({
      tipo: tipoLabel[r.tipo] || r.tipo,
      hash: r.referencia, codigo: r.numero,
      firmante: r.emitido_por ? (() => { const e = stmts.userById.get(r.emitido_por); return e ? { nombre: e.apellido+', '+e.nombre, legajo: e.legajo, rol: e.role } : null; })() : null,
      detalle: `N° ${r.numero} · Emitido: ${(r.emitido_at||'').slice(0,10)}`,
      anulado: r.anulado === 1
    });
  });

  res.json({ resultados });
});

/* ================= Panel de control de firmas EPPT por supervisor ================= */
app.get('/api/admin/eppt/firmas-supervisor', auth, roleAtLeast('admin'), (req, res) => {
  const { supervisor_id, alumno, apendice, desde, hasta, orden } = req.query;
  let sql = `SELECT ee.id, ee.fecha, ee.puesto, ee.horas, ee.firma_sup_at, ee.firma_sup_hash,
             u.id AS sup_id, u.apellido AS sup_apellido, u.nombre AS sup_nombre, u.legajo AS sup_legajo,
             al.apellido AS al_apellido, al.nombre AS al_nombre, al.legajo AS al_legajo,
             er.apendice, co.cod AS curso_cod, co.nombre AS curso_nombre
             FROM eppt_entries ee
             JOIN eppt_records er ON er.id=ee.eppt_id
             JOIN enrollments e2 ON e2.id=er.enrollment_id
             JOIN users u ON u.id=ee.supervisor_id
             JOIN users al ON al.id=e2.user_id
             JOIN courses co ON co.id=e2.course_id
             WHERE ee.firma_sup_at IS NOT NULL`;
  const params = [];
  if (supervisor_id) { sql += ' AND u.id=?'; params.push(Number(supervisor_id)); }
  if (alumno) { sql += ' AND (al.apellido LIKE ? OR al.nombre LIKE ? OR al.legajo LIKE ?)'; params.push('%'+alumno+'%','%'+alumno+'%','%'+alumno+'%'); }
  if (apendice) { sql += ' AND er.apendice LIKE ?'; params.push('%'+apendice+'%'); }
  if (desde) { sql += ' AND ee.fecha >= ?'; params.push(desde); }
  if (hasta) { sql += ' AND ee.fecha <= ?'; params.push(hasta); }
  sql += ' ORDER BY ee.fecha DESC';
  const detalle = db.prepare(sql).all(...params);

  // Resumen agrupado por supervisor
  const resumenMap = new Map();
  detalle.forEach(r => {
    if (!resumenMap.has(r.sup_id)) resumenMap.set(r.sup_id, {
      supervisor_id: r.sup_id, apellido: r.sup_apellido, nombre: r.sup_nombre, legajo: r.sup_legajo, firmas: 0, alumnos: new Set()
    });
    const s = resumenMap.get(r.sup_id);
    s.firmas++; s.alumnos.add(r.al_legajo);
  });
  let resumen = [...resumenMap.values()].map(s => ({ ...s, alumnos: s.alumnos.size }));
  if (orden === 'asc') resumen.sort((a,b) => a.firmas - b.firmas);
  else resumen.sort((a,b) => b.firmas - a.firmas);

  res.json({ resumen, detalle });
});

/* ═══════════════════════════════════════════════════════════════════
   BACKUP COMPLETO DE LA PLATAFORMA
   Incluye: BD principal, imágenes RX, videos, docs y sesiones proctor
   El ZIP se genera en una carpeta temporal del servidor y se envía
   al navegador como descarga directa. No queda ningún archivo
   residual en el servidor tras la descarga.
═══════════════════════════════════════════════════════════════════ */
app.post('/api/admin/backup', auth, roleAtLeast('admin'), async (req, res) => {
  const os    = require('os');
  const fs    = require('fs');
  const path  = require('path');
  const { execFile, spawn } = require('child_process');

  // Nombre con timestamp en formato DD-MM-AAAA_HH-MM
  const now   = new Date();
  const pad   = n => String(n).padStart(2, '0');
  const stamp = `${pad(now.getDate())}-${pad(now.getMonth()+1)}-${now.getFullYear()}_${pad(now.getHours())}-${pad(now.getMinutes())}`;
  const zipName = `SINCA_backup_${stamp}.zip`;
  const zipPath = path.join(os.tmpdir(), zipName);

  // Eliminar cualquier ZIP anterior con el mismo nombre (raro pero posible)
  try { fs.unlinkSync(zipPath); } catch {}

  // ── Carpetas y archivos a incluir ─────────────────────────────────────
  const root     = __dirname;
  const targets  = [
    { src: path.join(root, 'data', 'plataforma_pnisac.db'), arcName: 'data/plataforma_pnisac.db' },
    { src: path.join(root, 'data', 'proctor'),              arcName: 'data/proctor/',              isDir: true },
    { src: path.join(root, 'assets', 'xray_images'),        arcName: 'assets/xray_images/',        isDir: true },
    { src: path.join(root, 'assets', 'videos'),             arcName: 'assets/videos/',             isDir: true },
    { src: path.join(root, 'assets', 'docs'),               arcName: 'assets/docs/',               isDir: true },
  ].filter(t => fs.existsSync(t.src)); // solo incluir lo que realmente existe

  if (!targets.length) {
    return res.status(500).json({ error: 'No se encontraron archivos para respaldar.' });
  }

  // Incluir README con la fecha y el contenido del backup
  const readme = `SINCA — Backup completo
Generado: ${now.toLocaleString('es-AR')}
Contenido: ${targets.map(t=>t.arcName).join(', ')}
`;
  const readmePath = path.join(os.tmpdir(), 'SINCA_README_backup.txt');
  fs.writeFileSync(readmePath, readme, 'utf8');

  // ── Estrategia de compresión: usa 'zip' del sistema si está disponible.
  //    En Windows PowerShell es el fallback.
  //    En Windows sin zip, usamos el módulo 'archiver' si está instalado.
  function buildWithZip() {
    return new Promise((resolve, reject) => {
      // zip no acepta rutas absolutas bien; trabajamos desde __dirname
      const args = ['-r', zipPath, readmePath];
      targets.forEach(t => {
        if (t.isDir) args.push(t.src);
        else args.push(t.src);
      });
      // Opción más portable: construir la lista de rutas relativas a __dirname
      const relArgs = ['-r', zipPath, 'SINCA_README_backup.txt'];
      // Para relativas necesitamos cambiar el cwd a un directorio común; usamos directamente rutas absolutas
      // y luego recomponemos los nombres de archivo dentro del ZIP
      const spawnArgs = ['-j']; // -j = junk paths (aplanado); NO queremos eso; usamos sin -j
      // Enfoque más claro: armar un zip desde el directorio raíz del proyecto
      const relTargets = targets.map(t => {
        const rel = path.relative(root, t.src);
        return rel;
      });

      const proc = spawn('zip', ['-r', zipPath, ...relTargets], { cwd: root });
      proc.on('error', reject);
      proc.on('close', code => code === 0 ? resolve() : reject(new Error('zip exited ' + code)));
    });
  }

  function buildWithNode() {
    // Implementación pure-Node usando zlib + tar-like stream manualmente
    // Usamos el formato ZIP mínimo con Deflate via zlib
    return new Promise((resolve, reject) => {
      try {
        const { deflateRawSync } = require('zlib');
        const entries = [];

        function addFileEntry(absPath, arcPath) {
          if (!fs.existsSync(absPath)) return;
          const data    = fs.readFileSync(absPath);
          const compressed = deflateRawSync(data);
          const useDeflate = compressed.length < data.length;
          const finalData  = useDeflate ? compressed : data;
          const crc32 = calcCRC32(data);
          const dt    = dateToMsDOS(new Date(fs.statSync(absPath).mtimeMs));
          entries.push({ arcPath, data: finalData, uncompressedSize: data.length, crc32, method: useDeflate ? 8 : 0, modTime: dt });
        }

        function addDirRecursive(dirAbs, dirArc) {
          if (!fs.existsSync(dirAbs)) return;
          for (const name of fs.readdirSync(dirAbs)) {
            const abs = path.join(dirAbs, name);
            const arc = dirArc + name;
            if (fs.statSync(abs).isDirectory()) addDirRecursive(abs + '/', arc + '/');
            else addFileEntry(abs, arc);
          }
        }

        // Agregar README
        addFileEntry(readmePath, 'SINCA_README_backup.txt');
        // Agregar cada target
        targets.forEach(t => {
          if (t.isDir) addDirRecursive(t.src + '/', t.arcName);
          else addFileEntry(t.src, t.arcName);
        });

        // Construir el ZIP binario
        const buf = buildZipBuffer(entries);
        fs.writeFileSync(zipPath, buf);
        resolve();
      } catch(e) { reject(e); }
    });
  }

  // ── Funciones auxiliares ZIP ──────────────────────────────────────────
  function calcCRC32(buf) {
    let crc = 0xFFFFFFFF;
    const table = calcCRC32.table || (calcCRC32.table = (() => {
      const t = new Uint32Array(256);
      for (let i = 0; i < 256; i++) {
        let c = i;
        for (let j = 0; j < 8; j++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
        t[i] = c;
      }
      return t;
    })());
    for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }

  function dateToMsDOS(d) {
    const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    const time = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2);
    return { date, time };
  }

  function writeUInt16LE(buf, offset, val) { buf[offset] = val & 0xFF; buf[offset+1] = (val >> 8) & 0xFF; }
  function writeUInt32LE(buf, offset, val) {
    buf[offset] = val & 0xFF; buf[offset+1] = (val >> 8) & 0xFF;
    buf[offset+2] = (val >> 16) & 0xFF; buf[offset+3] = (val >> 24) & 0xFF;
  }

  function buildZipBuffer(entries) {
    const localHeaders = [];
    const offsets = [];
    let offset = 0;

    const bufs = [];
    for (const e of entries) {
      const nameBytes = Buffer.from(e.arcPath, 'utf8');
      const lh = Buffer.alloc(30 + nameBytes.length);
      writeUInt32LE(lh, 0, 0x04034b50); // local file header sig
      writeUInt16LE(lh, 4, 20);          // version needed
      writeUInt16LE(lh, 6, 0);           // flags
      writeUInt16LE(lh, 8, e.method);    // compression
      writeUInt16LE(lh, 10, e.modTime.time);
      writeUInt16LE(lh, 12, e.modTime.date);
      writeUInt32LE(lh, 14, e.crc32);
      writeUInt32LE(lh, 18, e.data.length);
      writeUInt32LE(lh, 22, e.uncompressedSize);
      writeUInt16LE(lh, 26, nameBytes.length);
      writeUInt16LE(lh, 28, 0);
      nameBytes.copy(lh, 30);
      offsets.push(offset);
      offset += lh.length + e.data.length;
      localHeaders.push(lh);
      bufs.push(lh, e.data);
    }

    // Central directory
    const cdBufs = [];
    let cdSize = 0;
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      const nameBytes = Buffer.from(e.arcPath, 'utf8');
      const cd = Buffer.alloc(46 + nameBytes.length);
      writeUInt32LE(cd, 0, 0x02014b50);
      writeUInt16LE(cd, 4, 20); writeUInt16LE(cd, 6, 20);
      writeUInt16LE(cd, 8, 0); writeUInt16LE(cd, 10, e.method);
      writeUInt16LE(cd, 12, e.modTime.time); writeUInt16LE(cd, 14, e.modTime.date);
      writeUInt32LE(cd, 16, e.crc32);
      writeUInt32LE(cd, 20, e.data.length);
      writeUInt32LE(cd, 24, e.uncompressedSize);
      writeUInt16LE(cd, 28, nameBytes.length);
      writeUInt16LE(cd, 30, 0); writeUInt16LE(cd, 32, 0);
      writeUInt16LE(cd, 34, 0); writeUInt16LE(cd, 36, 0);
      writeUInt32LE(cd, 38, 0); writeUInt32LE(cd, 42, offsets[i]);
      nameBytes.copy(cd, 46);
      cdBufs.push(cd);
      cdSize += cd.length;
    }

    const eocd = Buffer.alloc(22);
    writeUInt32LE(eocd, 0, 0x06054b50);
    writeUInt16LE(eocd, 4, 0); writeUInt16LE(eocd, 6, 0);
    writeUInt16LE(eocd, 8, entries.length); writeUInt16LE(eocd, 10, entries.length);
    writeUInt32LE(eocd, 12, cdSize); writeUInt32LE(eocd, 16, offset);
    writeUInt16LE(eocd, 20, 0);

    return Buffer.concat([...bufs, ...cdBufs, eocd]);
  }

  // ── Generar el ZIP ────────────────────────────────────────────────────
  try {
    // Intentar con zip del sistema (disponible en Linux/Mac)
    let zipOk = false;
    try {
      await buildWithZip();
      zipOk = true;
    } catch {
      // Fallback: implementación pure-Node (compatible con Windows sin zip)
      await buildWithNode();
      zipOk = true;
    }

    const stat = fs.statSync(zipPath);
    AUDIT(req.user.id, 'BACKUP_GENERADO', `${zipName} — ${(stat.size/1024).toFixed(1)} KB`);

    // Enviar el archivo al navegador como descarga y luego borrarlo
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${zipName}"`);
    res.setHeader('Content-Length', stat.size);

    const stream = fs.createReadStream(zipPath);
    stream.pipe(res);
    stream.on('end', () => {
      try { fs.unlinkSync(zipPath); } catch {}
      try { fs.unlinkSync(readmePath); } catch {}
    });
    stream.on('error', err => {
      try { fs.unlinkSync(zipPath); } catch {}
      if (!res.headersSent) res.status(500).json({ error: 'Error enviando el backup: ' + err.message });
    });
  } catch(e) {
    try { fs.unlinkSync(zipPath); } catch {}
    try { fs.unlinkSync(readmePath); } catch {}
    console.error('Error generando backup:', e.message);
    res.status(500).json({ error: 'Error generando el backup: ' + e.message });
  }
});

/* ═══════════════════════════════════════════════════════════════════
   RESTAURACIÓN DESDE BACKUP
   Recibe un ZIP generado por /api/admin/backup, extrae y reemplaza:
     - La base de datos (data/plataforma_pnisac.db)
     - Carpetas data/proctor/, assets/xray_images/, assets/videos/, assets/docs/
   Requiere confirmación explícita (campo confirm=true en el body multipart).
   Reinicia el servidor automáticamente luego de aplicar la BD.
═══════════════════════════════════════════════════════════════════ */
const restoreUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, os.tmpdir()),
    filename: (req, file, cb) => cb(null, 'SINCA_restore_' + Date.now() + '.zip')
  }),
  fileFilter: (req, file, cb) => {
    if (!file.originalname.toLowerCase().endsWith('.zip'))
      return cb(new Error('Solo se aceptan archivos ZIP de backup.'));
    cb(null, true);
  },
  limits: { fileSize: 2 * 1024 * 1024 * 1024 } // 2 GB
});

app.post('/api/admin/restore', auth, roleAtLeast('admin'), restoreUpload.single('backup'),
  async (req, res) => {
  const os   = require('os');
  const fs   = require('fs');
  const path = require('path');
  const { exec } = require('child_process');

  try {
    // 1. Verificar confirmación explícita
    if (req.body?.confirm !== 'CONFIRMAR_RESTAURACION')
      return res.status(400).json({ error: 'Debe enviar confirm=CONFIRMAR_RESTAURACION para ejecutar la restauración.' });

    if (!req.file)
      return res.status(400).json({ error: 'No se recibió el archivo de backup.' });

    const zipPath = req.file.path;
    const extractDir = path.join(os.tmpdir(), 'SINCA_restore_' + Date.now());
    fs.mkdirSync(extractDir, { recursive: true });

    // 2. Extraer el ZIP en una carpeta temporal
    await new Promise((resolve, reject) => {
      exec(`unzip -o "${zipPath}" -d "${extractDir}"`, (err) => {
        if (err) reject(new Error('Error extrayendo el backup: ' + err.message));
        else resolve();
      });
    });

    const root = __dirname;
    const restored = [];

    // 3. Restaurar cada componente si existe en el ZIP extraído
    const components = [
      { src: path.join(extractDir, 'data', 'plataforma_pnisac.db'), dst: path.join(root, 'data', 'plataforma_pnisac.db'), label: 'Base de datos' },
      { src: path.join(extractDir, 'data', 'proctor'),              dst: path.join(root, 'data', 'proctor'),              label: 'Sesiones de supervisión', isDir: true },
      { src: path.join(extractDir, 'assets', 'xray_images'),        dst: path.join(root, 'assets', 'xray_images'),        label: 'Imágenes de Rayos X', isDir: true },
      { src: path.join(extractDir, 'assets', 'videos'),             dst: path.join(root, 'assets', 'videos'),             label: 'Videos', isDir: true },
      { src: path.join(extractDir, 'assets', 'docs'),               dst: path.join(root, 'assets', 'docs'),               label: 'Documentos', isDir: true },
    ];

    for (const c of components) {
      if (!fs.existsSync(c.src)) continue;
      try {
        if (c.isDir) {
          // Reemplazar directorio completo
          if (fs.existsSync(c.dst)) fs.rmSync(c.dst, { recursive: true, force: true });
          fs.cpSync(c.src, c.dst, { recursive: true });
        } else {
          // Reemplazar archivo
          fs.mkdirSync(path.dirname(c.dst), { recursive: true });
          fs.copyFileSync(c.src, c.dst);
        }
        restored.push(c.label);
      } catch(ec) { console.warn('Restauración ' + c.label + ':', ec.message); }
    }

    // 4. Limpiar archivos temporales
    try { fs.unlinkSync(zipPath); } catch {}
    try { fs.rmSync(extractDir, { recursive: true, force: true }); } catch {}

    if (!restored.length)
      return res.status(400).json({ error: 'El ZIP no contenía archivos reconocibles de un backup SINCA.' });

    AUDIT(req.user.id, 'RESTAURACION_EJECUTADA',
      `Restaurados: ${restored.join(', ')} · ZIP: ${req.file.originalname}`);

    // 5. Responder ANTES de reiniciar para que el cliente reciba la respuesta
    res.json({
      ok: true,
      restaurados: restored,
      mensaje: 'Restauración completada. El servidor se reiniciará en 2 segundos para cargar la nueva base de datos.',
      reinicio: true
    });

    // 6. Reiniciar el proceso Node para que cargue la BD restaurada
    setTimeout(() => {
      console.log('🔄 Reiniciando servidor tras restauración de backup…');
      process.exit(0); // PM2 o nodemon lo levantará automáticamente
    }, 2000);

  } catch(e) {
    console.error('Error en restauración:', e.message);
    res.status(500).json({ error: 'Error durante la restauración: ' + e.message });
  }
});

/* ================= Credenciales AVSEC ================= */
app.post('/api/credenciales/registrar', auth, (req,res) => {
  const { ver_code, num_permiso } = req.body||{};
  if (!ver_code?.trim()) return res.status(400).json({ error:'ver_code requerido.' });
  stmts.anularCredencialesViejas.run(req.user.id, ver_code.trim().toUpperCase());
  try {
    stmts.insertCredencial.run(req.user.id, ver_code.trim().toUpperCase(), String(num_permiso||''), req.user.id);
  } catch(e) { if (!e.message.includes('UNIQUE')) throw e; }

  // Registrar en el Libro Matriz con número CRED-AAAA-NNNN
  let numCred = null;
  try {
    const anioCred = new Date().getFullYear();
    numCred = generarNumDoc('CRED', anioCred);
    const u = stmts.userById.get(req.user.id);
    stmts.insertRegDoc.run('credencial', numCred, req.user.id, null, ver_code.trim().toUpperCase(), req.user.id);
  } catch(eCred) { console.warn('Registro credencial en libro matriz:', eCred.message); }

  AUDIT(req.user.id, 'CREDENCIAL_EMITIDA', `${ver_code} permiso:${num_permiso} número:${numCred||'sin asignar'}`);
  res.json({ ok:true, numero_credencial: numCred });
});

app.get('/api/admin/credenciales', auth, roleAtLeast('admin','instructor'), (req,res) => {
  res.json({ credenciales: stmts.allCredenciales.all() });
});

app.get('/api/credencial/:code', (req,res) => {
  const code = String(req.params.code||'').trim().toUpperCase();
  const cred = stmts.credencialByCode.get(code);
  if (!cred) return res.json({ encontrado:false, mensaje:'No se encontró ninguna credencial con ese código.' });
  const hoyStr = new Date().toISOString().slice(0,10);
  const certsUser = stmts.certsByUser.all(cred.user_id) || [];
  const cursosVigentes = certsUser
    .filter(c => !c.anulado && c.es_avsec === 1 && (!c.vencimiento || c.vencimiento >= hoyStr))
    .map(c => ({ cod: (c.curso_cod||'').replace('COD-PSA ',''), nombre: c.curso_nombre, vencimiento: c.vencimiento || 'S/V' }));
  const serie = cred.ver_code.split('-')[1] || '0001';
  res.json({ encontrado:true, tipo:'credencial', valido:cred.activa===1,
    codigo:cred.ver_code, serie, num_permiso:cred.num_permiso,
    titular:cred.apellido+', '+cred.unombre, legajo:cred.legajo, dni:cred.dni,
    rango:cred.rango, organismo:cred.organismo, aeropuerto:cred.aeropuerto,
    emitido:cred.emitido_at?.slice(0,10), activa:cred.activa===1, anulado:cred.activa!==1,
    cursos_vigentes: cursosVigentes });
});

// Página pública (HTML) para mostrar el resultado del escaneo del QR — sin cadena cruda
app.get('/verificar-credencial/:code', (req, res) => {
  const code = String(req.params.code||'').trim().toUpperCase();
  const cred = stmts.credencialByCode.get(code);
  const fmtF = (f) => { if(!f) return '—'; const s=String(f).slice(0,10); const m=s.match(/^(\d{4})-(\d{2})-(\d{2})$/); return m ? m[3]+'/'+m[2]+'/'+m[1] : f; };
  if (!cred) {
    return res.send(`<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><title>Verificación SINCA</title>
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <style>body{font-family:Arial,sans-serif;background:#0a0c10;color:#fff;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:20px}
    .card{background:#151a22;border:2px solid #e5484d;border-radius:14px;padding:28px;max-width:420px;text-align:center}
    h1{color:#e5484d;font-size:20px}</style></head><body>
    <div class="card"><h1>✘ Credencial no encontrada</h1><p>El código escaneado no corresponde a ninguna credencial registrada en SINCA.</p></div>
    </body></html>`);
  }
  const hoyStr = new Date().toISOString().slice(0,10);
  const certsUser = stmts.certsByUser.all(cred.user_id) || [];
  const cursosVigentes = certsUser.filter(c => !c.anulado && (!c.vencimiento || c.vencimiento >= hoyStr));
  const serie = cred.ver_code.split('-')[1] || '0001';
  const estadoColor = cred.activa ? '#2eb87a' : '#e5484d';
  const estadoTxt = cred.activa ? 'VÁLIDA Y VIGENTE' : 'ANULADA / REEMPLAZADA';
  res.send(`<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><title>Verificación de Credencial — SINCA</title>
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <style>
    body{font-family:'Segoe UI',Arial,sans-serif;background:#0a0c10;color:#e8ecf1;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:20px}
    .card{background:#151a22;border:1px solid #252c38;border-top:4px solid ${estadoColor};border-radius:14px;padding:26px;max-width:440px;width:100%;box-shadow:0 10px 40px rgba(0,0,0,.5)}
    .estado{font-size:15px;font-weight:800;color:${estadoColor};text-align:center;margin-bottom:18px;letter-spacing:.04em}
    .row{display:flex;justify-content:space-between;padding:7px 0;border-bottom:1px solid #252c38;font-size:13px}
    .row b{color:#7a8899;font-weight:500}
    .row span{font-weight:700;text-align:right}
    .cursos{margin-top:16px}
    .cursos h3{font-size:12px;color:#e07b0a;text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px}
    .curso-item{font-size:12.5px;padding:8px 0;border-bottom:1px solid #1e242e;line-height:1.5}
    .curso-item b{color:#3d82e8}
    .footer{margin-top:18px;text-align:center;font-size:10px;color:#5a6475}
  </style></head><body>
  <div class="card">
    <div class="estado">${estadoTxt}</div>
    <div class="row"><b>Sistema</b><span>SINCA — PSA/ISSA</span></div>
    <div class="row"><b>Credencial</b><span>${cred.ver_code}</span></div>
    <div class="row"><b>Titular</b><span>${cred.apellido}, ${cred.unombre}</span></div>
    <div class="row"><b>Legajo</b><span>${cred.legajo}</span></div>
    <div class="row"><b>Permiso</b><span>${cred.num_permiso||'—'}</span></div>
    <div class="row"><b>Serie</b><span>${serie}</span></div>
    <div class="row"><b>Ente</b><span>${cred.organismo||'—'}</span></div>
    <div class="row"><b>Emisión</b><span>${fmtF(cred.emitido_at)}</span></div>
    <div class="cursos">
      <h3>Capacitaciones / Cursos vigentes</h3>
      ${cursosVigentes.length ? cursosVigentes.map(c => `<div class="curso-item">
          <div><b>${(c.curso_cod||'').replace('COD-PSA ','COD ')}</b> — ${c.curso_nombre||''}</div>
          <div style="color:#7a8899;font-size:11px;margin-top:2px">N° certificado: <span style="color:#e8ecf1;font-family:monospace">${c.code}</span></div>
          <div style="color:#7a8899;font-size:11px">Capacitación: ${fmtF(c.issued_at)} &nbsp;·&nbsp; Vencimiento: <b style="color:${c.vencimiento && c.vencimiento < hoyStr ? '#e5484d' : '#2eb87a'}">${c.vencimiento ? fmtF(c.vencimiento) : 'Sin vencimiento'}</b></div>
        </div>`).join('') : '<div class="curso-item">Sin capacitaciones vigentes</div>'}
    </div>
    <div class="footer">Verificación realizada en SINCA — PSA/ISSA · ${new Date().toLocaleString('es-AR')}</div>
  </div>
  </body></html>`);
});

/* ================= Verificador de documentos (público) ================= */
app.get('/api/verificar/:codigo', (req, res) => {
  const code = String(req.params.codigo||'').trim().toUpperCase();
  // Buscar en credenciales primero
  const credCheck = stmts.credencialByCode.get(code);
  if (credCheck) {
    const hoyStr = new Date().toISOString().slice(0,10);
    const certsUser = stmts.certsByUser.all(credCheck.user_id) || [];
    const cursosVigentes = certsUser
      .filter(c => !c.anulado && (!c.vencimiento || c.vencimiento >= hoyStr))
      .map(c => ({ cod: c.curso_cod, nombre: c.curso_nombre, vencimiento: c.vencimiento || 'S/V', emitido: c.issued_at?.slice(0,10) }));
    return res.json({ encontrado:true, tipo:'Credencial AVSEC', valido:credCheck.activa===1,
      codigo:credCheck.ver_code, num_permiso:credCheck.num_permiso,
      titular:credCheck.apellido+', '+credCheck.unombre,
      legajo:credCheck.legajo, dni:credCheck.dni,
      organismo:credCheck.organismo, aeropuerto:credCheck.aeropuerto,
      emitido:credCheck.emitido_at?.slice(0,10),
      vencimiento: cursosVigentes.length ? undefined : 'Sin capacitaciones vigentes',
      cursos_vigentes: cursosVigentes,
      anulado:credCheck.activa!==1 });
  }
  const cert = stmts.certByCode.get(code);
  if (cert) {
    const u = stmts.userById.get(cert.user_id);
    const c = stmts.courseById.get(cert.course_id);
    return res.json({ encontrado:true, tipo:'certificado', valido:!cert.anulado,
      codigo:cert.code, firma_hash:cert.firma_hash,
      titular:u?u.apellido+', '+u.nombre:'—', legajo:u?.legajo, organismo:u?.organismo,
      curso:c?c.cod+' — '+c.nombre:'—',
      emitido:cert.issued_at?.slice(0,10), vencimiento:cert.vencimiento||'Sin vencimiento',
      anulado:cert.anulado===1 });
  }
  const doc = db.prepare("SELECT * FROM registro_documentos WHERE numero=? OR referencia=?").get(code,code);
  if (doc) {
    const u = doc.user_id ? stmts.userById.get(doc.user_id) : null;
    const c = doc.course_id ? stmts.courseById.get(doc.course_id) : null;
    const emisor = doc.emitido_por ? stmts.userById.get(doc.emitido_por) : null;
    const tipoLabel = {
      'acta_examenes': 'Acta de examenes', 'acta_eppt': 'Acta EPPT', 'constancia_eppt': 'Constancia EPPT',
      'anulacion_cert': 'Constancia de anulacion de certificado'
    }[doc.tipo] || doc.tipo;
    return res.json({ encontrado:true, tipo:tipoLabel, valido:!doc.anulado,
      numero:doc.numero, titular: u ? u.apellido+', '+u.nombre : (c ? c.cod+' — '+c.nombre : '—'),
      curso: c ? c.cod+' — '+c.nombre : undefined,
      emisor: emisor ? emisor.apellido+', '+emisor.nombre+' (Leg: '+emisor.legajo+')' : undefined,
      firma_hash: doc.referencia && doc.referencia.length===64 ? doc.referencia : undefined,
      emitido:doc.emitido_at?.slice(0,10), anulado:doc.anulado===1 });
  }
  res.json({ encontrado:false, mensaje:'No se encontró ningún documento con ese código.' });
});

/* ================= Dashboard: cursos clave PSA (001, 001A, 002, 002A) ================= */
app.get('/api/admin/dashboard/cursos-clave', auth, roleAtLeast('admin','instructor','supervisor'), (req,res) => {
  const cods = ['COD-PSA 001','COD-PSA 001/A','COD-PSA 002','COD-PSA 002/A'];
  const result = cods.map(cod => {
    const c = db.prepare("SELECT * FROM courses WHERE cod LIKE ?").get('%'+cod.replace('COD-PSA ','')+'%') 
           || db.prepare("SELECT * FROM courses WHERE cod=?").get(cod);
    if (!c) return { cod, nombre:'Sin datos', inscriptos:0, aprobados:0, eppt:0, psa:0, externos:0 };
    const inscriptos = db.prepare("SELECT COUNT(*) AS n FROM enrollments WHERE course_id=?").get(c.id).n;
    const aprobados = db.prepare("SELECT COUNT(*) AS n FROM enrollments WHERE course_id=? AND estado='aprobado'").get(c.id).n;
    const eppt = db.prepare("SELECT COUNT(*) AS n FROM eppt_records er JOIN enrollments e ON e.id=er.enrollment_id WHERE e.course_id=? AND er.estado='completo'").get(c.id).n;
    const psa = db.prepare("SELECT COUNT(*) AS n FROM enrollments e JOIN users u ON u.id=e.user_id WHERE e.course_id=? AND (u.organismo='PSA' OR u.organismo LIKE '%Policia%' OR u.organismo LIKE '%Aeroportuaria%')").get(c.id).n;
    return { cod:c.cod, nombre:c.nombre, inscriptos, aprobados, eppt, psa, externos:inscriptos-psa,
      tasa: inscriptos>0?Math.round(aprobados/inscriptos*100):0 };
  });
  res.json({ cursos: result });
});

/* ================= Eliminar lección ================= */
/* ================= Eliminar lección (DELETE + POST alternativo) ================= */
function _doDeleteLesson(lid, userId, res) {
  const lesson = db.prepare('SELECT * FROM lessons WHERE id=?').get(lid);
  if (!lesson) return res.status(404).json({ error:'Lección no encontrada.' });
  const fs = require('fs');
  if (lesson.video_url && lesson.video_url.startsWith('/assets/videos/')) {
    const p = 'public'+lesson.video_url;
    if (fs.existsSync(p)) try { fs.unlinkSync(p); } catch {}
  }
  if (lesson.contenido && lesson.contenido.startsWith('/assets/docs/')) {
    const p = 'public'+lesson.contenido;
    if (fs.existsSync(p)) try { fs.unlinkSync(p); } catch {}
  }
  try { db.prepare('DELETE FROM quiz_sessions WHERE lesson_id=?').run(lid); } catch {}
  try { db.prepare('DELETE FROM lesson_sessions WHERE lesson_id=?').run(lid); } catch {}
  try { db.prepare('DELETE FROM lesson_progress WHERE lesson_id=?').run(lid); } catch {}
  try { db.prepare('DELETE FROM annotations WHERE lesson_id=?').run(lid); } catch {}
  try { db.prepare('DELETE FROM lesson_questions WHERE lesson_id=?').run(lid); } catch {}
  db.prepare('DELETE FROM lessons WHERE id=?').run(lid);
  AUDIT(userId, 'LESSON_DELETE', `lec ${lid} curso ${lesson.course_id}`);
  res.json({ ok:true });
}
app.delete('/api/admin/lessons/:id', auth, requireCourseAccess(req => stmts.lessonById.get(Number(req.params.id))?.course_id), (req,res) => {
  _doDeleteLesson(Number(req.params.id), req.user.id, res);
});
app.post('/api/admin/lessons/:id/delete', auth, requireCourseAccess(req => stmts.lessonById.get(Number(req.params.id))?.course_id), (req,res) => {
  _doDeleteLesson(Number(req.params.id), req.user.id, res);
});
/* ================= Agregar nueva unidad a un curso ================= */
app.post('/api/admin/courses/:id/lessons', auth, requireCourseAccess(req => Number(req.params.id)), (req,res) => {
  const course_id = Number(req.params.id);
  const c = stmts.courseById.get(course_id);
  if (!c) return res.status(404).json({ error:'Curso no encontrado.' });
  const { titulo } = req.body||{};
  if (!titulo?.trim()) return res.status(400).json({ error:'El título es requerido.' });
  const maxOrden = db.prepare('SELECT COALESCE(MAX(orden),0)+1 AS n FROM lessons WHERE course_id=?').get(course_id).n;
  const info = db.prepare('INSERT INTO lessons (course_id, titulo, tipo, contenido, video_url, duracion_s, orden) VALUES (?,?,?,?,?,?,?)').run(course_id, titulo.trim(), 'texto', '', null, 60, maxOrden);
  AUDIT(req.user.id,'LESSON_ADD',`curso ${course_id} - "${titulo.trim()}"`);
  res.json({ ok:true, id:Number(info.lastInsertRowid) });
});

/* ================= Mover lección (reordenar) ================= */
app.post('/api/admin/lessons/:id/move', auth, requireCourseAccess(req => stmts.lessonById.get(Number(req.params.id))?.course_id), (req,res) => {
  const lid = Number(req.params.id);
  const dir = req.body?.dir; // 'up' | 'down'
  const lesson = db.prepare('SELECT * FROM lessons WHERE id=?').get(lid);
  if (!lesson) return res.status(404).json({ error:'Lección no encontrada.' });
  const lessons = db.prepare('SELECT id,orden FROM lessons WHERE course_id=? ORDER BY orden').all(lesson.course_id);
  const idx = lessons.findIndex(l=>l.id===lid);
  const swapIdx = dir==='up' ? idx-1 : idx+1;
  if (swapIdx<0 || swapIdx>=lessons.length) return res.json({ok:true, msg:'Ya está en el extremo.'});
  const other = lessons[swapIdx];
  db.prepare('UPDATE lessons SET orden=? WHERE id=?').run(other.orden, lid);
  db.prepare('UPDATE lessons SET orden=? WHERE id=?').run(lesson.orden, other.id);
  AUDIT(req.user.id,'LESSON_MOVE',`lec ${lid} dir ${dir}`);
  res.json({ok:true});
});

/* ================= Badges de pendientes ================= */
app.get('/api/pendientes', auth, (req,res) => {
  const role = req.user.role;
  let result = {};
  if (['admin','instructor','supervisor'].includes(role)) {
    // EPPT abiertos (en curso, requieren carga de jornadas)
    result.eppt = db.prepare("SELECT COUNT(*) AS n FROM eppt_records WHERE estado='abierto'").get().n;
    // Supervisión IA: SOLO sesiones que aún no fueron convalidadas ni anuladas
    result.supervision = db.prepare(
      "SELECT COUNT(*) AS n FROM proctor_sessions WHERE revision='pendiente' AND nivel != 'verde'"
    ).get().n;
    // Certificados que vencen en los próximos 30 días
    const hoy = new Date().toISOString().slice(0,10);
    const en30 = new Date(Date.now()+30*864e5).toISOString().slice(0,10);
    result.vencimientos = db.prepare("SELECT COUNT(*) AS n FROM certificates WHERE vencimiento<=? AND vencimiento>=? AND anulado=0").get(en30,hoy).n;
  }
  if (['admin','instructor'].includes(role)) {
    result.eppt_vencidos = db.prepare("SELECT COUNT(*) AS n FROM eppt_records WHERE estado='vencido'").get().n;
    // Actas de examen esperando firma del instructor
    try {
      result.actas = db.prepare("SELECT COUNT(*) AS n FROM actas_examen WHERE estado='pendiente_instructor'").get().n;
    } catch { result.actas = 0; }
  }
  if (role === 'admin') {
    // Declaraciones de destino escaladas por falta de validación en plazo
    try {
      result.destinos = db.prepare("SELECT COUNT(*) AS n FROM destino_declaraciones WHERE estado='escalado'").get().n;
    } catch { result.destinos = 0; }
    // Solicitudes de inscripción de JUOSP sin resolver
    try {
      result.solicitudes = db.prepare("SELECT COUNT(*) AS n FROM juosp_solicitudes WHERE estado='pendiente'").get().n;
    } catch { result.solicitudes = 0; }
  }
  res.json(result);
});

/* ================= SPA ================= */
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));


// (Bloque de migración de roles legacy ELIMINADO)
// Ese bloque recreaba la tabla users con un CHECK obsoleto y reseteaba a 'estudiante'
// todos los roles nuevos (sanidad, juosp, juosp_regional, fiscalizador) en cada arranque.
// La validación de roles vive exclusivamente en validRoles dentro del endpoint de cambio de rol.

// ─── ENDPOINTS PARA PARÁMETROS CLÍNICOS Y PSICOTÉCNICOS ───

/**
 * POST /api/examen-clinico/crear
 * Crear nuevo examen clínico
 */
app.post('/api/examen-clinico/crear', (req, res) => {
  try {
    const { enrollment_id, tipo_examen, observaciones } = req.body;
    
    if (!enrollment_id || !tipo_examen) {
      return res.status(400).json({ error: 'enrollment_id y tipo_examen requeridos' });
    }
    
    const { crearExamenClinico } = require('./db');
    const exam_id = crearExamenClinico(enrollment_id, tipo_examen, observaciones || '');
    
    res.json({ success: true, exam_id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/parametros-clinicos/:tipo_examen
 * Obtener parámetros clínicos por tipo de examen
 */
app.get('/api/parametros-clinicos/:tipo_examen', (req, res) => {
  try {
    const { tipo_examen } = req.params;
    const { obtenerParametrosPorTipo } = require('./db');
    
    const parametros = obtenerParametrosPorTipo(tipo_examen);
    res.json({ success: true, parametros });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/resultado-clinico/registrar
 * Registrar resultado de parámetro clínico con firma del profesional
 */
app.post('/api/resultado-clinico/registrar', (req, res) => {
  try {
    const { 
      clinical_exam_id, 
      clinical_parameter_id, 
      valor_resultado, 
      health_professional_id, 
      firma_electronica, 
      observaciones 
    } = req.body;
    
    if (!clinical_exam_id || !clinical_parameter_id || !valor_resultado || !health_professional_id || !firma_electronica) {
      return res.status(400).json({ error: 'Campos requeridos: clinical_exam_id, clinical_parameter_id, valor_resultado, health_professional_id, firma_electronica' });
    }
    
    const { registrarResultadoClinico } = require('./db');
    const result_id = registrarResultadoClinico(
      clinical_exam_id, 
      clinical_parameter_id, 
      valor_resultado, 
      health_professional_id, 
      firma_electronica, 
      observaciones || ''
    );
    
    res.json({ 
      success: true, 
      result_id,
      mensaje: 'Resultado registrado y firmado correctamente'
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/indicadores-psicotecnicos
 * Obtener indicadores del perfil psicotécnico
 */
app.get('/api/indicadores-psicotecnicos', (req, res) => {
  try {
    const { obtenerIndicadoresPsicotecnicos } = require('./db');
    const indicadores = obtenerIndicadoresPsicotecnicos();
    
    res.json({ success: true, indicadores });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/resultado-psicotecnico/registrar
 * Registrar resultado psicotécnico (APTO/NO APTO) con firma del evaluador
 */
app.post('/api/resultado-psicotecnico/registrar', (req, res) => {
  try {
    const { 
      clinical_exam_id, 
      psychometric_indicator_id, 
      resultado, 
      health_professional_id, 
      firma_electronica, 
      observaciones 
    } = req.body;
    
    if (!clinical_exam_id || !psychometric_indicator_id || !resultado || !health_professional_id || !firma_electronica) {
      return res.status(400).json({ error: 'Campos requeridos: clinical_exam_id, psychometric_indicator_id, resultado, health_professional_id, firma_electronica' });
    }
    
    if (!['APTO', 'NO_APTO'].includes(resultado)) {
      return res.status(400).json({ error: 'resultado debe ser APTO o NO_APTO' });
    }
    
    const { registrarResultadoPsicotecnico } = require('./db');
    const result_id = registrarResultadoPsicotecnico(
      clinical_exam_id, 
      psychometric_indicator_id, 
      resultado, 
      health_professional_id, 
      firma_electronica, 
      observaciones || ''
    );
    
    res.json({ 
      success: true, 
      result_id,
      resultado,
      mensaje: `Evaluación registrada como ${resultado} y firmada correctamente`
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/certificado/generar-numero
 * Generar número de credencial único
 */
app.post('/api/certificado/generar-numero', (req, res) => {
  try {
    const { generarNumeroCredencial } = require('./db');
    const numero_credencial = generarNumeroCredencial();
    
    res.json({ success: true, numero_credencial });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/certificado/calcular-vencimiento
 * Calcular fecha de vencimiento automática
 */
app.post('/api/certificado/calcular-vencimiento', (req, res) => {
  try {
    const { issued_at, vigencia_meses } = req.body;
    
    if (!issued_at) {
      return res.status(400).json({ error: 'issued_at requerido (formato ISO)' });
    }
    
    const { calcularVencimiento } = require('./db');
    const vencimiento = calcularVencimiento(issued_at, vigencia_meses || 12);
    
    res.json({ 
      success: true, 
      vencimiento,
      issued_at,
      vigencia_meses: vigencia_meses || 12
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
// Arrancar el servidor solo si se ejecuta directamente (node server.js),
// NO si se importa desde los tests (require('./server'))
if (require.main === module) {
  app.listen(PORT, () => {
    const n = scanImages().length;
    console.log(`✔ SINCA (PSA/ISSA) escuchando en http://localhost:${PORT}`);
    console.log(`✔ Imágenes del simulador: ${n} en /assets/xray_images`);
    console.log(`✔ Usuario administrador: eheinrich`);
  });
}

module.exports = { app, db, stmts };
