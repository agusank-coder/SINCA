/* api.js — Cliente HTTP de SINCA (JWT en sessionStorage) */

// Formateador de fechas global: siempre DD/MM/AAAA
function _fmtFecha(fecha) {
  if (!fecha) return '—';
  try {
    // Acepta 'YYYY-MM-DD', 'YYYY-MM-DDTHH:mm:ss', o Date
    const s = String(fecha).slice(0, 10);
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) return m[3] + '/' + m[2] + '/' + m[1];
    const d = new Date(fecha);
    if (isNaN(d.getTime())) return String(fecha);
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yyyy = d.getFullYear();
    return dd + '/' + mm + '/' + yyyy;
  } catch { return String(fecha); }
}
// Igual pero con hora: DD/MM/AAAA HH:mm
function _fmtFechaHora(fechaISO) {
  if (!fechaISO) return '—';
  try {
    const d = new Date(fechaISO);
    if (isNaN(d.getTime())) return String(fechaISO);
    const dd = String(d.getDate()).padStart(2,'0');
    const mm = String(d.getMonth()+1).padStart(2,'0');
    const yyyy = d.getFullYear();
    const hh = String(d.getHours()).padStart(2,'0');
    const mi = String(d.getMinutes()).padStart(2,'0');
    return dd+'/'+mm+'/'+yyyy+' '+hh+':'+mi;
  } catch { return String(fechaISO); }
}

