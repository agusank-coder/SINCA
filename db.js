/**
 * db.js — Capa de datos de SINCA (node:sqlite integrado, sin dependencias nativas)
 * Tablas: users, courses, lessons, quiz_questions, enrollments, lesson_progress,
 *         attempts, results (simulador), certificates, annotations, audit_log
 */
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const { DatabaseSync } = require('node:sqlite');
const { COURSES, QUIZZES, GENERIC_QUIZ } = require('./seed_pnisac');

const DATA_DIR = process.env.DATA_DIR_OVERRIDE || path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(path.join(DATA_DIR, 'plataforma_pnisac.db'));
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  legajo        TEXT UNIQUE NOT NULL,
  usuario       TEXT UNIQUE,
  dni           TEXT,
  nombre        TEXT NOT NULL,
  apellido      TEXT NOT NULL,
  rango         TEXT NOT NULL DEFAULT '',
  organismo     TEXT NOT NULL DEFAULT 'PSA',
  aeropuerto    TEXT NOT NULL DEFAULT '',
  dependencia   TEXT NOT NULL DEFAULT '',
  funcion       TEXT NOT NULL DEFAULT '',
  role          TEXT NOT NULL DEFAULT 'estudiante',
  password_hash TEXT NOT NULL,
  activo        INTEGER NOT NULL DEFAULT 1,
  autoriza_cursos INTEGER NOT NULL DEFAULT 0,  -- 1 = el administrador autorizó a este instructor a crear/gestionar cursos
  legajo_base   TEXT NOT NULL DEFAULT '',      -- legajo sin sufijo -INST (igual a legajo para alumnos; permite validar autocertificación)
  created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS courses (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  cod             TEXT UNIQUE NOT NULL,
  nombre          TEXT NOT NULL,
  destinatarios   TEXT NOT NULL DEFAULT '',
  horas           INTEGER NOT NULL DEFAULT 0,
  horas_teoricas  INTEGER NOT NULL DEFAULT 0,
  horas_practicas INTEGER NOT NULL DEFAULT 0,
  modalidades     TEXT NOT NULL DEFAULT 'P',
  vigencia_meses  INTEGER NOT NULL DEFAULT 0,
  recurrente_cod  TEXT,
  nota_min        INTEGER NOT NULL DEFAULT 70,
  asistencia_min  INTEGER NOT NULL DEFAULT 100,
  simulador       INTEGER NOT NULL DEFAULT 0,
  observaciones   TEXT NOT NULL DEFAULT '',
  proctor         INTEGER NOT NULL DEFAULT 1,   -- supervisión IA en los exámenes del curso
  orden_aleatorio INTEGER NOT NULL DEFAULT 1,   -- cada alumno recorre las unidades en orden propio
  preguntas_examen INTEGER NOT NULL DEFAULT 10, -- tamaño del examen (subconjunto aleatorio del banco)
  activo          INTEGER NOT NULL DEFAULT 1,
  es_avsec        INTEGER NOT NULL DEFAULT 1     -- 1=curso AVSEC/PNISAC (va en credencial QR), 0=otra capacitación
);

CREATE TABLE IF NOT EXISTS lessons (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  course_id  INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  orden      INTEGER NOT NULL,
  titulo     TEXT NOT NULL,
  tipo       TEXT NOT NULL DEFAULT 'texto' CHECK (tipo IN ('texto','video','pdf','imagen','pptx','archivo')),
  contenido  TEXT NOT NULL DEFAULT '',
  video_url  TEXT,
  duracion_s INTEGER NOT NULL DEFAULT 30      -- video: duración real · texto: lectura mínima
);

-- Banco de preguntas de control (checkpoint) por unidad
CREATE TABLE IF NOT EXISTS lesson_questions (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  lesson_id INTEGER NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  pregunta  TEXT NOT NULL,
  opciones  TEXT NOT NULL,
  correcta  INTEGER NOT NULL,
  activa    INTEGER NOT NULL DEFAULT 1
);

-- Sesión de visualización: registro real de tiempos, validado en servidor
CREATE TABLE IF NOT EXISTS lesson_sessions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  enrollment_id INTEGER NOT NULL REFERENCES enrollments(id) ON DELETE CASCADE,
  lesson_id     INTEGER NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  started_at    TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  started_ms    INTEGER NOT NULL,             -- epoch ms del servidor
  video_done_ms INTEGER,                      -- fin de visualización validado
  question_id   INTEGER,                      -- checkpoint asignado (aleatorio)
  opciones_map  TEXT,                         -- permutación de opciones de la sesión
  completed_at  TEXT,
  resultado     TEXT CHECK (resultado IN (NULL,'aprobado','fallido'))
);