const API = (() => {
  let token = sessionStorage.getItem('pnisac_token') || null;
  let user = JSON.parse(sessionStorage.getItem('pnisac_user') || 'null');

  // Detectar si es mobile una vez al cargar
  const _isMobileDevice = () =>
    window.matchMedia('(pointer: coarse)').matches ||
    /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);

  async function request(method, url, body) {
    const opts = { method, headers: {} };
    if (token) opts.headers.Authorization = 'Bearer ' + token;
    // Informar al servidor el tipo de dispositivo para validación de examen
    opts.headers['X-Device-Type'] = _isMobileDevice() ? 'mobile' : 'desktop';
    if (body instanceof FormData) opts.body = body;
    else if (body !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
    let res;
    try { res = await fetch(url, opts); }
    catch { throw new Error('No se pudo contactar al servidor. ¿Está corriendo "npm start"?'); }
    let data = null;
    try { data = await res.json(); } catch {}
    if (!res.ok) {
      // Si el servidor indica que la cuenta fue desactivada, limpiar sesión local
      // inmediatamente sin esperar a que expire el JWT (forzar_logout = true)
      if (res.status === 401 && data?.forzar_logout) {
        clearSession();
        // Redirigir al login — usamos location.reload() para limpiar el estado completo de la SPA
        const msg = data.error || 'Su cuenta fue desactivada. Cierre sesión e intente nuevamente.';
        setTimeout(() => {
          alert('⚠ ' + msg);
          location.reload();
        }, 50);
      }
      throw new Error((data && data.error) || `Error ${res.status}`);
    }
    return data;
  }

  function setSession(t, u) {
    token = t; user = u;
    sessionStorage.setItem('pnisac_token', t);
    sessionStorage.setItem('pnisac_user', JSON.stringify(u));
  }
  function clearSession() {
    token = null; user = null;
    sessionStorage.removeItem('pnisac_token');
    sessionStorage.removeItem('pnisac_user');
  }

  return {
    get user() { return user; },
    get hasSession() { return !!token; },
    setSession, clearSession,

    register: d => request('POST', '/api/register', d),
    login: d => request('POST', '/api/login', d),
    me: () => request('GET', '/api/me'),

    courses: () => request('GET', '/api/courses'),
    course: id => request('GET', `/api/courses/${id}`),
    enroll: id => request('POST', `/api/courses/${id}/enroll`),
    lessonStart: id => request('POST', `/api/lessons/${id}/start`),
    lessonVideoDone: (id, session_id) => request('POST', `/api/lessons/${id}/videodone`, { session_id }),
    lessonCheckpoint: (id, session_id, answer) => request('POST', `/api/lessons/${id}/checkpoint`, { session_id, answer }),
    quizGet: id => request('GET', `/api/courses/${id}/quiz`),
    quizSubmit: (id, d) => request('POST', `/api/courses/${id}/quiz`, d),
    practicalSubmit: (id, d) => request('POST', `/api/courses/${id}/practical`, d),

    images: (qs) => request('GET', '/api/images' + (qs || '')),
    practicalSet: courseId => request('GET', `/api/practical-set/${courseId}`),
    // Configuración del tiempo por imagen del práctico
    // Verificación de contraseña para firmas electrónicas (reautenticación)
    verificarPassword: (password) => request('POST', '/api/auth/verificar-password', { password }),
    // Verificador unificado de documentos y firmas
    verificarDoc: (q) => request('GET', `/api/admin/verificar?q=${encodeURIComponent(q)}`),
    crearPerfilInstructor: (userId, password) => request('POST', `/api/admin/users/${userId}/perfil-instructor`, { password }),
    desactivarPerfilInstructor: (userId) => request('POST', `/api/admin/users/${userId}/perfil-instructor/desactivar`),
    getPerfiles: (userId) => request('GET', `/api/admin/users/${userId}/perfiles`),
    registrarFirmaPdf: (tipo, titulo, hash) => request('POST', '/api/admin/registrar-firma-pdf', { tipo, titulo, hash }),
    // Perfil propio
    updateMe: (data) => request('PATCH', '/api/me', data),
    changePassword: (password_actual, password_nuevo) => request('POST', '/api/me/password', { password_actual, password_nuevo }),
    getProctorConfig: () => request('GET', '/api/admin/settings/proctor'),

    // ── Módulo 1: Aptitud Psicofísica ──────────────────────────────────
    getAptos:          ()         => request('GET',   '/api/admin/apto-medico'),
    getAptoUsuario:    (uid)      => request('GET',   `/api/admin/apto-medico/usuario/${uid}`),
    crearApto:         (data)     => request('POST',  '/api/admin/apto-medico', data),
    updateAptoItem:    (id,data)  => request('PATCH', `/api/admin/apto-medico/item/${id}`, data),
    firmarApto:        (id,pass_) => request('POST',  `/api/admin/apto-medico/${id}/firmar`, {password:pass_}),
    checkAptoMedico:   (cid)      => request('GET',   `/api/courses/${cid}/apto-medico/check`),

    // ── Módulo 2: JUOSP ─────────────────────────────────────────────────
    getUosps:           ()         => request('GET',  '/api/admin/uosps'),
    crearUosp:          (data)     => request('POST', '/api/admin/uosps', data),
    asignarUosp:        (uid,oid)  => request('POST', `/api/admin/users/${uid}/uosp`, {uosp_id:oid}),
    getMiUosp:          ()         => request('GET',  '/api/juosp/mi-uosp'),
    getEpptPendientesJuosp: ()     => request('GET',  '/api/juosp/eppt-pendientes'),
    getHistorialUosp:   ()         => request('GET',  '/api/juosp/historial'),
    convalidarJuosp:    (data)     => request('POST', '/api/juosp/convalidar', data),
    solicitarInscripcion:(data)    => request('POST', '/api/juosp/solicitar-inscripcion', data),
    getSolicitudesJuosp: ()        => request('GET',  '/api/admin/juosp/solicitudes'),
    resolverSolicitud:  (id,data)  => request('POST', `/api/admin/juosp/solicitudes/${id}/resolver`, data),

    // ── Módulo 3: Acta de Examen ────────────────────────────────────────
    firmarActaAlumno:   (data)     => request('POST', `/api/courses/${data.course_id}/quiz/firma-alumno`, data),
    getActasPendientes: ()         => request('GET',  '/api/admin/actas/pendientes'),
    firmarActaInst:     (id,pass_) => request('POST', `/api/admin/actas/${id}/firma-instructor`, {password:pass_}),
    getActa:            (ref)      => request('GET',  `/api/admin/actas/${ref}`),
    getMisActas:        ()         => request('GET',  '/api/me/actas'),

    // ── Módulo 4: Reconfirmación de Destino ────────────────────────────
    getEstadoDestino:    ()         => request('GET',  '/api/me/destino/estado'),
    getDestinosCatalogo: ()         => request('GET',  '/api/destinos/catalogo'),
    getJefesDisponibles: ()         => request('GET',  '/api/destinos/jefes'),
    declararDestino:     (data)     => request('POST', '/api/me/destino/declarar', data),
    getMiHistorialDestino: ()       => request('GET',  '/api/me/destino/historial'),
    getPendientesValidacion: ()     => request('GET',  '/api/destinos/pendientes-validacion'),
    validarDeclaracion:  (id,data)  => request('POST', `/api/destinos/validar/${id}`, data),
    marcarNotifLeida:    (id)       => request('POST', `/api/destinos/notificaciones/${id}/leida`, {}),
    getReporteDestinos:  ()         => request('GET',  '/api/admin/destinos/reporte'),
    getHistorialDestino: (uid)      => request('GET',  `/api/admin/destinos/historial/${uid}`),
    crearDestino:        (data)     => request('POST', '/api/admin/destinos', data),
    editarDestino:       (id,data)  => request('PATCH', `/api/admin/destinos/${id}`, data),
    getSettingsDestino:  ()         => request('GET',  '/api/admin/settings/destino'),
    saveSettingsDestino: (data)     => request('POST', '/api/admin/settings/destino', data),
    setProctorConfig: (data) => request('POST', '/api/admin/settings/proctor', data),
    getEvalSeconds: () => request('GET', '/api/admin/settings/eval-seconds'),
    setEvalSeconds: seconds => request('POST', '/api/admin/settings/eval-seconds', { seconds }),
    // Panel de firmas electrónicas
    buscarFirmas: q => request('GET', `/api/admin/firmas/buscar?q=${encodeURIComponent(q)}`),
    // Panel de firmas EPPT por supervisor
    firmasEpptSupervisor: (params) => request('GET', '/api/admin/eppt/firmas-supervisor?' + new URLSearchParams(params).toString()),
    saveAnnotation: d => request('POST', '/api/annotations', d),

    certificate: code => request('GET', `/api/certificates/${encodeURIComponent(code)}`),
    verify: code => request('GET', `/api/verify/${encodeURIComponent(code)}`),

    adminStats: () => request('GET', '/api/admin/stats'),
    adminUsers: () => request('GET', '/api/admin/users'),
    adminSetRole: (id, role) => request('POST', `/api/admin/users/${id}/role`, { role }),
    adminSetActivo: (id, activo) => request('POST', `/api/admin/users/${id}/activo`, { activo }),
    adminUserData: (id, d) => request('POST', `/api/admin/users/${id}/data`, d),
    adminUserPassword: (id, password) => request('POST', `/api/admin/users/${id}/password`, { password }),
    adminUsersBulk: users => request('POST', '/api/admin/users/bulk', { users }),
    adminEnrollBulk: d => request('POST', '/api/admin/enrollments/bulk', d),
    adminCerts: qs => request('GET', '/api/admin/certificates' + (qs || '')),
    adminAnularCert: (id, motivo) => request('POST', `/api/admin/certificates/${id}/anular`, { motivo }),
    adminVencimientos: dias => request('GET', `/api/admin/vencimientos?dias=${dias || 60}`),
    adminActa: courseId => request('GET', `/api/admin/acta/${courseId}`),
    adminStudents: courseId => request('GET', `/api/admin/course/${courseId}/students`),
    adminResetEnrollment: id => request('POST', `/api/admin/enrollments/${id}/reset`),
    adminQuestions: courseId => request('GET', `/api/admin/course/${courseId}/questions`),
    adminSaveQuestion: d => request('POST', '/api/admin/questions', d),
    adminDeleteQuestion: id => request('DELETE', `/api/admin/questions/${id}`),
    adminLessons: courseId => request('GET', `/api/admin/course/${courseId}/lessons`),
    adminSaveLesson: (id, d) => request('POST', `/api/admin/lessons/${id}`, d),
    adminUploadVideo: (id, formData) => request('POST', `/api/admin/lessons/${id}/video`, formData),
    adminSaveLQ: d => request('POST', '/api/admin/lesson-questions', d),
    adminDeleteLQ: id => request('DELETE', `/api/admin/lesson-questions/${id}`),
    adminTiempos: courseId => request('GET', `/api/admin/course/${courseId}/tiempos`),
    adminAudit: () => request('GET', '/api/admin/audit'),
    // supervisión IA
    proctorStart: d => request('POST', '/api/proctor/start', d),
    proctorEvent: d => request('POST', '/api/proctor/event', d),
    proctorEnd: session_id => request('POST', '/api/proctor/end', { session_id }),
    adminProctor: courseId => request('GET', `/api/admin/proctor/${courseId}`),
    adminProctorPendientes: () => request('GET', '/api/admin/proctor/pendientes'),
    rangos: () => request('GET', '/api/rangos'),
    adminProctorSession: id => request('GET', `/api/admin/proctor/session/${id}`),
    adminProctorReview: (id, d) => request('POST', `/api/admin/proctor/session/${id}/review`, d),
    adminCourseProctor: (id, proctor) => request('POST', `/api/admin/course/${id}/proctor`, { proctor }),
    // Cursos CRUD
    adminAllCourses: () => request('GET', '/api/admin/courses'),
    adminCreateCourse: d => request('POST', '/api/admin/courses', d),
    adminUpdateCourse: (id, d) => request('PUT', `/api/admin/courses/${id}`, d),
    adminDeleteCourse: id => request('DELETE', `/api/admin/courses/${id}`),
    // Dashboard
    dashboard: () => request('GET', '/api/admin/dashboard'),
    // Reset biométrico (sin token: es para usuarios sin sesión)
    bioReset: d => fetch('/api/auth/bio-reset', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(d) }).then(r => r.json()),
    // EPPT
    epptMio: courseId => request('GET', `/api/courses/${courseId}/eppt`),
    epptFirmarAlumno: (entryId, password) => request('POST', `/api/eppt/entries/${entryId}/firmar`, { password }),
    adminEppt: () => request('GET', '/api/admin/eppt'),
    adminEpptEntry: (epptId, d) => request('POST', `/api/admin/eppt/${epptId}/entries`, d),
    adminEpptReprobar: (epptId, d) => request('POST', `/api/admin/eppt/${epptId}/reprobar`, d),
    adminImagesUpload: fd => request('POST', '/api/admin/images', fd),
    adminImageDelete: filename => request('DELETE', `/api/admin/images/${encodeURIComponent(filename)}`),
    dashboardDetalle: () => request('GET', '/api/admin/dashboard/detalle'),
    dashboardCursosClave: () => request('GET', '/api/admin/dashboard/cursos-clave'),
    // DNIs preautorizados
    adminDniAut: () => request('GET', '/api/admin/dni-autorizados'),
    adminDniAutBulk: rows => request('POST', '/api/admin/dni-autorizados/bulk', { dnis: rows }),
    adminDniAutDelete: id => request('DELETE', `/api/admin/dni-autorizados/${id}`),
    // Historial académico
    adminHistorial: userId => request('GET', `/api/admin/historial/${userId}`),
    // Asistencia
    adminAsistencia: courseId => request('GET', `/api/admin/asistencia/${courseId}`),
    adminAsistenciaBulk: d => request('POST', '/api/admin/asistencia/bulk', d),
    // Reloj instructores
    adminRelojInstructores: () => request('GET', '/api/admin/instructores/reloj'),
    adminInstructorHoras: (id, anio) => request('GET', `/api/admin/instructores/${id}/horas?anio=${anio}`),
    adminAddHorasInstructor: (id, d) => request('POST', `/api/admin/instructores/${id}/horas`, d),
    // Calendario ISSA
    adminCalendario: anio => request('GET', `/api/admin/calendario?anio=${anio}`),
    adminCalendarioAdd: d => request('POST', '/api/admin/calendario', d),
    adminCalendarioEdit: (id, d) => request('PUT', `/api/admin/calendario/${id}`, d),
    adminCalendarioEnviarISSA: d => request('POST', '/api/admin/calendario/enviar-issa', d),
    // Acta EPPT
    adminEpptActaPDF: id => request('GET', `/api/admin/eppt/${id}/acta-pdf`),
    // Credenciales
    adminCredenciales: () => request('GET', '/api/admin/credenciales'),
    verificarCredencial: code => fetch('/api/credencial/'+encodeURIComponent(code)).then(r=>r.json()),
    // Auditoría con filtros
    adminAuditFiltros: (desde, hasta, accion, limit) => {
      const p = new URLSearchParams();
      if (desde) p.set('desde', desde);
      if (hasta) p.set('hasta', hasta);
      if (accion) p.set('accion', accion);
      if (limit) p.set('limit', limit);
      return request('GET', '/api/admin/audit?' + p.toString());
    },
    getCertMedicoAgente: agente_id => request('GET', `/api/sanidad/certificados/agente/${agente_id}`),
    emitirCertMedico: d => request('POST', '/api/sanidad/certificados', d),
    exportUrl: tipo => `/api/admin/export/${tipo}`,
    get token() { return token; }
  };
})();