-- Sesión de examen: subconjunto y permutaciones únicos por alumno
CREATE TABLE IF NOT EXISTS quiz_sessions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  enrollment_id INTEGER NOT NULL REFERENCES enrollments(id) ON DELETE CASCADE,
  tipo          TEXT NOT NULL,
  payload       TEXT NOT NULL,                -- [{qid, correcta_permutada, map}]
  created_ms    INTEGER NOT NULL,
  used          INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS quiz_questions (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  pregunta  TEXT NOT NULL,
  opciones  TEXT NOT NULL,          -- JSON [4]
  correcta  INTEGER NOT NULL,       -- índice 0-3 (NUNCA se envía al cliente)
  activa    INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS enrollments (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  course_id   INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  estado      TEXT NOT NULL DEFAULT 'cursando'
              CHECK (estado IN ('cursando','eppt','aprobado','desaprobado')),
  created_at  TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  inscrito_por INTEGER REFERENCES users(id),  -- quien inscribió al alumno (instructor/admin responsable) -> firma en el certificado
  ciclo       INTEGER NOT NULL DEFAULT 1,      -- N° de intento/cursada (se incrementa al rehabilitar)
  activo      INTEGER NOT NULL DEFAULT 1       -- 1 = cursada vigente actual; 0 = ciclo archivado (histórico, se conserva íntegro)
);
-- Solo puede existir UNA cursada ACTIVA por alumno y curso (los ciclos archivados no compiten por esta unicidad)
CREATE UNIQUE INDEX IF NOT EXISTS ux_enrollments_activa ON enrollments(user_id, course_id) WHERE activo = 1;

CREATE TABLE IF NOT EXISTS lesson_progress (
  enrollment_id INTEGER NOT NULL REFERENCES enrollments(id) ON DELETE CASCADE,
  lesson_id     INTEGER NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  completed_at  TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  PRIMARY KEY (enrollment_id, lesson_id)
);

CREATE TABLE IF NOT EXISTS attempts (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  enrollment_id INTEGER NOT NULL REFERENCES enrollments(id) ON DELETE CASCADE,
  tipo          TEXT NOT NULL CHECK (tipo IN ('teorico','recuperatorio','practico')),
  total         INTEGER NOT NULL,
  correct       INTEGER NOT NULL,
  score_pct     REAL NOT NULL,
  aei_ok        INTEGER,            -- práctico rayos X: 1 si detectó todos los AEI
  passed        INTEGER NOT NULL,
  duration_s    INTEGER,
  detail_json   TEXT,
  anulado       INTEGER NOT NULL DEFAULT 0,   -- instancia anulada por revisión de supervisión
  created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  ciclo         INTEGER NOT NULL DEFAULT 1,   -- ciclo de la cursada al que pertenece este intento
  activo        INTEGER NOT NULL DEFAULT 1    -- 0 = pertenece a un ciclo archivado (se conserva para el historial)
);

-- ================== EPPT: Entrenamiento Práctico en el Puesto de Trabajo ==================
CREATE TABLE IF NOT EXISTS eppt_records (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  enrollment_id INTEGER NOT NULL UNIQUE REFERENCES enrollments(id) ON DELETE CASCADE,
  apendice      TEXT NOT NULL,
  requerido     INTEGER NOT NULL,             -- horas o actividades según tipo
  tipo          TEXT NOT NULL CHECK (tipo IN ('horas','actividades')),
  deadline      TEXT NOT NULL,                -- fecha límite (90/120 días corridos)
  estado        TEXT NOT NULL DEFAULT 'abierto' CHECK (estado IN ('abierto','completo','vencido','reprobado')),
  motivo_cierre TEXT NOT NULL DEFAULT '',
  created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  ciclo         INTEGER NOT NULL DEFAULT 1,
  activo        INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS eppt_entries (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  eppt_id        INTEGER NOT NULL REFERENCES eppt_records(id) ON DELETE CASCADE,
  fecha          TEXT NOT NULL,
  hora_inicio    TEXT NOT NULL DEFAULT '',    -- HH:MM real de inicio de la jornada
  hora_fin       TEXT NOT NULL DEFAULT '',    -- HH:MM real de fin de la jornada
  puesto         TEXT NOT NULL DEFAULT '',    -- ubicación física (ej. PIR Terminal A)
  horas          REAL NOT NULL DEFAULT 0,     -- 1 por actividad en tipo 'actividades'
  rubrica        TEXT NOT NULL DEFAULT '[]',  -- [{item, calif}]
  observaciones  TEXT NOT NULL DEFAULT '',
  supervisor_id  INTEGER NOT NULL REFERENCES users(id),
  firma_sup_at   TEXT,
  firma_sup_hash TEXT,
  firma_alu_at   TEXT,
  firma_alu_hash TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- Set de imágenes del examen práctico asignado por el SERVIDOR (anti-selección)
CREATE TABLE IF NOT EXISTS practical_sessions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  enrollment_id INTEGER NOT NULL REFERENCES enrollments(id) ON DELETE CASCADE,
  filenames     TEXT NOT NULL,
  created_ms    INTEGER NOT NULL,
  used          INTEGER NOT NULL DEFAULT 0,
  ciclo         INTEGER NOT NULL DEFAULT 1,
  activo        INTEGER NOT NULL DEFAULT 1
);

-- ================== SUPERVISIÓN IA (proctoring) ==================
CREATE TABLE IF NOT EXISTS proctor_sessions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  enrollment_id INTEGER NOT NULL REFERENCES enrollments(id) ON DELETE CASCADE,
  contexto      TEXT NOT NULL,                -- 'teorico' | 'practico'
  attempt_id    INTEGER REFERENCES attempts(id),
  risk_score    INTEGER NOT NULL DEFAULT 0,
  nivel         TEXT NOT NULL DEFAULT 'verde',-- verde | amarillo | rojo
  revision      TEXT NOT NULL DEFAULT 'pendiente', -- pendiente | convalidado | anulado
  revisor_id    INTEGER,
  revision_nota TEXT NOT NULL DEFAULT '',
  started_at    TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  ended_at      TEXT,
  ciclo         INTEGER NOT NULL DEFAULT 1,
  activo        INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS proctor_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id  INTEGER NOT NULL REFERENCES proctor_sessions(id) ON DELETE CASCADE,
  ts          TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  tipo        TEXT NOT NULL,
  detalle     TEXT NOT NULL DEFAULT '',
  puntos      INTEGER NOT NULL DEFAULT 0,
  foto        TEXT,                           -- captura de cámara en data/proctor/<session>/
  pantalla    TEXT                            -- captura de pantalla en data/proctor/<session>/
);

CREATE TABLE IF NOT EXISTS dni_autorizados (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  dni         TEXT UNIQUE NOT NULL,
  organismo   TEXT NOT NULL DEFAULT '',
  nota        TEXT NOT NULL DEFAULT '',
  usado       INTEGER NOT NULL DEFAULT 0,   -- 1 cuando ya se registró
  created_at  TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  created_by  INTEGER REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS certificates (
  -- firma_hash: firma electrónica del documento (Ley 25.506)
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  course_id        INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  code             TEXT UNIQUE NOT NULL,
  score_pct        REAL NOT NULL,
  vencimiento      TEXT,                 -- NULL = sin vencimiento
  issued_at        TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  anulado          INTEGER NOT NULL DEFAULT 0,
  observaciones    TEXT NOT NULL DEFAULT '',
  firma_hash       TEXT NOT NULL DEFAULT '',   -- firma electrónica del documento (Ley 25.506)
  enrollment_id    INTEGER REFERENCES enrollments(id),  -- ciclo/cursada exacta que originó este certificado
  numero_credencial TEXT,               -- número único de credencial CRED-XXXXX-AAAA-NNNN
  clinical_exam_id  INTEGER             -- FK al examen clínico asociado (si aplica)
);

-- Libro de Aula y Asistencia
CREATE TABLE IF NOT EXISTS asistencia (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  enrollment_id INTEGER NOT NULL REFERENCES enrollments(id) ON DELETE CASCADE,
  fecha         TEXT NOT NULL DEFAULT (date('now','localtime')),
  tipo          TEXT NOT NULL DEFAULT 'virtual',  -- 'presencial' | 'virtual'
  presente      INTEGER NOT NULL DEFAULT 1,
  justificado   INTEGER NOT NULL DEFAULT 0,
  nota_obs      TEXT NOT NULL DEFAULT '',
  registrado_por INTEGER REFERENCES users(id),
  created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- Reloj anual de instructores (20 hs/año mínimo)
CREATE TABLE IF NOT EXISTS instructor_horas (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  instructor_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  anio           INTEGER NOT NULL,
  curso_id       INTEGER REFERENCES courses(id),
  fecha          TEXT NOT NULL,
  horas          REAL NOT NULL DEFAULT 0,
  descripcion    TEXT NOT NULL DEFAULT '',
  firmado_por    INTEGER REFERENCES users(id),
  firma_hash     TEXT NOT NULL DEFAULT '',
  created_at     TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  UNIQUE(instructor_id, anio, fecha, curso_id)
);

-- Calendario anual de cursos (nómina ISSA 1-15 diciembre)
CREATE TABLE IF NOT EXISTS calendario_cursos (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  anio           INTEGER NOT NULL,
  course_id      INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  fecha_inicio   TEXT NOT NULL,
  fecha_fin      TEXT,
  modalidad      TEXT NOT NULL DEFAULT 'P',
  sede           TEXT NOT NULL DEFAULT '',
  cupo           INTEGER NOT NULL DEFAULT 30,
  estado         TEXT NOT NULL DEFAULT 'planificado' CHECK (estado IN ('planificado','confirmado','en_curso','finalizado','cancelado')),
  enviado_issa   INTEGER NOT NULL DEFAULT 0,
  created_by     INTEGER REFERENCES users(id),
  created_at     TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS registro_documentos (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  tipo        TEXT NOT NULL,          -- 'certificado' | 'acta_eppt' | 'acta_desaprobacion' | 'constancia' | 'credencial' | 'acta_examenes'
  numero      TEXT UNIQUE NOT NULL,   -- número correlativo ej. CERT-2026-0001
  user_id     INTEGER REFERENCES users(id),
  course_id   INTEGER REFERENCES courses(id),
  referencia  TEXT NOT NULL DEFAULT '',  -- código del certificado o EPPT id (o hash de firma)
  contenido   TEXT NOT NULL DEFAULT '', -- snapshot JSON del contenido (para reimprimir exactamente igual)
  emitido_at  TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  emitido_por INTEGER REFERENCES users(id),
  anulado     INTEGER NOT NULL DEFAULT 0
);

-- Jerarquías / rangos configurables por el administrador
CREATE TABLE IF NOT EXISTS jerarquias (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre  TEXT UNIQUE NOT NULL,
  orden   INTEGER NOT NULL DEFAULT 0,
  activo  INTEGER NOT NULL DEFAULT 1
);

-- Configuración general del sistema (clave/valor) — ej. segundos por imagen en el práctico de Rayos X
CREATE TABLE IF NOT EXISTS system_settings (
  clave      TEXT PRIMARY KEY,
  valor      TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_by INTEGER REFERENCES users(id)
);

-- Asignación de cursos a instructores (el administrador decide qué cursos gestiona cada instructor)
CREATE TABLE IF NOT EXISTS course_instructors (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  course_id     INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  instructor_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  assigned_at   TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  assigned_by   INTEGER REFERENCES users(id),
  UNIQUE(course_id, instructor_id)
);

-- Registro de credenciales AVSEC emitidas
CREATE TABLE IF NOT EXISTS credenciales (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER NOT NULL REFERENCES users(id),
  ver_code      TEXT UNIQUE NOT NULL,        -- ej. CRED-506065-A3BC4D
  num_permiso   TEXT NOT NULL DEFAULT '',    -- número de permiso aeroportuario
  emitido_at    TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  emitido_por   INTEGER REFERENCES users(id),
  activa        INTEGER NOT NULL DEFAULT 1,  -- 1=activa, 0=reemplazada/anulada
  anulada_at    TEXT,
  observaciones TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS annotations (
  filename    TEXT PRIMARY KEY,
  is_clean    INTEGER NOT NULL DEFAULT 1,
  threats     TEXT NOT NULL DEFAULT '[]',
  updated_at  TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS audit_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER,
  accion     TEXT NOT NULL,
  detalle    TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- Registro de intentos fallidos de login (rate-limiting y detección de fuerza bruta)
CREATE TABLE IF NOT EXISTS login_attempts (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  clave         TEXT NOT NULL,
  usuario       TEXT NOT NULL,
  ip            TEXT NOT NULL,
  created_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_login_attempts_clave_at ON login_attempts(clave, created_at);

-- ══════════════════════════════════════════════════════════════════════
-- MÓDULO 1: APTITUD PSICOFÍSICA
-- ══════════════════════════════════════════════════════════════════════

-- Unidades Operativas de Seguridad Portuaria (UOSP) — estructura jerárquica
CREATE TABLE IF NOT EXISTS uosps (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre      TEXT NOT NULL UNIQUE,       -- ej: "UOSP-EZE-01"
  descripcion TEXT NOT NULL DEFAULT '',
  sede        TEXT NOT NULL DEFAULT '',   -- aeropuerto/sede física
  region      TEXT NOT NULL DEFAULT '',   -- para agrupación regional
  activa      INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- Examen psicofísico por agente (cabecera)
CREATE TABLE IF NOT EXISTS apto_medico (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id         INTEGER NOT NULL REFERENCES users(id),
  numero          TEXT UNIQUE,            -- APSF-XXXXX-AAAA-NNNN
  organismo_tipo  TEXT NOT NULL DEFAULT 'psa', -- 'psa' | 'vigilador'
  vigencia_meses  INTEGER NOT NULL DEFAULT 36, -- 36 para PSA, 12 para vigiladores
  emitido_at      TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  vence_at        TEXT,                   -- calculado al emitir
  estado          TEXT NOT NULL DEFAULT 'borrador' CHECK (estado IN ('borrador','apto','no_apto','vencido')),
  medico_id       INTEGER REFERENCES users(id),   -- quien firma (rol medico)
  admin_medico_id INTEGER REFERENCES users(id),   -- quien cargó los datos
  firma_hash      TEXT NOT NULL DEFAULT '',
  observaciones   TEXT NOT NULL DEFAULT '',
  created_at      TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- Ítems individuales del examen psicofísico
CREATE TABLE IF NOT EXISTS apto_medico_items (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  apto_id       INTEGER NOT NULL REFERENCES apto_medico(id) ON DELETE CASCADE,
  categoria     TEXT NOT NULL,   -- 'psicologico' | 'laboratorio' | 'imagen' | 'cardiologia' | 'oftalmologico' | 'auditivo'
  item          TEXT NOT NULL,   -- nombre del ítem (ej: 'VDRL', 'Ergometría', 'Agudeza visual')
  resultado     TEXT NOT NULL DEFAULT '',   -- texto libre del resultado
  estado        TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente','apto','no_apto')),
  archivo_path  TEXT,            -- ruta al PDF/imagen subido (opcional)
  observaciones TEXT NOT NULL DEFAULT '',
  updated_at    TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- ══════════════════════════════════════════════════════════════════════
-- MÓDULO 2: JUOSP
-- ══════════════════════════════════════════════════════════════════════

-- Solicitudes de inscripción enviadas por el JUOSP al ISSA
CREATE TABLE IF NOT EXISTS juosp_solicitudes (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  juosp_id     INTEGER NOT NULL REFERENCES users(id),
  uosp_id      INTEGER NOT NULL REFERENCES uosps(id),
  course_id    INTEGER NOT NULL REFERENCES courses(id),
  user_ids     TEXT NOT NULL DEFAULT '[]',  -- JSON array de user_id solicitados
  estado       TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente','aprobada','rechazada')),
  nota_juosp   TEXT NOT NULL DEFAULT '',
  nota_issa    TEXT NOT NULL DEFAULT '',
  resuelto_por INTEGER REFERENCES users(id),
  resuelto_at  TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- Convalidaciones masivas de EPPT por el JUOSP
CREATE TABLE IF NOT EXISTS juosp_convalidaciones (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  juosp_id      INTEGER NOT NULL REFERENCES users(id),
  uosp_id       INTEGER NOT NULL REFERENCES uosps(id),
  eppt_ids      TEXT NOT NULL DEFAULT '[]',  -- JSON array de eppt_records.id convalidados
  firma_hash    TEXT NOT NULL DEFAULT '',
  observaciones TEXT NOT NULL DEFAULT '',
  created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- ══════════════════════════════════════════════════════════════════════
-- MÓDULO 3: ACTA DE EXAMEN CON DOBLE FIRMA
-- ══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS actas_examen (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  numero          TEXT UNIQUE,              -- ACEX-XXXXX-AAAA-NNNN
  attempt_id      INTEGER NOT NULL REFERENCES attempts(id),
  enrollment_id   INTEGER NOT NULL REFERENCES enrollments(id),
  -- Firma del alumno (al momento de entregar)
  firma_alu_at    TEXT,
  firma_alu_hash  TEXT NOT NULL DEFAULT '',
  -- Firma del instructor titular
  firma_inst_at   TEXT,
  firma_inst_id   INTEGER REFERENCES users(id),
  firma_inst_hash TEXT NOT NULL DEFAULT '',
  -- Contenido
  detalle_json    TEXT NOT NULL DEFAULT '{}',  -- preguntas, respuestas, tiempos
  estado          TEXT NOT NULL DEFAULT 'pendiente_instructor'
                  CHECK (estado IN ('pendiente_alumno','pendiente_instructor','firmada','observada')),
  observaciones   TEXT NOT NULL DEFAULT '',
  created_at      TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- ══════════════════════════════════════════════════════════════════════
-- MÓDULO 4: RECONFIRMACIÓN DE DESTINO
-- ══════════════════════════════════════════════════════════════════════

-- Catálogo cerrado de unidades/dependencias (cargado por el admin)
CREATE TABLE IF NOT EXISTS destinos_catalogo (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  codigo    TEXT NOT NULL UNIQUE,    -- ej: "EZE-OPS-01"
  nombre    TEXT NOT NULL,           -- ej: "Operaciones Pista — Ezeiza"
  region    TEXT NOT NULL DEFAULT '',
  aeropuerto TEXT NOT NULL DEFAULT '',
  activo    INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- Historial completo de declaraciones de destino por usuario
CREATE TABLE IF NOT EXISTS destino_declaraciones (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id         INTEGER NOT NULL REFERENCES users(id),
  destino_id      INTEGER NOT NULL REFERENCES destinos_catalogo(id),
  destino_ant_id  INTEGER REFERENCES destinos_catalogo(id),  -- anterior (null si es la primera)
  jefe_id         INTEGER REFERENCES users(id),              -- jefe declarado
  estado          TEXT NOT NULL DEFAULT 'pendiente_validacion'
                  CHECK (estado IN ('pendiente_validacion','validado','rechazado','escalado')),
  rechazado_nota  TEXT NOT NULL DEFAULT '',
  validado_por    INTEGER REFERENCES users(id),
  validado_at     TEXT,
  escalado_at     TEXT,
  vence_at        TEXT NOT NULL,    -- fecha límite de la próxima reconfirmación
  created_at      TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_dest_decl_user ON destino_declaraciones(user_id, created_at DESC);

-- Bandeja de notificaciones in-app (solo se muestra al login, sin canales externos)
CREATE TABLE IF NOT EXISTS destino_notificaciones (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  para_user   INTEGER NOT NULL REFERENCES users(id),   -- quién debe ver esto
  de_user     INTEGER NOT NULL REFERENCES users(id),   -- de quién es la declaración
  decl_id     INTEGER NOT NULL REFERENCES destino_declaraciones(id),
  tipo        TEXT NOT NULL CHECK (tipo IN ('validar','escalado','rechazado','vencimiento')),
  leida       INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_dest_notif_para ON destino_notificaciones(para_user, leida);

-- ══════════════════════════════════════════════════════════════════════
-- MÓDULO SANIDAD: Certificados Médicos (Aptitud Psicofísica Operativa)
-- ══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS certificados_medicos (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  agente_id            INTEGER NOT NULL REFERENCES users(id),
  tipo_examen          TEXT NOT NULL DEFAULT 'ingreso'
                       CHECK (tipo_examen IN ('ingreso','periodico','reincorporacion','especial')),
  fecha_vencimiento    TEXT NOT NULL,
  dictamen_global      TEXT NOT NULL CHECK (dictamen_global IN ('APTO','NO_APTO','APTO_CON_RESTRICCIONES')),
  codigo_certificado   TEXT UNIQUE NOT NULL,   -- MED-XXXXX-AAAA-NNNN
  hash_sha256          TEXT NOT NULL DEFAULT '',
  hash_truncado        TEXT NOT NULL DEFAULT '',
  profesional_emisor_id INTEGER REFERENCES users(id),
  uosp_id              INTEGER REFERENCES uosps(id),
  region_id            INTEGER,
  observaciones        TEXT NOT NULL DEFAULT '',
  es_activo            INTEGER NOT NULL DEFAULT 1,
  created_at           TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_cert_med_agente ON certificados_medicos(agente_id, es_activo);

-- Exámenes clínicos individuales vinculados a un enrollment
CREATE TABLE IF NOT EXISTS clinical_exams (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  enrollment_id INTEGER NOT NULL REFERENCES enrollments(id) ON DELETE CASCADE,
  user_id       INTEGER NOT NULL REFERENCES users(id),
  tipo          TEXT NOT NULL DEFAULT 'pre_curso',
  resultado     TEXT NOT NULL DEFAULT 'pendiente'
                CHECK (resultado IN ('pendiente','apto','no_apto')),
  observaciones TEXT NOT NULL DEFAULT '',
  fecha         TEXT NOT NULL DEFAULT (date('now','localtime')),
  firmado_por   INTEGER REFERENCES users(id),
  firma_hash    TEXT NOT NULL DEFAULT '',
  created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
`);

/* ---------------- Semillas ---------------- */
// Migraciones de columnas
try {
  const coursesCols = db.prepare("PRAGMA table_info(courses)").all().map(c=>c.name);
  if (!coursesCols.includes('instructor_id')) {
    db.prepare("ALTER TABLE courses ADD COLUMN instructor_id INTEGER REFERENCES users(id)").run();
    console.log('✔ courses.instructor_id migrado');
  }
  if (!coursesCols.includes('es_avsec')) {
    db.prepare("ALTER TABLE courses ADD COLUMN es_avsec INTEGER NOT NULL DEFAULT 1").run();
    console.log('✔ courses.es_avsec migrado');
  }
} catch(e) { console.warn('Mig courses.instructor_id/es_avsec:', e.message); }

// Migración: modelo de CICLOS en enrollments (archivar en vez de borrar al rehabilitar)
// Requiere recrear la tabla enrollments porque SQLite no permite quitar un UNIQUE inline con ALTER TABLE.
try {
  const enrCols = db.prepare("PRAGMA table_info(enrollments)").all().map(c => c.name);
  if (!enrCols.includes('ciclo') || !enrCols.includes('activo')) {
    console.log('Migrando enrollments al modelo de ciclos (archivar, no borrar)...');
    db.prepare("BEGIN").run();
    try {
      const rows = db.prepare("SELECT * FROM enrollments").all();
      db.prepare("ALTER TABLE enrollments RENAME TO _enrollments_mig").run();
      db.prepare(`CREATE TABLE enrollments (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        course_id   INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
        estado      TEXT NOT NULL DEFAULT 'cursando' CHECK (estado IN ('cursando','eppt','aprobado','desaprobado')),
        created_at  TEXT NOT NULL DEFAULT (datetime('now','localtime')),
        inscrito_por INTEGER REFERENCES users(id),
        ciclo       INTEGER NOT NULL DEFAULT 1,
        activo      INTEGER NOT NULL DEFAULT 1
      )`).run();
      for (const r of rows) {
        db.prepare(`INSERT INTO enrollments (id,user_id,course_id,estado,created_at,inscrito_por,ciclo,activo) VALUES (?,?,?,?,?,?,1,1)`)
          .run(r.id, r.user_id, r.course_id, r.estado, r.created_at, r.inscrito_por ?? null);
      }
      db.prepare("DROP TABLE _enrollments_mig").run();
      db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS ux_enrollments_activa ON enrollments(user_id, course_id) WHERE activo = 1").run();
      db.prepare("COMMIT").run();
      console.log(`✔ enrollments migrado al modelo de ciclos — ${rows.length} inscripciones preservadas (ciclo=1, activo=1)`);
    } catch(e2) {
      try { db.prepare("ROLLBACK").run(); } catch {}
      console.warn('Migración de ciclos en enrollments falló:', e2.message);
    }
  } else {
    // Asegurar que el índice parcial exista aunque la tabla ya tuviera las columnas
    try { db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS ux_enrollments_activa ON enrollments(user_id, course_id) WHERE activo = 1").run(); } catch {}
  }
} catch(e) { console.warn('Mig enrollments ciclos (chequeo inicial):', e.message); }

// Migración: agregar ciclo/activo a las tablas relacionadas (intentos, EPPT, práctico, supervisión)
try {
  const migraciones = [
    { tabla: 'attempts', cols: ['ciclo INTEGER NOT NULL DEFAULT 1', 'activo INTEGER NOT NULL DEFAULT 1'] },
    { tabla: 'eppt_records', cols: ['ciclo INTEGER NOT NULL DEFAULT 1', 'activo INTEGER NOT NULL DEFAULT 1'] },
    { tabla: 'practical_sessions', cols: ['ciclo INTEGER NOT NULL DEFAULT 1', 'activo INTEGER NOT NULL DEFAULT 1'] },
    { tabla: 'proctor_sessions', cols: ['ciclo INTEGER NOT NULL DEFAULT 1', 'activo INTEGER NOT NULL DEFAULT 1'] },
  ];
  for (const m of migraciones) {
    const cols = db.prepare(`PRAGMA table_info(${m.tabla})`).all().map(c => c.name);
    for (const colDef of m.cols) {
      const colName = colDef.split(' ')[0];
      if (!cols.includes(colName)) {
        db.prepare(`ALTER TABLE ${m.tabla} ADD COLUMN ${colDef}`).run();
        console.log(`✔ ${m.tabla}.${colName} migrado`);
      }
    }
  }
} catch(e) { console.warn('Mig ciclo/activo tablas relacionadas:', e.message); }

// Migración: estado_sanidad en users
try {
  const uc = db.prepare("PRAGMA table_info(users)").all().map(c => c.name);
  if (!uc.includes('estado_sanidad')) {
    db.prepare("ALTER TABLE users ADD COLUMN estado_sanidad TEXT NOT NULL DEFAULT 'PENDIENTE_EVALUACION'").run();
    console.log('✔ users.estado_sanidad migrado');
  }
} catch(e) { console.warn('Mig users.estado_sanidad:', e.message); }

// Migración: tabla certificados_medicos (por si la BD es anterior al CREATE TABLE IF NOT EXISTS)
try {
  db.prepare(`CREATE TABLE IF NOT EXISTS certificados_medicos (
    id                    INTEGER PRIMARY KEY AUTOINCREMENT,
    agente_id             INTEGER NOT NULL REFERENCES users(id),
    tipo_examen           TEXT NOT NULL DEFAULT 'ingreso',
    fecha_vencimiento     TEXT NOT NULL,
    dictamen_global       TEXT NOT NULL,
    codigo_certificado    TEXT UNIQUE NOT NULL,
    hash_sha256           TEXT NOT NULL DEFAULT '',
    hash_truncado         TEXT NOT NULL DEFAULT '',
    profesional_emisor_id INTEGER REFERENCES users(id),
    uosp_id               INTEGER REFERENCES uosps(id),
    region_id             INTEGER,
    observaciones         TEXT NOT NULL DEFAULT '',
    es_activo             INTEGER NOT NULL DEFAULT 1,
    created_at            TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  )`).run();
  db.prepare("CREATE INDEX IF NOT EXISTS idx_cert_med_agente ON certificados_medicos(agente_id, es_activo)").run();
} catch(e) { console.warn('Mig certificados_medicos:', e.message); }

// Migración: tabla clinical_exams
try {
  db.prepare(`CREATE TABLE IF NOT EXISTS clinical_exams (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    enrollment_id INTEGER NOT NULL REFERENCES enrollments(id) ON DELETE CASCADE,
    user_id       INTEGER NOT NULL REFERENCES users(id),
    tipo          TEXT NOT NULL DEFAULT 'pre_curso',
    resultado     TEXT NOT NULL DEFAULT 'pendiente',
    observaciones TEXT NOT NULL DEFAULT '',
    fecha         TEXT NOT NULL DEFAULT (date('now','localtime')),
    firmado_por   INTEGER REFERENCES users(id),
    firma_hash    TEXT NOT NULL DEFAULT '',
    created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  )`).run();
} catch(e) { console.warn('Mig clinical_exams:', e.message); }

// Migración: agregar enrollment_id a certificates (para resolver sin ambigüedad la firma del instructor)
try {
  const certCols = db.prepare("PRAGMA table_info(certificates)").all().map(c => c.name);
  if (!certCols.includes('enrollment_id')) {
    db.prepare("ALTER TABLE certificates ADD COLUMN enrollment_id INTEGER REFERENCES enrollments(id)").run();
    // Backfill best-effort: como antes de esta migración solo podía existir 1 enrollment por user+course, es unívoco
    db.prepare(`UPDATE certificates SET enrollment_id = (
      SELECT e.id FROM enrollments e WHERE e.user_id = certificates.user_id AND e.course_id = certificates.course_id LIMIT 1
    ) WHERE enrollment_id IS NULL`).run();
    console.log('✔ certificates.enrollment_id migrado y completado retroactivamente');
  }
  // Migración: numero_credencial en certificates
  if (!certCols.includes('numero_credencial')) {
    db.prepare("ALTER TABLE certificates ADD COLUMN numero_credencial TEXT").run();
    console.log('✔ certificates.numero_credencial migrado');
  }
  // Migración: clinical_exam_id en certificates
  if (!certCols.includes('clinical_exam_id')) {
    db.prepare("ALTER TABLE certificates ADD COLUMN clinical_exam_id INTEGER").run();
    console.log('✔ certificates.clinical_exam_id migrado');
  }
} catch(e) { console.warn('Mig certificates:', e.message); }

// Migración: crear tabla login_attempts si no existe (rate-limiting)
try {
  db.prepare(`CREATE TABLE IF NOT EXISTS login_attempts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    clave TEXT NOT NULL, usuario TEXT NOT NULL, ip TEXT NOT NULL,
    created_at INTEGER NOT NULL)`).run();
  db.prepare(`CREATE INDEX IF NOT EXISTS idx_login_attempts_clave_at ON login_attempts(clave, created_at)`).run();
} catch(e) { console.warn('Mig login_attempts:', e.message); }

// Migración: agregar columna 'inscrito_por' a enrollments si no existe
try {
  const enrCols = db.prepare("PRAGMA table_info(enrollments)").all().map(c=>c.name);
  if (!enrCols.includes('inscrito_por')) {
    db.prepare("ALTER TABLE enrollments ADD COLUMN inscrito_por INTEGER REFERENCES users(id)").run();
    console.log('✔ enrollments.inscrito_por migrado');
  }
} catch(e) { console.warn('Mig inscrito_por:', e.message); }

// Migración: agregar columna 'autoriza_cursos' a users si no existe
try {
  const usersCols = db.prepare("PRAGMA table_info(users)").all().map(c=>c.name);
  if (!usersCols.includes('autoriza_cursos')) {
    db.prepare("ALTER TABLE users ADD COLUMN autoriza_cursos INTEGER NOT NULL DEFAULT 0").run();
    console.log('✔ users.autoriza_cursos migrado');
  }
} catch(e) { console.warn('Mig autoriza_cursos:', e.message); }

// Migración: legajo_base para el modelo de perfiles duales (alumno + instructor)
// legajo_base = legajo sin sufijo -INST; permite la validación de autocertificación
try {
  const ucols2 = db.prepare("PRAGMA table_info(users)").all().map(c => c.name);
  if (!ucols2.includes('legajo_base')) {
    db.prepare("ALTER TABLE users ADD COLUMN legajo_base TEXT NOT NULL DEFAULT ''").run();
    // Para usuarios existentes: legajo_base = legajo sin el sufijo -INST si lo tuviera
    db.prepare("UPDATE users SET legajo_base = REPLACE(legajo, '-INST', '')").run();
    console.log('✔ users.legajo_base migrado y rellenado');
  }
  // Garantizar que no existan dos perfiles del mismo tipo para la misma persona
  db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS ux_users_base_role ON users(legajo_base, role) WHERE activo=1 AND legajo_base!=''").run();
} catch(e) { console.warn('Mig users.legajo_base:', e.message); }

// Migración: eliminar CHECK de role en BDs existentes (definitivo — nunca más "Rol inválido")
try {
  const row = db.prepare("SELECT sql FROM sqlite_master WHERE name='users' AND type='table'").get();
  if (row && row.sql && row.sql.includes('CHECK (role IN')) {
    // La BD tiene el CHECK viejo — eliminarlo con writable_schema + vaciar el CHECK
    db.prepare('PRAGMA writable_schema=ON').run();
    const sqlSinCheck = row.sql.replace(/\s*CHECK \(role IN \([^)]+\)\)/, '');
    db.prepare("UPDATE sqlite_master SET sql=? WHERE name='users' AND type='table'").run(sqlSinCheck);
    db.prepare('PRAGMA writable_schema=OFF').run();
    db.prepare('PRAGMA integrity_check').get();
    console.log('✔ CHECK de role eliminado de la BD — Rol inválido no volverá a ocurrir');
  }
} catch(e) { console.warn('Mig eliminar CHECK role:', e.message); }

// Migración: unificar roles médicos — 'medico' y 'medico_admin' → 'sanidad'
try {
  const n1 = db.prepare("SELECT COUNT(*) AS n FROM users WHERE role='medico'").get()?.n || 0;
  const n2 = db.prepare("SELECT COUNT(*) AS n FROM users WHERE role='medico_admin'").get()?.n || 0;
  if (n1 + n2 > 0) {
    db.prepare('PRAGMA ignore_check_constraints=ON').run();
    if (n1 > 0) db.prepare("UPDATE users SET role='sanidad' WHERE role='medico'").run();
    if (n2 > 0) db.prepare("UPDATE users SET role='sanidad' WHERE role='medico_admin'").run();
    db.prepare('PRAGMA ignore_check_constraints=OFF').run();
    console.log('✔ Roles médicos unificados → sanidad: ' + (n1+n2) + ' usuario(s)');
  }
} catch(e) { console.warn('Mig roles médicos:', e.message); }

// Migración: renombrar rol medico_admin → sanidad (compatibilidad hacia atrás)
try {
  const hayMedicoAdmin = db.prepare("SELECT COUNT(*) AS n FROM users WHERE role='medico_admin'").get()?.n;
  if (hayMedicoAdmin > 0) {
    // Usar ignore_check_constraints para actualizar BDs con CHECK viejo
    db.prepare('PRAGMA ignore_check_constraints=ON').run();
    db.prepare("UPDATE users SET role='sanidad' WHERE role='medico_admin'").run();
    db.prepare('PRAGMA ignore_check_constraints=OFF').run();
    console.log('✔ Rol medico_admin → sanidad migrado en '+hayMedicoAdmin+' usuarios');
  }
} catch(e) { console.warn('Mig medico_admin→sanidad:', e.message); }

// Migración: uosp_id en users (para JUOSP)
try {
  const uc = db.prepare("PRAGMA table_info(users)").all().map(c=>c.name);
  if (!uc.includes('uosp_id')) {
    db.prepare("ALTER TABLE users ADD COLUMN uosp_id INTEGER REFERENCES uosps(id)").run();
    console.log('✔ users.uosp_id migrado');
  }
} catch(e) { console.warn('Mig users.uosp_id:', e.message); }

// Migración: requiere_apto_medico en courses
try {
  const cc = db.prepare("PRAGMA table_info(courses)").all().map(c=>c.name);
  if (!cc.includes('requiere_apto_medico')) {
    db.prepare("ALTER TABLE courses ADD COLUMN requiere_apto_medico INTEGER NOT NULL DEFAULT 0").run();
    // COD-PSA 001 y 002 requieren apto médico por normativa
    db.prepare("UPDATE courses SET requiere_apto_medico=1 WHERE cod IN ('COD-PSA 001','COD-PSA 001/A','COD-PSA 002')").run();
    console.log('✔ courses.requiere_apto_medico migrado');
  }
} catch(e) { console.warn('Mig courses.requiere_apto_medico:', e.message); }

// Migración: acta_examen_id en attempts (FK al acta generada)
try {
  const ac = db.prepare("PRAGMA table_info(attempts)").all().map(c=>c.name);
  if (!ac.includes('acta_id')) {
    db.prepare("ALTER TABLE attempts ADD COLUMN acta_id INTEGER REFERENCES actas_examen(id)").run();
    console.log('✔ attempts.acta_id migrado');
  }
} catch(e) { console.warn('Mig attempts.acta_id:', e.message); }

// Migración: agregar 'fiscalizador' al CHECK de role si aún no está
try {
  db.prepare("UPDATE sqlite_master SET sql=REPLACE(sql,\"'admin')\",\"'admin','fiscalizador')\") WHERE type='table' AND name='users' AND sql NOT LIKE '%fiscalizador%'").run();
} catch { /* ignorar si no es necesario o no tiene permisos */ }

// Migración: agregar columna 'contenido' a registro_documentos si no existe
try {
  const rdCols = db.prepare("PRAGMA table_info(registro_documentos)").all().map(c=>c.name);
  if (!rdCols.includes('contenido')) {
    db.prepare("ALTER TABLE registro_documentos ADD COLUMN contenido TEXT NOT NULL DEFAULT ''").run();
    console.log('✔ registro_documentos.contenido migrado');
  }
} catch(e) { console.warn('Mig contenido:', e.message); }

// Migración tabla credenciales
try {
  db.prepare(`CREATE TABLE IF NOT EXISTS credenciales (
    id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES users(id),
    ver_code TEXT UNIQUE NOT NULL, num_permiso TEXT NOT NULL DEFAULT '',
    emitido_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    emitido_por INTEGER REFERENCES users(id), activa INTEGER NOT NULL DEFAULT 1,
    anulada_at TEXT, observaciones TEXT NOT NULL DEFAULT '')`).run();
} catch(e) { console.warn('Mig credenciales:', e.message); }

function seed() {
  // Usuario administrador solicitado
  const admin = db.prepare(`SELECT id FROM users WHERE usuario = ?`).get('eheinrich');
  if (!admin) {
    db.prepare(`INSERT INTO users (legajo, usuario, dni, nombre, apellido, rango, role, password_hash)
                VALUES (?,?,?,?,?,?,?,?)`)
      .run('506065', 'eheinrich', '', 'Emilio Agustín', 'HEINRICH', 'Oficial Mayor', 'admin',
           bcrypt.hashSync('506065', 10));
    console.log('✔ Usuario administrador creado: eheinrich');
  }

  // Usuarios de prueba para comprobación de roles
  const testUsers = [
    { legajo:'INST001', usuario:'instructor', nombre:'Carlos', apellido:'GOMEZ', rango:'Inspector', role:'instructor', pass:'123456' },
    { legajo:'SUP001', usuario:'supervisor', nombre:'Laura', apellido:'MARTINEZ', rango:'Oficial Mayor', role:'supervisor', pass:'123456' },
    { legajo:'EST001', usuario:'estudiante', nombre:'Juan', apellido:'PEREZ', rango:'Oficial Ayudante', role:'estudiante', pass:'123456' },
  ];
  // Seed de jerarquías por defecto (solo si la tabla está vacía)
  if (db.prepare('SELECT COUNT(*) AS n FROM jerarquias').get().n === 0) {
    const defaults = ['Oficial Ayudante','Oficial Principal','Oficial Mayor','Oficial Jefe','Subinspector',
      'Inspector','Comisionado Inspector','Comisionado Mayor','Comisionado General','Personal Civil',
      'Personal de Seguridad Privada','Personal Aeroportuario','Personal Externo'];
    defaults.forEach((n,i) => { try { db.prepare('INSERT INTO jerarquias (nombre,orden) VALUES (?,?)').run(n,i); } catch {} });
    console.log('✔ Jerarquías por defecto cargadas');
  }

  const bcrypt2 = require('bcryptjs');
  for (const u of testUsers) {
    if (!db.prepare('SELECT id FROM users WHERE usuario=?').get(u.usuario)) {
      try {
        db.prepare('INSERT INTO users (legajo,usuario,dni,nombre,apellido,rango,organismo,role,password_hash,activo) VALUES (?,?,?,?,?,?,?,?,?,1)')
          .run(u.legajo, u.usuario, '', u.nombre, u.apellido, u.rango, 'PSA', u.role, bcrypt2.hashSync(u.pass,10));
        console.log('✔ Usuario de prueba: ' + u.usuario + ' (' + u.role + ')');
      } catch(e) { /* ya existe */ }
    }
  }

  // Catálogo PNISAC
  const nCourses = db.prepare(`SELECT COUNT(*) AS n FROM courses`).get().n;
  if (nCourses === 0) {
    const insC = db.prepare(`INSERT INTO courses
      (cod,nombre,destinatarios,horas,horas_teoricas,horas_practicas,modalidades,
       vigencia_meses,recurrente_cod,nota_min,asistencia_min,simulador,observaciones)
      VALUES (@cod,@nombre,@destinatarios,@horas,@horas_teoricas,@horas_practicas,@modalidades,
       @vigencia_meses,@recurrente_cod,@nota_min,@asistencia_min,@simulador,@observaciones)`);
    const insL = db.prepare(`INSERT INTO lessons (course_id,orden,titulo,contenido) VALUES (?,?,?,?)`);
    const insQ = db.prepare(`INSERT INTO quiz_questions (course_id,pregunta,opciones,correcta) VALUES (?,?,?,?)`);

    for (const c of COURSES) {
      const info = insC.run({
        cod: c.cod, nombre: c.nombre, destinatarios: c.destinatarios,
        horas: c.horas, horas_teoricas: c.horas_teoricas, horas_practicas: c.horas_practicas,
        modalidades: c.modalidades, vigencia_meses: c.vigencia_meses,
        recurrente_cod: c.recurrente_cod || null, nota_min: c.nota_min,
        asistencia_min: c.asistencia_min, simulador: c.simulador ? 1 : 0,
        observaciones: c.observaciones || ''
      });
      const cid = Number(info.lastInsertRowid);
      c.unidades.forEach((u, i) => {
        insL.run(cid, i + 1, `Unidad ${i + 1}: ${u}`,
          `<h3>${u}</h3>
           <p>Contenido mínimo establecido por el PNISAC para el ${c.cod}. El docente puede
           editar y ampliar este material desde el panel de gestión, incorporando la normativa,
           casos prácticos y material audiovisual correspondiente a la unidad.</p>
           <p><em>Al finalizar la lectura, marque la unidad como completada para registrar la
           actividad en el aula virtual, conforme lo exige la modalidad a distancia del PNISAC.</em></p>`);
      });
      const bank = QUIZZES[c.cod] || GENERIC_QUIZ(c);
      for (const qq of bank) insQ.run(cid, qq.q, JSON.stringify(qq.opts), qq.ok);

      // Checkpoints por unidad: el alumno debe identificar el eje de lo que acaba de ver/leer.
      // El administrador puede reemplazarlos por preguntas específicas de cada micro-video.
      const insLQ = db.prepare(`INSERT INTO lesson_questions (lesson_id,pregunta,opciones,correcta) VALUES (?,?,?,?)`);
      const lessonRows = db.prepare(`SELECT id,orden,titulo FROM lessons WHERE course_id = ? ORDER BY orden`).all(cid);
      for (const lr of lessonRows) {
        const otros = c.unidades.filter((_,i) => i !== lr.orden - 1);
        const distractores = otros.sort(() => Math.random() - .5).slice(0,3);
        while (distractores.length < 3) distractores.push('Contenido no abordado en este curso');
        const opts = [c.unidades[lr.orden-1], ...distractores];
        const shuffled = opts.map((o,i)=>({o,i})).sort(()=>Math.random()-.5);
        insLQ.run(lr.id,
          'El contenido que acaba de completar aborda principalmente:',
          JSON.stringify(shuffled.map(s=>s.o)),
          shuffled.findIndex(s=>s.i===0));
        insLQ.run(lr.id,
          `Dentro del ${c.cod}, la unidad "${c.unidades[lr.orden-1]}" se orienta a:`,
          JSON.stringify(['Desarrollar la competencia específica que fija el PNISAC para esa unidad','Cumplir un trámite sin evaluación','Reemplazar la totalidad de la práctica presencial','Otorgar la certificación en forma directa']),
          0);
      }
    }
    console.log(`✔ Catálogo PNISAC cargado: ${COURSES.length} cursos con unidades y bancos de preguntas`);
  }

  // ── Usuario DEMO: acceso total sin restricciones para presentaciones ───────
  // Datos realistas de un agente PSA para que la demo sea convincente
  try {
    const demoExiste = db.prepare("SELECT id FROM users WHERE usuario='demo'").get();
    if (!demoExiste) {
      const bcryptDemo = require('bcryptjs');
      db.prepare(`INSERT INTO users
        (legajo, usuario, dni, nombre, apellido, rango, organismo, aeropuerto,
         dependencia, funcion, role, password_hash, activo, autoriza_cursos, legajo_base)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,1,1,?)`)
        .run(
          'DEMO',          // legajo
          'demo',          // usuario
          '28547391',      // dni — ficticio pero realista
          'Agustín',       // nombre
          'RODRIGUEZ',     // apellido
          'Inspector',     // rango (jerarquía PSA)
          'PSA',           // organismo
          'Ezeiza EZE',    // aeropuerto
          'Subdirección Nacional', // dependencia
          'Inspector de Seguridad Aeroportuaria', // funcion
          'admin',         // rol: admin para ver todo el panel
          bcryptDemo.hashSync('demo', 10),
          'DEMO'           // legajo_base
        );
      console.log('✔ Usuario DEMO creado: demo / demo (acceso total para presentaciones)');

      // Inscribir al demo en los primeros 3 cursos del catálogo
      const demoUser = db.prepare("SELECT id FROM users WHERE usuario='demo'").get();
      if (demoUser) {
        const adminUser = db.prepare("SELECT id FROM users WHERE usuario='eheinrich'").get();
        const cursos = db.prepare('SELECT id FROM courses ORDER BY id LIMIT 3').all();
        cursos.forEach(c => {
          try {
            db.prepare(`INSERT INTO enrollments (user_id, course_id, estado, inscrito_por, ciclo, activo)
                        VALUES (?,?,'cursando',?,1,1)`)
              .run(demoUser.id, c.id, adminUser?.id || demoUser.id);
          } catch {}
        });
        // Marcar todas las lecciones del primer curso como completadas
        const primerCurso = cursos[0];
        if (primerCurso) {
          const enr = db.prepare('SELECT id FROM enrollments WHERE user_id=? AND course_id=? AND activo=1')
            .get(demoUser.id, primerCurso.id);
          if (enr) {
            const lecciones = db.prepare('SELECT id FROM lessons WHERE course_id=?').all(primerCurso.id);
            lecciones.forEach(l => {
              try {
                db.prepare('INSERT OR IGNORE INTO lesson_progress (enrollment_id, lesson_id) VALUES (?,?)')
                  .run(enr.id, l.id);
              } catch {}
            });
          }
        }
        // Abrir EPPT de prueba para el demo en el primer curso
        try {
          const enr1 = db.prepare('SELECT id FROM enrollments WHERE user_id=? AND course_id=? AND activo=1')
            .get(demoUser.id, cursos[0].id);
          if (enr1) {
            const dl = new Date(); dl.setDate(dl.getDate() + 90);
            db.prepare(`INSERT OR IGNORE INTO eppt_records
              (enrollment_id, apendice, requerido, tipo, deadline, estado, ciclo)
              VALUES (?,?,?,?,?,?,1)`)
              .run(enr1.id, 'Apéndice 05 — Demo', 10, 'horas',
                   dl.toISOString().slice(0,10), 'abierto');
          }
        } catch {}
        console.log('✔ Demo: inscripto en 3 cursos, lecciones completadas, EPPT abierto');
      }
    }
  } catch(e) { console.warn('Seed demo:', e.message); }

  // Seed: destinos de catálogo por defecto (aeropuertos PSA principales)
  try {
    if (db.prepare('SELECT COUNT(*) AS n FROM destinos_catalogo').get().n === 0) {
      const destSeed = [
        // [codigo, nombre, region, aeropuerto]
        ['EZE-OPS-01',  'Operaciones de Pista — Ezeiza',              'Buenos Aires', 'Aeropuerto Internacional Ezeiza (EZE)'],
        ['EZE-SEG-01',  'Seguridad Aeroportuaria — Ezeiza',           'Buenos Aires', 'Aeropuerto Internacional Ezeiza (EZE)'],
        ['EZE-TERM-01', 'Terminal de Pasajeros — Ezeiza',             'Buenos Aires', 'Aeropuerto Internacional Ezeiza (EZE)'],
        ['AEP-OPS-01',  'Operaciones de Pista — Aeroparque',          'Buenos Aires', 'Aeroparque Jorge Newbery (AEP)'],
        ['AEP-SEG-01',  'Seguridad Aeroportuaria — Aeroparque',       'Buenos Aires', 'Aeroparque Jorge Newbery (AEP)'],
        ['COR-SEG-01',  'Seguridad Aeroportuaria — Córdoba',          'Centro',       'Aeropuerto Internacional Córdoba (COR)'],
        ['MDZ-SEG-01',  'Seguridad Aeroportuaria — Mendoza',          'Cuyo',         'Aeropuerto Internacional Mendoza (MDZ)'],
        ['ROS-SEG-01',  'Seguridad Aeroportuaria — Rosario',          'Centro',       'Aeropuerto Internacional Rosario (ROS)'],
        ['USH-SEG-01',  'Seguridad Aeroportuaria — Ushuaia',          'Patagonia',    'Aeropuerto Internacional Ushuaia (USH)'],
        ['BRC-SEG-01',  'Seguridad Aeroportuaria — Bariloche',        'Patagonia',    'Aeropuerto Internacional Bariloche (BRC)'],
        ['IGR-SEG-01',  'Seguridad Aeroportuaria — Iguazú',           'NEA',          'Aeropuerto Internacional Iguazú (IGR)'],
        ['SLA-SEG-01',  'Seguridad Aeroportuaria — Salta',            'NOA',          'Aeropuerto Internacional Salta (SLA)'],
        ['TUC-SEG-01',  'Seguridad Aeroportuaria — Tucumán',          'NOA',          'Aeropuerto Internacional Tucumán (TUC)'],
        ['CRD-SUBDIR',  'Subdirección Nacional — Central',            'Buenos Aires', 'Sede Central PSA'],
        ['CRD-ISSA',    'Instituto Superior de Seguridad Aeroportuaria (ISSA)', 'Buenos Aires', 'Sede Central PSA'],
        ['CRD-ADM',     'Administración Central PSA',                 'Buenos Aires', 'Sede Central PSA'],
      ];
      const ins = db.prepare('INSERT INTO destinos_catalogo (codigo,nombre,region,aeropuerto) VALUES (?,?,?,?)');
      destSeed.forEach(([c,n,r,a]) => { try { ins.run(c,n,r,a); } catch {} });
      console.log('✔ Catálogo de destinos precargado: '+destSeed.length+' unidades');
    }
  } catch(e) { console.warn('Seed destinos:', e.message); }

  // Settings por defecto del módulo 4
  const settingsDefecto = [
    ['destino_vigencia_dias',   '180'],   // cada cuántos días debe reconfirmar
    ['destino_aviso_dias',      '30'],    // días antes del vencimiento para mostrar aviso
    ['destino_validacion_dias', '15'],    // días que tiene el jefe para validar
  ];
  settingsDefecto.forEach(([clave, valor]) => {
    try {
      if (!db.prepare('SELECT clave FROM system_settings WHERE clave=?').get(clave))
        db.prepare('INSERT INTO system_settings (clave, valor, updated_by) VALUES (?,?,1)').run(clave, valor);
    } catch {}
  });

  // Asignar todos los cursos al instructor de prueba — se ejecuta después del catálogo
  try {
    const instUser = db.prepare("SELECT id FROM users WHERE usuario='instructor'").get();
    const adminUser = db.prepare("SELECT id FROM users WHERE usuario='eheinrich'").get();
    if (instUser && adminUser) {
      const todosLosCursos = db.prepare('SELECT id FROM courses').all();
      todosLosCursos.forEach(c => {
        try { db.prepare('INSERT OR IGNORE INTO course_instructors (course_id, instructor_id, assigned_by) VALUES (?,?,?)').run(c.id, instUser.id, adminUser.id); } catch {}
      });
      if (todosLosCursos.length > 0) console.log('✔ Cursos asignados al instructor de prueba: ' + todosLosCursos.length);
    }
  } catch(e) { /* ignorar */ }
}
seed();

/* ---------------- Sentencias preparadas ---------------- */
const stmts = {
  // usuarios
  insertUser: db.prepare(`INSERT INTO users (legajo,usuario,dni,nombre,apellido,rango,organismo,aeropuerto,dependencia,funcion,role,password_hash,legajo_base)
                          VALUES (@legajo,@usuario,@dni,@nombre,@apellido,@rango,@organismo,@aeropuerto,@dependencia,@funcion,@role,@password_hash,@legajo_base)`),
  userByLogin: db.prepare(`SELECT * FROM users WHERE (usuario = ? OR legajo = ?) AND activo = 1`),
  userById: db.prepare(`SELECT * FROM users WHERE id = ?`),
  allUsers: db.prepare(`SELECT id,legajo,usuario,dni,nombre,apellido,rango,organismo,aeropuerto,dependencia,funcion,role,activo,autoriza_cursos,legajo_base,created_at FROM users ORDER BY apellido,nombre`),
  updateUserRole: db.prepare(`UPDATE users SET role = ? WHERE id = ?`),
  updateUserActivo: db.prepare(`UPDATE users SET activo = ? WHERE id = ?`),
  countUsers: db.prepare(`SELECT COUNT(*) AS n FROM users`),

  // ── Módulo 1: Aptitud Psicofísica ──────────────────────────────────
  aptoByUser:      db.prepare(`SELECT * FROM apto_medico WHERE user_id=? ORDER BY created_at DESC LIMIT 1`),
  aptoById:        db.prepare(`SELECT * FROM apto_medico WHERE id=?`),
  aptoItemsByApto: db.prepare(`SELECT * FROM apto_medico_items WHERE apto_id=? ORDER BY categoria,id`),
  insertApto:      db.prepare(`INSERT INTO apto_medico (user_id,organismo_tipo,vigencia_meses,admin_medico_id,estado) VALUES (?,?,?,?,'borrador')`),
  insertAptoItem:  db.prepare(`INSERT INTO apto_medico_items (apto_id,categoria,item,resultado,estado,observaciones) VALUES (?,?,?,?,?,?)`),
  updateAptoItem:  db.prepare(`UPDATE apto_medico_items SET resultado=?,estado=?,observaciones=?,updated_at=datetime('now','localtime') WHERE id=?`),
  allAptos:        db.prepare(`SELECT am.*, u.apellido, u.nombre, u.legajo, u.organismo FROM apto_medico am JOIN users u ON u.id=am.user_id ORDER BY am.created_at DESC`),

  // ── Módulo 2: JUOSP ─────────────────────────────────────────────────
  allUosps:        db.prepare(`SELECT * FROM uosps WHERE activa=1 ORDER BY nombre`),
  uospById:        db.prepare(`SELECT * FROM uosps WHERE id=?`),
  insertUosp:      db.prepare(`INSERT INTO uosps (nombre,descripcion,sede,region) VALUES (?,?,?,?)`),
  usersByUosp:     db.prepare(`SELECT * FROM users WHERE uosp_id=? AND activo=1 ORDER BY apellido`),
  epptByUosp:      db.prepare(`SELECT er.*, u.apellido, u.nombre, u.legajo, c.cod AS curso_cod, c.nombre AS curso_nombre
                                FROM eppt_records er
                                JOIN enrollments e ON e.id=er.enrollment_id
                                JOIN users u ON u.id=e.user_id
                                JOIN courses c ON c.id=e.course_id
                                WHERE u.uosp_id=? AND er.estado='completo'
                                ORDER BY u.apellido, er.created_at`),
  insertSolicitud: db.prepare(`INSERT INTO juosp_solicitudes (juosp_id,uosp_id,course_id,user_ids,nota_juosp) VALUES (?,?,?,?,?)`),
  solicitudesByUosp: db.prepare(`SELECT js.*, c.cod AS curso_cod, c.nombre AS curso_nombre, u.apellido AS juosp_apellido
                                  FROM juosp_solicitudes js
                                  JOIN courses c ON c.id=js.course_id
                                  JOIN users u ON u.id=js.juosp_id
                                  WHERE js.uosp_id=? ORDER BY js.created_at DESC`),
  insertConvalidacion: db.prepare(`INSERT INTO juosp_convalidaciones (juosp_id,uosp_id,eppt_ids,firma_hash,observaciones) VALUES (?,?,?,?,?)`),

  // ── Módulo 3: Acta de Examen ────────────────────────────────────────
  actaByAttempt:   db.prepare(`SELECT * FROM actas_examen WHERE attempt_id=?`),
  actaById:        db.prepare(`SELECT * FROM actas_examen WHERE id=?`),
  actaByNumero:    db.prepare(`SELECT * FROM actas_examen WHERE numero=?`),
  insertActa:      db.prepare(`INSERT INTO actas_examen (attempt_id,enrollment_id,detalle_json,estado) VALUES (?,?,?,'pendiente_alumno')`),
  actasPendientesInst: db.prepare(`SELECT ae.*, u.apellido, u.nombre, u.legajo, c.cod AS curso_cod
                                    FROM actas_examen ae
                                    JOIN enrollments e ON e.id=ae.enrollment_id
                                    JOIN users u ON u.id=e.user_id
                                    JOIN courses c ON c.id=e.course_id
                                    WHERE ae.estado='pendiente_instructor'
                                    ORDER BY ae.created_at DESC`),

  // ── Módulo 4: Reconfirmación de Destino ────────────────────────────
  // Catálogo
  allDestinos:      db.prepare(`SELECT * FROM destinos_catalogo WHERE activo=1 ORDER BY region,aeropuerto,nombre`),
  destinoById:      db.prepare(`SELECT * FROM destinos_catalogo WHERE id=?`),
  insertDestino:    db.prepare(`INSERT INTO destinos_catalogo (codigo,nombre,region,aeropuerto) VALUES (?,?,?,?)`),

  // Declaraciones
  declActiva:       db.prepare(`SELECT dd.*, dc.nombre AS destino_nombre, dc.codigo AS destino_codigo,
                                 d2.nombre AS destino_ant_nombre, u2.apellido AS jefe_apellido, u2.nombre AS jefe_nombre
                                 FROM destino_declaraciones dd
                                 JOIN destinos_catalogo dc ON dc.id=dd.destino_id
                                 LEFT JOIN destinos_catalogo d2 ON d2.id=dd.destino_ant_id
                                 LEFT JOIN users u2 ON u2.id=dd.jefe_id
                                 WHERE dd.user_id=? ORDER BY dd.created_at DESC LIMIT 1`),
  historialDecl:    db.prepare(`SELECT dd.*, dc.nombre AS destino_nombre, dc.codigo AS destino_codigo
                                 FROM destino_declaraciones dd
                                 JOIN destinos_catalogo dc ON dc.id=dd.destino_id
                                 WHERE dd.user_id=? ORDER BY dd.created_at DESC`),
  insertDecl:       db.prepare(`INSERT INTO destino_declaraciones
                                 (user_id,destino_id,destino_ant_id,jefe_id,estado,vence_at)
                                 VALUES (?,?,?,?,'pendiente_validacion',?)`),
  updateDeclEstado: db.prepare(`UPDATE destino_declaraciones SET estado=?,validado_por=?,validado_at=datetime('now','localtime') WHERE id=?`),
  declsPendJefe:    db.prepare(`SELECT dd.*, u.apellido, u.nombre AS unombre, u.legajo, dc.nombre AS destino_nombre
                                 FROM destino_declaraciones dd
                                 JOIN users u ON u.id=dd.user_id
                                 JOIN destinos_catalogo dc ON dc.id=dd.destino_id
                                 WHERE dd.jefe_id=? AND dd.estado='pendiente_validacion'
                                 ORDER BY dd.created_at DESC`),
  declsEscaladas:   db.prepare(`SELECT dd.*, u.apellido, u.nombre AS unombre, u.legajo, dc.nombre AS destino_nombre
                                 FROM destino_declaraciones dd
                                 JOIN users u ON u.id=dd.user_id
                                 JOIN destinos_catalogo dc ON dc.id=dd.destino_id
                                 WHERE dd.estado IN ('escalado','pendiente_validacion')
                                 ORDER BY dd.escalado_at DESC, dd.created_at DESC`),
  todosUltimaDecl:  db.prepare(`SELECT u.id, u.apellido, u.nombre, u.legajo, u.role, u.organismo,
                                 MAX(dd.created_at) AS ultima_decl, dd.estado AS ultimo_estado,
                                 dd.vence_at AS ultima_vence, dc.nombre AS destino_nombre, dc.codigo AS destino_codigo
                                 FROM users u
                                 LEFT JOIN destino_declaraciones dd ON dd.user_id=u.id AND dd.id=(
                                   SELECT id FROM destino_declaraciones WHERE user_id=u.id ORDER BY created_at DESC LIMIT 1)
                                 LEFT JOIN destinos_catalogo dc ON dc.id=dd.destino_id
                                 WHERE u.activo=1 AND u.role NOT IN ('sanidad')
                                 GROUP BY u.id ORDER BY ultima_decl ASC NULLS FIRST`),
  reportePorDestino: db.prepare(`SELECT dc.codigo, dc.nombre, dc.region, dc.aeropuerto,
                                  COUNT(dd.id) AS total,
                                  SUM(CASE WHEN dd.vence_at < date('now') THEN 1 ELSE 0 END) AS vencidos
                                  FROM destinos_catalogo dc
                                  LEFT JOIN destino_declaraciones dd ON dd.destino_id=dc.id AND dd.id=(
                                    SELECT id FROM destino_declaraciones WHERE destino_id=dc.id ORDER BY created_at DESC LIMIT 1)
                                  WHERE dc.activo=1 GROUP BY dc.id ORDER BY dc.region, dc.aeropuerto`),

  // Notificaciones in-app
  notifsPendientes: db.prepare(`SELECT dn.*, u.apellido, u.nombre AS unombre, u.legajo,
                                 dc.nombre AS destino_nombre
                                 FROM destino_notificaciones dn
                                 JOIN users u ON u.id=dn.de_user
                                 JOIN destino_declaraciones dd ON dd.id=dn.decl_id
                                 JOIN destinos_catalogo dc ON dc.id=dd.destino_id
                                 WHERE dn.para_user=? AND dn.leida=0
                                 ORDER BY dn.created_at DESC`),
  insertNotif:      db.prepare(`INSERT INTO destino_notificaciones (para_user,de_user,decl_id,tipo) VALUES (?,?,?,?)`),
  marcarNotifLeida: db.prepare(`UPDATE destino_notificaciones SET leida=1 WHERE id=?`),
  marcarTodasLeidas:db.prepare(`UPDATE destino_notificaciones SET leida=1 WHERE para_user=?`),

  // cursos
  allCourses: db.prepare(`SELECT * FROM courses WHERE activo = 1 ORDER BY cod`),
  courseById: db.prepare(`SELECT c.*, u.apellido AS inst_apellido, u.nombre AS inst_nombre, u.legajo AS inst_legajo FROM courses c LEFT JOIN users u ON u.id=c.instructor_id WHERE c.id=?`),
  courseByCod: db.prepare(`SELECT * FROM courses WHERE cod = ?`),
  lessonsByCourse: db.prepare(`SELECT * FROM lessons WHERE course_id = ? ORDER BY orden`),
  lessonById: db.prepare(`SELECT * FROM lessons WHERE id = ?`),
  updateLesson: db.prepare(`UPDATE lessons SET titulo = ?, tipo = ?, contenido = ?, video_url = COALESCE(?, video_url), duracion_s = ? WHERE id = ?`),

  // checkpoints por unidad
  lqByLesson: db.prepare(`SELECT * FROM lesson_questions WHERE lesson_id = ? AND activa = 1`),
  lqById: db.prepare(`SELECT * FROM lesson_questions WHERE id = ?`),
  insertLQ: db.prepare(`INSERT INTO lesson_questions (lesson_id,pregunta,opciones,correcta) VALUES (?,?,?,?)`),
  updateLQ: db.prepare(`UPDATE lesson_questions SET pregunta=?, opciones=?, correcta=? WHERE id = ?`),
  deleteLQ: db.prepare(`UPDATE lesson_questions SET activa = 0 WHERE id = ?`),

  // sesiones de unidad (tiempos reales)
  insertLS: db.prepare(`INSERT INTO lesson_sessions (enrollment_id,lesson_id,started_ms) VALUES (?,?,?)`),
  lsById: db.prepare(`SELECT * FROM lesson_sessions WHERE id = ?`),
  lsSetVideoDone: db.prepare(`UPDATE lesson_sessions SET video_done_ms=?, question_id=?, opciones_map=? WHERE id = ?`),
  lsClose: db.prepare(`UPDATE lesson_sessions SET completed_at=datetime('now','localtime'), resultado=? WHERE id = ?`),
  lsTimes: db.prepare(`SELECT ls.*, l.titulo, l.tipo, l.duracion_s, u.apellido, u.nombre AS unombre, u.legajo
                       FROM lesson_sessions ls
                       JOIN lessons l ON l.id = ls.lesson_id
                       JOIN enrollments e ON e.id = ls.enrollment_id
                       JOIN users u ON u.id = e.user_id
                       WHERE l.course_id = ? ORDER BY u.apellido, ls.id`),

  // sesiones de examen
  insertQS: db.prepare(`INSERT INTO quiz_sessions (enrollment_id,tipo,payload,created_ms) VALUES (?,?,?,?)`),
  qsById: db.prepare(`SELECT * FROM quiz_sessions WHERE id = ?`),
  qsUse: db.prepare(`UPDATE quiz_sessions SET used = 1 WHERE id = ?`),

  // preguntas
  questionsByCourse: db.prepare(`SELECT id,course_id,pregunta,opciones FROM quiz_questions WHERE course_id = ? AND activa = 1`),
  questionsFull: db.prepare(`SELECT * FROM quiz_questions WHERE course_id = ? AND activa = 1`),
  questionById: db.prepare(`SELECT * FROM quiz_questions WHERE id = ?`),
  insertQuestion: db.prepare(`INSERT INTO quiz_questions (course_id,pregunta,opciones,correcta) VALUES (?,?,?,?)`),
  updateQuestion: db.prepare(`UPDATE quiz_questions SET pregunta=?, opciones=?, correcta=? WHERE id = ?`),
  deleteQuestion: db.prepare(`UPDATE quiz_questions SET activa = 0 WHERE id = ?`),

  // inscripciones
  enroll: db.prepare(`INSERT OR IGNORE INTO enrollments (user_id,course_id,inscrito_por) VALUES (?,?,?)`),
  enrollment: db.prepare(`SELECT * FROM enrollments WHERE user_id = ? AND course_id = ? AND activo = 1`),
  enrollmentById: db.prepare(`SELECT * FROM enrollments WHERE id = ?`),
  enrollmentsByUser: db.prepare(`SELECT e.*, c.cod, c.nombre, c.horas, c.simulador, c.vigencia_meses
                                 FROM enrollments e JOIN courses c ON c.id = e.course_id
                                 WHERE e.user_id = ? AND e.activo = 1 ORDER BY e.created_at DESC`),
  enrollmentsByCourse: db.prepare(`SELECT e.*, u.legajo, u.dni, u.nombre AS unombre, u.apellido, u.rango, u.organismo
                                   FROM enrollments e JOIN users u ON u.id = e.user_id
                                   WHERE e.course_id = ? AND e.activo = 1 ORDER BY u.apellido`),
  setEnrollmentEstado: db.prepare(`UPDATE enrollments SET estado = ? WHERE id = ?`),
  insertNuevoCiclo: db.prepare(`INSERT INTO enrollments (user_id, course_id, inscrito_por, ciclo, activo, estado) VALUES (?,?,?,?,1,'cursando')`),
  archivarEnrollment: db.prepare(`UPDATE enrollments SET activo = 0 WHERE id = ?`),
  archivarHijosDeEnrollment: (enrollmentId) => {
    db.prepare('UPDATE attempts SET activo=0 WHERE enrollment_id=?').run(enrollmentId);
    db.prepare('UPDATE eppt_records SET activo=0 WHERE enrollment_id=?').run(enrollmentId);
    db.prepare('UPDATE practical_sessions SET activo=0 WHERE enrollment_id=?').run(enrollmentId);
    db.prepare('UPDATE proctor_sessions SET activo=0 WHERE enrollment_id=?').run(enrollmentId);
  },
  historialCiclosEnrollment: db.prepare(`SELECT * FROM enrollments WHERE user_id=? AND course_id=? ORDER BY ciclo DESC`),

  // progreso
  markLesson: db.prepare(`INSERT OR IGNORE INTO lesson_progress (enrollment_id,lesson_id) VALUES (?,?)`),
  progressByEnrollment: db.prepare(`SELECT lesson_id FROM lesson_progress WHERE enrollment_id = ?`),

  // intentos
  insertAttempt: db.prepare(`INSERT INTO attempts (enrollment_id,tipo,total,correct,score_pct,aei_ok,passed,duration_s,detail_json,ciclo)
                             VALUES (@enrollment_id,@tipo,@total,@correct,@score_pct,@aei_ok,@passed,@duration_s,@detail_json,@ciclo)`),
  attemptsByEnrollment: db.prepare(`SELECT * FROM attempts WHERE enrollment_id = ? AND anulado = 0 ORDER BY created_at`),
  attemptById: db.prepare(`SELECT * FROM attempts WHERE id = ?`),
  anularAttempt: db.prepare(`UPDATE attempts SET anulado = 1 WHERE id = ?`),

  // supervisión IA
  insertPS: db.prepare(`INSERT INTO proctor_sessions (enrollment_id, contexto, ciclo) VALUES (?,?,?)`),
  psById: db.prepare(`SELECT * FROM proctor_sessions WHERE id = ?`),
  psAddRisk: db.prepare(`UPDATE proctor_sessions SET risk_score = risk_score + ?, nivel = ? WHERE id = ?`),
  psEnd: db.prepare(`UPDATE proctor_sessions SET ended_at = datetime('now','localtime') WHERE id = ?`),
  psSetAttempt: db.prepare(`UPDATE proctor_sessions SET attempt_id = ? WHERE id = ?`),
  psReview: db.prepare(`UPDATE proctor_sessions SET revision = ?, revisor_id = ?, revision_nota = ? WHERE id = ?`),
  insertPE: db.prepare(`INSERT INTO proctor_events (session_id, tipo, detalle, puntos, foto, pantalla) VALUES (?,?,?,?,?,?)`),
  peBySession: db.prepare(`SELECT * FROM proctor_events WHERE session_id = ? ORDER BY id`),
  psAllPendientes: db.prepare(`SELECT ps.*, u.apellido, u.nombre AS unombre, u.legajo,
                                 a.tipo AS attempt_tipo, a.score_pct, a.passed, a.anulado AS attempt_anulado,
                                 c.cod AS curso_cod, c.nombre AS curso_nombre
                          FROM proctor_sessions ps
                          JOIN enrollments e ON e.id = ps.enrollment_id
                          JOIN users u ON u.id = e.user_id
                          JOIN courses c ON c.id = e.course_id
                          LEFT JOIN attempts a ON a.id = ps.attempt_id
                          WHERE ps.revision = 'pendiente' AND ps.nivel != 'verde'
                          ORDER BY CASE ps.nivel WHEN 'rojo' THEN 0 WHEN 'amarillo' THEN 1 ELSE 2 END, ps.id DESC`),
  psByCourse: db.prepare(`SELECT ps.*, u.apellido, u.nombre AS unombre, u.legajo,
                                 a.tipo AS attempt_tipo, a.score_pct, a.passed, a.anulado AS attempt_anulado
                          FROM proctor_sessions ps
                          JOIN enrollments e ON e.id = ps.enrollment_id
                          JOIN users u ON u.id = e.user_id
                          LEFT JOIN attempts a ON a.id = ps.attempt_id
                          WHERE e.course_id = ? ORDER BY ps.id DESC`),
  setCourseProctor: db.prepare(`UPDATE courses SET proctor = ? WHERE id = ?`),

  // Gestión de cursos (admin)
  insertCourse: db.prepare(`INSERT INTO courses
    (cod,nombre,destinatarios,horas,horas_teoricas,horas_practicas,modalidades,
     vigencia_meses,nota_min,asistencia_min,simulador,preguntas_examen,observaciones,proctor,orden_aleatorio,instructor_id,es_avsec)
    VALUES (@cod,@nombre,@destinatarios,@horas,@horas_teoricas,@horas_practicas,@modalidades,
     @vigencia_meses,@nota_min,@asistencia_min,@simulador,@preguntas_examen,@observaciones,@proctor,@orden_aleatorio,@instructor_id,@es_avsec)`),
  updateCourse: db.prepare(`UPDATE courses SET cod=?,nombre=?,destinatarios=?,horas=?,horas_teoricas=?,
    horas_practicas=?,modalidades=?,vigencia_meses=?,nota_min=?,asistencia_min=?,simulador=?,
    preguntas_examen=?,observaciones=?,proctor=?,orden_aleatorio=?,es_avsec=? WHERE id=?`),
  deleteCourse: db.prepare(`UPDATE courses SET activo = 0 WHERE id = ?`),
  allCoursesAdmin: db.prepare(`SELECT * FROM courses ORDER BY activo DESC, cod`),

  // Dashboard: métricas agregadas
  statsAlumnos: db.prepare(`SELECT COUNT(*) AS n FROM users WHERE role='estudiante' AND activo=1`),
  statsCertificados: db.prepare(`SELECT COUNT(*) AS n FROM certificates WHERE anulado=0`),
  statsCertVigentes: db.prepare(`SELECT COUNT(*) AS n FROM certificates WHERE anulado=0 AND (vencimiento IS NULL OR vencimiento >= date('now','localtime'))`),
  statsCertVencidos: db.prepare(`SELECT COUNT(*) AS n FROM certificates WHERE anulado=0 AND vencimiento < date('now','localtime')`),
  statsEnrollsByCourse: db.prepare(`SELECT c.cod, c.nombre, COUNT(e.id) AS total,
    SUM(CASE WHEN e.estado='aprobado' THEN 1 ELSE 0 END) AS aprobados,
    SUM(CASE WHEN e.estado='desaprobado' THEN 1 ELSE 0 END) AS desaprobados,
    SUM(CASE WHEN e.estado='cursando' OR e.estado='eppt' THEN 1 ELSE 0 END) AS cursando
    FROM enrollments e JOIN courses c ON c.id=e.course_id WHERE c.activo=1 GROUP BY c.id ORDER BY total DESC LIMIT 12`),
  statsTendencia: db.prepare(`SELECT strftime('%Y-%m', e.created_at) AS mes, COUNT(*) AS inscriptos,
    SUM(CASE WHEN e.estado='aprobado' THEN 1 ELSE 0 END) AS aprobados
    FROM enrollments e GROUP BY mes ORDER BY mes DESC LIMIT 12`),
  statsEpptPendientes: db.prepare(`SELECT COUNT(*) AS n FROM eppt_records WHERE estado='abierto'`),
  statsEpptVencidos: db.prepare(`SELECT COUNT(*) AS n FROM eppt_records WHERE estado='vencido'`),
  statsProctorRojos: db.prepare(`SELECT COUNT(*) AS n FROM proctor_sessions WHERE nivel='rojo' AND revision='pendiente'`),
  statsProctorAmarillos: db.prepare(`SELECT COUNT(*) AS n FROM proctor_sessions WHERE nivel='amarillo' AND revision='pendiente'`),
  // Reset de contraseña con verificación biométrica
  // bioResetLog se maneja con la función AUDIT() del servidor; esta sentencia no se usa

  // Rate-limiting de login
  loginAttemptsCount: db.prepare(`SELECT COUNT(*) AS n FROM login_attempts WHERE clave=? AND created_at > ?`),
  loginAttemptsInsert: db.prepare(`INSERT INTO login_attempts (clave, usuario, ip, created_at) VALUES (?,?,?,?)`),
  loginAttemptsPurge: db.prepare(`DELETE FROM login_attempts WHERE created_at < ?`),

  // Configuración general del sistema
  getSetting: db.prepare(`SELECT valor FROM system_settings WHERE clave=?`),
  setSetting: db.prepare(`INSERT INTO system_settings (clave,valor,updated_by) VALUES (?,?,?)
    ON CONFLICT(clave) DO UPDATE SET valor=excluded.valor, updated_at=datetime('now','localtime'), updated_by=excluded.updated_by`),

  // Asignación de cursos a instructores
  assignCourseInstructor: db.prepare(`INSERT OR IGNORE INTO course_instructors (course_id, instructor_id, assigned_by) VALUES (?,?,?)`),
  unassignCourseInstructor: db.prepare(`DELETE FROM course_instructors WHERE course_id=? AND instructor_id=?`),
  clearCourseInstructors: db.prepare(`DELETE FROM course_instructors WHERE instructor_id=?`),
  coursesAssignedToInstructor: db.prepare(`SELECT c.* FROM course_instructors ci JOIN courses c ON c.id=ci.course_id WHERE ci.instructor_id=? ORDER BY c.cod`),
  courseIdsAssignedToInstructor: db.prepare(`SELECT course_id FROM course_instructors WHERE instructor_id=?`),
  instructorsAssignedToCourse: db.prepare(`SELECT u.id, u.apellido, u.nombre AS unombre, u.legajo FROM course_instructors ci JOIN users u ON u.id=ci.instructor_id WHERE ci.course_id=? ORDER BY u.apellido`),
  isInstructorAssigned: db.prepare(`SELECT 1 AS ok FROM course_instructors WHERE course_id=? AND instructor_id=?`),

  // Credenciales
  insertCredencial: db.prepare(`INSERT INTO credenciales (user_id, ver_code, num_permiso, emitido_por) VALUES (?,?,?,?)`),
  credencialByCode: db.prepare(`SELECT c.*, u.apellido, u.nombre AS unombre, u.legajo, u.dni, u.rango, u.organismo, u.aeropuerto FROM credenciales c JOIN users u ON u.id=c.user_id WHERE c.ver_code=?`),
  credencialesByUser: db.prepare(`SELECT * FROM credenciales WHERE user_id=? ORDER BY emitido_at DESC`),
  anularCredencialesViejas: db.prepare(`UPDATE credenciales SET activa=0, anulada_at=datetime('now','localtime') WHERE user_id=? AND activa=1 AND ver_code!=?`),
  allCredenciales: db.prepare(`SELECT c.*, u.apellido, u.nombre AS unombre, u.legajo, u.organismo FROM credenciales c JOIN users u ON u.id=c.user_id ORDER BY c.emitido_at DESC`),

  // Jerarquías configurables
  allJerarquias: db.prepare(`SELECT * FROM jerarquias WHERE activo=1 ORDER BY orden, nombre`),
  allJerarquiasAdmin: db.prepare(`SELECT * FROM jerarquias ORDER BY orden, nombre`),
  insertJerarquia: db.prepare(`INSERT INTO jerarquias (nombre, orden) VALUES (?,?)`),
  deleteJerarquia: db.prepare(`UPDATE jerarquias SET activo=0 WHERE id=?`),

  // Asistencia / Libro de Aula
  insertAsistencia: db.prepare(`INSERT OR IGNORE INTO asistencia (enrollment_id, fecha, tipo, presente, justificado, nota_obs, registrado_por) VALUES (?,?,?,?,?,?,?)`),
  asistenciaByEnrollment: db.prepare(`SELECT * FROM asistencia WHERE enrollment_id = ? ORDER BY fecha`),
  asistenciaByCourse: db.prepare(`SELECT a.*, u.apellido, u.nombre AS unombre, u.legajo
    FROM asistencia a JOIN enrollments e ON e.id=a.enrollment_id JOIN users u ON u.id=e.user_id
    WHERE e.course_id=? ORDER BY a.fecha DESC, u.apellido`),
  pctAsistencia: db.prepare(`SELECT COUNT(*) AS total, SUM(presente) AS presentes FROM asistencia WHERE enrollment_id=?`),

  // Reloj de instructores
  insertInstructorHoras: db.prepare(`INSERT INTO instructor_horas (instructor_id,anio,curso_id,fecha,horas,descripcion,firmado_por,firma_hash) VALUES (?,?,?,?,?,?,?,?)`),
  horasInstructor: db.prepare(`SELECT * FROM instructor_horas WHERE instructor_id=? AND anio=? ORDER BY fecha`),
  totalHorasInstructor: db.prepare(`SELECT COALESCE(SUM(horas),0) AS total FROM instructor_horas WHERE instructor_id=? AND anio=?`),
  allInstructoresReloj: db.prepare(`SELECT u.id, u.apellido, u.nombre AS unombre, u.legajo, u.rango,
    COALESCE(SUM(h.horas),0) AS horas_anio
    FROM users u LEFT JOIN instructor_horas h ON h.instructor_id=u.id AND h.anio=strftime('%Y','now')
    WHERE u.role IN ('instructor','admin') AND u.activo=1 GROUP BY u.id ORDER BY u.apellido`),

  // Calendario ISSA
  insertCalendario: db.prepare(`INSERT INTO calendario_cursos (anio,course_id,fecha_inicio,fecha_fin,modalidad,sede,cupo,created_by) VALUES (?,?,?,?,?,?,?,?)`),
  updateCalendario: db.prepare(`UPDATE calendario_cursos SET fecha_inicio=?,fecha_fin=?,modalidad=?,sede=?,cupo=?,estado=? WHERE id=?`),
  allCalendario: db.prepare(`SELECT cc.*, c.cod AS curso_cod, c.nombre AS curso_nombre, c.horas
    FROM calendario_cursos cc JOIN courses c ON c.id=cc.course_id ORDER BY cc.fecha_inicio`),
  calendarioPorAnio: db.prepare(`SELECT cc.*, c.cod AS curso_cod, c.nombre AS curso_nombre, c.horas
    FROM calendario_cursos cc JOIN courses c ON c.id=cc.course_id WHERE cc.anio=? ORDER BY cc.fecha_inicio`),
  marcarEnviadoISSA: db.prepare(`UPDATE calendario_cursos SET enviado_issa=1 WHERE anio=? AND estado='planificado' OR estado='confirmado'`),

  // DNIs preautorizados
  insertDniAut: db.prepare(`INSERT INTO dni_autorizados (dni, organismo, nota, created_by) VALUES (?,?,?,?)`),
  dniAutByDni: db.prepare(`SELECT * FROM dni_autorizados WHERE dni = ?`),
  allDniAut: db.prepare(`SELECT * FROM dni_autorizados ORDER BY created_at DESC`),
  marcarDniUsado: db.prepare(`UPDATE dni_autorizados SET usado = 1 WHERE dni = ?`),
  deleteDniAut: db.prepare(`DELETE FROM dni_autorizados WHERE id = ?`),

  // Registro correlativo de documentos
  nextDocNum: db.prepare(`SELECT COALESCE(MAX(CAST(SUBSTR(numero,-4) AS INTEGER)),0)+1 AS n FROM registro_documentos WHERE tipo=? AND numero LIKE ?`),
  insertRegDoc: db.prepare(`INSERT INTO registro_documentos (tipo,numero,user_id,course_id,referencia,emitido_por) VALUES (?,?,?,?,?,?)`),
  regDocById: db.prepare(`SELECT * FROM registro_documentos WHERE id = ?`),
  regDocByRef: db.prepare(`SELECT * FROM registro_documentos WHERE referencia = ?`),
  allRegDoc: db.prepare(`SELECT rd.*, u.apellido, u.nombre AS unombre, u.legajo, u.dni,
                                c.cod AS curso_cod, c.nombre AS curso_nombre,
                                ep.apellido AS emisor_ap, ep.nombre AS emisor_nom
                         FROM registro_documentos rd
                         LEFT JOIN users u ON u.id = rd.user_id
                         LEFT JOIN courses c ON c.id = rd.course_id
                         LEFT JOIN users ep ON ep.id = rd.emitido_por
                         ORDER BY rd.id DESC`),

  // Historial académico del alumno
  historialAlumno: db.prepare(`SELECT e.*, c.cod AS curso_cod, c.nombre AS curso_nombre, c.horas,
                                       c.vigencia_meses, a.score_pct, a.tipo AS tipo_instancia,
                                       a.passed, a.created_at AS instancia_at,
                                       cert.code AS cert_code, cert.vencimiento, cert.firma_hash,
                                       cert.anulado AS cert_anulado
                                FROM enrollments e
                                JOIN courses c ON c.id = e.course_id
                                LEFT JOIN attempts a ON a.enrollment_id = e.id AND a.anulado = 0
                                LEFT JOIN certificates cert ON cert.enrollment_id = e.id AND cert.anulado = 0
                                WHERE e.user_id = ? ORDER BY e.course_id, e.ciclo DESC, a.created_at DESC`),

  // Campos nuevos de usuario
  updateUserFull: db.prepare(`UPDATE users SET nombre=?,apellido=?,dni=?,rango=?,organismo=?,aeropuerto=?,dependencia=?,funcion=? WHERE id=?`),
  usersByOrg: db.prepare(`SELECT * FROM users WHERE organismo=? AND activo=1 ORDER BY apellido`),

  // gestión de usuarios
  updateUserData: db.prepare(`UPDATE users SET dni=?, nombre=?, apellido=?, rango=?, organismo=? WHERE id = ?`),
  updateUserPassword: db.prepare(`UPDATE users SET password_hash = ? WHERE id = ?`),
  userByDni: db.prepare(`SELECT * FROM users WHERE dni = ? AND activo = 1`),
  usersBySupervisor: db.prepare(`SELECT * FROM users WHERE role IN ('supervisor','instructor','admin') AND activo = 1`),

  // EPPT
  insertEppt: db.prepare(`INSERT INTO eppt_records (enrollment_id, apendice, requerido, tipo, deadline, ciclo) VALUES (?,?,?,?,?,?)`),
  epptByEnrollment: db.prepare(`SELECT * FROM eppt_records WHERE enrollment_id = ?`),
  epptById: db.prepare(`SELECT * FROM eppt_records WHERE id = ?`),
  epptSetEstado: db.prepare(`UPDATE eppt_records SET estado = ? WHERE id = ?`),
  epptCerrar: db.prepare(`UPDATE eppt_records SET estado = ?, motivo_cierre = ? WHERE id = ?`),
  deleteEppt: db.prepare(`DELETE FROM eppt_records WHERE enrollment_id = ?`),
  insertEpptEntry: db.prepare(`INSERT INTO eppt_entries (eppt_id, fecha, hora_inicio, hora_fin, puesto, horas, rubrica, observaciones, supervisor_id, firma_sup_at, firma_sup_hash)
                               VALUES (?,?,?,?,?,?,?,?,?,datetime('now','localtime'),?)`),
  epptEntries: db.prepare(`SELECT e.*, u.apellido AS sup_apellido, u.nombre AS sup_nombre, u.legajo AS sup_legajo
                           FROM eppt_entries e JOIN users u ON u.id = e.supervisor_id
                           WHERE e.eppt_id = ? ORDER BY e.fecha, e.id`),
  epptEntryById: db.prepare(`SELECT * FROM eppt_entries WHERE id = ?`),
  epptSignAlumno: db.prepare(`UPDATE eppt_entries SET firma_alu_at = datetime('now','localtime'), firma_alu_hash = ? WHERE id = ?`),
  epptPendientes: db.prepare(`SELECT r.*, e.user_id, e.course_id, u.apellido, u.nombre AS unombre, u.legajo, u.dni,
                                     c.cod AS curso_cod, c.nombre AS curso_nombre
                              FROM eppt_records r
                              JOIN enrollments e ON e.id = r.enrollment_id
                              JOIN users u ON u.id = e.user_id
                              JOIN courses c ON c.id = e.course_id
                              ORDER BY r.deadline ASC`),

  // sets del práctico
  insertPracSet: db.prepare(`INSERT INTO practical_sessions (enrollment_id, filenames, created_ms, ciclo) VALUES (?,?,?,?)`),
  pracSetById: db.prepare(`SELECT * FROM practical_sessions WHERE id = ?`),
  pracSetUse: db.prepare(`UPDATE practical_sessions SET used = 1 WHERE id = ?`),

  // certificados
  insertCert: db.prepare(`INSERT INTO certificates (user_id,course_id,code,score_pct,vencimiento,enrollment_id,numero_credencial,clinical_exam_id)
                          VALUES (@user_id,@course_id,@code,@score_pct,@vencimiento,@enrollment_id,@numero_credencial,@clinical_exam_id)`),
  certByCode: db.prepare(`SELECT c.*, u.nombre, u.apellido, u.rango, u.legajo, u.dni, u.organismo,
                                 co.cod AS curso_cod, co.nombre AS curso_nombre, co.horas
                          FROM certificates c
                          JOIN users u ON u.id = c.user_id
                          JOIN courses co ON co.id = c.course_id
                          WHERE c.code = ?`),
  certsByUser: db.prepare(`SELECT c.*, co.cod AS curso_cod, co.nombre AS curso_nombre, co.es_avsec
                           FROM certificates c JOIN courses co ON co.id = c.course_id
                           WHERE c.user_id = ? AND c.anulado = 0 ORDER BY c.issued_at DESC`),
  allCerts: db.prepare(`SELECT c.*, u.legajo, u.dni, u.apellido, u.nombre AS unombre, u.rango,
                               co.cod AS curso_cod, co.nombre AS curso_nombre
                        FROM certificates c
                        JOIN users u ON u.id = c.user_id
                        JOIN courses co ON co.id = c.course_id
                        ORDER BY c.issued_at DESC`),
  certByEnrollmentCourse: db.prepare(`SELECT * FROM certificates WHERE user_id = ? AND course_id = ? AND anulado = 0`),
  psPendientesByEnrollment: db.prepare(`SELECT * FROM proctor_sessions
      WHERE enrollment_id = ? AND nivel != 'verde' AND revision = 'pendiente'`),
  anularCert: db.prepare(`UPDATE certificates SET anulado = 1, observaciones = ? WHERE id = ?`),

  // anotaciones simulador
  upsertAnnotation: db.prepare(`INSERT INTO annotations (filename,is_clean,threats,updated_at)
                                VALUES (@filename,@is_clean,@threats,datetime('now','localtime'))
                                ON CONFLICT(filename) DO UPDATE SET
                                  is_clean=excluded.is_clean, threats=excluded.threats, updated_at=datetime('now','localtime')`),
  annotationByFile: db.prepare(`SELECT * FROM annotations WHERE filename = ?`),
  allAnnotations: db.prepare(`SELECT * FROM annotations`),

  // auditoría
  audit: db.prepare(`INSERT INTO audit_log (user_id,accion,detalle) VALUES (?,?,?)`),
  auditList: db.prepare(`SELECT a.*, u.usuario, u.apellido FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
                         ORDER BY a.id DESC LIMIT 500`),

  // métricas
  statsCursos: db.prepare(`
    SELECT co.cod, co.nombre,
           COUNT(e.id) AS inscriptos,
           SUM(CASE WHEN e.estado='aprobado' THEN 1 ELSE 0 END) AS aprobados,
           SUM(CASE WHEN e.estado='desaprobado' THEN 1 ELSE 0 END) AS desaprobados,
           ROUND(AVG(CASE WHEN a.tipo IN ('teorico','recuperatorio') THEN a.score_pct END),1) AS promedio_teoria
    FROM courses co
    LEFT JOIN enrollments e ON e.course_id = co.id
    LEFT JOIN attempts a ON a.enrollment_id = e.id
    WHERE co.activo = 1
    GROUP BY co.id ORDER BY co.cod`),
  vencimientos: db.prepare(`
    SELECT c.code, c.vencimiento, c.issued_at, u.legajo, u.dni, u.apellido, u.nombre AS unombre,
           co.cod AS curso_cod, co.nombre AS curso_nombre
    FROM certificates c
    JOIN users u ON u.id = c.user_id
    JOIN courses co ON co.id = c.course_id
    WHERE c.anulado = 0 AND c.vencimiento IS NOT NULL
    ORDER BY c.vencimiento ASC`)
};

module.exports = { db, stmts };
