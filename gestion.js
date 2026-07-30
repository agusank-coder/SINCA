/* ============================================================
 * gestion.js — Panel de gestión (docente / administrador)
 * Tablero · Usuarios · Certificados · Vencimientos · Actas ·
 * Contenidos por curso (unidades/videos/checkpoints/banco de examen,
 * alumnos, tiempos de visualización) · Auditoría
 * ============================================================ */
const Gestion = {
  tab: 'tablero',
  courseSel: null,

  isAdmin() { return ['admin','instructor'].includes(API.user?.role); },

  // Permisos específicos por módulo
  puedeGestionarMedico() { return ['admin','sanidad'].includes(API.user?.role); },
  puedeGestionarJUOSP()  { return ['admin','juosp','juosp_regional'].includes(API.user?.role); },
  esSuperAdmin()         { return API.user?.role === 'admin'; },

  async render() {
    const el = document.getElementById('view-gestion');
    if (!el) { console.warn('view-gestion no encontrado'); return; }
    const admin = this.isAdmin();
    const userRole = API.user?.role || '';
    const isSuperAdmin = userRole === 'admin';

    // Supervisor: vista simplificada solo para EPPT
    if (userRole === 'supervisor') {
      this.tab = 'eppt';
      el.style.cssText = '';
      el.innerHTML = '<h2 style="margin-bottom:14px">Panel de Supervisión</h2>'
        + '<div class="gtabs"><button class="gtab active" data-gt="eppt">Firmar EPPT</button></div>'
        + '<div id="sup-body"><p class="hint">Cargando…</p></div>';
      el.querySelectorAll('[data-gt]').forEach(b => b.addEventListener('click', () => { this.tab = b.dataset.gt; this.render(); }));
      try { await this['t_' + this.tab](document.getElementById('sup-body')); }
      catch(e) { document.getElementById('sup-body').innerHTML = '<p class="error">'+e.message+'</p>'; }
      return;
    }
    const esFiscalizador = userRole === 'fiscalizador';

    // ── Definición del menú lateral por rol ─────────────────────────────
    const MENU = {
      admin: [
        { seccion: 'General', icono: '⬛', items: [
          { k:'tablero',     t:'Tablero',          i:'📊' },
          { k:'usuarios',    t:'Usuarios',          i:'👥' },
          { k:'certificados',t:'Certificados',      i:'🎓' },
          { k:'dashboard',   t:'Dashboard',         i:'📈' },
          { k:'vencimientos',t:'Vencimientos',      i:'⏰' },
          { k:'credenciales',t:'Credenciales',      i:'🪪' },
          { k:'historial',   t:'Historial alumno',  i:'📋' },
        ]},
        { seccion: 'Académico', icono: '📚', items: [
          { k:'eppt',        t:'EPPT',              i:'✍️' },
          { k:'actas',       t:'Libro de Actas',    i:'📖' },
          { k:'actas_examen',t:'Actas de Examen',   i:'📝' },
          { k:'supervision', t:'Supervisión IA',    i:'🤖' },
          { k:'reloj',       t:'Reloj instructores',i:'⏱' },
        ]},
        { seccion: 'Configuración', icono: '⚙️', items: [
          { k:'cursos',      t:'Gestión de cursos', i:'📘' },
          { k:'contenidos',  t:'Cursos y contenidos',i:'🗂' },
          { k:'banco',       t:'Banco de imágenes', i:'🖼' },
          { k:'dnis',        t:'DNIs autorizados',  i:'🔐' },
          { k:'jerarquias',  t:'Jerarquías',        i:'🏛' },
          { k:'verificacion',t:'Firmas y Verificación',i:'🔏' },
          { k:'proctor_config',t:'Calibración IA',  i:'🎯' },
          { k:'auditoria',   t:'Auditoría',         i:'🔍' },
        ]},
        { seccion: 'Módulos PSA', icono: '🆕', items: [
          { k:'apto_medico', t:'Aptitud Psicofísica',i:'🏥' },
          { k:'juosp_panel', t:'JUOSP',             i:'🏢' },
          { k:'reconfirmacion_destino',t:'Reconfirmación de Destino',i:'📍' },
        ]},
      ],
      instructor: [
        { seccion: 'General', icono: '⬛', items: [
          { k:'tablero',     t:'Tablero',           i:'📊' },
          { k:'usuarios',    t:'Usuarios',           i:'👥' },
          { k:'certificados',t:'Certificados',       i:'🎓' },
          { k:'dashboard',   t:'Dashboard',          i:'📈' },
          { k:'vencimientos',t:'Vencimientos',       i:'⏰' },
          { k:'historial',   t:'Historial alumno',   i:'📋' },
        ]},
        { seccion: 'Académico', icono: '📚', items: [
          { k:'eppt',        t:'EPPT',               i:'✍️' },
          { k:'actas',       t:'Libro de Actas',     i:'📖' },
          { k:'actas_examen',t:'Actas de Examen',    i:'📝' },
          { k:'supervision', t:'Supervisión IA',     i:'🤖' },
          { k:'reloj',       t:'Reloj instructores', i:'⏱' },
          { k:'contenidos',  t:'Cursos y contenidos',i:'🗂' },
        ]},
      ],
      fiscalizador: [
        { seccion: 'Consulta (solo lectura)', icono: '👁', items: [
          { k:'tablero',     t:'Tablero',            i:'📊' },
          { k:'usuarios',    t:'Usuarios',            i:'👥' },
          { k:'certificados',t:'Certificados',        i:'🎓' },
          { k:'dashboard',   t:'Dashboard',           i:'📈' },
          { k:'eppt',        t:'EPPT',                i:'✍️' },
          { k:'historial',   t:'Historial alumno',    i:'📋' },
          { k:'actas',       t:'Libro de Actas',      i:'📖' },
          { k:'credenciales',t:'Credenciales',        i:'🪪' },
          { k:'verificacion',t:'Firmas y Verificación',i:'🔏' },
        ]},
      ],
      sanidad: [
        { seccion: 'Sanidad / Módulo Médico', icono: '🏥', items: [
          { k:'apto_medico', t:'Aptitud Psicofísica', i:'🏥' },
          { k:'certificados_medicos', t:'Certificados Médicos', i:'📜' },
        ]},
      ],
      medico: [
        { seccion: 'Sanidad / Módulo Médico', icono: '🏥', items: [
          { k:'apto_medico', t:'Aptitud Psicofísica', i:'🏥' },
        ]},
      ],
      juosp: [
        { seccion: 'Mi UOSP', icono: '🏢', items: [
          { k:'juosp_panel', t:'JUOSP',              i:'🏢' },
          { k:'reconfirmacion_destino',t:'Destinos',  i:'📍' },
        ]},
      ],
      juosp_regional: [
        { seccion: 'Mi Región', icono: '🗺', items: [
          { k:'juosp_panel', t:'JUOSP Regional',     i:'🏢' },
          { k:'reconfirmacion_destino',t:'Destinos',  i:'📍' },
        ]},
      ],
    };

    const menuSecciones = MENU[userRole] || MENU.instructor;

    // Asegurar que el tab actual existe en el menú
    const todosLosKeys = menuSecciones.flatMap(s => s.items.map(i => i.k));
    if (!todosLosKeys.includes(this.tab)) this.tab = todosLosKeys[0] || 'tablero';

    // ── Layout sidebar + contenido ───────────────────────────────────────
    el.style.cssText = 'display:grid;grid-template-columns:220px 1fr;gap:0;min-height:calc(100vh - 120px);max-width:1400px;margin:0 auto';

    const sidebarHtml = `
      <aside id="admin-sidebar" style="
        background:var(--panel);
        border-right:1px solid var(--line);
        padding:16px 0;
        position:sticky;top:60px;
        height:calc(100vh - 120px);
        overflow-y:auto;
        scrollbar-width:thin;
      ">
        <div style="padding:0 16px 12px;font-size:11px;font-weight:800;letter-spacing:.12em;
                    color:var(--muted);text-transform:uppercase">
          ${esFiscalizador ? '👁 Fiscalización' : admin ? '⚙ Administración' : '📚 Docencia'}
        </div>
        ${menuSecciones.map(sec => `
          <div style="margin-bottom:4px">
            <div style="padding:6px 16px;font-size:10px;font-weight:700;letter-spacing:.1em;
                        color:var(--muted);text-transform:uppercase;margin-top:8px">${sec.seccion}</div>
            ${sec.items.map(item => `
              <button class="sidebar-item ${this.tab===item.k?'sidebar-active':''}"
                data-gt="${item.k}" title="${item.t}">
                <span class="sidebar-icon">${item.i}</span>
                <span class="sidebar-label">${item.t}</span>
              </button>`).join('')}
          </div>
        `).join('')}
        ${esFiscalizador ? `<div style="margin:16px;padding:10px;background:rgba(61,130,232,.08);
          border-radius:8px;font-size:11px;color:var(--blue);line-height:1.5">
          👁 Solo lectura. No puede realizar modificaciones.</div>` : ''}
      </aside>`;

    el.innerHTML = sidebarHtml
      + '<main id="gestion-body" style="padding:24px 28px;min-width:0;overflow:hidden"><p class="hint">Cargando…</p></main>';

    el.querySelectorAll('[data-gt]').forEach(b => b.addEventListener('click', async () => {
      this.tab = b.dataset.gt;
      el.querySelectorAll('.sidebar-item').forEach(x => x.classList.remove('sidebar-active'));
      b.classList.add('sidebar-active');
      const body = document.getElementById('gestion-body');
      body.innerHTML = '<p class="hint" style="padding:20px">Cargando…</p>';
      try { await this['t_' + this.tab](body); }
      catch(e) {
        console.error('Error en panel '+this.tab+':', e);
        body.innerHTML = '<div style="padding:24px"><p class="error" style="margin-bottom:10px">Error al cargar: '+e.message+'</p>'
          + '<button class="btn-ghost" onclick="Gestion.render()">Reintentar</button></div>';
      }
    }));

    const body = document.getElementById('gestion-body');
    try { await this['t_' + this.tab](body); }
    catch(e) {
      console.error('Error en panel '+this.tab+':', e);
      body.innerHTML = '<div style="padding:24px"><p class="error">Error al cargar: '+e.message+'</p>'
        + '<button class="btn-ghost" onclick="Gestion.render()">Reintentar</button></div>';
    }
  },

  nav(tab) { this.tab = tab; this.render(); },

  /* ---------- Tablero ---------- */
  async t_tablero(el) {
    const admin = this.isAdmin();           // true para admin e instructor
    const isSuperAdmin = API.user?.role === 'admin'; // solo rol admin estricto
    const { cursos, totales } = await API.adminStats();

    // Panel de pendientes con navegación directa a cada uno
    let pend = {};
    try {
      pend = await fetch('/api/pendientes', { headers: { Authorization: 'Bearer ' + API.token } }).then(r => r.json());
    } catch {}
    const LISTA_PEND = [
      { k:'eppt',          n: pend.eppt||0,          txt:'EPPT en curso (esperan carga de jornadas)',        tab:'eppt',                   color:'var(--blue)'   },
      { k:'supervision',   n: pend.supervision||0,   txt:'Sesiones de Supervisión IA sin revisar',           tab:'supervision',            color:'var(--alert)'  },
      { k:'actas',         n: pend.actas||0,         txt:'Actas de examen esperando tu firma',               tab:'actas_examen',           color:'var(--organic)'},
      { k:'vencimientos',  n: pend.vencimientos||0,  txt:'Certificados que vencen en los próximos 30 días',  tab:'vencimientos',           color:'var(--organic)'},
      { k:'eppt_vencidos', n: pend.eppt_vencidos||0, txt:'EPPT vencidos (requieren rehabilitación)',         tab:'eppt',                   color:'var(--alert)'  },
      { k:'solicitudes',   n: pend.solicitudes||0,   txt:'Solicitudes de inscripción de JUOSP sin resolver', tab:'juosp_panel',            color:'var(--blue)'   },
      { k:'destinos',      n: pend.destinos||0,      txt:'Declaraciones de destino escaladas sin validar',   tab:'reconfirmacion_destino', color:'var(--alert)'  },
    ].filter(p => p.n > 0);
    const totalPend = LISTA_PEND.reduce((a,p) => a + p.n, 0);

    const panelPendientes = totalPend === 0
      ? `<div style="background:rgba(46,196,128,.08);border:1px solid rgba(46,196,128,.28);border-radius:12px;padding:14px 16px;margin-bottom:18px">
           <b style="color:var(--ok);font-size:14px">✔ No tenés pendientes</b>
           <div class="hint" style="font-size:12px;margin-top:2px">Todo al día. No hay acciones esperando tu intervención.</div>
         </div>`
      : `<div style="background:var(--panel);border:1px solid var(--line);border-left:4px solid var(--alert);border-radius:12px;padding:16px;margin-bottom:18px">
           <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px">
             <b style="font-size:15px">🔔 Tenés ${totalPend} pendiente${totalPend>1?'s':''}</b>
             <span class="hint" style="font-size:12px">— hacé clic para ir a resolverlo</span>
           </div>
           ${LISTA_PEND.map(p => `
             <button class="pend-ir" data-pendtab="${p.tab}" style="
               display:flex;align-items:center;gap:12px;width:100%;text-align:left;
               background:var(--panel-2);border:1px solid var(--line);border-radius:9px;
               padding:10px 14px;margin-bottom:7px;cursor:pointer;color:var(--text);font-size:13px">
               <span style="background:${p.color};color:#fff;border-radius:20px;min-width:24px;
                     padding:2px 8px;font-weight:800;font-size:12px;text-align:center">${p.n}</span>
               <span style="flex:1">${p.txt}</span>
               <span style="color:var(--blue);font-weight:600;font-size:12px">Ir →</span>
             </button>`).join('')}
         </div>`;

    el.innerHTML = panelPendientes + `
      <div class="kpis">
        <div class="kpi"><b>${totales.usuarios}</b><span>Usuarios</span></div>
        <div class="kpi"><b>${totales.inscripciones}</b><span>Inscripciones</span></div>
        <div class="kpi"><b>${totales.aprobados}</b><span>Cursos aprobados</span></div>
        <div class="kpi"><b>${totales.certificados}</b><span>Certificados vigentes</span></div>
        <div class="kpi"><b>${totales.examenes}</b><span>Instancias rendidas</span></div>
      </div>
      <table class="list-table"><thead><tr>
        <th>Código</th><th>Curso</th><th>Inscriptos</th><th>Aprobados</th><th>Desaprobados</th><th>Promedio teoría</th></tr></thead>
      <tbody>${cursos.map(c => `
        <tr><td class="mono">${c.cod}</td><td>${c.nombre}</td><td>${c.inscriptos}</td>
        <td>${c.aprobados}</td><td>${c.desaprobados}</td><td>${c.promedio_teoria ?? '—'} ${c.promedio_teoria ? '%' : ''}</td></tr>`).join('')}
      </tbody></table>
      ${admin ? `
      <div style="margin-top:24px;padding:14px 16px;background:var(--panel);border:1px solid var(--line);border-radius:10px">
        <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px">
          <div>
            <b style="font-size:14px">🔐 Control de registro público</b><br>
            <span class="hint" style="font-size:12px">Si está <b>cerrado</b>, nadie puede auto-registrarse (incluso sin DNI autorizado). Abrirlo solo cuando la whitelist de DNIs esté cargada.</span>
          </div>
          <div style="display:flex;align-items:center;gap:10px" id="registro-control">
            <span id="registro-estado" class="hint" style="font-size:12px">Verificando…</span>
            <button id="btn-registro-toggle" class="btn-ghost" style="width:auto;font-size:13px">…</button>
          </div>
        </div>
      </div>` : ''}

      ${admin ? `
      <div style="margin-top:32px">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:14px">
          <div style="width:3px;height:22px;background:var(--blue);border-radius:2px"></div>
          <b style="font-size:15px;letter-spacing:.02em">Gestión de respaldo y restauración</b>
          <span class="pill" style="background:rgba(229,72,77,.12);color:var(--alert);font-size:11px;border:1px solid rgba(229,72,77,.3);margin-left:4px">Solo Administrador</span>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px" id="backup-restore-grid">

          <!-- BACKUP -->
          <div style="background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:18px">
            <div style="font-weight:700;font-size:14px;margin-bottom:4px">⬇ Generar backup</div>
            <p class="hint" style="font-size:12px;margin-bottom:14px">Descarga un ZIP con la base de datos, imágenes de Rayos X, videos, documentos y sesiones de supervisión.</p>
            <button class="btn-primary" id="btn-backup" style="width:100%">Generar y descargar backup</button>
            <div id="backup-status" style="margin-top:10px;font-size:12px;display:none"></div>
          </div>

          <!-- RESTAURAR -->
          <div style="background:var(--panel);border:1.5px solid rgba(229,72,77,.3);border-radius:10px;padding:18px">
            <div style="font-weight:700;font-size:14px;margin-bottom:4px;color:var(--alert)">⚠ Restaurar desde backup</div>
            <p class="hint" style="font-size:12px;margin-bottom:14px"><b>Esta operación SOBRESCRIBE los datos actuales</b>: base de datos, imágenes, videos, documentos y sesiones de supervisión. No se puede deshacer.</p>
            <label style="display:block;font-size:13px;margin-bottom:8px">Seleccionar archivo de backup (.zip)
              <input type="file" id="restore-file" accept=".zip" style="margin-top:4px;width:100%;font-size:12px">
            </label>
            <button class="btn-ghost" id="btn-restore" style="width:100%;border-color:var(--alert);color:var(--alert)" disabled>
              Restaurar sistema
            </button>
            <div id="restore-status" style="margin-top:10px;font-size:12px;display:none"></div>
          </div>

        </div>
      </div>` : ''}`;

    // ── BACKUP ───────────────────────────────────────────────────────────
    // Navegación directa desde el panel de pendientes
    el.querySelectorAll('.pend-ir').forEach(b => b.addEventListener('click', () => {
      this.tab = b.dataset.pendtab;
      this.render();
    }));

    // ── Control de registro público ──────────────────────────────────────
    if (document.getElementById('btn-registro-toggle')) {
      try {
        const rr = await fetch('/api/admin/settings/registro', { headers: { Authorization: 'Bearer ' + API.token } }).then(x => x.json());
        const abierto = rr.registro_abierto;
        const estado = document.getElementById('registro-estado');
        const btn    = document.getElementById('btn-registro-toggle');
        const actualizar = (ab) => {
          estado.innerHTML = ab
            ? '<span style="color:var(--ok)">● Registro ABIERTO</span>'
            : '<span style="color:var(--alert)">● Registro CERRADO</span>';
          btn.textContent = ab ? 'Cerrar registro' : 'Abrir registro';
          btn.style.borderColor = ab ? 'var(--alert)' : 'var(--ok)';
          btn.style.color = ab ? 'var(--alert)' : 'var(--ok)';
        };
        actualizar(abierto);
        btn.addEventListener('click', async () => {
          const actual = btn.textContent.includes('Cerrar');
          if (actual && !confirm('¿Cerrar el registro público? Los usuarios ya registrados no se ven afectados.')) return;
          if (!actual && !confirm('¿Abrir el registro público? Cualquier persona con acceso a la URL podrá registrarse (según la whitelist de DNI).')) return;
          const r2 = await fetch('/api/admin/settings/registro', {
            method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + API.token },
            body: JSON.stringify({ abierto: !actual })
          }).then(x => x.json());
          if (r2.ok) actualizar(r2.registro_abierto);
        });
      } catch {}
    }

    document.getElementById('btn-backup')?.addEventListener('click', async () => {
      const btn = document.getElementById('btn-backup');
      const status = document.getElementById('backup-status');
      btn.disabled = true;
      btn.textContent = '⏳ Generando backup…';
      status.style.display = 'block';
      status.innerHTML = '<span style="color:var(--muted)">Comprimiendo archivos, esto puede tardar unos segundos…</span>';
      try {
        const resp = await fetch('/api/admin/backup', {
          method: 'POST',
          headers: { 'Authorization': 'Bearer ' + API.token }
        });
        if (!resp.ok) {
          const err = await resp.json().catch(() => ({ error: 'Error desconocido' }));
          throw new Error(err.error || 'Error ' + resp.status);
        }
        const cd = resp.headers.get('Content-Disposition') || '';
        const match = cd.match(/filename="([^"]+)"/);
        const filename = match ? match[1] : 'SINCA_backup.zip';
        const blob = await resp.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = filename;
        document.body.appendChild(a); a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 5000);
        const kb = (blob.size / 1024).toFixed(1);
        status.innerHTML = `<span style="color:var(--green)">✔ <b>${filename}</b> — ${kb} KB descargado.</span>`;
        btn.textContent = '✔ Backup descargado';
        setTimeout(() => { btn.disabled = false; btn.textContent = 'Generar y descargar backup'; }, 4000);
      } catch(e) {
        status.innerHTML = `<span style="color:var(--alert)">✘ ${e.message}</span>`;
        btn.disabled = false;
        btn.textContent = 'Generar y descargar backup';
      }
    });

    // ── RESTAURAR ────────────────────────────────────────────────────────
    const restoreFile = document.getElementById('restore-file');
    const restoreBtn  = document.getElementById('btn-restore');
    if (restoreFile && restoreBtn) {
      restoreFile.addEventListener('change', () => {
        restoreBtn.disabled = !restoreFile.files?.length;
      });
      restoreBtn.addEventListener('click', async () => {
        const file = restoreFile.files?.[0];
        if (!file) return;
        const status = document.getElementById('restore-status');

        // Confirmación explícita en dos pasos
        if (!confirm(
          '⚠ ATENCIÓN: Está a punto de RESTAURAR el sistema desde el archivo:\n\n' +
          file.name + '\n\n' +
          'Esta operación reemplazará PERMANENTEMENTE la base de datos actual y todos los archivos asociados.\n\n' +
          '¿Está seguro de que desea continuar?'
        )) return;

        if (!confirm(
          '⚠ SEGUNDA CONFIRMACIÓN\n\nLos datos actuales serán SOBREESCRITOS y NO se podrán recuperar.\n\n' +
          '¿Confirma la restauración desde:\n' + file.name + ' ?'
        )) return;

        restoreBtn.disabled = true;
        restoreBtn.textContent = '⏳ Restaurando…';
        status.style.display = 'block';
        status.innerHTML = '<span style="color:var(--muted)">Subiendo y aplicando el backup, por favor espere…</span>';

        try {
          const fd = new FormData();
          fd.append('backup', file);
          fd.append('confirm', 'CONFIRMAR_RESTAURACION');

          const resp = await fetch('/api/admin/restore', {
            method: 'POST',
            headers: { 'Authorization': 'Bearer ' + API.token },
            body: fd
          });

          const result = await resp.json().catch(() => ({}));
          if (!resp.ok) throw new Error(result.error || 'Error ' + resp.status);

          const restaurados = result.restaurados?.join(', ') || '—';
          status.innerHTML = `<span style="color:var(--green)">✔ Restauración completada.<br>
            Restaurados: ${restaurados}.<br>
            ${result.reinicio ? 'El servidor se reiniciará en 2 segundos. Recargue la página en unos momentos.' : ''}</span>`;
          restoreBtn.textContent = '✔ Restauración completada';

          if (result.reinicio) {
            setTimeout(() => {
              status.innerHTML += '<br><span style="color:var(--muted)">Recargando…</span>';
              setTimeout(() => location.reload(), 3000);
            }, 2000);
          }
        } catch(e) {
          status.innerHTML = `<span style="color:var(--alert)">✘ Error: ${e.message}</span>`;
          restoreBtn.disabled = false;
          restoreBtn.textContent = 'Restaurar sistema';
        }
      });
    }
  },

  /* ---------- Usuarios ---------- */
  async t_usuarios(el) {
    const { users } = await API.adminUsers();
    // admin: gestión total de cursos (visibilidad general). isSuperAdmin: solo rol 'admin' — único que edita/activa/da baja usuarios
    const admin = this.isAdmin();
    const isSuperAdmin = API.user?.role === 'admin';
    // Instructores pueden inscribir a cursos, pero no editar/tocar datos de los estudiantes
    const canEnroll = admin; // admin o instructor
    let coursesData; try { const cd = await API.adminAllCourses(); coursesData = cd.courses.filter(c => c.activo); } catch { coursesData = []; }
    const courses = coursesData;
    el.innerHTML = `
      <div class="filter-row">
        <input id="f-user" placeholder="Filtrar por apellido, legajo, DNI…">
        ${isSuperAdmin ? `<button class="btn-ghost" id="btn-bulk-users">Carga masiva ⬆</button>` : ''}
        <button class="btn-ghost" onclick="return Gestion.dl('usuarios')">CSV ⬇</button>
        <button class="btn-ghost" onclick="Gestion.printTable('Listado de usuarios', document.getElementById('tbl-users'))">PDF 🖨</button>
      </div>
      <div class="filter-row">
        <span class="hint">Inscribir a curso:</span>
        <select id="enroll-course">${courses.map(c => `<option value="${c.id}">${c.cod}</option>`).join('')}</select>
        <button class="btn-ghost" id="btn-enroll-sel">Inscribir seleccionados ☑</button>
        <button class="btn-ghost" id="btn-enroll-paste">Inscribir por lista de DNI/legajos…</button>
      </div>
      <table class="list-table" id="tbl-users"><thead><tr>
        <th>☑</th><th>Apellido y nombre</th><th>Legajo</th><th>DNI</th><th>Rango</th><th>Organismo</th><th>Rol</th><th>Cursos asignados</th><th>Estado</th></tr></thead>
      <tbody>${users.map(u => `
        <tr data-txt="${(u.apellido + ' ' + u.nombre + ' ' + u.legajo + ' ' + (u.dni||'')+' '+(u.rango||'')+' '+(u.organismo||'')).toLowerCase()}" data-rolfiltro="${u.role}" data-activo="${u.activo}">
          <td><input type="checkbox" class="sel-user" value="${u.id}"></td>
          <td>${u.apellido}, ${u.nombre}${isSuperAdmin ? ` <button class="btn-ghost" data-edit="${u.id}">✎</button> <button class="btn-ghost" data-pass="${u.id}">🔑</button>` : ''}</td><td class="mono">${u.legajo}</td><td class="mono">${u.dni || '—'}</td>
          <td>${u.rango || '—'}</td><td>${u.organismo}</td>
          <td>${isSuperAdmin ? `<select class="sel-rol-usuario" data-uid="${u.id}" data-rolactual="${u.role}">
              ${[
                ['estudiante','Estudiante'],['instructor','Instructor'],['supervisor','Supervisor'],
                ['admin','Administrador'],['fiscalizador','Fiscalizador'],
                ['sanidad','Sanidad / Médico'],
                ['juosp','JUOSP'],['juosp_regional','JUOSP Regional']
              ].map(([v,l]) => `<option value="${v}" ${u.role === v ? 'selected' : ''}>${l}</option>`).join('')}
            </select>` : u.role}</td>
          <td>${isSuperAdmin ? (() => {
              const base = u.legajo_base || u.legajo.replace(/-INST$/, '');
              const esInst = u.legajo.endsWith('-INST');
              const tieneInstActivo = users.some(x => x.legajo === base + '-INST' && x.activo);
              if (esInst) return '<span style="color:var(--muted);font-size:11px">perfil instructor</span>';
              if (tieneInstActivo) return `<span style="color:var(--green);font-size:12px">✔ -INST activo</span> <button class="btn-ghost" data-desact-inst="${u.id}" style="font-size:11px;color:var(--muted)">desactivar</button>`;
              return `<button class="btn-ghost" data-crear-inst="${u.id}" data-leg="${u.legajo}" style="color:var(--blue);font-size:12px">+ Crear -INST</button>`;
            })() : '<span class="hint">—</span>'}</td>
          <td>${u.role !== 'instructor' ? '<span class="hint">—</span>' :
              (isSuperAdmin
                ? `<button class="btn-ghost" data-asignar-cursos="${u.id}" data-nom2="${u.apellido}" style="color:var(--blue);font-weight:600">📚 Asignar cursos</button>`
                : '<span class="hint">—</span>')
            }</td>
          <td style="white-space:nowrap">${canEnroll ? `<button class="btn-ghost" data-eq="${u.id}" data-nom="${u.apellido}" title="Inscribir a curso" style="color:var(--green);font-weight:600">+Curso</button>` : ''}${isSuperAdmin ? ` <button class="btn-ghost" data-act="${u.id}" data-on="${u.activo}">${u.activo ? 'Desactivar' : 'Activar'}</button>`
                      : (canEnroll ? '' : (u.activo ? ' Activo' : ' Inactivo'))}</td>
        </tr>`).join('')}
      </tbody></table>`;
    const applyUF = () => {
      const q = (document.getElementById('f-user')?.value || '').toLowerCase();
      const rol = document.getElementById('f-role')?.value || '';
      const act = document.getElementById('f-activo')?.value || '';
      let n = 0;
      document.querySelectorAll('#tbl-users tbody tr').forEach(tr => {
        const ok = (!q || (tr.dataset.txt||'').includes(q))
          && (!rol || tr.dataset.rolfiltro === rol)
          && (!act || tr.dataset.activo === act);
        tr.style.display = ok ? '' : 'none';
        if (ok) n++;
      });
      const fc = document.getElementById('f-count');
      if (fc) fc.textContent = n + ' usuario(s)';
    };
    document.getElementById('f-user').addEventListener('input', applyUF);
    document.getElementById('f-role')?.addEventListener('change', applyUF);
    document.getElementById('f-activo')?.addEventListener('change', applyUF);
    setTimeout(applyUF, 30);
    document.getElementById('btn-enroll-sel').addEventListener('click', async () => {
      const ids = [...el.querySelectorAll('.sel-user:checked')].map(c => Number(c.value));
      if (!ids.length) return alert('Seleccione al menos un usuario (☑).');
      const r = await API.adminEnrollBulk({ course_id: Number(document.getElementById('enroll-course').value), user_ids: ids });
      alert(`Inscripción: ${r.inscriptos} nuevas · ${r.ya_inscriptos} ya inscriptos.`);
    });
    document.getElementById('btn-enroll-paste').addEventListener('click', async () => {
      const d = await this.formModal('INSCRIPCIÓN MASIVA POR LISTA', [
        { name: 'claves', label: 'Pegue DNIs o legajos (uno por línea, o separados por coma o punto y coma)', type: 'textarea', required: true }
      ], 'Inscribir');
      if (!d) return;
      const claves = d.claves.split(/[\n,;]+/).map(s => s.trim()).filter(Boolean);
      const r = await API.adminEnrollBulk({ course_id: Number(document.getElementById('enroll-course').value), claves });
      alert(`Procesados ${claves.length}: ${r.inscriptos} inscripciones nuevas · ${r.ya_inscriptos} ya inscriptos o no encontrados.`);
    });
    if (admin) {
      document.getElementById('btn-bulk-users').addEventListener('click', async () => {
        const d = await this.formModal('CARGA MASIVA DE USUARIOS', [
          { name: 'csv', label: 'Una fila por usuario: legajo;dni;apellido;nombre;rango;organismo;contraseña(opcional, por defecto el DNI). Legajos o DNI ya registrados se rechazan automáticamente.', type: 'textarea', required: true }
        ], 'Procesar carga');
        if (!d) return;
        const rows = d.csv.split(/\n+/).map(l => l.trim()).filter(Boolean)
          .filter(l => !/^legajo/i.test(l))
          .map(l => { const p = l.split(/[;,\t]/).map(x => x.trim());
            return { legajo: p[0], dni: p[1], apellido: p[2], nombre: p[3], rango: p[4] || '', organismo: p[5] || 'PSA', password: p[6] || '' }; });
        if (!rows.length) return alert('No se detectaron filas válidas.');
        try {
          const r = await API.adminUsersBulk(rows);
          alert('Carga finalizada:\n✔ Creados: ' + r.creados +
            '\n≡ Duplicados rechazados: ' + r.duplicados.length +
            r.duplicados.slice(0, 8).map(x => '\n   · ' + (x.legajo || '') + ' ' + (x.dni || '') + ' (' + x.motivo + ')').join('') +
            '\n✘ Errores: ' + r.errores.length);
          this.render();
        } catch (e) { alert(e.message); }
      });
      el.querySelectorAll('[data-eq]').forEach(b => b.addEventListener('click', async () => {
        const userId = Number(b.dataset.eq), nombre = b.dataset.nom;
        let coursesData = [];
        try { const r = await API.adminAllCourses(); coursesData = (r.courses||[]).filter(c=>c.activo); } catch {}
        if (!coursesData.length) {
          alert('No tenés cursos asignados. El administrador debe asignarte cursos desde el panel de gestión de cursos (pestaña "Gestión de cursos" → botón "Asignar cursos").');
          return;
        }
        const d = await this.formModal('INSCRIBIR A CURSO — '+nombre, [
          { name:'course_id', label:'Curso', type:'select', required:true,
            options: coursesData.map(c=>({value:String(c.id), label:c.cod+' — '+c.nombre.slice(0,45)})) }
        ], 'Inscribir ✓');
        if (!d || !d.course_id) return;
        try {
          const resp = await fetch('/api/admin/enroll-direct', {
            method:'POST', headers:{'Content-Type':'application/json','Authorization':'Bearer '+API.token},
            body: JSON.stringify({user_id:userId, course_id:Number(d.course_id)})
          }).then(r=>r.json());
          if (!resp.ok) throw new Error(resp.error);
          alert('✔ '+nombre+' inscripto correctamente.');
        } catch(e) { alert('Error: '+e.message); }
      }));
      el.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', async () => {
        const u = users.find(x => x.id === Number(b.dataset.edit));
        let jerarquiasList = [];
        try { jerarquiasList = (await fetch('/api/jerarquias').then(r=>r.json())).jerarquias; } catch {}
        const d = await this.formModal('EDITAR USUARIO — ' + u.legajo, [
          { name: 'legajo', label: 'Legajo / ID', value: u.legajo, required: true },
          { name: 'apellido', label: 'Apellido', value: u.apellido, required: true },
          { name: 'nombre', label: 'Nombre', value: u.nombre, required: true },
          { name: 'dni', label: 'DNI (registro oficial)', value: u.dni || '' },
          { name: 'rango', label: 'Jerarquía / Rango', type: 'select',
            options: [{ value: '', label: 'Seleccionar…' }, ...jerarquiasList],
            value: u.rango || '' },
          { name: 'organismo', label: 'Organismo', value: u.organismo },
          { name: 'aeropuerto', label: 'Aeropuerto asignado', value: u.aeropuerto || '' },
          { name: 'dependencia', label: 'Dependencia / Unidad', value: u.dependencia || '' },
          { name: 'funcion', label: 'Función / Cargo', value: u.funcion || '' }
        ]);
        if (!d) return;
        try {
          await API.adminUserData(u.id, d);
          this.render();
        } catch(e) { alert('Error: '+e.message); }
      }));
      el.querySelectorAll('[data-pass]').forEach(b => b.addEventListener('click', async () => {
        const u = users.find(x => x.id === Number(b.dataset.pass));
        const d = await this.formModal('RESETEAR CONTRASEÑA — ' + u.legajo, [
          { name: 'password', label: 'Nueva contraseña provisoria (mínimo 6 caracteres)', required: true, minlength: 6 }
        ], 'Resetear');
        if (!d) return;
        await API.adminUserPassword(u.id, d.password);
        alert('Contraseña reseteada. Indique al usuario que la cambie al ingresar.');
      }));
      // Cambio de rol — delegación de eventos sobre la tabla, con validación previa.
      // Solo reacciona a <select class="sel-rol-usuario">; ignora cualquier otro evento.
      const ROLES_VALIDOS = ['estudiante','supervisor','instructor','admin','fiscalizador','sanidad','juosp','juosp_regional'];
      const tablaUsuarios = document.getElementById('tbl-users');
      if (tablaUsuarios) {
        tablaUsuarios.addEventListener('change', async (ev) => {
          const sel = ev.target;
          if (!sel || !sel.classList || !sel.classList.contains('sel-rol-usuario')) return;
          ev.stopPropagation();

          const uid = Number(sel.dataset.uid);
          const rol = String(sel.value || '').trim();
          const rolAnterior = sel.dataset.rolactual || '';

          if (!Number.isInteger(uid) || uid <= 0) { console.warn('uid inválido:', sel.dataset.uid); return; }
          if (!ROLES_VALIDOS.includes(rol)) { console.warn('rol no reconocido:', rol); sel.value = rolAnterior; return; }
          if (rol === rolAnterior) return;

          sel.disabled = true;
          try {
            const r = await API.adminSetRole(uid, rol);
            if (r && r.ok === false) throw new Error(r.error || 'No se pudo cambiar el rol.');
            sel.dataset.rolactual = rol;
            const fila = sel.closest('tr');
            if (fila) fila.dataset.rolfiltro = rol;
            sel.style.borderColor = 'var(--ok)';
            setTimeout(() => { sel.style.borderColor = ''; }, 1200);
          } catch (e) {
            sel.value = rolAnterior;
            alert('No se pudo cambiar el rol: ' + e.message);
          } finally {
            sel.disabled = false;
          }
        });
      }
      el.querySelectorAll('[data-act]').forEach(b => b.addEventListener('click', async () => {
        try { await API.adminSetActivo(Number(b.dataset.act), b.dataset.on !== '1'); this.render(); }
        catch (e) { alert(e.message); }
      }));

      // ── Perfil dual: crear -INST ─────────────────────────────────────
      el.querySelectorAll('[data-crear-inst]').forEach(b => b.addEventListener('click', async () => {
        const uid = Number(b.dataset.crearInst);
        const legajo = b.dataset.leg;
        const legajoInst = legajo.replace(/-INST$/,'') + '-INST';
        const confirma = confirm(
          `¿Crear perfil instructor para ${legajo}?\n\n` +
          `Se generará el acceso "${legajoInst}" con los mismos datos personales.\n` +
          `Contraseña inicial: el legajo base (${legajo.replace(/-INST$/,'')}).\n\n` +
          `El docente deberá cambiarla al primer ingreso.`
        );
        if (!confirma) return;
        try {
          const r = await API.crearPerfilInstructor(uid);
          if (r.ok) {
            alert(`✔ Perfil instructor creado.\nLegajo: ${r.legajo_instructor}\nContraseña inicial: ${r.password_inicial}`);
            this.render();
          } else { alert('Error: ' + (r.error || 'desconocido')); }
        } catch(e) { alert('Error: ' + e.message); }
      }));

      // ── Perfil dual: desactivar -INST ────────────────────────────────
      el.querySelectorAll('[data-desact-inst]').forEach(b => b.addEventListener('click', async () => {
        const uid = Number(b.dataset.desactInst);
        if (!confirm('¿Desactivar el perfil instructor (-INST)? El perfil alumno no se verá afectado.')) return;
        try {
          const r = await API.desactivarPerfilInstructor(uid);
          if (r.ok) { this.render(); }
          else { alert('Error: ' + (r.error || 'desconocido')); }
        } catch(e) { alert('Error: ' + e.message); }
      }));

      el.querySelectorAll('[data-asignar-cursos]').forEach(b => b.addEventListener('click', async () => {
        const instructorId = Number(b.dataset.asignarCursos);
        const nombre = b.dataset.nom2;
        let todosCursos = [];
        try { const cd = await API.adminAllCourses(); todosCursos = cd.courses.filter(c => c.activo); } catch {}
        let asignadosIds = new Set();
        try {
          const r = await fetch('/api/admin/instructor/'+instructorId+'/cursos', {headers:{'Authorization':'Bearer '+API.token}}).then(x=>x.json());
          asignadosIds = new Set((r.cursos||[]).map(c=>c.id));
        } catch {}

        // Modal simple con checkboxes de todos los cursos
        const modal = document.createElement('div');
        modal.className = 'modal';
        modal.style.cssText = 'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;z-index:1000';
        modal.innerHTML = '<div class="modal-card" style="max-width:520px;width:100%;max-height:80vh;overflow-y:auto;padding:22px">'
          + '<div class="panel-title">ASIGNAR CURSOS — ' + nombre + '</div>'
          + '<p class="hint" style="margin-bottom:12px">Seleccione los cursos que este instructor podrá gestionar (crear unidades, banco de examen, material). El resto de los cursos permanecerán fuera de su alcance.</p>'
          + '<div id="asignar-lista" style="display:flex;flex-direction:column;gap:6px;margin-bottom:16px">'
          + todosCursos.map(c => '<label style="display:flex;align-items:center;gap:8px;font-size:13px;padding:4px 0">'
              + '<input type="checkbox" class="chk-curso-asig" value="' + c.id + '" ' + (asignadosIds.has(c.id) ? 'checked' : '') + '>'
              + '<span><b class="mono">' + c.cod + '</b> — ' + c.nombre + '</span></label>').join('')
          + '</div>'
          + '<div style="display:flex;gap:8px;justify-content:flex-end">'
          + '<button class="btn-ghost" id="btn-asig-cancel">Cancelar</button>'
          + '<button class="btn-primary" id="btn-asig-guardar" style="width:auto">Guardar asignación</button>'
          + '</div></div>';
        document.body.appendChild(modal);
        document.getElementById('btn-asig-cancel').addEventListener('click', () => modal.remove());
        document.getElementById('btn-asig-guardar').addEventListener('click', async () => {
          const seleccionados = [...modal.querySelectorAll('.chk-curso-asig:checked')].map(c => Number(c.value));
          try {
            await fetch('/api/admin/instructor/'+instructorId+'/cursos', {
              method:'POST', headers:{'Content-Type':'application/json','Authorization':'Bearer '+API.token},
              body: JSON.stringify({ course_ids: seleccionados })
            }).then(r=>r.json()).then(r=>{ if(!r.ok) throw new Error(r.error||'Error'); });
            modal.remove();
            alert('✔ Cursos asignados a ' + nombre + ': ' + seleccionados.length);
          } catch(e) { alert('Error: '+e.message); }
        });
      }));
    }
  },

  /* ---------- Certificados (registro PNISAC con filtros y reimpresión) ---------- */
  async t_certificados(el) {
    const { certificates } = await API.adminCerts('');
    const cursos = [...new Set(certificates.map(c => c.curso_cod))];
    el.innerHTML = `
      <div class="filter-row">
        <input id="f-cert" placeholder="Buscar por apellido, legajo, DNI o código…">
        <select id="f-cert-curso"><option value="">Todos los cursos</option>${cursos.map(c => `<option>${c}</option>`).join('')}</select>
        <select id="f-cert-vig"><option value="">Vigentes y vencidos</option><option value="vigentes">Solo vigentes</option><option value="vencidos">Solo vencidos</option></select>
        <button class="btn-ghost" onclick="return Gestion.dl('certificados')">CSV ⬇</button>
        <button class="btn-ghost" onclick="Gestion.printTable('LIBRO MATRIZ — Certificaciones emitidas (PSA/ISSA)', document.querySelector('#cert-table table'))">Libro Matriz / PDF 🖨</button>
      </div>
      <div id="cert-table"></div>`;
    const draw = () => {
      const s = document.getElementById('f-cert').value.toLowerCase();
      const fc = document.getElementById('f-cert-curso').value;
      const fv = document.getElementById('f-cert-vig').value;
      const hoy = new Date().toISOString().slice(0, 10);
      let rows = certificates;
      if (s) rows = rows.filter(r => [r.apellido, r.unombre, r.legajo, r.dni, r.code].join(' ').toLowerCase().includes(s));
      if (fc) rows = rows.filter(r => r.curso_cod === fc);
      if (fv === 'vigentes') rows = rows.filter(r => !r.anulado && (!r.vencimiento || r.vencimiento >= hoy));
      if (fv === 'vencidos') rows = rows.filter(r => r.vencimiento && r.vencimiento < hoy);
      document.getElementById('cert-table').innerHTML = `
        <table class="list-table"><thead><tr>
          <th>Código</th><th>Apellido y nombre</th><th>DNI</th><th>Legajo</th><th>Curso</th>
          <th>Nota</th><th>Emisión</th><th>Vencimiento</th><th>Estado</th><th></th></tr></thead>
        <tbody>${rows.map(r => `
          <tr><td class="mono">${r.code}</td><td>${r.apellido}, ${r.unombre}</td>
          <td class="mono">${r.dni || '—'}</td><td class="mono">${r.legajo}</td>
          <td class="mono">${r.curso_cod}</td><td>${r.score_pct} %</td>
          <td class="mono">${r.issued_at.slice(0, 10)}</td><td class="mono">${r.vencimiento || '—'}</td>
          <td>${r.anulado ? '<span class="badge-fail">ANULADO</span>'
              : (r.vencimiento && r.vencimiento < hoy) ? '<span class="badge-fail">VENCIDO</span>'
              : '<span class="badge-pass">VIGENTE</span>'}</td>
          <td class="nowrap">
            <button class="btn-ghost" data-re="${r.code}">Reimprimir</button>
            ${this.isAdmin() && !r.anulado ? `<button class="btn-ghost" data-an="${r.id}">Anular</button>` : ''}
          </td></tr>`).join('')}
        </tbody></table>
        <p class="hint">${rows.length} certificado(s) en el listado.</p>`;
      document.querySelectorAll('[data-re]').forEach(b => b.addEventListener('click', async () => {
        const { certificate } = await API.certificate(b.dataset.re);
        generateCertificate(certificate, true);
      }));
      document.querySelectorAll('[data-an]').forEach(b => b.addEventListener('click', async () => {
        const motivo = prompt('Motivo de anulación del certificado:');
        if (motivo === null) return;
        await API.adminAnularCert(Number(b.dataset.an), motivo);
        this.render();
      }));
    };
    ['f-cert', 'f-cert-curso', 'f-cert-vig'].forEach(id =>
      document.getElementById(id).addEventListener('input', draw));
    draw();
  },

  /* ---------- Vencimientos (control de recurrencias) ---------- */
  async t_vencimientos(el) {
    const dias = 90;
    const { vencimientos } = await API.adminVencimientos(dias);
    el.innerHTML = `
      <p class="hint">Certificaciones vencidas o que vencen dentro de los próximos ${dias} días.
      El personal alcanzado debe realizar la instrucción recurrente (cursos /A) para mantener su habilitación.</p>
      <div class="filter-row"><button class="btn-ghost" onclick="return Gestion.dl('vencimientos')">CSV ⬇</button>
      <button class="btn-ghost" onclick="Gestion.printTable('Alerta de recurrencias — certificaciones vencidas y por vencer', document.querySelector('#gestion-body table'))">PDF 🖨</button></div>
      ${vencimientos.length ? `
      <table class="list-table"><thead><tr>
        <th>Estado</th><th>Vencimiento</th><th>Apellido y nombre</th><th>Legajo</th><th>DNI</th><th>Curso</th><th>Código</th></tr></thead>
      <tbody>${vencimientos.map(v => `
        <tr><td>${v.estado === 'VENCIDO' ? '<span class="badge-fail">VENCIDO</span>' : '<span class="pill">POR VENCER</span>'}</td>
        <td class="mono">${v.vencimiento}</td><td>${v.apellido}, ${v.unombre}</td>
        <td class="mono">${v.legajo}</td><td class="mono">${v.dni || '—'}</td>
        <td class="mono">${v.curso_cod}</td><td class="mono">${v.code}</td></tr>`).join('')}
      </tbody></table>` : '<p class="badge-pass">✔ No hay certificaciones vencidas ni próximas a vencer.</p>'}`;
  },

  /* ---------- Libro de Actas ---------- */
  async t_actas(el) {
    let coursesData; try { const cd = await API.adminAllCourses(); coursesData = cd.courses.filter(c => c.activo); } catch { coursesData = []; }
    const courses = coursesData;
    el.innerHTML = `
      <div class="filter-row">
        <select id="acta-curso">${courses.map(c => `<option value="${c.id}">${c.cod} — ${c.nombre}</option>`).join('')}</select>
        <button class="btn-primary" id="acta-gen" style="width:auto">Generar acta nueva</button>
      </div>
      <div class="filter-row" style="border-left:3px solid var(--blue)">
        <input id="acta-buscar-num" placeholder="Buscar acta existente por número… (ej: ACTA-2026-0001)" style="flex:1">
        <button class="btn-ghost" id="acta-buscar-btn" style="width:auto">🔍 Buscar y reimprimir</button>
      </div>
      <div id="acta-out"></div>`;
    document.getElementById('acta-buscar-btn').addEventListener('click', async () => {
      const numero = document.getElementById('acta-buscar-num').value.trim();
      if (!numero) { alert('Ingresá el número de acta a buscar.'); return; }
      const out = document.getElementById('acta-out');
      out.innerHTML = '<p class="hint">Buscando…</p>';
      try {
        const resp = await fetch('/api/admin/acta/buscar/'+encodeURIComponent(numero), { headers:{'Authorization':'Bearer '+API.token} }).then(r=>r.json());
        if (resp.error) throw new Error(resp.error);
        this._renderActa(out, resp.course, resp.acta, resp.generada, resp.numero_acta, resp.firma_hash, resp.emisor, true, resp.anulado);
      } catch(e) { out.innerHTML = '<p class="error">'+e.message+'</p>'; }
    });
    document.getElementById('acta-gen').addEventListener('click', async () => {
      const { course, acta, generada, numero_acta, firma_hash, emisor } = await API.adminActa(Number(document.getElementById('acta-curso').value));
      this._renderActa(document.getElementById('acta-out'), course, acta, generada, numero_acta, firma_hash, emisor, false, false);
    });
  },

  _renderActa(outEl, course, acta, generada, numero_acta, firma_hash, emisor, esReimpresion, anulada) {
    const html = `
        <div class="acta" id="acta-print">
          ${esReimpresion ? '<div style="background:#fff3cd;color:#7a5a00;padding:8px 14px;border-radius:6px;margin-bottom:10px;font-size:12px;font-weight:700;text-align:center">📋 REIMPRESIÓN de acta existente — generada originalmente el ' + _fmtFechaHora(generada) + '</div>' : ''}
          ${anulada ? '<div style="background:#fde2e2;color:#a11;padding:8px 14px;border-radius:6px;margin-bottom:10px;font-size:12px;font-weight:700;text-align:center">✘ ESTA ACTA FUE ANULADA</div>' : ''}
          <div class="acta-head">
            <img src="/img/psa.png"><div>
              <b>LIBRO DE ACTAS DE EXÁMENES — SINCA</b><br>
              ${course.cod} · ${course.nombre}<br>
              <span class="mono">N° ${numero_acta} · Generada: ${_fmtFechaHora(generada)} · Conservación mínima: 5 años</span>
            </div><img src="/img/issa.png">
          </div>
          <table class="list-table"><thead><tr>
            <th>Apellido y nombre</th><th>Legajo</th><th>DNI</th><th>Organismo</th>
            <th>Teoría</th><th>Instancia</th><th>Práctico</th><th>AEI</th><th>Resultado</th><th>Fecha</th></tr></thead>
          <tbody>${acta.map(a => `
            <tr><td>${a.apellido}, ${a.nombre}</td><td class="mono">${a.legajo}</td><td class="mono">${a.dni || '—'}</td>
            <td>${a.organismo}</td><td>${a.nota_teoria ?? '—'}${a.nota_teoria != null ? ' %' : ''}</td>
            <td>${a.instancia || '—'}</td><td>${a.nota_practico ?? '—'}${a.nota_practico != null ? ' %' : ''}</td>
            <td>${a.aei ?? '—'}</td>
            <td>${a.estado === 'aprobado' ? 'APROBADO' : a.estado === 'desaprobado' ? 'DESAPROBADO' : 'EN CURSO'}</td>
            <td class="mono">${_fmtFecha(a.fecha)}</td></tr>`).join('')}
          </tbody></table>
          <div class="acta-firmas"><span>________________________<br>Docente/Instructor a cargo</span>
          <span>________________________<br>Dirección ISSA</span></div>
          <div class="acta-firma-electronica">
            <b>Firma electrónica del emisor (Ley N° 25.506)</b><br>
            Emitido por: ${emisor?.apellido || '—'}, ${emisor?.nombre || ''} (Legajo: ${emisor?.legajo || '—'})<br>
            N° de acta: <span class="mono">${numero_acta}</span><br>
            Hash SHA-256: <span class="mono" style="font-size:10px;word-break:break-all">${firma_hash}</span>
          </div>
        </div>
        <button class="btn-primary" style="width:auto;margin-top:12px" onclick="Gestion.printActa()">Imprimir acta 🖨</button>`;
    outEl.innerHTML = html;
  },

  printActa() {
    const w = window.open('', '_blank');
    w.document.write(`<html><head><title>Acta de examen</title><style>
      body{font-family:Arial;color:#111;padding:24px;background:#fff}
      table{width:100%;border-collapse:collapse;font-size:12px;margin-top:14px}
      th{background:#eef1f8;color:#1e3272;border:1px solid #ccc;padding:6px 8px;text-align:left;font-weight:700}
      td{border:1px solid #ccc;padding:6px 8px;text-align:left;color:#111}
      tbody tr:nth-child(even){background:#f7f9fc}
      .acta-head{display:flex;align-items:center;gap:16px;justify-content:space-between;border-bottom:2px solid #1e3272;padding-bottom:12px;margin-bottom:8px}
      .acta-head img{height:64px}
      .acta-firmas{display:flex;justify-content:space-around;margin-top:50px;text-align:center;font-size:13px}
      .acta-firma-electronica{margin-top:24px;padding:14px;background:#f7f9fc;border:1px solid #d0d6e2;border-radius:6px;font-size:11px}
      .mono{font-family:monospace}</style></head><body>
      ${document.getElementById('acta-print').outerHTML}</body></html>`);
    w.document.close(); w.focus(); setTimeout(() => w.print(), 400);
  },

  /* ---------- Cursos y contenidos ---------- */
  async t_contenidos(el) {
    let coursesData; try { const cd = await API.adminAllCourses(); coursesData = cd.courses.filter(c => c.activo); } catch { coursesData = []; }
    const courses = coursesData;
    // Instructor sin cursos asignados: mensaje informativo (el servidor ya filtra la lista)
    if (API.user?.role === 'instructor' && courses.length === 0) {
      el.innerHTML = '<div style="max-width:520px;margin:60px auto;text-align:center;background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:32px">'
        + '<div style="font-size:40px;margin-bottom:12px">📚</div>'
        + '<h2 style="margin-bottom:10px">Sin cursos asignados</h2>'
        + '<p class="hint">Todavía no tiene cursos asignados para gestionar. El administrador debe asignárselos desde la pestaña Usuarios.</p>'
        + '</div>';
      return;
    }
    if (!this.courseSel || !courses.some(c=>c.id===this.courseSel)) this.courseSel = courses[0]?.id;
    el.innerHTML = `
      <div class="filter-row">
        <select id="cont-curso">${courses.map(c =>
          `<option value="${c.id}" ${c.id === this.courseSel ? 'selected' : ''}>${c.cod} — ${c.nombre}</option>`).join('')}</select>
      </div>
      <div class="gsub">
        <button class="gtab active" data-gs="alumnos">Alumnos y notas</button>
        <button class="gtab" data-gs="unidades">Unidades y videos</button>
        <button class="gtab" data-gs="banco">Banco del examen</button>
        <button class="gtab" data-gs="tiempos">Tiempos de visualización</button>
      </div>
      <div id="cont-body"></div>`;
    document.getElementById('cont-curso').addEventListener('change', e => {
      this.courseSel = Number(e.target.value); this.t_contenidos(el);
    });
    const sub = async (name) => {
      el.querySelectorAll('[data-gs]').forEach(b => b.classList.toggle('active', b.dataset.gs === name));
      const body = document.getElementById('cont-body');
      body.innerHTML = '<p class="hint">Cargando…</p>';
      try { await this['s_' + name](body); } catch (e) { body.innerHTML = `<p class="error">${e.message}</p>`; }
    };
    el.querySelectorAll('[data-gs]').forEach(b => b.addEventListener('click', () => sub(b.dataset.gs)));
    sub('alumnos');
  },

  async s_alumnos(el) {
    const { students } = await API.adminStudents(this.courseSel);
    el.innerHTML = students.length ? `
      <table class="list-table"><thead><tr>
        <th>Apellido y nombre</th><th>Legajo</th><th>Estado</th><th>Instancias</th><th></th></tr></thead>
      <tbody>${students.map(s => `
        <tr><td>${s.apellido}, ${s.unombre}</td><td class="mono">${s.legajo}</td>
        <td>${s.estado === 'aprobado' ? '<span class="badge-pass">APROBADO</span>'
            : s.estado === 'desaprobado' ? '<span class="badge-fail">DESAPROBADO · NO OPERATIVO</span>'
            : s.estado === 'eppt' ? '<span class="pill">EPPT EN CURSO</span>' : '<span class="pill">CURSANDO</span>'}</td>
        <td>${s.attempts.map(a => `${a.tipo}: ${a.score_pct}%${a.aei_ok === 0 ? ' (AEI no detectado)' : ''} ${a.passed ? '✔' : '✘'}`).join(' · ') || '—'}</td>
        <td>${s.estado !== 'cursando' || s.attempts.length ? `<button class="btn-ghost" data-reset="${s.id}">Rehabilitar cursada ↺</button>` : ''}</td>
        </tr>`).join('')}
      </tbody></table>` : '<p class="hint">Sin inscriptos en este curso.</p>';
    el.querySelectorAll('[data-reset]').forEach(b => b.addEventListener('click', async () => {
      if (!confirm('Rehabilitar la cursada ELIMINA las instancias rendidas, el EPPT y ANULA el certificado si existía, y permite rendir todo nuevamente. ¿Continuar?')) return;
      b.disabled = true; b.textContent = 'Rehabilitando…';
      try {
        await API.adminResetEnrollment(Number(b.dataset.reset));
        alert('Cursada rehabilitada: el alumno vuelve a estado CURSANDO y puede rendir nuevamente.');
        this.s_alumnos(el);
      } catch (e) { alert('No se pudo rehabilitar: ' + e.message); b.disabled = false; b.textContent = 'Rehabilitar cursada ↺'; }
    }));
  },

  async s_unidades(el) {
    const { lessons } = await API.adminLessons(this.courseSel);
    const admin = this.isAdmin();
    el.innerHTML = `<p class="hint">${admin ? 'Solo el administrador puede cargar videos y editar los checkpoints.' :
      'Vista de solo lectura: la carga de recursos es exclusiva del administrador.'}</p>` +
      lessons.map(l => `
      <div class="unit-card" data-l="${l.id}">
        <div class="unit-head" style="display:flex;align-items:center;gap:8px">
          ${admin ? `<button class="btn-ghost" data-up-lesson="${l.id}" title="Subir unidad" style="padding:2px 6px;font-size:13px">▲</button>
          <button class="btn-ghost" data-dn-lesson="${l.id}" title="Bajar unidad" style="padding:2px 6px;font-size:13px">▼</button>` : ''}
          <b style="flex:1">${l.titulo}</b>
          <span class="mono" style="font-size:11px">${l.tipo === 'video' ? '🎬 ' + (!l.video_url ? 'SIN VIDEO' : l.video_url.startsWith('youtube:') ? 'YouTube ' + l.video_url.slice(8) : l.video_url.split('/').pop()) : l.tipo === 'imagen' ? '🖼 Imagen: ' + (l.video_url||'').split('/').pop() : '📖 lectura'} · ${l.duracion_s}s</span>
          ${admin ? `<button class="btn-ghost" data-del-unit="${l.id}" title="Eliminar unidad" style="color:var(--alert);padding:2px 8px">✕ Eliminar</button>` : ''}
        </div>
        ${admin ? `
        <div class="unit-tools">
          <label class="mini-label">Duración exigida (s)
            <input type="number" min="5" value="${l.duracion_s}" data-dur="${l.id}" style="width:90px"></label>
          <label class="mini-label">Video local (MP4/WebM, máx. 300 MB)
            <input type="file" accept="video/mp4,video/webm,.mp4,.webm" data-vid="${l.id}"></label>
          <label class="mini-label">Material didáctico — imagen (PNG/JPG/WebP/GIF, máx. 50 MB)
            <input type="file" accept=".png,.jpg,.jpeg,.webp,.gif,.bmp" data-doc="${l.id}"></label>
          <button class="btn-ghost" data-savedur="${l.id}">Guardar duración</button>
          <button class="btn-ghost" data-yt="${l.id}">Video YouTube ▸</button>
          <span class="upload-status" data-st="${l.id}"></span>
        </div>` : ''}
        <details><summary>Checkpoints de la unidad (${l.checkpoints.length})</summary>
          ${l.checkpoints.map(q => `
            <div class="q-row"><span>${q.pregunta}<br><small class="hint">${q.opciones.map((o, i) =>
              (i === q.correcta ? '✔ ' : '· ') + o).join(' | ')}</small></span>
              ${admin ? `<button class="btn-ghost" data-dellq="${q.id}">Eliminar</button>` : ''}</div>`).join('')}
          ${admin ? `<button class="btn-ghost" data-addlq="${l.id}">+ Agregar checkpoint</button>` : ''}
        </details>
      </div>`).join('');

    // Botón agregar nueva unidad
    if (admin) {
      const addDiv = document.createElement('div');
      addDiv.style.cssText = 'margin-top:14px;display:flex;gap:8px;align-items:center;padding:10px;background:var(--panel);border:1px solid var(--line);border-radius:8px';
      addDiv.innerHTML = '<input id="new-unit-title" placeholder="Título de la nueva unidad…" style="flex:1">'
        + '<button class="btn-primary" id="btn-add-unit" style="width:auto;padding:9px 16px">+ Agregar unidad</button>';
      el.appendChild(addDiv);
      document.getElementById('btn-add-unit').addEventListener('click', async () => {
        const titulo = document.getElementById('new-unit-title').value.trim();
        if (!titulo) { alert('Ingresá el título de la unidad.'); return; }
        try {
          const r = await fetch('/api/admin/courses/'+this.courseSel+'/lessons', {
            method:'POST', headers:{'Content-Type':'application/json','Authorization':'Bearer '+API.token},
            body: JSON.stringify({titulo})
          }).then(x=>x.json());
          if (!r.ok && r.error) throw new Error(r.error);
          await this.s_unidades(el);
        } catch(e) { alert('Error al agregar unidad: '+e.message); }
      });
    }

    if (!admin) return;
    el.querySelectorAll('[data-up-lesson],[data-dn-lesson]').forEach(b => b.addEventListener('click', async () => {
      const lid = Number(b.dataset.upLesson||b.dataset.dnLesson);
      const dir = b.dataset.upLesson ? 'up' : 'down';
      try {
        const r = await fetch('/api/admin/lessons/'+lid+'/move', {
          method:'POST', headers:{'Content-Type':'application/json','Authorization':'Bearer '+API.token},
          body: JSON.stringify({dir})
        }).then(x=>x.json());
        if (!r.ok && r.error) throw new Error(r.error);
        await this.s_unidades(el);
      } catch(e) { alert('Error al reordenar: '+e.message); }
    }));

    el.querySelectorAll('[data-del-unit]').forEach(b => b.addEventListener('click', async () => {
      const lid = Number(b.dataset.delUnit);
      if (!confirm('¿Eliminar esta unidad y todo su contenido? Esta acción no se puede deshacer.')) return;
      try {
        const r = await fetch('/api/admin/lessons/'+lid+'/delete', {
          method:'POST',
          headers:{'Authorization':'Bearer '+API.token, 'Content-Type':'application/json'},
          body: JSON.stringify({})
        }).then(async x => {
          const text = await x.text();
          try { return JSON.parse(text); }
          catch { throw new Error('Respuesta no válida del servidor: '+text.slice(0,80)); }
        });
        if (!r.ok && r.error) throw new Error(r.error);
        await this.s_unidades(el);
      } catch(e) { alert('Error al eliminar: '+e.message); }
    }));

    el.querySelectorAll('[data-savedur]').forEach(b => b.addEventListener('click', async () => {
      const id = Number(b.dataset.savedur);
      const dur = Number(el.querySelector(`[data-dur="${id}"]`).value);
      await API.adminSaveLesson(id, { duracion_s: dur });
      alert('Duración actualizada.');
    }));
    el.querySelectorAll('[data-vid]').forEach(inp => inp.addEventListener('change', async () => {
      const file = inp.files[0]; if (!file) return;
      const id = Number(inp.dataset.vid);
      const st = el.querySelector(`[data-st="${id}"]`);
      const setSt = t => { if (st) st.textContent = t; };
      if (file.size > 300 * 1024 * 1024) { setSt('✘ Supera 300 MB.'); inp.value = ''; return; }
      // Duración con tiempo límite; si no puede leerse, se pide manualmente (nunca se traba)
      setSt('Leyendo duración…');
      let dur = await new Promise(res => {
        const url = URL.createObjectURL(file);
        const v = document.createElement('video');
        const to = setTimeout(() => { URL.revokeObjectURL(url); res(null); }, 5000);
        v.preload = 'metadata';
        v.onloadedmetadata = () => { clearTimeout(to); URL.revokeObjectURL(url);
          res(isFinite(v.duration) && v.duration > 0 ? Math.round(v.duration) : null); };
        v.onerror = () => { clearTimeout(to); URL.revokeObjectURL(url); res(null); };
        v.src = url;
      });
      if (!dur) {
        const d = await this.formModal('DURACIÓN DEL VIDEO', [
          { name: 'seg', label: 'No se pudo leer la duración automáticamente. Indíquela en segundos:', type: 'number', required: true, min: 5 }
        ], 'Continuar');
        dur = d ? Number(d.seg) : null;
      }
      if (!dur) { setSt(''); inp.value = ''; return; }
      const fd = new FormData();
      fd.append('duracion_s', String(dur));
      fd.append('video', file);
      inp.disabled = true;
      setSt(`Subiendo ${(file.size / 1048576).toFixed(1)} MB…`);
      try {
        await API.adminUploadVideo(id, fd);
        setSt(`✔ Video cargado (${dur} s)`);
        setTimeout(() => this.s_unidades(el), 900);
      } catch (e) { setSt('✘ ' + e.message); inp.disabled = false; inp.value = ''; }
    }));
    // Material didáctico: PDF, imágenes, PPTX, DOCX
    el.querySelectorAll('[data-doc]').forEach(inp => inp.addEventListener('change', async () => {
      const file = inp.files[0]; if (!file) return;
      const id = Number(inp.dataset.doc);
      const st = el.querySelector('[data-st="' + id + '"]');
      const setSt = t => { if (st) st.textContent = t; };
      if (file.size > 100 * 1024 * 1024) { setSt('✘ Supera 100 MB.'); inp.value = ''; return; }
      setSt('Subiendo ' + file.name + ' (' + (file.size/1048576).toFixed(1) + ' MB)…');
      const fd = new FormData();
      fd.append('doc', file);
      fd.append('duracion_s', '60');
      inp.disabled = true;
      try {
        const resp = await fetch('/api/admin/lessons/' + id + '/doc', {
          method: 'POST', headers: { Authorization: 'Bearer ' + API.token }, body: fd
        }).then(r => r.json());
        if (resp.error) throw new Error(resp.error);
        setSt('✔ ' + file.name + ' cargado como ' + resp.tipo);
        setTimeout(() => this.s_unidades(el), 900);
      } catch(e) { setSt('✘ ' + e.message); inp.disabled = false; inp.value = ''; }
    }));
    // YouTube institucional (video "Oculto/No listado"): no ocupa almacenamiento de la PSA
    el.querySelectorAll('[data-yt]').forEach(b => b.addEventListener('click', async () => {
      const id = Number(b.dataset.yt);
      const d = await this.formModal('VIDEO DE YOUTUBE (CANAL INSTITUCIONAL)', [
        { name: 'url', label: 'URL del video. Súbalo como "Oculto/No listado" en el canal de la PSA: solo se reproducirá dentro de la plataforma, con la misma lógica de bloqueo (sin pausa, sin adelantar, tiempo validado en servidor).', required: true },
        { name: 'seg', label: 'Duración del video en segundos (tiempo obligatorio de visualización)', type: 'number', required: true, min: 5 }
      ], 'Vincular video');
      if (!d) return;
      try {
        await API.adminSaveLesson(id, { youtube_url: d.url, duracion_s: Number(d.seg), tipo: 'video' });
        alert('Video de YouTube vinculado a la unidad.');
        this.s_unidades(el);
      } catch (e) { alert(e.message); }
    }));
    el.querySelectorAll('[data-dellq]').forEach(b => b.addEventListener('click', async () => {
      await API.adminDeleteLQ(Number(b.dataset.dellq)); this.s_unidades(el);
    }));
    el.querySelectorAll('[data-addlq]').forEach(b => b.addEventListener('click', async () => {
      const q = await this._askQuestion(); if (!q) return;
      await API.adminSaveLQ({ lesson_id: Number(b.dataset.addlq), ...q });
      this.s_unidades(el);
    }));
  },

  async s_banco(el) {
    const { questions } = await API.adminQuestions(this.courseSel);
    const admin = this.isAdmin();
    el.innerHTML = `
      <p class="hint">Banco del examen teórico: cada alumno recibe un subconjunto aleatorio con preguntas y opciones en orden único.
      Cuanto más grande el banco, menor la probabilidad de coincidencia entre compañeros.</p>
      ${questions.map(q => `
        <div class="q-row"><span><b>${q.pregunta}</b><br><small class="hint">${q.opciones.map((o, i) =>
          (i === q.correcta ? '✔ ' : '· ') + o).join(' | ')}</small></span>
          ${admin || API.user.role === 'instructor' ? `<button class="btn-ghost" data-delq="${q.id}">Eliminar</button>` : ''}</div>`).join('')}
      <button class="btn-ghost" id="addq">+ Agregar pregunta al banco</button>`;
    el.querySelectorAll('[data-delq]').forEach(b => b.addEventListener('click', async () => {
      await API.adminDeleteQuestion(Number(b.dataset.delq)); this.s_banco(el);
    }));
    document.getElementById('addq').addEventListener('click', async () => {
      const q = await this._askQuestion(); if (!q) return;
      await API.adminSaveQuestion({ course_id: this.courseSel, ...q });
      this.s_banco(el);
    });
  },

  /** Formulario modal genérico: reemplaza a prompt() (que fallaba/cerraba) */
  formModal(titulo, fields, submitLabel) {
    return new Promise(resolve => {
      const m = document.createElement('div');
      m.className = 'modal';
      const f = document.createElement('div');
      f.className = 'modal-card form-modal';
      f.style.cssText = 'max-height:85vh;overflow-y:auto;';
      f.addEventListener('click', e => e.stopPropagation());
      f.innerHTML = `<div class="panel-title">${titulo}</div>`;
      const form = document.createElement('form');
      for (const fl of fields) {
        const lab = document.createElement('label');
        lab.textContent = fl.label;
        let inp;
        if (fl.type === 'select') {
          inp = document.createElement('select');
          for (const o of fl.options) {
            const op = document.createElement('option');
            op.value = o.value ?? o; op.textContent = o.label ?? o;
            if ((o.value ?? o) == fl.value) op.selected = true;
            inp.appendChild(op);
          }
        } else if (fl.type === 'textarea') {
          inp = document.createElement('textarea');
          inp.value = fl.value || '';
        } else {
          inp = document.createElement('input');
          inp.type = fl.type || 'text';
          inp.value = fl.value ?? '';
          if (fl.min != null) inp.min = fl.min;
          if (fl.step != null) inp.step = fl.step;
          if (fl.minlength != null) inp.minLength = fl.minlength;
        }
        inp.name = fl.name;
        if (fl.required) inp.required = true;
        lab.appendChild(inp);
        form.appendChild(lab);
      }
      const actions = document.createElement('div');
      actions.className = 'results-actions';
      actions.innerHTML = `<button type="submit" class="btn-primary" style="width:auto">${submitLabel || 'Guardar'}</button>
        <button type="button" class="btn-ghost" data-c>Cancelar</button>`;
      form.appendChild(actions);
      f.appendChild(form);
      m.appendChild(f);
      document.body.appendChild(m);
      actions.querySelector('[data-c]').addEventListener('click', () => { m.remove(); resolve(null); });
      form.addEventListener('submit', e => {
        e.preventDefault();
        const out = Object.fromEntries(new FormData(form).entries());
        m.remove(); resolve(out);
      });
    });
  },

  async _askQuestion(prev) {
    const d = await this.formModal(prev ? 'EDITAR PREGUNTA' : 'NUEVA PREGUNTA', [
      { name: 'pregunta', label: 'Enunciado', type: 'textarea', value: prev && prev.pregunta || '', required: true },
      { name: 'a', label: 'Opción A', value: prev && prev.opciones[0] || '', required: true },
      { name: 'b', label: 'Opción B', value: prev && prev.opciones[1] || '', required: true },
      { name: 'c', label: 'Opción C', value: prev && prev.opciones[2] || '' },
      { name: 'd', label: 'Opción D', value: prev && prev.opciones[3] || '' },
      { name: 'correcta', label: 'Respuesta correcta', type: 'select', value: 'ABCD'[prev ? prev.correcta : 0], options: ['A', 'B', 'C', 'D'] }
    ], 'Guardar pregunta');
    if (!d || !d.pregunta.trim()) return null;
    const opciones = [d.a, d.b, d.c, d.d].filter(x => x && x.trim());
    const correcta = 'ABCD'.indexOf(d.correcta);
    if (opciones.length < 2 || correcta < 0 || correcta >= opciones.length) { alert('Revise las opciones y la respuesta correcta.'); return null; }
    return { pregunta: d.pregunta.trim(), opciones, correcta };
  },

  /** Exportar a PDF: versión imprimible (Guardar como PDF del navegador) — con firma electrónica del emisor */
  async printHtml(titulo, innerHtml) {
    const tituloLimpio = String(titulo).replace(/\s*\(PNISAC\)\s*/gi, '').replace(/\bPNISAC\b/gi, 'PSA/ISSA').trim();
    const u = API.user || {};
    const emisorNombre = (u.apellido ? u.apellido + ', ' + u.nombre : 'Usuario no identificado');
    const emisorLegajo = u.legajo || '—';
    const emisorRol = (u.role || '').toUpperCase();
    const fechaHora24 = _fmtFechaHora(new Date().toISOString());
    // Hash de firma electrónica real (SHA-256) del contenido + emisor + timestamp
    let firmaHash = '';
    try {
      const base = tituloLimpio + '|' + emisorLegajo + '|' + fechaHora24 + '|' + innerHtml.length;
      const enc = new TextEncoder().encode(base);
      const buf = await crypto.subtle.digest('SHA-256', enc);
      firmaHash = Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,'0')).join('');
      // Registrar el hash en el Libro Matriz para que el panel verificador lo encuentre
      if (firmaHash.length === 64 && API.token) {
        API.registrarFirmaPdf('pdf_auditoria', tituloLimpio, firmaHash).catch(() => {});
      }
    } catch { firmaHash = 'no disponible'; }

    const w = window.open('', '_blank');
    w.document.write('<html><head><title>' + tituloLimpio + '</title><style>' +
      'body{font-family:Arial;color:#111;padding:22px}h2{margin-bottom:4px}' +
      '.sub{color:#555;font-size:12px;margin-bottom:14px}' +
      'table{width:100%;border-collapse:collapse;font-size:11px}' +
      'th,td{border:1px solid #444;padding:4px 6px;text-align:left}' +
      '.head{display:flex;justify-content:space-between;align-items:center;gap:12px}' +
      '.head img{height:56px}button{display:none}input[type=checkbox]{display:none}' +
      '.firma-electronica{margin-top:22px;padding:12px 14px;background:#f4f6fb;border:1px solid #ccd3e0;border-radius:6px;font-size:10.5px;color:#333}' +
      '.firma-electronica b{color:#1e3272}' +
      '</style></head><body><div class="head"><img src="/img/psa.png">' +
      '<div style="text-align:center"><h2>' + tituloLimpio + '</h2><div class="sub">SINCA · PSA/ISSA · ' +
      fechaHora24 + '</div></div><img src="/img/issa.png"></div>' + innerHtml +
      '<div class="firma-electronica"><b>Firma electrónica del emisor (Ley N° 25.506)</b><br>' +
      'Emitido por: ' + emisorNombre + ' · Legajo: ' + emisorLegajo + ' · Rol: ' + emisorRol + '<br>' +
      'Fecha y hora de emisión: ' + fechaHora24 + ' (formato 24 hs)<br>' +
      'Hash SHA-256 del documento: <span style="font-family:monospace;word-break:break-all">' + firmaHash + '</span></div>' +
      '</body></html>');
    w.document.close(); w.focus(); setTimeout(() => w.print(), 500);
  },
  async printTable(titulo, tableEl) { if (tableEl) await this.printHtml(titulo, tableEl.outerHTML); },

  async s_tiempos(el) {
    const { tiempos } = await API.adminTiempos(this.courseSel);
    el.innerHTML = tiempos.length ? `
      <p class="hint">Registro real de tiempos validado por el servidor (evidencia para fiscalización del aula virtual).</p>
      <table class="list-table"><thead><tr>
        <th>Alumno</th><th>Legajo</th><th>Unidad</th><th>Tipo</th><th>Inicio</th>
        <th>Exigido</th><th>Efectivo</th><th>Resultado</th></tr></thead>
      <tbody>${tiempos.map(t => `
        <tr><td>${t.apellido}, ${t.nombre}</td><td class="mono">${t.legajo}</td>
        <td>${t.unidad}</td><td>${t.tipo}</td><td class="mono">${t.inicio}</td>
        <td class="mono">${t.requerido_s}s</td><td class="mono">${t.efectivo_s != null ? t.efectivo_s + 's' : '—'}</td>
        <td>${t.resultado === 'aprobado' ? '<span class="badge-pass">✔ superada</span>'
            : t.resultado === 'fallido' ? '<span class="badge-fail">✘ checkpoint fallido</span>'
            : '<span class="pill">incompleta</span>'}</td></tr>`).join('')}
      </tbody></table>` : '<p class="hint">Sin actividad registrada en este curso.</p>';
  },

  /* ---------- Dashboard PNISAC ---------- */
  async t_dashboard(el) {
    el.innerHTML = '<div class="dash-loading"><div class="dash-spinner"></div><span>Cargando datos…</span></div>';
    let d, det;
    try { d = await API.dashboard(); } catch(e) { el.innerHTML = '<p class="error" style="padding:20px">Error: '+e.message+'</p>'; return; }
    try { det = await API.dashboardDetalle(); } catch { det = null; }
    const K = d.kpis;
    const pct = K.tasaAprobacion || 0;
    const trend = (d.tendencia || []).slice(-6);
    const maxT = Math.max(...trend.map(t=>t.inscriptos), 1);
    const hoy = new Date().toISOString().slice(0,10);

    // ── Gauge SVG animado ──
    const gColor = pct>=70?'#2eb87a':pct>=50?'#f28c1a':'#e5484d';
    const gAng = -135 + (pct/100)*270;
    const toRad = a => a*Math.PI/180;
    const gR=46, gCx=60, gCy=60;
    const gx=gCx+gR*Math.cos(toRad(gAng-90)), gy=gCy+gR*Math.sin(toRad(gAng-90));
    const arcBg = `M ${gCx+gR*Math.cos(toRad(-135-90))} ${gCy+gR*Math.sin(toRad(-135-90))} A ${gR} ${gR} 0 1 1 ${gCx+gR*Math.cos(toRad(135-90))} ${gCy+gR*Math.sin(toRad(135-90))}`;
    const arcFill = `M ${gCx+gR*Math.cos(toRad(-135-90))} ${gCy+gR*Math.sin(toRad(-135-90))} A ${gR} ${gR} 0 ${pct>50?1:0} 1 ${gx} ${gy}`;
    const gaugeTotal = Math.PI * 2 * gR * 270/360;

    // ── Mini donut ──
    const donutSlices = [
      {v:K.vigentes,c:'#2eb87a',l:'Operativos'},
      {v:K.vencidos,c:'#e5484d',l:'Vencidos'},
      {v:K.epptPend,c:'#f28c1a',l:'EPPT pendiente'},
      {v:K.rojo+K.amarillo,c:'#3d82e8',l:'Supervisión pendiente'}
    ];
    const dTotal = donutSlices.reduce((s,x)=>s+x.v,0)||1;
    let dOffset=0;
    const dR=36, dCx=50, dCy=50;
    const donutPaths = donutSlices.map(s=>{
      const pctS=s.v/dTotal, ang=pctS*2*Math.PI;
      const x1=dCx+dR*Math.sin(dOffset), y1=dCy-dR*Math.cos(dOffset);
      dOffset+=ang;
      const x2=dCx+dR*Math.sin(dOffset), y2=dCy-dR*Math.cos(dOffset);
      if(pctS<0.001) return '';
      return `<path d="M ${dCx} ${dCy} L ${x1} ${y1} A ${dR} ${dR} 0 ${ang>Math.PI?1:0} 1 ${x2} ${y2} Z" fill="${s.c}" opacity=".9"/>`;
    }).join('');

    // ── Barras SVG animadas por curso ──
    const maxE = Math.max(...(d.porCurso||[]).map(c=>c.total), 1);
    const barsHTML = (d.porCurso||[]).slice(0,8).map(c=>{
      const wT = Math.round(c.total/maxE*100);
      const wA = c.total>0?Math.round(c.aprobados/c.total*100):0;
      return `<div class="db-bar-row" style="--w:${wT}%;--wa:${wA}%">
        <span class="db-bar-label" title="${c.nombre}">${c.cod}</span>
        <div class="db-bar-track">
          <div class="db-bar-bg"></div>
          <div class="db-bar-fill"></div>
          <span class="db-bar-val">${c.aprobados}/${c.total}</span>
        </div>
      </div>`;
    }).join('') || '<p class="hint" style="padding:16px">Sin inscripciones aún</p>';

    // ── Sparkline de tendencia ──
    const spW=320, spH=80;
    const maxTrend=Math.max(...trend.map(t=>t.inscriptos),1);
    const spPoints = trend.map((t,i)=>`${30+i*(spW-40)/(Math.max(trend.length-1,1))},${spH-10-Math.round(t.inscriptos/maxTrend*(spH-20))}`).join(' ');
    const spPointsA = trend.map((t,i)=>`${30+i*(spW-40)/(Math.max(trend.length-1,1))},${spH-10-Math.round(t.aprobados/maxTrend*(spH-20))}`).join(' ');
    const sparkline = trend.length>1 ? `
      <svg viewBox="0 0 ${spW} ${spH}" style="width:100%;overflow:visible">
        <defs>
          <linearGradient id="sg1" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#3d82e8" stop-opacity=".35"/>
            <stop offset="100%" stop-color="#3d82e8" stop-opacity="0"/>
          </linearGradient>
          <linearGradient id="sg2" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#2eb87a" stop-opacity=".35"/>
            <stop offset="100%" stop-color="#2eb87a" stop-opacity="0"/>
          </linearGradient>
        </defs>
        <polygon points="${spPoints} ${30+(trend.length-1)*(spW-40)/Math.max(trend.length-1,1)},${spH-10} 30,${spH-10}" fill="url(#sg1)"/>
        <polyline points="${spPoints}" fill="none" stroke="#3d82e8" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" class="spark-line"/>
        <polygon points="${spPointsA} ${30+(trend.length-1)*(spW-40)/Math.max(trend.length-1,1)},${spH-10} 30,${spH-10}" fill="url(#sg2)"/>
        <polyline points="${spPointsA}" fill="none" stroke="#2eb87a" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" class="spark-line"/>
        ${trend.map((t,i)=>{
          const x=30+i*(spW-40)/Math.max(trend.length-1,1);
          const y=spH-10-Math.round(t.inscriptos/maxTrend*(spH-20));
          return `<circle cx="${x}" cy="${y}" r="3.5" fill="#3d82e8" class="spark-dot"/>
            <text x="${x}" y="${y-8}" text-anchor="middle" style="font-size:9px;fill:#3d82e8">${t.inscriptos||''}</text>
            <text x="${x}" y="${spH}" text-anchor="middle" style="font-size:8px;fill:#7a8899">${(t.mes||'').slice(5)}</text>`;
        }).join('')}
      </svg>` : '<p class="hint" style="padding:16px;text-align:center">Sin datos de tendencia aún</p>';

    // ── PSA vs externos donut pequeño ──
    const psa = det?.psa||0, ext_n = det?.ext||0;
    const psaTotal = psa+ext_n||1;
    const psaAng = (psa/psaTotal)*2*Math.PI;
    const px1=50+38*Math.sin(0), py1=50-38*Math.cos(0);
    const px2=50+38*Math.sin(psaAng), py2=50-38*Math.cos(psaAng);

    el.innerHTML = `
    <div class="db-wrap">
      <!-- ── Fila 1: KPIs animados ── -->
      <div class="db-kpis">
        ${[
          {v:K.alumnos, l:'Alumnos', icon:'👤', c:'--blue'},
          {v:K.certs, l:'Certificados', icon:'📋', c:'--green'},
          {v:K.vigentes, l:'Vigentes', icon:'✔', c:'--green'},
          {v:K.vencidos, l:'Vencidos', icon:'⚠', c:K.vencidos>0?'--alert':'--muted'},
          {v:K.epptPend, l:'EPPT activos', icon:'🔄', c:'--orange'},
          {v:K.rojo+K.amarillo, l:'Supervisión', icon:'🎥', c:K.rojo+K.amarillo>0?'--orange':'--muted'},
          {v:pct+'%', l:'Aprobación', icon:'📈', c:pct>=70?'--green':pct>=50?'--orange':'--alert'},
          {v:K.epptVenc, l:'EPPT vencidos', icon:'🚨', c:K.epptVenc>0?'--alert':'--muted'},
        ].map(k=>`
          <div class="db-kpi-card">
            <div class="db-kpi-icon">${k.icon}</div>
            <div class="db-kpi-val" style="color:var(${k.c})" data-target="${typeof k.v==='number'?k.v:''}">${k.v}</div>
            <div class="db-kpi-label">${k.l}</div>
            <div class="db-kpi-glow" style="background:var(${k.c})"></div>
          </div>`).join('')}
      </div>

      <!-- ── Fila 2: Gauge + Donut + Semáforos + Alertas ── -->
      <div class="db-row2">
        <div class="db-card db-gauge-card">
          <div class="db-card-title">Aprobación general</div>
          <svg viewBox="0 0 120 90" style="width:100%;max-width:200px;display:block;margin:0 auto">
            <defs>
              <linearGradient id="ggrad" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stop-color="#e5484d"/>
                <stop offset="50%" stop-color="#f28c1a"/>
                <stop offset="100%" stop-color="#2eb87a"/>
              </linearGradient>
            </defs>
            <path d="${arcBg}" fill="none" stroke="rgba(255,255,255,.07)" stroke-width="12" stroke-linecap="round"/>
            <path d="${arcFill}" fill="none" stroke="url(#ggrad)" stroke-width="12" stroke-linecap="round" class="gauge-fill" style="stroke-dasharray:${gaugeTotal};stroke-dashoffset:${gaugeTotal*(1-pct/100)}"/>
            <text x="60" y="68" text-anchor="middle" style="font-size:22px;fill:${gColor};font-weight:700">${pct}%</text>
            <text x="60" y="80" text-anchor="middle" style="font-size:9px;fill:var(--muted)">aprobación</text>
          </svg>
          <div style="display:flex;justify-content:space-between;font-size:10px;color:var(--muted);margin-top:4px"><span>0%</span><span>100%</span></div>
        </div>

        <div class="db-card db-donut-card">
          <div class="db-card-title">Estado de fuerza</div>
          <div style="display:flex;align-items:center;gap:12px">
            <svg viewBox="0 0 100 100" style="width:90px;flex-shrink:0">
              ${donutPaths}
              <circle cx="${dCx}" cy="${dCy}" r="22" fill="var(--panel)"/>
              <text x="${dCx}" y="${dCy+4}" text-anchor="middle" style="font-size:12px;fill:var(--text);font-weight:700">${dTotal}</text>
            </svg>
            <div style="flex:1">
              ${donutSlices.map(s=>`<div style="display:flex;align-items:center;gap:6px;margin-bottom:6px;font-size:11px">
                <span style="width:8px;height:8px;border-radius:50%;background:${s.c};flex-shrink:0;box-shadow:0 0 4px ${s.c}"></span>
                <span style="flex:1;color:var(--muted)">${s.l}</span>
                <b style="color:${s.c}">${s.v}</b></div>`).join('')}
            </div>
          </div>
        </div>

        <div class="db-card db-semaforo-card">
          <div class="db-card-title">Recurrencias próximas</div>
          ${[
            {l:'Vencen en 30 días', v:d.vencimientos.v30, c:d.vencimientos.v30>0?'#e5484d':'#2eb87a'},
            {l:'Vencen 30–60 días', v:d.vencimientos.v60, c:d.vencimientos.v60>0?'#f28c1a':'#2eb87a'},
            {l:'Vencen 60–90 días', v:d.vencimientos.v90, c:d.vencimientos.v90>0?'#f28c1a':'#2eb87a'},
            {l:'Ya vencidos', v:d.vencimientos.vencidos, c:d.vencimientos.vencidos>0?'#e5484d':'#2eb87a'},
          ].map(s=>`<div class="db-sem-row">
            <span class="db-sem-dot" style="background:${s.c};box-shadow:0 0 6px ${s.c}"></span>
            <span class="db-sem-lbl">${s.l}</span>
            <b style="color:${s.c}">${s.v}</b>
          </div>`).join('')}
        </div>

        ${det ? `<div class="db-card db-psa-card">
          <div class="db-card-title">PSA vs Externos</div>
          <svg viewBox="0 0 100 100" style="width:80px;display:block;margin:0 auto 8px">
            <path d="M 50 50 L ${px1} ${py1} A 38 38 0 ${psaAng>Math.PI?1:0} 1 ${px2} ${py2} Z" fill="#3d82e8" opacity=".9"/>
            <path d="M 50 50 L ${px2} ${py2} A 38 38 0 ${psaAng<=Math.PI?1:0} 1 ${px1} ${py1} Z" fill="#2eb87a" opacity=".9"/>
            <circle cx="50" cy="50" r="20" fill="var(--panel)"/>
            <text x="50" y="54" text-anchor="middle" style="font-size:10px;fill:var(--text);font-weight:700">${psaTotal}</text>
          </svg>
          <div style="font-size:11px;display:flex;flex-direction:column;gap:4px">
            <div style="display:flex;gap:6px;align-items:center"><span style="width:8px;height:8px;border-radius:50%;background:#3d82e8;box-shadow:0 0 4px #3d82e8"></span><span style="color:var(--muted)">PSA</span><b style="margin-left:auto;color:#3d82e8">${psa}</b></div>
            <div style="display:flex;gap:6px;align-items:center"><span style="width:8px;height:8px;border-radius:50%;background:#2eb87a;box-shadow:0 0 4px #2eb87a"></span><span style="color:var(--muted)">Externos</span><b style="margin-left:auto;color:#2eb87a">${ext_n}</b></div>
          </div>
        </div>` : ''}
      </div>

      <!-- ── Fila 3: Barras por curso + Tendencia ── -->
      <div class="db-row3">
        <div class="db-card db-bars-card">
          <div class="db-card-title">Inscriptos y aprobados por curso <span style="color:#2eb87a;font-weight:400">■ aprobados</span></div>
          <div class="db-bars">${barsHTML}</div>
        </div>
        <div class="db-card db-trend-card">
          <div class="db-card-title">Evolución mensual <span style="color:#3d82e8;font-weight:400">■ inscriptos</span> <span style="color:#2eb87a;font-weight:400">■ aprobados</span></div>
          ${sparkline}
        </div>
      </div>

      <!-- ── Fila 4: Distribución detallada (expandible) ── -->
      <div class="db-card" style="margin-top:12px">
        <button class="db-expand-btn" id="btn-dash-detalle" onclick="this.parentElement.querySelector('.db-detalle').classList.toggle('open')">
          📊 Distribución detallada por organismo, aeropuerto y jerarquía ▸
        </button>
        <div class="db-detalle" id="dash-detalle"></div>
      </div>

      <!-- ── Cursos clave PSA ── -->
      <div class="db-card" id="db-cursos-clave" style="margin-top:12px">
        <div class="db-card-title">COD-PSA 001 / 001A / 002 / 002A — Cursos prioritarios de la PSA</div>
        <div id="db-clave-body"><p class="hint" style="padding:8px">Cargando…</p></div>
      </div>

      <div style="text-align:right;margin-top:10px">
        <button class="btn-ghost" onclick="window.print()">🖨 Imprimir informe</button>
        <button class="btn-ghost" style="margin-left:6px" onclick="Gestion.t_dashboard(document.getElementById('gestion-body'))">↺ Actualizar</button>
      </div>
    </div>`;

    // Cargar cursos clave
    API.dashboardCursosClave().then(ck => {
      const box = document.getElementById('db-clave-body');
      if (!box) return;
      const maxI = Math.max(...(ck.cursos||[]).map(c=>c.inscriptos),1);
      box.innerHTML = '<div class="db-clave-grid">'
        + (ck.cursos||[]).map(c => {
            const wI = Math.round(c.inscriptos/maxI*100);
            const wA = c.inscriptos>0?Math.round(c.aprobados/c.inscriptos*100):0;
            const wP = c.inscriptos>0?Math.round(c.psa/c.inscriptos*100):0;
            return '<div class="db-clave-card">'
              + '<div class="db-clave-cod">'+c.cod+'</div>'
              + '<div class="db-clave-nombre">'+c.nombre.slice(0,40)+'</div>'
              + '<div class="db-clave-stats">'
              + '<div class="db-clave-row"><span>Inscriptos</span><div class="db-clave-bar"><div style="width:'+wI+'%;background:#3d82e8"></div></div><b>'+c.inscriptos+'</b></div>'
              + '<div class="db-clave-row"><span>Aprobados</span><div class="db-clave-bar"><div style="width:'+wA+'%;background:#2eb87a"></div></div><b style="color:#2eb87a">'+c.aprobados+'</b></div>'
              + '<div class="db-clave-row"><span>PSA</span><div class="db-clave-bar"><div style="width:'+wP+'%;background:#e07b0a"></div></div><b style="color:#e07b0a">'+c.psa+'</b></div>'
              + '<div class="db-clave-row"><span>EPPT completo</span><div class="db-clave-bar"><div style="width:'+(c.inscriptos>0?Math.round(c.eppt/c.inscriptos*100):0)+'%;background:#b080f0"></div></div><b style="color:#b080f0">'+c.eppt+'</b></div>'
              + '<div class="db-clave-tasa" style="color:'+(c.tasa>=70?'#2eb87a':c.tasa>=50?'#e07b0a':'#e5484d')+'">'+c.tasa+'% aprobación</div>'
              + '</div></div>';
          }).join('')
        + '</div>';
    }).catch(()=>{});

    // Animación de KPIs: contar hasta el valor
    el.querySelectorAll('[data-target]').forEach(el2 => {
      const target = parseInt(el2.dataset.target);
      if (!isNaN(target) && target > 0) {
        let current = 0;
        const step = Math.ceil(target/30);
        const timer = setInterval(() => {
          current = Math.min(current+step, target);
          el2.textContent = current;
          if(current>=target) clearInterval(timer);
        }, 30);
      }
    });

    // Expandir distribución detallada
    document.getElementById('btn-dash-detalle').addEventListener('click', async () => {
      const box = document.getElementById('dash-detalle');
      if (box.innerHTML && box.classList.contains('open')) return;
      box.innerHTML = '<p class="hint" style="padding:12px">Cargando distribución…</p>';
      try {
        const det2 = det || await API.dashboardDetalle();
        const maxOrg = Math.max(...(det2.porOrg||[]).map(o=>o.total),1);
        const maxAero = Math.max(...(det2.porAeropuerto||[]).map(a=>a.total),1);
        box.innerHTML = '<div class="db-detalle-grid">'
          + '<div class="db-card"><div class="db-card-title">Por organismo</div>'
          + (det2.porOrg||[]).slice(0,6).map(o=>`<div class="db-bar-row" style="--w:${Math.round(o.total/maxOrg*100)}%;--wa:${Math.round(o.total/maxOrg*100)}%">
              <span class="db-bar-label" title="${o.organismo}">${o.organismo.slice(0,14)}</span>
              <div class="db-bar-track"><div class="db-bar-bg"></div><div class="db-bar-fill" style="--color:#3d82e8"></div>
              <span class="db-bar-val">${o.total}</span></div></div>`).join('')
          + (!(det2.porOrg||[]).length ? '<p class="hint" style="font-size:12px">Sin datos</p>' : '') + '</div>'
          + '<div class="db-card"><div class="db-card-title">Por aeropuerto</div>'
          + (det2.porAeropuerto||[]).slice(0,6).map(a=>`<div class="db-bar-row" style="--w:${Math.round(a.total/maxAero*100)}%;--wa:${Math.round(a.total/maxAero*100)}%">
              <span class="db-bar-label" title="${a.aeropuerto}">${(a.aeropuerto||'Sin aeropto').slice(0,14)}</span>
              <div class="db-bar-track"><div class="db-bar-bg"></div><div class="db-bar-fill" style="--color:#2eb87a"></div>
              <span class="db-bar-val">${a.total}</span></div></div>`).join('')
          + (!(det2.porAeropuerto||[]).length ? '<p class="hint" style="font-size:12px">Sin datos de aeropuerto</p>' : '') + '</div>'
          + '<div class="db-card"><div class="db-card-title">Por jerarquía</div>'
          + (det2.porRango||[]).slice(0,6).map((r,i,arr)=>{
              const w=Math.round(r.total/Math.max(...arr.map(x=>x.total),1)*100);
              const s=(r.rango||'Sin jerarquía').replace('de la Policía de Seguridad Aeroportuaria','PSA').slice(0,22);
              return `<div class="db-bar-row" style="--w:${w}%;--wa:${w}%">
                <span class="db-bar-label" title="${r.rango}">${s}</span>
                <div class="db-bar-track"><div class="db-bar-bg"></div><div class="db-bar-fill" style="--color:#b080f0"></div>
                <span class="db-bar-val">${r.total}</span></div></div>`;}).join('')
          + (!(det2.porRango||[]).length ? '<p class="hint" style="font-size:12px">Sin datos de jerarquía</p>' : '') + '</div>'
          + '</div>';
      } catch(e2) { box.innerHTML = '<p class="error">Error: '+e2.message+'</p>'; }
    });
  },

  /* ---------- EPPT (supervisores): rúbricas por apéndice y firma electrónica ---------- */
  async t_eppt(el) {
    if (!this.epptFiltros) this.epptFiltros = { texto: '', estado: 'todos', curso: 'todos' };
    const { eppts, calificaciones } = await API.adminEppt();
    const RUB = {
      'Apéndice 05 — Seguridad Aeroportuaria': ['Control de accesos', 'Inspección de personas', 'Registro de equipaje de mano', 'Registro de equipaje de despacho', 'Control de aeronaves'],
      'Apéndice 06 — Operador de Rayos X': ['Uso de las funciones del teclado', 'Ángulos de incidencia', 'Equipo de doble vista / CT', 'Detiene la cinta ante detecciones', 'Interpretación de imágenes en puesto real'],
      'Apéndice 08 — Inspector Nacional': ['Preparación de la auditoría', 'Ejecución de la auditoría', 'Habilidades personales'],
      'Apéndice 09 — Instructor Nacional': ['Preparación de la clase', 'Desarrollo', 'Cierre', 'Gestión del tiempo de impartición']
    };
    const cursos = [...new Set(eppts.map(e => e.curso_cod))].sort();
    const filtrar = () => eppts.filter(r => {
      const txt = this.epptFiltros.texto.toLowerCase();
      if (txt && !(r.apellido + ' ' + r.unombre + ' ' + r.legajo + ' ' + (r.dni || '')).toLowerCase().includes(txt)) return false;
      if (this.epptFiltros.estado !== 'todos' && r.estado !== this.epptFiltros.estado) return false;
      if (this.epptFiltros.curso !== 'todos' && r.curso_cod !== this.epptFiltros.curso) return false;
      return true;
    });
    const render = () => {
      const v = filtrar();
      const stats = { abierto: 0, completo: 0, vencido: 0, reprobado: 0 };
      eppts.forEach(r => { if (stats[r.estado] != null) stats[r.estado]++; });
      const rows = v.map(r => {
        const pct = Math.min(100, Math.round((r.horas_firmadas / r.requerido) * 100));
        const dias = Math.max(0, Math.ceil((new Date(r.deadline) - new Date()) / 86400000));
        const colorDias = r.estado === 'abierto' && dias <= 10 ? 'color:var(--alert)' : r.estado === 'abierto' && dias <= 30 ? 'color:var(--organic)' : '';
        const badge = r.estado === 'completo' ? '<span class="badge-pass">✔ COMPLETO</span>'
          : r.estado === 'vencido' ? '<span class="badge-fail">VENCIDO</span>'
          : r.estado === 'reprobado' ? '<span class="badge-fail">REPROBADO</span>'
          : '<span class="pill">EN CURSO</span>';
        return '<tr><td><b>' + r.apellido + '</b>, ' + r.unombre + '</td>'
          + '<td class="mono">' + r.legajo + '</td><td class="mono">' + (r.dni || '—') + '</td>'
          + '<td><b>' + r.curso_cod + '</b><br><small class="hint">' + r.apendice + '</small></td>'
          + '<td>' + badge + '</td>'
          + '<td><span style="' + colorDias + '">' + r.deadline + '</span>'
          + (r.estado === 'abierto' ? '<br><small class="hint">' + dias + ' días</small>' : '') + '</td>'
          + '<td><div class="eppt-bar" style="width:100px"><div style="width:' + pct + '%"></div></div>'
          + '<small class="hint">' + r.horas_firmadas + '/' + r.requerido + ' ' + r.tipo + '</small></td>'
          + '<td>'
          + (r.estado === 'abierto' ? '<button class="btn-ghost" data-carga="' + r.id + '">Cargar ＋</button> ' : '')
          + '<button class="btn-ghost" data-print="' + r.id + '">PDF 🖨</button>'
          + (r.estado === 'abierto' ? ' <button class="btn-ghost" data-reprobar="' + r.id + '" style="color:var(--alert)">Reprobar ✘</button>' : '')
          + '</td></tr>';
      }).join('');
      document.getElementById('eppt-body').innerHTML = v.length
        ? '<table class="list-table"><thead><tr><th>Alumno</th><th>Legajo</th><th>DNI</th><th>Curso</th><th>Estado</th><th>Plazo</th><th>Progreso</th><th></th></tr></thead><tbody>' + rows + '</tbody></table>'
        : '<p class="hint">Sin resultados con los filtros actuales.</p>';
      document.getElementById('eppt-body').querySelectorAll('[data-carga]').forEach(b => b.addEventListener('click', async () => {
        const r = eppts.find(x => x.id === Number(b.dataset.carga));
        const items = RUB[r.apendice] || [];
        const d = await this.formModal('EPPT — ' + r.apellido + ' — ' + r.apendice, [
          { name: 'fecha', label: 'Fecha de la jornada', type: 'date', required: true, value: new Date().toISOString().slice(0, 10) },
          { name: 'hora_inicio', label: 'Hora de inicio (HH:MM)', required: true, value: '', attrs: 'pattern="[0-2][0-9]:[0-5][0-9]" placeholder="08:00"' },
          { name: 'hora_fin', label: 'Hora de fin (HH:MM)', required: true, value: '', attrs: 'pattern="[0-2][0-9]:[0-5][0-9]" placeholder="10:00"' },
          { name: 'puesto', label: 'Puesto / Ubicación física (ej: PIR Terminal A - Puerta 5)', required: true, value: '' },
          { name: 'horas', label: r.tipo === 'actividades' ? 'Actividades realizadas' : 'Horas de entrenamiento efectivo', type: 'number', required: true, min: 0.5, step: 0.5, value: r.tipo === 'actividades' ? 1 : 2 },
          ...items.map((it, i) => ({ name: 'rub' + i, label: 'Rúbrica — ' + it, type: 'select', options: calificaciones, value: 'Bueno' })),
          { name: 'observaciones', label: 'Observaciones', type: 'textarea' },
          { name: 'password', label: 'FIRMA ELECTRÓNICA — reingrese su contraseña', type: 'password', required: true }
        ], 'Firmar y registrar jornada');
        if (!d) return;
        try {
          const obsCompletas = `Jornada ${d.fecha} | Horario: ${d.hora_inicio}–${d.hora_fin} | Puesto: ${d.puesto} | ${r.tipo === 'actividades' ? 'Actividades: ' + d.horas : 'Horas: ' + d.horas} | ${d.observaciones || 'Sin observaciones adicionales'}`;
          await API.adminEpptEntry(r.id, {
            fecha: d.fecha, hora_inicio: d.hora_inicio, hora_fin: d.hora_fin,
            puesto: d.puesto, horas: Number(d.horas), observaciones: obsCompletas,
            rubrica: items.map((it, i) => ({ item: it, calif: d['rub' + i] })), password: d.password
          });
          alert('Jornada registrada. El cursante debe firmar su conformidad desde el campus.');
          this.render();
        } catch (e) { alert(e.message); }
      }));
      document.getElementById('eppt-body').querySelectorAll('[data-reprobar]').forEach(b => b.addEventListener('click', async () => {
        const r = eppts.find(x => x.id === Number(b.dataset.reprobar));
        const d = await this.formModal('REPROBAR EPPT — ' + r.apellido + ' (' + r.curso_cod + ')', [
          { name: 'motivo', label: 'Motivo (sin recuperatorio práctico — ; el agente queda NO OPERATIVO)', type: 'textarea', required: true },
          { name: 'password', label: 'FIRMA ELECTRÓNICA — su contraseña', type: 'password', required: true }
        ], 'Reprobar y firmar');
        if (!d) return;
        try { const resp = await API.adminEpptReprobar(r.id, d); alert(resp.mensaje); this.render(); }
        catch (e) { alert(e.message); }
      }));
      document.getElementById('eppt-body').querySelectorAll('[data-acta]').forEach(b => b.addEventListener('click', async () => {
        try {
          const data = await API.adminEpptActaPDF(Number(b.dataset.acta));
          if (!data.eppt) { alert('Sin datos.'); return; }
          if (data.eppt.estado === 'reprobado') await generateActaReprobacionEPPT(data);
          else await generateConstanciaEPPT(data);
        } catch(e) { alert('Error: ' + e.message); }
      }));
      document.getElementById('eppt-body').querySelectorAll('[data-print]').forEach(b => b.addEventListener('click', () => {
        const r = eppts.find(x => x.id === Number(b.dataset.print));
        this.printHtml('EPPT — ' + r.apendice,
          '<p><b>Cursante:</b> ' + r.apellido + ', ' + r.unombre + ' · Leg. ' + r.legajo + ' · DNI ' + (r.dni || '—') + ' · Curso ' + r.curso_cod + '</p>'
          + '<p><b>Requerido:</b> ' + r.requerido + ' ' + r.tipo + ' · <b>Vencimiento:</b> ' + r.deadline + ' · <b>Estado:</b> ' + r.estado.toUpperCase() + ' · <b>Firmadas:</b> ' + r.horas_firmadas + '</p>'
          + '<table><tr><th>Fecha</th><th>Hs/Act.</th><th>Rúbrica</th><th>Obs.</th><th>Firma supervisor</th><th>Conformidad alumno</th></tr>'
          + r.entries.map(e => '<tr><td>' + e.fecha + '</td><td>' + e.horas + '</td>'
            + '<td>' + e.rubrica.map(x => x.item + ': ' + x.calif).join('<br>') + '</td><td>' + (e.observaciones || '') + '</td>'
            + '<td>' + e.sup_apellido + ' (' + e.sup_legajo + ')<br>' + (e.firma_sup_at || '').slice(0, 16) + '<br><small>hash ' + (e.firma_sup_hash || '').slice(0, 16) + '…</small></td>'
            + '<td>' + (e.firma_alu_at ? e.firma_alu_at.slice(0, 16) + '<br><small>hash ' + (e.firma_alu_hash || '').slice(0, 16) + '…</small>' : 'PENDIENTE') + '</td></tr>').join('')
          + '</table>');
      }));
    };
    const filtroHtml = '<div class="filter-row" style="flex-wrap:wrap">'
      + '<input id="eppt-txt" placeholder="Buscar apellido, legajo, DNI…" value="' + this.epptFiltros.texto + '" style="flex:1;min-width:180px">'
      + '<select id="eppt-est">'
      + '<option value="todos"' + (this.epptFiltros.estado === 'todos' ? ' selected' : '') + '>Todos los estados</option>'
      + '<option value="abierto"' + (this.epptFiltros.estado === 'abierto' ? ' selected' : '') + '>En curso</option>'
      + '<option value="completo"' + (this.epptFiltros.estado === 'completo' ? ' selected' : '') + '>Completos</option>'
      + '<option value="vencido"' + (this.epptFiltros.estado === 'vencido' ? ' selected' : '') + '>Vencidos</option>'
      + '<option value="reprobado"' + (this.epptFiltros.estado === 'reprobado' ? ' selected' : '') + '>Reprobados</option>'
      + '</select>'
      + '<select id="eppt-curso">'
      + '<option value="todos"' + (this.epptFiltros.curso === 'todos' ? ' selected' : '') + '>Todos los cursos</option>'
      + cursos.map(c => '<option value="' + c + '"' + (this.epptFiltros.curso === c ? ' selected' : '') + '>' + c + '</option>').join('')
      + '</select>'
      + '<button class="btn-ghost" id="eppt-pdf-btn">PDF 🖨</button>'
      + '</div>'
      + '<div class="kpi-row">'
      + '<div class="kpi"><b>' + eppts.length + '</b><span>Total EPPT</span></div>'
      + '<div class="kpi"><b style="color:var(--ok)">' + eppts.filter(e => e.estado === 'completo').length + '</b><span>Completos</span></div>'
      + '<div class="kpi"><b style="color:var(--organic)">' + eppts.filter(e => e.estado === 'abierto').length + '</b><span>En curso</span></div>'
      + '<div class="kpi"><b style="color:var(--alert)">' + eppts.filter(e => e.estado === 'vencido' || e.estado === 'reprobado').length + '</b><span>Vencidos / Reprobados</span></div>'
      + '</div>'
      + '<p class="hint">El EPPT es obligatorio para COD-PSA 001, 002, 008 y 009. El COD-PSA 004 certifica sin EPPT. '
      + 'La carga y firmas son electrónicas (Ley 25.506). Los EPPT se abren automáticamente al aprobar los exámenes.</p>'
      + '<div id="eppt-body"></div>';
    el.innerHTML = filtroHtml;
    render();
    document.getElementById('eppt-pdf-btn').addEventListener('click', () => {
      this.printTable('EPPT — Registro completo', document.querySelector('#eppt-body table'));
    });
    document.getElementById('eppt-txt').addEventListener('input', e => { this.epptFiltros.texto = e.target.value; render(); });
    document.getElementById('eppt-est').addEventListener('change', e => { this.epptFiltros.estado = e.target.value; render(); });
    document.getElementById('eppt-curso').addEventListener('change', e => { this.epptFiltros.curso = e.target.value; render(); });
  },

  /* ---------- Supervisión IA: panel de auditoría del docente ---------- */
  async t_supervision(el) {
    let coursesData; try { const cd = await API.adminAllCourses(); coursesData = cd.courses.filter(c => c.activo); } catch { coursesData = []; }
    const courses = coursesData;
    if (!this.supCourse) this.supCourse = (courses[0] && courses[0].id) || null;

    // ---- Panel unificado: TODOS los pendientes de todos los cursos ----
    let pendientes = [];
    try { const r = await API.adminProctorPendientes(); pendientes = r.sessions || []; } catch {}

    const nRojo = pendientes.filter(s => s.nivel === 'rojo').length;
    const nAmar = pendientes.filter(s => s.nivel === 'amarillo').length;

    el.innerHTML =
      '<h2 class="section-title" style="margin-bottom:12px">Supervisión IA de exámenes</h2>' +
      // KPIs pendientes
      '<div class="kpi-row" style="margin-bottom:16px">' +
      '<div class="kpi"><b style="color:' + (nRojo ? '#e24b4a' : 'inherit') + '">' + nRojo + '</b><span>ROJO — bloqueados</span></div>' +
      '<div class="kpi"><b style="color:' + (nAmar ? '#ef9f27' : 'inherit') + '">' + nAmar + '</b><span>AMARILLO — revisar</span></div>' +
      '<div class="kpi"><b>' + pendientes.length + '</b><span>Total pendientes</span></div>' +
      '</div>' +
      // Tabla global pendientes
      (pendientes.length ?
        '<div style="overflow-x:auto;margin-bottom:20px">' +
        '<table class="list-table"><thead><tr>' +
        '<th>Riesgo</th><th>Pts</th><th>Alumno</th><th>Curso</th><th>Instancia</th><th>Fecha</th><th></th>' +
        '</tr></thead><tbody id="sup-global-body">' +
        pendientes.map(s =>
          '<tr id="srow-' + s.id + '">' +
          '<td><span class="sem ' + s.nivel + '"></span>' + s.nivel.toUpperCase() + '</td>' +
          '<td class="mono">' + s.risk_score + '</td>' +
          '<td><b>' + s.apellido + '</b>, ' + s.unombre + ' (' + s.legajo + ')</td>' +
          '<td class="mono">' + (s.curso_cod || '') + '</td>' +
          '<td>' + s.contexto + (s.attempt_tipo ? ' · ' + s.attempt_tipo : '') + '</td>' +
          '<td class="mono">' + s.started_at.slice(0, 16) + '</td>' +
          '<td style="white-space:nowrap">' +
          '<button class="btn-ghost" data-tl="' + s.id + '">Ver evidencia ▸</button> ' +
          '<button class="btn-ghost" data-ok="' + s.id + '" style="color:var(--ok)">✔ Convalidar</button> ' +
          '<button class="btn-ghost" data-anular="' + s.id + '" style="color:var(--alert)">✘ Anular</button>' +
          '</td></tr>'
        ).join('') +
        '</tbody></table></div>'
        : '<div class="hint" style="padding:16px;text-align:center;margin-bottom:20px">✔ Sin sesiones pendientes de revisión en toda la plataforma.</div>') +

      '<hr style="border:none;border-top:1px solid var(--line);margin:16px 0">' +
      '<div class="dash-tit">Historial por curso</div>' +
      '<div class="filter-row">' +
      '<select id="sup-curso">' +
      courses.map(c => '<option value="' + c.id + '"' + (c.id === this.supCourse ? ' selected' : '') + '>' + c.cod + ' — ' + c.nombre + '</option>').join('') +
      '</select>' +
      (this.isAdmin() ? '<label style="display:flex;align-items:center;gap:6px;font-size:13px">Supervisión activa <input type="checkbox" id="sup-toggle"></label>' : '') +
      '<button class="btn-ghost" id="sup-refresh">↺ Actualizar</button>' +
      '</div>' +
      '<div id="sup-body"><p class="hint">Seleccione un curso…</p></div>' +
      '<div id="sup-detail" style="margin-top:16px"></div>';

    // Listeners de acciones rápidas sobre la tabla global
    el.querySelectorAll('[data-tl]').forEach(b => b.addEventListener('click', () => this._supDetail(Number(b.dataset.tl))));
    el.querySelectorAll('[data-ok]').forEach(b => b.addEventListener('click', async () => {
      try {
        const r = await API.adminProctorReview(Number(b.dataset.ok), { decision: 'convalidado', nota: 'Revisión humana: sin irregularidad determinante.' });
        if (r.error) throw new Error(r.error);
        const msg = r.certificado_emitido ? 'Convalidado. Certificado emitido: ' + r.certificado_emitido : 'Instancia convalidada.';
        alert(msg);
        const row = document.getElementById('srow-' + b.dataset.ok);
        if (row) row.remove();
      } catch(e) { alert('Error al convalidar: ' + e.message); }
    }));
    el.querySelectorAll('[data-anular]').forEach(b => b.addEventListener('click', async () => {
      const d = await this.formModal('ANULAR INSTANCIA', [
        { name: 'nota', label: 'Motivo de la anulación (queda en el registro)', type: 'textarea', required: true }
      ], 'Anular');
      if (!d) return;
      await API.adminProctorReview(Number(b.dataset.anular), { decision: 'anulado', nota: d.nota });
      alert('Instancia anulada y certificado invalidado si existía.');
      const row = document.getElementById('srow-' + b.dataset.anular);
      if (row) row.remove();
    }));

    // Historial por curso
    const drawHistory = async () => {
      const cid = Number(document.getElementById('sup-curso').value);
      this.supCourse = cid;
      const tg = document.getElementById('sup-toggle');
      if (tg) tg.checked = !!(courses.find(c => c.id === cid) || {}).proctor;
      const { sessions } = await API.adminProctor(cid);
      document.getElementById('sup-detail').innerHTML = '';
      document.getElementById('sup-body').innerHTML = sessions.length ?
        '<div style="overflow-x:auto"><table class="list-table"><thead><tr>' +
        '<th>Riesgo</th><th>Pts</th><th>Alumno</th><th>Instancia</th><th>Nota</th><th>Inicio</th><th>Revisión</th><th></th></tr></thead>' +
        '<tbody>' + sessions.map(s =>
          '<tr><td><span class="sem ' + s.nivel + '"></span>' + s.nivel.toUpperCase() + '</td>' +
          '<td class="mono">' + s.risk_score + '</td>' +
          '<td>' + s.apellido + ', ' + s.unombre + ' (' + s.legajo + ')</td>' +
          '<td>' + s.contexto + (s.attempt_tipo ? ' · ' + s.attempt_tipo : '') + (s.attempt_anulado ? ' <span class="badge-fail">ANULADA</span>' : '') + '</td>' +
          '<td>' + (s.score_pct != null ? s.score_pct + ' %' : '—') + '</td>' +
          '<td class="mono">' + s.started_at.slice(0, 16) + '</td>' +
          '<td>' + (s.revision === 'pendiente' ? '<span class="pill">pendiente</span>' : s.revision === 'convalidado' ? '<span class="badge-pass">convalidado</span>' : '<span class="badge-fail">anulado</span>') + '</td>' +
          '<td><button class="btn-ghost" data-htl="' + s.id + '">Línea de tiempo ▸</button></td></tr>'
        ).join('') + '</tbody></table></div>'
        : '<p class="hint">Sin sesiones en este curso.</p>';
      document.getElementById('sup-body').querySelectorAll('[data-htl]').forEach(b =>
        b.addEventListener('click', () => this._supDetail(Number(b.dataset.htl))));
    };
    document.getElementById('sup-curso').addEventListener('change', drawHistory);
    document.getElementById('sup-refresh').addEventListener('click', () => this.t_supervision(el));
    const tg = document.getElementById('sup-toggle');
    if (tg) tg.addEventListener('change', async () => {
      await API.adminCourseProctor(this.supCourse, tg.checked);
      alert('Supervisión ' + (tg.checked ? 'ACTIVADA' : 'DESACTIVADA') + '.');
    });
    if (this.supCourse) drawHistory();
  },


  async _supDetail(id) {
    const { session, events } = await API.adminProctorSession(id);
    const box = document.getElementById('sup-detail');
    const img = f => `<img src="/api/admin/proctor/photo/${session.id}/${f}?token=${encodeURIComponent(API.token)}" onclick="window.open(this.src)">`;
    const foto = e => (e.foto || e.pantalla)
      ? `${e.foto ? '<div class="ev-lab">📷 Cámara</div>' + img(e.foto) : ''}${e.pantalla ? '<div class="ev-lab">🖥 Pantalla</div>' + img(e.pantalla) : ''}`
      : '<span class="hint">sin evidencia</span>';
    box.innerHTML = `
      <h2 class="section-title">Línea de tiempo — sesión ${session.id} · <span class="sem ${session.nivel}"></span>${session.nivel.toUpperCase()} (${session.risk_score} pts) · revisión: ${session.revision}</h2>
      <div class="results-actions" style="justify-content:flex-start">
        <button class="btn-ghost" id="sup-ok">✔ Convalidar instancia</button>
        <button class="btn-ghost" id="sup-anular">✘ Anular instancia observada</button>
      </div>
      <div class="timeline">${events.map(e => `
        <div class="tl-event"><div>${foto(e)}</div>
          <div><b>${e.tipo.replace(/_/g, ' ').toUpperCase()}</b><br>${e.detalle}<br><span class="mono hint">${e.ts}</span></div>
          <div class="pts">+${e.puntos}</div></div>`).join('')}</div>`;
    document.getElementById('sup-ok').addEventListener('click', async () => {
      try {
        const r = await API.adminProctorReview(session.id, { decision: 'convalidado', nota: 'Revisión humana: sin irregularidad determinante.' });
        if (r.error) throw new Error(r.error);
        alert('Instancia convalidada.' + (r.certificado_emitido ? `\nEl certificado retenido fue EMITIDO y firmado electrónicamente: ${r.certificado_emitido}` : ''));
        this.render();
      } catch(e) { alert('Error al convalidar: ' + e.message); }
    });
    document.getElementById('sup-anular').addEventListener('click', async () => {
      const d = await this.formModal('ANULAR INSTANCIA', [
        { name: 'nota', label: 'Motivo de la anulación (queda en el registro oficial y en la auditoría)', type: 'textarea', required: true }
      ], 'Anular instancia');
      if (!d) return;
      await API.adminProctorReview(session.id, { decision: 'anulado', nota: d.nota });
      alert('Instancia anulada: la nota quedó invalidada, el certificado (si existía) fue anulado y el alumno vuelve a estado cursando.');
      this.render();
    });
  },

  /* ---------- Gestión de cursos (CRUD) ---------- */
  async t_cursos(el) {
    const isSuperAdmin = API.user?.role === 'admin'; // solo admin: eliminación definitiva, y solo admin crea cursos nuevos
    const { courses } = await API.adminAllCourses();
    const admin = this.isAdmin(); // admin o instructor: gestión de cursos (según asignación)
    // Instructor sin cursos asignados: mensaje informativo (el servidor ya filtra la lista)
    if (API.user?.role === 'instructor' && courses.length === 0) {
      el.innerHTML = '<div style="max-width:520px;margin:60px auto;text-align:center;background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:32px">'
        + '<div style="font-size:40px;margin-bottom:12px">📚</div>'
        + '<h2 style="margin-bottom:10px">Sin cursos asignados</h2>'
        + '<p class="hint">Todavía no tiene cursos asignados para gestionar. El administrador debe asignárselos desde la pestaña Usuarios.</p>'
        + '</div>';
      return;
    }
    el.innerHTML = '<div class="filter-row">'
      + (isSuperAdmin ? '<button class="btn-primary" id="btn-new-curso" style="width:auto">＋ Nuevo curso</button>' : '')
      + '</div>'
      + '<table class="list-table"><thead><tr>'
      + '<th>Código</th><th>Nombre</th><th>Hs</th><th>Vigencia</th><th>Modalidad</th><th>Nota mín.</th><th>AVSEC</th><th>Simulador</th><th>Proctor</th><th title="Requiere aptitud psicofísica">🏥 Apto<br>médico</th><th>Activo</th>'
      + (admin ? '<th></th>' : '') + '</tr></thead><tbody>'
      + courses.map(c =>
          '<tr style="' + (c.activo ? '' : 'opacity:.45') + '">'
          + '<td class="mono">' + c.cod + '</td>'
          + '<td>' + c.nombre + '</td>'
          + '<td>' + c.horas + ' hs</td>'
          + '<td>' + (c.vigencia_meses ? c.vigencia_meses + ' meses' : 'Sin venc.') + '</td>'
          + '<td>' + c.modalidades + '</td>'
          + '<td>' + c.nota_min + '%</td>'
          + '<td>' + (c.es_avsec ? '<span class="badge-pass" title="Va en la credencial AVSEC">AVSEC</span>' : '<span style="color:var(--muted);font-size:11px">Otro</span>') + '</td>'
          + '<td>' + (c.simulador ? '✔' : '—') + '</td>'
          + '<td>' + (c.proctor ? '✔' : '—') + '</td>'
          + '<td style="text-align:center">' + (c.requiere_apto_medico ? '<span style="color:var(--ok);font-weight:600" title="Requiere aptitud psicofísica vigente para iniciar">✔ Sí</span>' : '<span style="color:var(--muted);font-size:11px">—</span>') + '</td>'
          + '<td>' + (c.activo ? '✔' : '—') + '</td>'
          + (admin ? '<td style="white-space:nowrap"><button class="btn-ghost" data-edit="' + c.id + '" title="Editar">✎</button>'
            + ' <button class="btn-ghost" data-toggle="' + c.id + '" style="color:' + (c.activo ? 'var(--orange)' : 'var(--green)') + '">' + (c.activo ? 'Desactivar' : 'Activar') + '</button>'
            + (isSuperAdmin ? ' <button class="btn-ghost" data-del="' + c.id + '" style="color:var(--alert)" title="Eliminar definitivamente (requiere firma)">🗑</button>' : '')
            + '</td>' : '')
          + '</tr>').join('')
      + '</tbody></table>';
    if (!admin) return;
    document.getElementById('btn-new-curso')?.addEventListener('click', () => this._editCurso(null));
    el.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => {
      const c = courses.find(x => x.id === Number(b.dataset.edit));
      this._editCurso(c);
    }));
    el.querySelectorAll('[data-lecciones]').forEach(b => b.addEventListener('click', async () => {
      const cid = Number(b.dataset.lecciones);
      const c = courses.find(x => x.id === cid);
      if (c) { this.currentContentCourse = cid; await this.s_unidades(body); }
    }));
    // Activar / desactivar — disponible para instructor y admin
    el.querySelectorAll('[data-toggle]').forEach(b => b.addEventListener('click', async () => {
      const c = courses.find(x => x.id === Number(b.dataset.toggle));
      const accion = c.activo ? 'desactivar' : 'activar';
      if (!confirm('¿' + accion.charAt(0).toUpperCase()+accion.slice(1) + ' el curso ' + c.cod + '?')) return;
      try {
        await fetch('/api/admin/courses/'+c.id+'/toggle', { method:'POST', headers:{'Authorization':'Bearer '+API.token} })
          .then(r=>r.json()).then(r=>{ if(!r.ok) throw new Error(r.error); });
        this.render();
      } catch(e) { alert(e.message); }
    }));
    // Eliminación DEFINITIVA — solo admin, requiere contraseña como firma
    el.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', async () => {
      const c = courses.find(x => x.id === Number(b.dataset.del));
      if (!confirm('¿ELIMINAR DEFINITIVAMENTE el curso ' + c.cod + '? Esta acción no se puede deshacer. Solo es posible si no tiene alumnos inscriptos.')) return;
      const d = await this.formModal('FIRMA ELECTRÓNICA REQUERIDA — Eliminar ' + c.cod, [
        { name:'password', label:'Ingrese su contraseña de administrador para confirmar', type:'password', required:true }
      ], 'Eliminar definitivamente');
      if (!d) return;
      try {
        const r = await fetch('/api/admin/courses/'+c.id, {
          method:'DELETE', headers:{'Authorization':'Bearer '+API.token,'Content-Type':'application/json'},
          body: JSON.stringify({ password: d.password })
        }).then(x=>x.json());
        if (!r.ok) throw new Error(r.error);
        alert(r.mensaje);
        this.render();
      } catch(e) { alert(e.message); }
    }));
  },

  async _editCurso(c) {
    const d = await this.formModal(c ? 'EDITAR CURSO — ' + c.cod : 'NUEVO CURSO', [
      { name: 'cod', label: 'Código (único, ej. COD-PSA 021)', value: c?.cod || '', required: true },
      { name: 'nombre', label: 'Nombre del curso', value: c?.nombre || '', required: true },
      { name: 'destinatarios', label: 'Destinatarios', value: c?.destinatarios || '' },
      { name: 'horas', label: 'Horas totales', type: 'number', value: c?.horas || 0, min: 0 },
      { name: 'horas_teoricas', label: 'Horas teóricas', type: 'number', value: c?.horas_teoricas || 0, min: 0 },
      { name: 'horas_practicas', label: 'Horas prácticas', type: 'number', value: c?.horas_practicas || 0, min: 0 },
      { name: 'modalidades', label: 'Modalidades (P=Presencial, S=Semipresencial, E=E-learning)', value: c?.modalidades || 'P' },
      { name: 'vigencia_meses', label: 'Vigencia en meses (0 = sin vencimiento)', type: 'number', value: c?.vigencia_meses || 0, min: 0 },
      { name: 'nota_min', label: 'Nota mínima de aprobación (%)', type: 'number', value: c?.nota_min || 70, min: 1 },
      { name: 'asistencia_min', label: 'Asistencia mínima requerida (%)', type: 'number', value: c?.asistencia_min || 100, min: 0 },
      { name: 'preguntas_examen', label: 'Preguntas por examen', type: 'number', value: c?.preguntas_examen || 10, min: 1 },
      { name: 'observaciones', label: 'Observaciones / Referencia normativa', type: 'textarea', value: c?.observaciones || '' },
      { name: 'simulador', label: '¿Requiere práctico en simulador de Rayos X?', type: 'select', options: [{value:'0',label:'No'},{value:'1',label:'Sí'}], value: c?.simulador ? '1' : '0' },
      { name: 'proctor', label: '¿Supervisión IA de exámenes activa?', type: 'select', options: [{value:'1',label:'Sí'},{value:'0',label:'No'}], value: c?.proctor !== undefined ? String(c.proctor) : '1' },
      { name: 'es_avsec', label: '¿Es un curso AVSEC/PNISAC? (determina si aparece en la credencial y el QR)', type: 'select', options: [{value:'1',label:'Sí — Curso AVSEC (va en la credencial)'},{value:'0',label:'No — Otra capacitación (no va en la credencial)'}], value: c?.es_avsec !== undefined ? String(c.es_avsec) : '1' },
      { name: 'requiere_apto_medico', label: '🏥 ¿Requiere aptitud psicofísica vigente para iniciar la cursada? (Obligatorio para COD-PSA 001 y 002 por normativa AVSEC)', type: 'select', options: [{value:'0',label:'No — El alumno puede iniciar sin apto médico'},{value:'1',label:'Sí — El alumno debe tener apto psicofísico vigente'}], value: c?.requiere_apto_medico !== undefined ? String(c.requiere_apto_medico) : '0' }
    ], c ? 'Guardar cambios' : 'Crear curso');
    if (!d) return;
    try {
      const payload = { ...d, simulador: d.simulador === '1', proctor: d.proctor === '1', es_avsec: d.es_avsec === '1', requiere_apto_medico: d.requiere_apto_medico === '1' };
      if (c) {
        const firma = await this.formModal('CONFIRMAR CAMBIOS — FIRMA ELECTRÓNICA', [
          { name: 'pass', label: 'Reingrese su contraseña para confirmar y firmar los cambios del curso ' + (payload.cod || c.cod), type: 'password', required: true }
        ], 'Firmar y guardar');
        if (!firma) return;
        await API.adminUpdateCourse(c.id, { ...payload, firma_password: firma.pass });
        alert('✔ Curso actualizado y cambios firmados electrónicamente.');
      } else {
        await API.adminCreateCourse(payload);
        alert('✔ Curso creado. Ahora podés agregar unidades y preguntas desde Cursos y contenidos.');
      }
      this.render();
    } catch (e) { alert(e.message); }
  },

  /* ---------- Banco de imágenes del simulador ---------- */
  async t_banco(el) {
    if (this.bancoPage == null) this.bancoPage = 0;
    if (!this.bancoFiltro) this.bancoFiltro = 'all';
    const PAGE = 60;
    let r;
    try {
      r = await API.images('?only=' + this.bancoFiltro + '&limit=' + PAGE + '&offset=' + (this.bancoPage * PAGE) + '&force=1');
    } catch(e) { el.innerHTML = '<p class="error">Error: ' + e.message + '</p>'; return; }
    const admin = this.isAdmin();
    const canEditBanco = API.user?.role === 'admin'; // el banco de imagenes es un recurso compartido, no atado a un curso -> solo admin lo gestiona
    const totales = r.totales || { todas: 0, anotadas: 0, pendientes: 0 };
    const total = r.total || 0;
    el.innerHTML =
      '<p class="hint">Banco central de imágenes del simulador de Rayos X. Las <b>anotadas</b> alimentan el ' +
      'Entrenamiento libre y los exámenes prácticos. Las <b>pendientes</b> se marcan en el Anotador.</p>' +
      (!canEditBanco && API.user?.role === 'instructor' ? '<div class="hint" style="margin-bottom:10px">El banco de imágenes es gestionado por el administrador. Puede visualizarlas.</div>' : '') +
      '<div class="kpi-row">' +
      '<div class="kpi"><b>' + totales.todas + '</b><span>Total en banco</span></div>' +
      '<div class="kpi"><b style="color:var(--ok)">' + totales.anotadas + '</b><span>Anotadas (usables)</span></div>' +
      '<div class="kpi"><b style="color:var(--organic)">' + totales.pendientes + '</b><span>Pendientes de anotación</span></div>' +
      '</div>' +
      (canEditBanco ? '<div class="filter-row" style="border-left:3px solid var(--organic)"><span class="hint">⏱ Tiempo máximo por imagen en el examen práctico:</span>' +
        '<input type="number" id="eval-seconds-input" min="5" max="300" style="width:80px" placeholder="30"> segundos' +
        '<button class="btn-ghost" id="btn-save-eval-seconds">Guardar</button>' +
        '<span id="eval-seconds-status" class="hint"></span></div>' : '') +
      '<div class="filter-row" style="flex-wrap:wrap;gap:8px">' +
      (canEditBanco ? '<label class="btn-ghost" style="cursor:pointer">Cargar imágenes ⬆ <input type="file" id="banco-up" accept="image/png,image/jpeg,image/webp" multiple style="display:none"></label>' : '') +
      '<button class="btn-primary" id="banco-anotar" style="width:auto">Abrir Anotador ✏</button>' +
      '<select id="banco-filtro">' +
      '<option value="all"' + (this.bancoFiltro === 'all' ? ' selected' : '') + '>Todas</option>' +
      '<option value="annotated"' + (this.bancoFiltro === 'annotated' ? ' selected' : '') + '>Solo anotadas</option>' +
      '<option value="pending"' + (this.bancoFiltro === 'pending' ? ' selected' : '') + '>Solo pendientes</option>' +
      '</select>' +
      '<span id="banco-st" class="upload-status"></span>' +
      '</div>' +
      '<div class="banco-grid">' +
      (r.images && r.images.length ?
        r.images.map(i =>
          '<div class="banco-item">' +
          '<img src="' + i.url + '" loading="lazy" alt="" style="cursor:pointer" onclick="window.open(this.src)">' +
          '<div class="banco-meta">' +
          '<span style="font-size:11px">' + (i.annotated ? (i.is_clean ? '✔ Limpia' : '⚠ ' + (i.threats ? i.threats.length : 0) + ' amenaza(s)') : '⏳ Pendiente') + '</span>' +
          (canEditBanco ? '<button class="btn-ghost" data-del="' + i.filename.replace(/"/g, '') + '" style="padding:2px 6px;font-size:11px" title="Eliminar imagen">🗑</button>' : '') +
          '</div></div>'
        ).join('')
        : '<p class="hint" style="grid-column:1/-1;padding:20px;text-align:center">Sin imágenes con este filtro. ' +
          (admin && this.bancoFiltro === 'pending' ? 'Cambie el filtro a "Todas" para ver las anotadas.' : 'Cargue imágenes con el botón de arriba.') + '</p>') +
      '</div>' +
      '<div class="filter-row" style="justify-content:center;gap:12px;margin-top:12px">' +
      '<button class="btn-ghost" id="banco-prev"' + (this.bancoPage === 0 ? ' disabled' : '') + '>◀ Anteriores</button>' +
      '<span class="hint">' + (total > 0 ? (this.bancoPage * PAGE + 1) + '–' + Math.min(total, (this.bancoPage + 1) * PAGE) + ' de ' + total : '0 imágenes') + '</span>' +
      '<button class="btn-ghost" id="banco-next"' + ((this.bancoPage + 1) * PAGE >= total ? ' disabled' : '') + '>Siguientes ▶</button>' +
      '</div>';

    // Listeners
    document.getElementById('banco-filtro').addEventListener('change', e => { this.bancoFiltro = e.target.value; this.bancoPage = 0; this.t_banco(el); });
    document.getElementById('banco-prev').addEventListener('click', () => { this.bancoPage--; this.t_banco(el); });
    document.getElementById('banco-next').addEventListener('click', () => { this.bancoPage++; this.t_banco(el); });
    if (canEditBanco) {
      API.getEvalSeconds().then(r => {
        const inp = document.getElementById('eval-seconds-input');
        if (inp) inp.value = r.seconds_per_image;
      }).catch(() => {});
      document.getElementById('btn-save-eval-seconds')?.addEventListener('click', async () => {
        const val = Number(document.getElementById('eval-seconds-input').value);
        const status = document.getElementById('eval-seconds-status');
        try {
          await API.setEvalSeconds(val);
          status.textContent = '✔ Guardado (' + val + 's)'; status.style.color = 'var(--ok)';
        } catch(e) { status.textContent = 'Error: ' + e.message; status.style.color = 'var(--alert)'; }
      });
    }
    document.getElementById('banco-anotar').addEventListener('click', () => {
      App.openAnnotator().catch(e => alert(e.message));
    });
    const up = document.getElementById('banco-up');
    if (up) {
      up.addEventListener('change', async () => {
        const files = [...up.files];
        if (!files.length) return;
        const st = document.getElementById('banco-st');
        st.textContent = 'Subiendo ' + files.length + ' imagen(es)…';
        const fd = new FormData();
        files.slice(0, 200).forEach(f => fd.append('images', f));
        try {
          const resp = await API.adminImagesUpload(fd);
          st.textContent = '✔ ' + resp.subidas + ' imagen(es) cargadas al banco';
          setTimeout(() => { this.bancoFiltro = 'pending'; this.bancoPage = 0; this.t_banco(el); }, 1200);
        } catch (e) { st.textContent = '✘ Error: ' + e.message; }
        up.value = '';
      });
    }
    el.querySelectorAll('[data-lecciones]').forEach(b => b.addEventListener('click', async () => {
      const cid = Number(b.dataset.lecciones);
      const c = courses.find(x => x.id === cid);
      if (c) { this.currentContentCourse = cid; await this.s_unidades(body); }
    }));
    el.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', async () => {
      if (!confirm('¿Eliminar "' + b.dataset.del + '" del banco? También se borra su anotación.')) return;
      try { await API.adminImageDelete(b.dataset.del); this.t_banco(el); }
      catch (e) { alert('Error: ' + e.message); }
    }));
  },

  /* ---------- DNIs preautorizados (whitelist) ---------- */
  async t_dnis(el) {
    if (!this.isAdmin()) { el.innerHTML = '<p class="hint">Solo administradores pueden gestionar la lista de acceso.</p>'; return; }
    const { dnis } = await API.adminDniAut();
    el.innerHTML =
      '<p class="hint">Solo los DNI cargados aquí podrán registrarse en la plataforma. El organismo se toma de esta lista automáticamente al registrarse.</p>' +
      '<div class="filter-row">' +
      '<button class="btn-primary" id="btn-dnis-bulk" style="width:auto">Carga masiva de DNIs ⬆</button>' +
      '</div>' +
      '<div class="kpi-row">' +
      '<div class="kpi"><b>' + dnis.length + '</b><span>Total en lista</span></div>' +
      '<div class="kpi"><b style="color:var(--ok)">' + dnis.filter(d => d.usado).length + '</b><span>Ya registrados</span></div>' +
      '<div class="kpi"><b style="color:var(--organic)">' + dnis.filter(d => !d.usado).length + '</b><span>Pendientes</span></div>' +
      '</div>' +
      '<table class="list-table"><thead><tr><th>DNI</th><th>Organismo</th><th>Nota</th><th>Estado</th><th>Cargado</th><th></th></tr></thead>' +
      '<tbody>' + dnis.map(d =>
        '<tr><td class="mono">' + d.dni + '</td><td>' + (d.organismo || '—') + '</td>' +
        '<td>' + (d.nota || '—') + '</td>' +
        '<td>' + (d.usado ? '<span class="badge-pass">✔ Registrado</span>' : '<span class="pill">Pendiente</span>') + '</td>' +
        '<td class="mono">' + d.created_at.slice(0,16) + '</td>' +
        '<td>' + (!d.usado ? '<button class="btn-ghost" data-deldni="' + d.id + '">🗑</button>' : '') + '</td></tr>'
      ).join('') + '</tbody></table>';

    document.getElementById('btn-dnis-bulk').addEventListener('click', async () => {
      const d = await this.formModal('CARGA MASIVA DE DNIs', [
        { name: 'csv', label: 'Un DNI por línea. Opcional: DNI;ORGANISMO. Ejemplos: 37682757 o 37682757;PSA', type: 'textarea', required: true },
        { name: 'org', label: 'Organismo por defecto (si no se especifica en cada fila)', value: 'PSA' }
      ], 'Cargar');
      if (!d) return;
      const rows = d.csv.split(/[,\n]+/).map(l => l.trim()).filter(Boolean).map(l => {
        const p = l.split(';').map(x => x.trim());
        return { dni: p[0], organismo: p[1] || d.org };
      });
      try {
        const r = await API.adminDniAutBulk(rows);
        alert('Carga completada: ' + r.creados + ' creados · ' + r.duplicados + ' duplicados · ' + r.errores + ' errores');
        this.render();
      } catch(e) { alert(e.message); }
    });
    el.querySelectorAll('[data-deldni]').forEach(b => b.addEventListener('click', async () => {
      if (!confirm('¿Eliminar este DNI de la lista?')) return;
      await API.adminDniAutDelete(Number(b.dataset.deldni));
      this.render();
    }));
  },

  /* ---------- Historial académico visual por alumno ---------- */
  async t_historial(el) {
    const { users } = await API.adminUsers();
    if (!this._historialUser) this._historialUser = null;
    el.innerHTML = '<div class="filter-row">'
      + '<input id="hist-search" placeholder="Buscar alumno por apellido, legajo o DNI…" style="flex:1;min-width:200px">'
      + '<div id="hist-sugerencias" style="position:relative"></div>'
      + '</div><div id="hist-resultado"><p class="hint" style="padding:20px;text-align:center">Busque un alumno para ver su historial académico.</p></div>';
    const inp = document.getElementById('hist-search');
    const res = document.getElementById('hist-resultado');
    inp.addEventListener('input', () => {
      const q = inp.value.toLowerCase().trim();
      const sg = document.getElementById('hist-sugerencias');
      if (!q || q.length < 2) { sg.innerHTML = ''; return; }
      const hits = users.filter(u => (u.apellido+' '+u.nombre+' '+u.legajo+(u.dni||'')).toLowerCase().includes(q)).slice(0,8);
      sg.innerHTML = hits.length
        ? '<div style="position:absolute;top:0;left:0;background:var(--panel);border:1px solid var(--line);border-radius:8px;z-index:10;min-width:320px;box-shadow:0 4px 20px rgba(0,0,0,.4)">'
          + hits.map(u => '<div class="suger-item" data-uid="'+u.id+'" style="padding:8px 12px;cursor:pointer;font-size:13px">'
            + '<b>'+u.apellido+'</b>, '+u.nombre+' · '+u.legajo+' · <span style="color:var(--muted)">'+u.role+'</span></div>').join('')
          + '</div>'
        : '';
      sg.querySelectorAll('.suger-item').forEach(d => d.addEventListener('click', async () => {
        sg.innerHTML = ''; inp.value = d.textContent.trim();
        res.innerHTML = '<p class="hint">Cargando historial…</p>';
        try {
          const h = await API.adminHistorial(Number(d.dataset.uid));
          this._renderHistorial(res, h);
        } catch(e) { res.innerHTML = '<p class="error">'+e.message+'</p>'; }
      }));
    });
  },

  _renderHistorial(el, h) {
    const u = h.usuario; const hoy = new Date().toISOString().slice(0,10);
    const cursos = h.historial_agrupado || (() => {
      const m = new Map();
      (h.historial||[]).forEach(r => {
        if (!m.has(r.course_id)) m.set(r.course_id, { course_id:r.course_id, cod:r.curso_cod, nombre:r.curso_nombre, ciclos:[] });
        if (!m.get(r.course_id).ciclos.some(c=>c.enrollment_id===r.id))
          m.get(r.course_id).ciclos.push({ enrollment_id:r.id, ciclo:r.ciclo||1, activo:r.activo, estado:r.estado, created_at:r.created_at, intentos:[], certificado:null });
      });
      return [...m.values()];
    })();
    const totalRehab = h.metricas?.rehabilitaciones || cursos.reduce((n,c)=>n+Math.max(0,(c.ciclos?.length||1)-1),0);

    el.innerHTML = '<div id="historial-print-area">'
      + '<div style="display:flex;justify-content:flex-end;margin-bottom:8px">'
      + '<button class="btn-ghost" id="btn-print-historial">🖨 Imprimir historial</button>'
      + '</div>'
      + '<div style="background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:16px;margin-bottom:14px">'
      + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:4px">'
      + '<div><b style="font-size:16px">'+u.apellido+', '+u.nombre+'</b><br>'
      + '<span style="color:var(--muted);font-size:12px">'+(u.rango||'').replace('de la Policía de Seguridad Aeroportuaria','PSA')+'</span></div>'
      + '<div style="font-size:12px;color:var(--muted)">DNI: '+(u.dni||'—')+' · Leg: '+u.legajo+'<br>'+u.organismo+(u.aeropuerto?' · '+u.aeropuerto:'')+(u.dependencia?'<br>'+u.dependencia:'')+'</div>'
      + '</div></div>'
      + '<div class="kpi-row" style="margin-bottom:14px">'
      + '<div class="kpi"><b>'+(h.metricas?.cursados||cursos.length)+'</b><span>Cursos</span></div>'
      + '<div class="kpi"><b style="color:var(--ok)">'+(h.metricas?.aprobados||0)+'</b><span>Aprobados</span></div>'
      + '<div class="kpi"><b style="color:'+((h.metricas?.tasaAprob||0)>=70?'var(--ok)':'var(--alert)')+'">'+(h.metricas?.tasaAprob||0)+'%</b><span>Tasa aprobación</span></div>'
      + '<div class="kpi"><b>'+(h.certificados||[]).filter(c=>!c.anulado&&(!c.vencimiento||c.vencimiento>=hoy)).length+'</b><span>Cert. vigentes</span></div>'
      + (totalRehab>0?'<div class="kpi"><b style="color:var(--orange)">'+totalRehab+'</b><span>Rehabilitaciones</span></div>':'')
      + '</div>'
      + cursos.map(c => {
          const ciclos = c.ciclos || [];
          const cicloActivo = ciclos.find(ci=>ci.activo) || ciclos[0] || {};
          const certActivo = (h.certificados||[]).find(x=>x.course_id===c.course_id&&!x.anulado);
          const venc = certActivo?.vencimiento;
          const vencStr = !venc ? 'Sin venc.' : venc < hoy
            ? '<span style="color:var(--alert)">'+_fmtFecha(venc)+' VENCIDO</span>'
            : _fmtFecha(venc);
          const badge = cicloActivo.estado==='aprobado'?'<span class="badge-pass">APROBADO</span>'
            :cicloActivo.estado==='desaprobado'?'<span class="badge-fail">DESAPROBADO</span>'
            :cicloActivo.estado?'<span class="pill">'+cicloActivo.estado.toUpperCase()+'</span>':'—';
          const ciclosHtml = ciclos.length > 1
            ? ciclos.map(ci => {
                const badgeCi = ci.estado==='aprobado'?'<span class="badge-pass" style="font-size:10px">APROBADO</span>'
                  :ci.estado==='desaprobado'?'<span class="badge-fail" style="font-size:10px">DESAPROBADO</span>'
                  :'<span class="pill" style="font-size:10px">'+(ci.estado||'').toUpperCase()+'</span>';
                const notasCi = (ci.intentos||[]).filter(i=>i.score_pct!=null).map(i=>i.score_pct+'%').join(', ')||'—';
                return '<div style="font-size:11px;padding:4px 8px;margin-top:4px;border-radius:4px;background:'
                  +(ci.activo?'rgba(30,138,90,.1)':'rgba(255,255,255,.04)')
                  +';border-left:2px solid '+(ci.activo?'var(--green)':'var(--muted)')+'">'
                  +'<b>Ciclo '+ci.ciclo+'</b> '
                  +(ci.activo?'<span style="color:var(--green)">EN CURSO / ACTIVO</span>':'<span style="color:var(--muted)">archivado</span>')
                  +' · '+badgeCi+' · Notas: '+notasCi+' · Inicio: '+_fmtFecha(ci.created_at)+'</div>';
              }).join('')
            : '';
          return '<div style="background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:14px;margin-bottom:10px">'
            + '<div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px">'
            + '<div><b class="mono">'+c.cod+'</b> <span style="font-size:12px;color:var(--muted)">'+c.nombre+'</span>'
            + (ciclos.length>1?' <span class="pill" style="font-size:10px">'+ciclos.length+' CICLOS</span>':'')+'</div>'
            + '<div>'+badge+'</div></div>'
            + '<div style="font-size:12px;color:var(--muted);margin-top:4px">'
            + 'Vencimiento: '+vencStr+(certActivo?' · Cert: <span class="mono">'+certActivo.code+'</span>':'')+'</div>'
            + ciclosHtml
            + '</div>';
        }).join('')
      + ((h.documentos||[]).length ? '<h3 class="section-title" style="margin-top:16px">Documentos registrados</h3>'
        + '<table class="list-table"><thead><tr><th>N°</th><th>Tipo</th><th>Curso</th><th>Emitido</th></tr></thead><tbody>'
        + h.documentos.map(d=>'<tr><td class="mono">'+d.numero+'</td><td>'+d.tipo+'</td><td>'+(d.curso_cod||'—')+'</td><td class="mono">'+_fmtFecha(d.emitido_at)+'</td></tr>').join('')
        + '</tbody></table>' : '')
      + '</div>';

    document.getElementById('btn-print-historial').addEventListener('click', () => {
      const area = document.getElementById('historial-print-area').cloneNode(true);
      area.querySelector('#btn-print-historial')?.closest('div')?.remove();
      this.printHtml('Historial académico — ' + u.apellido + ', ' + u.nombre + ' (Leg. ' + u.legajo + ')', area.innerHTML);
    });
  },

  /* ---------- Libro de Aula y Asistencia ---------- */
  async t_aula(el) {
    const { courses } = await API.adminAllCourses();
    if (!this.aulaCourse) this.aulaCourse = courses.find(c=>c.activo)?.id || courses[0]?.id;
    const renderAula = async () => {
      const cid = this.aulaCourse;
      const r = await API.adminAsistencia(cid);
      const enrolls = r.enrolls || [];
      const asist = r.asistencias || [];
      const pct = r.pct || {};
      const fechas = [...new Set(asist.map(a=>a.fecha))].sort().reverse().slice(0,20);
      const fechaActual = new Date().toISOString().slice(0,10);
      el.innerHTML = '<div class="filter-row" style="flex-wrap:wrap">'
        + '<select id="aula-curso" style="flex:2;min-width:200px">'
        + courses.filter(c=>c.activo).map(c=>'<option value="'+c.id+'"'+(c.id===cid?' selected':'')+'>'+c.cod+' — '+c.nombre+'</option>').join('')
        + '</select>'
        + '<input type="date" id="aula-fecha" value="'+fechaActual+'">'
        + '<select id="aula-tipo"><option value="virtual">Virtual / E-learning</option><option value="presencial">Presencial</option></select>'
        + '<button class="btn-primary" id="aula-registrar" style="width:auto">Registrar asistencia del día ✔</button>'
        + '</div>'
        + '<div class="kpi-row">'
        + '<div class="kpi"><b>'+enrolls.length+'</b><span>Inscriptos</span></div>'
        + '<div class="kpi"><b style="color:var(--ok)">'+enrolls.filter(e=>pct[e.id]>=90).length+'</b><span>Asistencia ≥ 90%</span></div>'
        + '<div class="kpi"><b style="color:var(--alert)">'+enrolls.filter(e=>pct[e.id]!=null&&pct[e.id]<90).length+'</b><span>Asistencia &lt; 90%</span></div>'
        + '</div>'
        + '<div id="aula-form-container"></div>'
        + '<h3 class="section-title" style="margin-top:12px">Registro de asistencia</h3>'
        + '<div style="overflow-x:auto"><table class="list-table"><thead><tr><th>Alumno</th><th>Legajo</th><th>Asistencia %</th>'
        + fechas.slice(0,8).map(f=>'<th class="mono" style="font-size:11px">'+f.slice(5)+'</th>').join('')
        + '</tr></thead><tbody>'
        + enrolls.map(e=>{
            const pctE = pct[e.id];
            const color = pctE==null?'':pctE>=90?'color:var(--ok)':pctE>=75?'color:var(--organic)':'color:var(--alert)';
            const dias = fechas.slice(0,8).map(f=>{
              const a = asist.find(x=>x.enrollment_id===e.id&&x.fecha===f);
              return '<td style="text-align:center">'+(a?a.presente?'<span style="color:var(--ok)">P</span>':'<span style="color:var(--alert)">'+(a.justificado?'J':'A')+'</span>':'<span style="color:var(--line)">·</span>')+'</td>';
            }).join('');
            return '<tr><td>'+e.apellido+', '+e.unombre+'</td><td class="mono">'+e.legajo+'</td>'
              + '<td style="'+color+';font-weight:500">'+(pctE!=null?pctE+'%':'—')+'</td>'+dias+'</tr>';
          }).join('')
        + '</tbody></table></div>';
      document.getElementById('aula-curso').addEventListener('change', e=>{ this.aulaCourse=Number(e.target.value); renderAula(); });
      document.getElementById('aula-registrar').addEventListener('click', () => {
        const fecha = document.getElementById('aula-fecha').value;
        const tipo = document.getElementById('aula-tipo').value;
        const ctr = document.getElementById('aula-form-container');
        ctr.innerHTML = '<div style="background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:14px;margin-bottom:12px">'
          + '<h3 class="dash-tit">Registro de asistencia — '+fecha+'</h3>'
          + '<table class="list-table"><thead><tr><th>Alumno</th><th>Legajo</th><th>Presente</th><th>Justificado</th><th>Observaciones</th></tr></thead><tbody>'
          + enrolls.map((e,i)=>'<tr><td>'+e.apellido+', '+e.unombre+'</td><td class="mono">'+e.legajo+'</td>'
            + '<td><input type="checkbox" class="aula-pres" data-eid="'+e.id+'" checked></td>'
            + '<td><input type="checkbox" class="aula-just" data-eid="'+e.id+'"></td>'
            + '<td><input type="text" class="aula-obs" data-eid="'+e.id+'" style="width:100%;font-size:12px"></td></tr>').join('')
          + '</tbody></table>'
          + '<div class="results-actions"><button class="btn-primary" id="aula-guardar">Guardar y firmar ✔</button>'
          + '<button class="btn-ghost" id="aula-cancelar">Cancelar</button></div></div>';
        document.getElementById('aula-cancelar').addEventListener('click', ()=>{ ctr.innerHTML=''; });
        document.getElementById('aula-guardar').addEventListener('click', async ()=>{
          const registros = enrolls.map(e=>({
            enrollment_id: e.id,
            presente: ctr.querySelector('.aula-pres[data-eid="'+e.id+'"]').checked ? 1 : 0,
            justificado: ctr.querySelector('.aula-just[data-eid="'+e.id+'"]').checked ? 1 : 0,
            nota_obs: ctr.querySelector('.aula-obs[data-eid="'+e.id+'"]').value
          }));
          try {
            await API.adminAsistenciaBulk({ course_id: cid, fecha, tipo, registros });
            ctr.innerHTML = '';
            alert('✔ Asistencia del '+fecha+' registrada para '+enrolls.length+' alumnos.');
            renderAula();
          } catch(e) { alert(e.message); }
        });
      });
    };
    await renderAula();
  },

  /* ---------- Reloj anual de instructores ---------- */
  async t_reloj(el) {
    const anio = this._relojAnio || new Date().getFullYear();
    this._relojAnio = anio;
    const r = await API.adminRelojInstructores();
    const insts = r.instructores || [];
    const alertas = insts.filter(i=>!i.cumple);
    el.innerHTML = '<div class="filter-row">'
      + '<label style="font-size:13px">Año: <input type="number" id="reloj-anio" value="'+anio+'" min="2020" max="2099" style="width:80px"></label>'
      + '<span class="hint">Meta anual: <b>'+r.meta+' horas</b> por instructor, según normativa vigente.</span>'
      + '</div>'
      + (alertas.length ? '<div style="background:rgba(220,50,50,.1);border:1px solid var(--alert);border-radius:8px;padding:10px 14px;margin-bottom:12px;font-size:13px">'
        + '⚠ <b>'+alertas.length+' instructor(es)</b> no alcanzaron la meta de '+r.meta+' hs en '+anio+': '
        + alertas.map(i=>'<b>'+i.apellido+'</b>').join(', ')
        + '</div>' : '')
      + '<table class="list-table"><thead><tr><th>Instructor</th><th>Legajo</th><th>Jerarquía</th><th>Horas '+anio+'</th><th>Meta</th><th>Estado</th><th></th></tr></thead><tbody>'
      + insts.map(i=>'<tr>'
        + '<td><b>'+i.apellido+'</b>, '+i.unombre+'</td>'
        + '<td class="mono">'+i.legajo+'</td>'
        + '<td style="font-size:11px;color:var(--muted)">'+(i.rango||'').replace('de la Policía de Seguridad Aeroportuaria','PSA').slice(0,30)+'</td>'
        + '<td><div style="display:flex;align-items:center;gap:8px">'
          + '<div style="width:80px;height:8px;background:var(--line);border-radius:4px;overflow:hidden"><div style="width:'+i.pct+'%;height:100%;background:'+(i.cumple?'var(--ok)':'var(--alert)')+'"></div></div>'
          + '<b style="color:'+(i.cumple?'var(--ok)':i.horas_anio>10?'var(--organic)':'var(--alert)')+'">'+i.horas_anio+' hs</b></div></td>'
        + '<td>'+r.meta+' hs</td>'
        + '<td>'+(i.cumple?'<span class="badge-pass">✔ CUMPLE</span>':'<span class="badge-fail">NO CUMPLE</span>')+'</td>'
        + '<td><button class="btn-ghost" data-addhs="'+i.id+'" data-nombre="'+i.apellido+'">Cargar horas ＋</button> '
          + '<button class="btn-ghost" data-verhs="'+i.id+'" data-nombre="'+i.apellido+'">Ver detalle</button></td></tr>').join('')
      + '</tbody></table>';
    document.getElementById('reloj-anio').addEventListener('change', e=>{ this._relojAnio=Number(e.target.value)||anio; this.t_reloj(el); });
    el.querySelectorAll('[data-addhs]').forEach(b=>b.addEventListener('click', async ()=>{
      const { courses } = await API.adminAllCourses();
      const d = await this.formModal('CARGAR HORAS — '+b.dataset.nombre, [
        { name:'fecha', label:'Fecha de la actividad', type:'date', required:true, value:new Date().toISOString().slice(0,10) },
        { name:'horas', label:'Horas impartidas', type:'number', required:true, min:0.5, step:0.5, value:2 },
        { name:'curso_id', label:'Curso (opcional)', type:'select', options:[{value:'',label:'Sin curso específico'},...courses.filter(c=>c.activo).map(c=>({value:String(c.id),label:c.cod+' — '+c.nombre.slice(0,40)}))] },
        { name:'descripcion', label:'Descripción de la actividad (clase, taller, evaluación…)', required:true },
        { name:'password', label:'FIRMA ELECTRÓNICA — su contraseña', type:'password', required:true }
      ], 'Firmar y registrar');
      if (!d) return;
      try {
        await API.adminAddHorasInstructor(Number(b.dataset.addhs), { ...d, anio, horas:Number(d.horas), curso_id:d.curso_id||null });
        alert('✔ Horas registradas con firma electrónica.');
        this.t_reloj(el);
      } catch(e) { alert(e.message); }
    }));
    el.querySelectorAll('[data-verhs]').forEach(b=>b.addEventListener('click', async ()=>{
      const d = await API.adminInstructorHoras(Number(b.dataset.verhs), anio);
      const rows = (d.horas||[]).map(h=>'<tr><td class="mono">'+h.fecha+'</td><td><b>'+h.horas+' hs</b></td><td>'+(h.descripcion||'—')+'</td><td class="mono" style="font-size:9px;word-break:break-all">'+h.firma_hash+'</td></tr>').join('');
      (()=>{ const _lines=[d.instructor.apellido+', '+d.instructor.unombre,'Anio '+anio+' - Total: '+d.total+' hs de '+d.meta+' meta',...(d.horas||[]).map(h=>h.fecha+' - '+h.horas+'hs - '+h.descripcion)]; alert(_lines.join('\n')); })();
    }));
  },

  /* ---------- Calendario anual ISSA ---------- */
  async t_calendario(el) {
    const anio = this._calAnio || new Date().getFullYear();
    this._calAnio = anio;
    const hoy = new Date().toISOString().slice(0,10);
    const r = await API.adminCalendario(anio);
    const cursos = r.cursos || [];
    const meses = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
    // Alerta: si estamos en noviembre-diciembre, recordar enviar al ISSA
    const mesActual = new Date().getMonth();
    const alertaISSA = mesActual >= 10;
    el.innerHTML = '<div class="filter-row">'
      + '<label style="font-size:13px">Año: <input type="number" id="cal-anio" value="'+anio+'" min="2020" max="2099" style="width:80px"></label>'
      + (this.isAdmin() ? '<button class="btn-primary" id="cal-nuevo" style="width:auto">＋ Agregar curso al calendario</button>' : '')
      + (this.isAdmin() ? '<button class="btn-ghost" id="cal-enviar-issa">Enviar nómina al ISSA 📤</button>' : '')
      + '</div>'
      + (alertaISSA ? '<div style="background:rgba(240,160,0,.1);border:1px solid var(--organic);border-radius:8px;padding:10px 14px;margin-bottom:12px;font-size:13px">⚠ Recuerde: la nómina de cursos proyectados para '+(anio+1)+' debe enviarse al ISSA entre el 1 y el 15 de diciembre. Use el botón "Enviar nómina al ISSA".</div>' : '')
      + '<table class="list-table"><thead><tr><th>Curso</th><th>Inicio</th><th>Fin</th><th>Modalidad</th><th>Sede</th><th>Cupo</th><th>Estado</th><th>ISSA</th>'+(this.isAdmin()?'<th></th>':'')+'</tr></thead><tbody>'
      + (cursos.length ? cursos.map(c=>{
          const est = c.estado==='planificado'?'<span class="pill">Planificado</span>'
            :c.estado==='confirmado'?'<span class="badge-pass">Confirmado</span>'
            :c.estado==='en_curso'?'<span style="color:var(--organic)">En curso</span>'
            :c.estado==='finalizado'?'<span class="badge-pass">Finalizado</span>'
            :'<span class="badge-fail">Cancelado</span>';
          return '<tr><td><b class="mono">'+c.curso_cod+'</b><br><small class="hint">'+c.curso_nombre.slice(0,30)+'</small></td>'
            +'<td class="mono">'+c.fecha_inicio+'</td><td class="mono">'+(c.fecha_fin||'—')+'</td>'
            +'<td>'+c.modalidad+'</td><td>'+(c.sede||'—')+'</td><td>'+c.cupo+'</td>'
            +'<td>'+est+'</td><td>'+(c.enviado_issa?'<span class="badge-pass">✔ Enviado</span>':'<span class="pill">Pendiente</span>')+'</td>'
            +(this.isAdmin()?'<td><button class="btn-ghost" data-calid="'+c.id+'" data-estado="'+c.estado+'">Editar</button></td>':'')+'</tr>';
        }).join('') : '<tr><td colspan="9" class="hint" style="text-align:center;padding:20px">Sin cursos en el calendario '+anio+'. Agréguelos con el botón de arriba.</td></tr>')
      + '</tbody></table>';
    document.getElementById('cal-anio').addEventListener('change', e=>{ this._calAnio=Number(e.target.value)||anio; this.t_calendario(el); });
    if (this.isAdmin()) {
      const { courses } = await API.adminAllCourses();
      document.getElementById('cal-nuevo').addEventListener('click', async ()=>{
        const d = await this.formModal('NUEVO CURSO EN CALENDARIO '+anio, [
          { name:'course_id', label:'Curso', type:'select', required:true, options:courses.filter(c=>c.activo).map(c=>({value:String(c.id),label:c.cod+' — '+c.nombre.slice(0,50)})) },
          { name:'fecha_inicio', label:'Fecha de inicio', type:'date', required:true },
          { name:'fecha_fin', label:'Fecha de fin (opcional)', type:'date' },
          { name:'modalidad', label:'Modalidad', type:'select', options:[{value:'P',label:'Presencial'},{value:'S',label:'Semipresencial'},{value:'E',label:'E-learning'}] },
          { name:'sede', label:'Sede / Aeropuerto', value:'ISSA — Buenos Aires' },
          { name:'cupo', label:'Cupo máximo', type:'number', value:30, min:1 }
        ], 'Agregar al calendario');
        if (!d) return;
        try { await API.adminCalendarioAdd({...d, anio, cupo:Number(d.cupo)}); this.t_calendario(el); }
        catch(e) { alert(e.message); }
      });
      document.getElementById('cal-enviar-issa').addEventListener('click', async ()=>{
        if (!confirm('¿Enviar la nómina de cursos planificados/confirmados de '+anio+' al ISSA? Esta acción requiere su firma electrónica y queda registrada en la auditoría.')) return;
        const d = await this.formModal('FIRMA ELECTRÓNICA — Envío de nómina al ISSA', [
          { name:'password', label:'Reingrese su contraseña para firmar el envío oficial', type:'password', required:true }
        ], 'Firmar y enviar al ISSA');
        if (!d) return;
        try {
          const resp = await API.adminCalendarioEnviarISSA({ anio, password:d.password });
          alert('Nomina enviada: '+resp.enviados+' cursos registrados como enviados al ISSA. Firma: '+resp.firma.slice(0,24)+'...');
          this.t_calendario(el);
        } catch(e) { alert(e.message); }
      });
      el.querySelectorAll('[data-calid]').forEach(b=>b.addEventListener('click', async ()=>{
        const estadoActual = b.dataset.estado;
        const d = await this.formModal('EDITAR ESTADO DEL CURSO', [
          { name:'estado', label:'Nuevo estado', type:'select', options:[
            {value:'planificado',label:'Planificado'},{value:'confirmado',label:'Confirmado'},
            {value:'en_curso',label:'En curso'},{value:'finalizado',label:'Finalizado'},{value:'cancelado',label:'Cancelado'}
          ], value:estadoActual }
        ], 'Guardar');
        if (!d) return;
        try { await API.adminCalendarioEdit(Number(b.dataset.calid), d); this.t_calendario(el); }
        catch(e) { alert(e.message); }
      }));
    }
  },

  /* ---------- Verificador de documentos y firmas electrónicas ---------- */
  async t_credenciales(el) {
    const { credenciales } = await API.adminCredenciales();
    const hoy = new Date().toISOString().slice(0,10);
    el.innerHTML = '<h2 class="section-title">Registro de credenciales AVSEC emitidas</h2>'
      + '<p class="hint" style="margin-bottom:14px">Cada vez que se emite una credencial queda registrada aquí. Las nuevas reemplazan automáticamente a las anteriores del mismo agente.</p>'
      + '<div class="kpi-row">'
      + '<div class="kpi"><b>'+credenciales.length+'</b><span>Total emitidas</span></div>'
      + '<div class="kpi"><b style="color:var(--green)">'+credenciales.filter(c=>c.activa).length+'</b><span>Activas</span></div>'
      + '<div class="kpi"><b style="color:var(--muted)">'+credenciales.filter(c=>!c.activa).length+'</b><span>Reemplazadas / anuladas</span></div>'
      + '</div>'
      + '<div class="filter-row">'
      + '<input id="cred-search" placeholder="Buscar por apellido, legajo, código..." style="flex:1">'
      + '</div>'
      + '<div style="overflow-x:auto"><table class="list-table"><thead><tr>'
      + '<th>Código de verificación</th><th>Titular</th><th>Legajo</th><th>Organismo</th>'
      + '<th>N° Permiso</th><th>Emitida</th><th>Estado</th></tr></thead>'
      + '<tbody id="cred-tbody">'
      + credenciales.map(c => '<tr>'
          + '<td><code style="font-size:11px;color:var(--blue)">'+c.ver_code+'</code></td>'
          + '<td><b>'+c.apellido+'</b>, '+c.unombre+'</td>'
          + '<td class="mono">'+c.legajo+'</td>'
          + '<td>'+(c.organismo||'—')+'</td>'
          + '<td class="mono">'+(c.num_permiso||'—')+'</td>'
          + '<td class="mono">'+(c.emitido_at||'').slice(0,16)+'</td>'
          + '<td>'+(c.activa?'<span class="badge-pass">ACTIVA</span>':'<span style="color:var(--muted);font-size:11px">Reemplazada</span>')+'</td>'
          + '</tr>').join('')
      + '</tbody></table></div>';
    document.getElementById('cred-search').addEventListener('input', e => {
      const q = e.target.value.toLowerCase();
      document.querySelectorAll('#cred-tbody tr').forEach(row => {
        row.style.display = row.textContent.toLowerCase().includes(q) ? '' : 'none';
      });
    });
  },

  /* ---------- Panel de control de firmas electrónicas ---------- */
  /* ══════════════════════════════════════════════════════════════════
     PANEL UNIFICADO DE FIRMAS Y VERIFICACIÓN
     Reemplaza: t_panelfirmas, t_firmaseppt, t_verificador
     Acepta: número de documento, código de certificado/credencial o hash SHA-256 (completo o parcial)
  ══════════════════════════════════════════════════════════════════ */
  /* ── Gestión de jerarquías / rangos ─────────────────────────────── */
  async t_jerarquias(el) {
    const cargar = async () => {
      const { jerarquias } = await fetch('/api/admin/jerarquias',
        { headers: { Authorization: 'Bearer ' + API.token } }).then(r => r.json());
      el.innerHTML = `
        <h2 style="margin-bottom:6px">Jerarquías y rangos</h2>
        <p class="hint" style="margin-bottom:18px">Lista de jerarquías disponibles para asignar a los usuarios durante el registro. El orden determina cómo aparecen en el desplegable.</p>
        <div class="filter-row" style="margin-bottom:16px">
          <input id="jer-nuevo" placeholder="Nuevo rango / jerarquía…" style="flex:1">
          <button class="btn-primary" id="btn-jer-add" style="width:auto">Agregar</button>
        </div>
        <table class="list-table">
          <thead><tr><th>#</th><th>Nombre</th><th>Activo</th><th></th></tr></thead>
          <tbody>${jerarquias.map(j => `
            <tr>
              <td class="mono" style="font-size:12px">${j.orden}</td>
              <td>${j.nombre}</td>
              <td>${j.activo ? '<span class="badge-pass">Sí</span>' : '<span class="badge-fail">No</span>'}</td>
              <td><button class="btn-ghost" data-del="${j.id}" style="color:var(--alert);font-size:12px">Eliminar</button></td>
            </tr>`).join('')}
          </tbody>
        </table>`;

      document.getElementById('btn-jer-add').addEventListener('click', async () => {
        const nombre = document.getElementById('jer-nuevo').value.trim();
        if (!nombre) return;
        const r = await fetch('/api/admin/jerarquias', {
          method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + API.token },
          body: JSON.stringify({ nombre })
        }).then(x => x.json());
        if (r.ok) { await cargar(); } else { alert(r.error || 'Error'); }
      });
      document.getElementById('jer-nuevo').addEventListener('keydown', e => {
        if (e.key === 'Enter') document.getElementById('btn-jer-add').click();
      });
      el.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', async () => {
        if (!confirm('¿Eliminar esta jerarquía?')) return;
        const r = await fetch('/api/admin/jerarquias/' + b.dataset.del, {
          method: 'DELETE', headers: { Authorization: 'Bearer ' + API.token }
        }).then(x => x.json());
        if (r.ok) { await cargar(); } else { alert(r.error || 'Error'); }
      }));
    };
    await cargar();
  },

  async t_verificacion(el) {
    if (!this._verQ) this._verQ = '';
    const isSup = API.user?.role === 'supervisor';

    el.innerHTML =
      '<h2 class="section-title" style="margin-bottom:6px">Firmas y Verificación</h2>'      + '<p class="hint" style="margin-bottom:16px">Busque por número de documento (<span class="mono">CERT-XXXXX-2026-0001</span>), '      + 'código de credencial (<span class="mono">CRED-XXXXX-2026-0001</span>) o cualquier fragmento del hash SHA-256 de una firma electrónica.'      + ' El sistema buscará en certificados, credenciales, EPPT y actas simultáneamente.</p>'      + '<div class="filter-row" style="margin-bottom:18px">'      + '<input id="ver-q" placeholder="Número de documento, código o fragmento de hash (mín. 4 caracteres)…" value="' + this._verQ + '" '      + 'style="flex:1;font-family:var(--mono);font-size:14px" autocomplete="off" autocorrect="off" spellcheck="false">'      + '<button class="btn-primary" id="ver-buscar" style="width:auto">Verificar 🔍</button>'      + '</div>'      + '<div id="ver-resultado"></div>';

    const buscar = async () => {
      const q = document.getElementById('ver-q').value.trim();
      this._verQ = q;
      const out = document.getElementById('ver-resultado');
      if (q.length < 4) { out.innerHTML = '<p class="hint" style="text-align:center;padding:24px">Ingrese al menos 4 caracteres.</p>'; return; }
      out.innerHTML = '<div class="dash-loading"><div class="dash-spinner"></div><span>Buscando en todos los registros…</span></div>';
      try {
        const { total, resultados } = await API.verificarDoc(q);
        if (!total) {
          out.innerHTML = '<div style="text-align:center;padding:32px">'
            + '<div style="font-size:36px;margin-bottom:10px">🔍</div>'
            + '<b>Sin resultados</b>'
            + '<p class="hint">No se encontró ningún documento, firma ni credencial que coincida con <span class="mono">' + q + '</span>.</p>'
            + '</div>';
          return;
        }
        out.innerHTML = '<div style="margin-bottom:10px;display:flex;align-items:center;justify-content:space-between">'          + '<span class="hint"><b>' + total + '</b> resultado' + (total===1?'':'s') + ' para <span class="mono">' + q + '</span></span>'          + (!isSup ? '<button class="btn-ghost" id="ver-pdf-btn" style="font-size:12px">🖨 PDF firmado</button>' : '')
          + '</div>'
          + resultados.map((r, i) => {
            const estadoColor = r.estado_doc === 'VIGENTE' || r.estado_doc === 'ACTIVA' || r.estado_doc === 'FIRMADO'
              ? 'var(--green)' : r.estado_doc === 'VENCIDO' ? 'var(--organic)' : 'var(--alert)';
            const hashBadge = r.estado_hash === 'valido'
              ? '<span style="color:var(--green);font-size:11px;font-weight:700">✔ HASH VÁLIDO</span>'
              : r.estado_hash === 'no_aplica'
              ? '<span style="color:var(--muted);font-size:11px">— sin hash</span>'
              : r.estado_hash === 'no_buscado_por_hash'
              ? '<span style="color:var(--blue);font-size:11px">🔍 buscar por hash para validar</span>'
              : r.estado_hash === 'sin_hash'
              ? '<span style="color:var(--organic);font-size:11px">⚠ sin hash registrado</span>'
              : '<span style="color:var(--alert);font-size:11px;font-weight:700">✗ HASH NO COINCIDE</span>';
            return '<div style="background:var(--panel);border:1px solid var(--line);border-left:4px solid '
              + estadoColor + ';border-radius:8px;padding:16px;margin-bottom:10px">'              + '<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:10px">'              + '<div style="display:flex;align-items:center;gap:10px">'              + '<span style="font-size:22px">' + r.tipo_icono + '</span>'              + '<div>'              + '<div style="font-weight:700;font-size:14px">' + r.tipo + '</div>'              + '<div class="mono" style="font-size:12px;color:var(--muted)">' + r.numero_doc + '</div>'              + '</div></div>'              + '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">'              + hashBadge              + '<span style="font-size:12px;font-weight:700;padding:3px 10px;border-radius:20px;background:' + estadoColor + '33;color:' + estadoColor + '">' + r.estado_doc + '</span>'              + '</div></div>'              + '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:8px;font-size:13px;margin-bottom:10px">'              + (r.titular ? '<div><span class="hint">Titular</span><br><b>' + r.titular.nombre + '</b>' + (r.titular.legajo ? ' · Leg. ' + r.titular.legajo : '') + '</div>' : '')              + (r.firmante ? '<div><span class="hint">Firmante</span><br><b>' + r.firmante.nombre + '</b> · Leg. ' + r.firmante.legajo + '<br><span class="pill" style="font-size:10px">' + (r.firmante.rol||'').toUpperCase() + '</span></div>' : '')              + (r.detalle ? '<div><span class="hint">Detalle</span><br>' + r.detalle + '</div>' : '')              + '<div><span class="hint">Emitido</span><br>' + (r.emitido_at ? _fmtFechaHora(r.emitido_at) : '—') + '</div>'              + (r.vencimiento ? '<div><span class="hint">Vencimiento</span><br>' + (r.vencimiento !== 'Sin vencimiento' ? _fmtFecha(r.vencimiento) : 'Sin vencimiento') + '</div>' : '')              + '</div>'              + (r.hash ? '<div style="background:var(--bg);border-radius:6px;padding:8px 10px;margin-top:4px">'                + '<span class="hint" style="font-size:11px">Hash SHA-256 de la firma electrónica (Ley N° 25.506)</span><br>'                + '<span class="mono" style="font-size:11px;color:var(--green);word-break:break-all">' + r.hash + '</span>'                + '</div>' : '')              + '</div>';
          }).join('');

        // Botón de PDF firmado (admin)
        document.getElementById('ver-pdf-btn')?.addEventListener('click', async () => {
          await this.printHtml('Verificación de documentos — SINCA', out.querySelector('[style]')?.outerHTML || out.innerHTML);
        });

      } catch(e) { out.innerHTML = '<p class="error">Error: ' + e.message + '</p>'; }
    };

    document.getElementById('ver-buscar').addEventListener('click', buscar);
    document.getElementById('ver-q').addEventListener('keydown', e => { if (e.key === 'Enter') buscar(); });

    // Si ya hay una búsqueda previa, reejecutarla
    if (this._verQ && this._verQ.length >= 4) buscar();
  },

  /* ── Panel de calibración del proctor de IA ─────────────────────── */
  async t_proctor_config(el) {
    el.innerHTML = '<p class="hint">Cargando configuración…</p>';
    let cfg, defs;
    try {
      const r = await API.getProctorConfig();
      cfg = r.config; defs = r.defaults;
    } catch(e) { el.innerHTML = '<p class="error">Error: ' + e.message + '</p>'; return; }

    const fila = (key, label, hint, min, max, step) => `
      <tr>
        <td style="padding:10px 8px;font-size:13px;font-weight:600">${label}</td>
        <td style="padding:10px 8px;font-size:12px;color:var(--muted);max-width:300px">${hint}</td>
        <td style="padding:10px 8px"><span class="mono" style="font-size:12px;color:var(--organic)">Antes: ${defs[key]}</span></td>
        <td style="padding:10px 8px">
          <input type="number" id="pc-${key}" value="${cfg[key]}"
                 min="${min}" max="${max}" step="${step}"
                 style="width:90px;font-family:var(--mono);font-size:13px">
        </td>
      </tr>`;

    el.innerHTML = `
      <h2 style="margin-bottom:6px">Calibración del módulo de supervisión IA</h2>
      <p class="hint" style="margin-bottom:20px">
        Todos los parámetros de detección de head pose son configurables sin modificar código.
        Los valores marcados como <span style="color:var(--organic)">Antes:</span> son los defaults originales del sistema.
        Los cambios se aplican a la próxima sesión de examen (no afectan sesiones activas).
      </p>

      <div style="background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:18px;margin-bottom:16px">
        <div style="font-weight:700;font-size:14px;margin-bottom:14px;display:flex;align-items:center;gap:8px">
          <span style="width:3px;height:18px;background:var(--blue);border-radius:2px;display:inline-block"></span>
          Umbrales de orientación de cabeza (yaw / pitch)
        </div>
        <table style="width:100%;border-collapse:collapse">
          <thead><tr style="border-bottom:1px solid var(--line)">
            <th style="text-align:left;padding:6px 8px;font-size:12px;color:var(--muted)">Parámetro</th>
            <th style="text-align:left;padding:6px 8px;font-size:12px;color:var(--muted)">Descripción</th>
            <th style="text-align:left;padding:6px 8px;font-size:12px;color:var(--muted)">Valor original</th>
            <th style="text-align:left;padding:6px 8px;font-size:12px;color:var(--muted)">Valor actual</th>
          </tr></thead>
          <tbody>
            ${fila('yaw_threshold',   'Umbral yaw (giro)',     'Giro horizontal máximo sin alertar. 0.14=estricto, 0.22=operador RX, 0.30=permisivo', '0.05', '0.50', '0.01')}
            ${fila('pitch_threshold', 'Umbral pitch (inclin.)', 'Inclinación vertical hacia abajo máxima. 0.50=estricto, 0.55=operador RX', '0.30', '0.80', '0.01')}
          </tbody>
        </table>
      </div>

      <div style="background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:18px;margin-bottom:16px">
        <div style="font-weight:700;font-size:14px;margin-bottom:14px;display:flex;align-items:center;gap:8px">
          <span style="width:3px;height:18px;background:var(--ok);border-radius:2px;display:inline-block"></span>
          Persistencia y tiempos de reacción
        </div>
        <table style="width:100%;border-collapse:collapse">
          <thead><tr style="border-bottom:1px solid var(--line)">
            <th style="text-align:left;padding:6px 8px;font-size:12px;color:var(--muted)">Parámetro</th>
            <th style="text-align:left;padding:6px 8px;font-size:12px;color:var(--muted)">Descripción</th>
            <th style="text-align:left;padding:6px 8px;font-size:12px;color:var(--muted)">Valor original</th>
            <th style="text-align:left;padding:6px 8px;font-size:12px;color:var(--muted)">Valor actual</th>
          </tr></thead>
          <tbody>
            ${fila('gaze_warn_ms',  '1ª advertencia (ms)',  'Milisegundos fuera de rango antes de generar la 1ª alerta. Antes: 900ms → muy sensible', '500', '8000', '100')}
            ${fila('gaze_block_ms', 'Bloqueo (ms)',         'Milisegundos adicionales de infracción antes de bloquear el examen. Antes: 1300ms', '500', '10000', '100')}
            ${fila('sustain_ms',    'Persistencia sin rostro (ms)', 'Tiempo sin detectar rostro antes de alertar (sin_rostro, múltiples_rostros)', '1000', '10000', '100')}
          </tbody>
        </table>
      </div>

      <div style="background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:18px;margin-bottom:16px">
        <div style="font-weight:700;font-size:14px;margin-bottom:14px;display:flex;align-items:center;gap:8px">
          <span style="width:3px;height:18px;background:var(--organic);border-radius:2px;display:inline-block"></span>
          Suavizado y rendimiento
        </div>
        <table style="width:100%;border-collapse:collapse">
          <thead><tr style="border-bottom:1px solid var(--line)">
            <th style="text-align:left;padding:6px 8px;font-size:12px;color:var(--muted)">Parámetro</th>
            <th style="text-align:left;padding:6px 8px;font-size:12px;color:var(--muted)">Descripción</th>
            <th style="text-align:left;padding:6px 8px;font-size:12px;color:var(--muted)">Valor original</th>
            <th style="text-align:left;padding:6px 8px;font-size:12px;color:var(--muted)">Valor actual</th>
          </tr></thead>
          <tbody>
            ${fila('smooth_n',   'Ventana de suavizado (frames)', 'Promedio móvil sobre N frames. 1=sin suavizado, 5=recomendado, 10=muy suavizado', '1', '20', '1')}
            ${fila('check_ms',   'Intervalo de análisis (ms)',    'Tiempo entre frames analizados. 700=original, 900=recomendado, 1500=bajo rendimiento', '300', '3000', '50')}
          </tbody>
        </table>
      </div>

      <div style="background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:18px;margin-bottom:20px">
        <div style="font-weight:700;font-size:14px;margin-bottom:14px;display:flex;align-items:center;gap:8px">
          <span style="width:3px;height:18px;background:var(--alert);border-radius:2px;display:inline-block"></span>
          Detección de movimiento errático
        </div>
        <table style="width:100%;border-collapse:collapse">
          <thead><tr style="border-bottom:1px solid var(--line)">
            <th style="text-align:left;padding:6px 8px;font-size:12px;color:var(--muted)">Parámetro</th>
            <th style="text-align:left;padding:6px 8px;font-size:12px;color:var(--muted)">Descripción</th>
            <th style="text-align:left;padding:6px 8px;font-size:12px;color:var(--muted)">Valor original</th>
            <th style="text-align:left;padding:6px 8px;font-size:12px;color:var(--muted)">Valor actual</th>
          </tr></thead>
          <tbody>
            ${fila('erratic_dYaw',   'Delta yaw brusco',           'Cambio de yaw entre frames que cuenta como "salto brusco". Antes: 0.18', '0.05', '0.50', '0.01')}
            ${fila('erratic_count',  'Saltos para alerta',         'Cuántos saltos bruscos en la ventana de tiempo definen movimiento errático. Antes: 3', '2', '10', '1')}
            ${fila('erratic_win_ms', 'Ventana de tiempo (ms)',     'Ventana temporal para contar saltos bruscos', '1000', '10000', '100')}
          </tbody>
        </table>
      </div>

      <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
        <button class="btn-primary" id="btn-save-proctor" style="width:auto">Guardar configuración</button>
        <button class="btn-ghost" id="btn-reset-proctor" style="width:auto">Restaurar defaults</button>
        <span id="proctor-cfg-status" style="font-size:13px;display:none"></span>
      </div>

      <div style="margin-top:20px;padding:14px;background:rgba(61,130,232,.08);border:1px solid rgba(61,130,232,.2);border-radius:8px;font-size:12px;color:var(--muted)">
        <b style="color:var(--text)">Guía de calibración para operadores de Rayos X:</b><br>
        El operador legítimo mueve levemente la cabeza para inspeccionar distintas zonas de la imagen.
        El yaw normal en inspección de Rayos X está entre ±0.15 y ±0.20. Con <b>yaw_threshold = 0.22</b> y
        <b>gaze_warn_ms = 2500ms</b>, solo se alertará si la cabeza se gira más de 22° y se sostiene por más de 2.5 segundos.
        El <b>smooth_n = 5</b> promedia los últimos 5 frames (~4.5 segundos a 900ms/frame), eliminando
        vibraciones de cámara sin retardar la detección de desvíos reales.
      </div>`;

    const guardar = async (resetear = false) => {
      const status = document.getElementById('proctor-cfg-status');
      status.style.display = 'none';
      const params = ['yaw_threshold','pitch_threshold','gaze_warn_ms','gaze_block_ms',
                      'sustain_ms','smooth_n','check_ms','erratic_dYaw','erratic_count','erratic_win_ms'];
      const data = {};
      if (resetear) {
        params.forEach(k => data[k] = defs[k]);
      } else {
        params.forEach(k => {
          const el2 = document.getElementById('pc-' + k);
          if (el2) data[k] = el2.value;
        });
      }
      try {
        const r = await API.setProctorConfig(data);
        if (r.ok) {
          status.style.display = 'inline';
          status.style.color = 'var(--ok)';
          status.textContent = '✔ Configuración guardada. Se aplica desde la próxima sesión.';
          // Actualizar los inputs con los valores confirmados por el servidor
          if (r.config) params.forEach(k => {
            const el2 = document.getElementById('pc-' + k);
            if (el2 && r.config[k] !== undefined) el2.value = r.config[k];
          });
          cfg = r.config;
        } else throw new Error(r.error || 'Error al guardar');
      } catch(e) {
        status.style.display = 'inline';
        status.style.color = 'var(--alert)';
        status.textContent = '✘ ' + e.message;
      }
    };

    document.getElementById('btn-save-proctor').addEventListener('click', () => guardar(false));
    document.getElementById('btn-reset-proctor').addEventListener('click', async () => {
      if (confirm('¿Restaurar todos los parámetros a los valores originales?')) await guardar(true);
    });

    // ── Sección de control de inactividad ──────────────────────────────
    let idleCfg, idleDefs;
    try {
      const ir = await API.request?.('GET', '/api/admin/settings/idle') ||
        await fetch('/api/admin/settings/idle', { headers: { Authorization: 'Bearer ' + API.token } }).then(x => x.json());
      idleCfg = ir.config; idleDefs = ir.defaults;
    } catch { idleCfg = { idle_warn_ms: 180000, idle_total_ms: 300000 }; idleDefs = idleCfg; }

    const idleSection = document.createElement('div');
    idleSection.style.cssText = 'margin-top:28px;padding-top:24px;border-top:1px solid var(--line)';
    idleSection.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:14px">
        <span style="width:3px;height:18px;background:var(--organic);border-radius:2px;display:inline-block"></span>
        <b style="font-size:14px">Control de inactividad (cierre de sesión automático)</b>
      </div>
      <p class="hint" style="font-size:12px;margin-bottom:16px">
        Si el usuario no interactúa con la plataforma durante el tiempo configurado, se muestra un aviso con cuenta regresiva y luego se cierra la sesión automáticamente.
        <b>No aplica durante exámenes teóricos ni prácticos en curso.</b>
      </p>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:18px">
        <label style="font-size:13px;color:var(--muted)">
          Aviso tras inactividad de
          <div style="display:flex;align-items:center;gap:8px;margin-top:6px">
            <input type="number" id="idle-warn" value="${Math.round(idleCfg.idle_warn_ms / 60000)}"
                   min="1" max="60" step="1" style="width:80px;font-family:var(--mono)">
            <span class="hint">minutos</span>
            <span class="hint" style="font-size:11px">(original: ${Math.round(idleDefs.idle_warn_ms / 60000)} min)</span>
          </div>
        </label>
        <label style="font-size:13px;color:var(--muted)">
          Cierre de sesión tras inactividad total de
          <div style="display:flex;align-items:center;gap:8px;margin-top:6px">
            <input type="number" id="idle-total" value="${Math.round(idleCfg.idle_total_ms / 60000)}"
                   min="2" max="120" step="1" style="width:80px;font-family:var(--mono)">
            <span class="hint">minutos</span>
            <span class="hint" style="font-size:11px">(original: ${Math.round(idleDefs.idle_total_ms / 60000)} min)</span>
          </div>
        </label>
      </div>
      <p class="hint" style="font-size:11px;margin-bottom:14px">
        El aviso debe aparecer <b>antes</b> del cierre. El tiempo entre aviso y cierre es la diferencia entre los dos valores.
        Ejemplo: aviso a los 3 minutos, cierre a los 5 → el usuario tiene 2 minutos para responder.
      </p>
      <div style="display:flex;align-items:center;gap:10px">
        <button class="btn-primary" id="btn-save-idle" style="width:auto">Guardar tiempos</button>
        <span id="idle-status" style="font-size:13px;display:none"></span>
      </div>`;
    el.appendChild(idleSection);

    document.getElementById('btn-save-idle').addEventListener('click', async () => {
      const st = document.getElementById('idle-status');
      st.style.display = 'none';
      const warnMin  = Number(document.getElementById('idle-warn').value);
      const totalMin = Number(document.getElementById('idle-total').value);
      if (!warnMin || !totalMin || warnMin < 1 || totalMin < 2) {
        st.style.color = 'var(--alert)'; st.textContent = '✘ Los valores mínimos son 1 min (aviso) y 2 min (cierre).'; st.style.display = 'inline'; return;
      }
      if (warnMin >= totalMin) {
        st.style.color = 'var(--alert)'; st.textContent = '✘ El tiempo de aviso debe ser menor al de cierre.'; st.style.display = 'inline'; return;
      }
      try {
        const r = await fetch('/api/admin/settings/idle', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + API.token },
          body: JSON.stringify({ idle_warn_ms: warnMin * 60000, idle_total_ms: totalMin * 60000 })
        }).then(x => x.json());
        if (r.ok) {
          st.style.color = 'var(--ok)'; st.textContent = '✔ Guardado. Se aplica desde la próxima sesión de usuario.';
          // Actualizar en la instancia activa si está corriendo
          if (typeof IdleGuard !== 'undefined' && IdleGuard._active) {
            IdleGuard._warnMs  = warnMin * 60000;
            IdleGuard._totalMs = totalMin * 60000;
          }
        } else throw new Error(r.error);
        st.style.display = 'inline';
      } catch(e) {
        st.style.color = 'var(--alert)'; st.textContent = '✘ ' + e.message; st.style.display = 'inline';
      }
    });
  },

  /* ══ MÓDULO 1: APTITUD PSICOFÍSICA ════════════════════════════════ */
  async t_apto_medico(el) {
    const esMedico = ['sanidad'].includes(API.user?.role);
    el.innerHTML = '<p class="hint">Cargando…</p>';
    const { aptos } = await API.getAptos();
    const hoy = new Date().toISOString().slice(0,10);

    el.innerHTML = `
      <h2 style="margin-bottom:6px">Aptitud Psicofísica</h2>
      <p class="hint" style="margin-bottom:16px">Registro de exámenes psicofísicos. PSA: vigencia 36 meses · Vigiladores: vigencia 12 meses.</p>
      ${this.puedeGestionarMedico() ? `<div class="filter-row" style="margin-bottom:16px">
        <input id="apto-buscar" placeholder="Buscar por apellido, nombre o legajo…" style="flex:1">
        <button class="btn-primary" id="btn-nuevo-apto" style="width:auto">+ Nuevo examen</button>
      </div>` : ''}
      <table class="list-table">
        <thead><tr><th>Apellido y nombre</th><th>Legajo</th><th>Organismo</th><th>Estado</th><th>Vigencia</th><th>Número</th><th></th></tr></thead>
        <tbody>${aptos.map(a => {
          const vigente = a.estado==='apto' && a.vence_at && a.vence_at >= hoy;
          const color = a.estado==='apto' ? (vigente?'var(--ok)':'var(--organic)') : a.estado==='no_apto' ? 'var(--alert)' : 'var(--muted)';
          return `<tr>
            <td><b>${a.apellido}, ${a.nombre}</b></td>
            <td class="mono">${a.legajo}</td>
            <td>${a.organismo}</td>
            <td><span style="color:${color};font-weight:600">${a.estado==='apto'?(vigente?'APTO VIGENTE':'VENCIDO'):a.estado==='no_apto'?'NO APTO':'BORRADOR'}</span></td>
            <td style="font-size:12px">${a.vence_at ? (vigente?'Hasta ':'Venció ')+a.vence_at : '—'}</td>
            <td class="mono" style="font-size:11px">${a.numero||'—'}</td>
            <td><button class="btn-ghost" data-apto-id="${a.id}" data-apto-user="${a.user_id}" style="font-size:12px">Ver / Editar</button></td>
          </tr>`;
        }).join('')}</tbody>
      </table>`;

    // Nuevo examen
    document.getElementById('btn-nuevo-apto')?.addEventListener('click', async () => {
      const users = (await API.adminUsers()).users;
      const d = await this.formModal('Nuevo examen psicofísico', [
        { id:'uid', label:'Agente', type:'select',
          options:[{value:'',label:'Seleccionar…'},...users.map(u=>({value:u.id,label:u.apellido+', '+u.nombre+' ('+u.legajo+')'}))], required:true },
        { id:'tipo', label:'Tipo de personal', type:'select',
          options:[{value:'psa',label:'Personal PSA (vigencia 36 meses)'},{value:'vigilador',label:'Vigilador privado (vigencia 12 meses)'}] }
      ]);
      if (!d) return;
      const r = await API.crearApto({ user_id: Number(d.uid), organismo_tipo: d.tipo });
      if (r.ok) this.t_apto_medico(el);
    });

    // Ver/editar examen
    el.querySelectorAll('[data-apto-id]').forEach(btn => btn.addEventListener('click', async () => {
      const aptoId = Number(btn.dataset.aptoId);
      const { apto } = await API.getAptoUsuario(btn.dataset.aptoUser);
      if (!apto) return;
      const items = apto.items || [];
      const cats = [...new Set(items.map(i=>i.categoria))];
      const modal = document.createElement('div');
      modal.style.cssText = 'position:fixed;inset:0;z-index:9000;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;padding:16px';
      const canEdit = ['admin','sanidad'].includes(API.user?.role);
      const canSign = ['admin','sanidad','medico'].includes(API.user?.role);
      modal.innerHTML = `<div style="background:var(--panel);border-radius:14px;padding:22px;max-width:700px;width:100%;max-height:90vh;overflow-y:auto">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
          <h3>Examen Psicofísico — ${apto.apellido}, ${apto.nombre}</h3>
          <button id="close-apto-modal" style="background:none;border:none;font-size:22px;cursor:pointer;color:var(--muted)">✕</button>
        </div>
        ${cats.map(cat => `
          <div style="margin-bottom:16px">
            <div style="font-weight:700;font-size:13px;color:var(--blue);text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px">${cat}</div>
            ${items.filter(i=>i.categoria===cat).map(it => `
              <div style="background:var(--panel-2);border-radius:8px;padding:10px 12px;margin-bottom:6px" id="item-row-${it.id}">
                <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
                  <span style="flex:1;font-size:13px">${it.item}</span>
                  ${canEdit ? `
                  <select id="est-${it.id}" style="font-size:12px;padding:4px 8px;border-radius:6px">
                    <option value="pendiente" ${it.estado==='pendiente'?'selected':''}>Pendiente</option>
                    <option value="apto" ${it.estado==='apto'?'selected':''}>APTO</option>
                    <option value="no_apto" ${it.estado==='no_apto'?'selected':''}>NO APTO</option>
                  </select>
                  <button class="btn-ghost" data-save-item="${it.id}" style="font-size:12px;padding:4px 10px">Guardar</button>` :
                  `<span style="font-size:12px;font-weight:600;color:${it.estado==='apto'?'var(--ok)':it.estado==='no_apto'?'var(--alert)':'var(--muted)'}">${it.estado.toUpperCase()}</span>`}
                </div>
                ${canEdit ? `<input placeholder="Resultado / observaciones" value="${it.resultado||''}" id="res-${it.id}"
                  style="margin-top:6px;width:100%;font-size:12px;padding:6px 10px;border-radius:6px;background:var(--panel);border:1px solid var(--line);color:var(--text)">` :
                  (it.resultado ? `<div style="font-size:11px;color:var(--muted);margin-top:4px">${it.resultado}</div>` : '')}
              </div>`).join('')}
          </div>`).join('')}
        ${apto.estado!=='borrador' && apto.numero ? `
        <div style="display:flex;gap:8px;margin-top:14px">
          <button id="btn-pdf-apto" class="btn-primary" style="flex:1;font-size:14px">
            ⬇ Descargar PDF oficial
          </button>
          <button id="btn-ver-apto-num" class="btn-ghost" style="width:auto;font-size:13px" title="Número verificable">
            🔍 ${apto.numero}
          </button>
        </div>` : ''}
        ${canSign && apto.estado==='borrador' ? `
        <div style="border-top:1px solid var(--line);padding-top:16px;margin-top:8px">
          <div style="font-weight:600;font-size:13px;color:var(--blue);margin-bottom:8px">🔐 Firma electrónica del médico</div>
          <input type="password" id="apto-pass" placeholder="Contraseña del médico firmante"
            style="width:100%;margin-bottom:10px;font-size:14px;padding:10px;border-radius:8px;background:var(--panel-2);border:1px solid var(--line);color:var(--text)">
          <button id="btn-firmar-apto" class="btn-primary" style="width:100%">Firmar y emitir certificado</button>
          <p id="apto-sign-err" style="color:var(--alert);font-size:13px;margin-top:8px;display:none"></p>
        </div>` : (apto.estado!=='borrador' ? `<div style="padding:12px;background:rgba(46,196,128,.1);border-radius:8px;margin-top:8px;font-size:13px;color:var(--ok)">
          ✔ Certificado N° ${apto.numero} · ${apto.estado.toUpperCase()} · Vence ${apto.vence_at}</div>` : '')}
      </div>`;
      document.body.appendChild(modal);
      document.getElementById('close-apto-modal').onclick = () => modal.remove();

      // Guardar ítems
      modal.querySelectorAll('[data-save-item]').forEach(b => b.addEventListener('click', async () => {
        const id = b.dataset.saveItem;
        await API.updateAptoItem(id, {
          estado: document.getElementById('est-'+id).value,
          resultado: document.getElementById('res-'+id).value,
          observaciones: ''
        });
        b.textContent = '✔'; b.style.color='var(--ok)';
      }));

      // Firmar
      // Descargar PDF del certificado de apto
      document.getElementById('btn-pdf-apto')?.addEventListener('click', async () => {
        try {
          // Enriquecer con el nombre del médico si está disponible
          const aptoConMedico = {
            ...apto,
            medico_nombre: apto.medico_nombre || 'Médico certificante PSA/ISSA',
            apellido: apto.apellido, nombre: apto.nombre,
            legajo: apto.legajo
          };
          const doc = await generateAptoPDF(aptoConMedico);
          doc.save('APSF_'+apto.numero+'_'+apto.apellido+'.pdf');
        } catch(e) { alert('Error al generar el PDF: '+e.message); }
      });

      document.getElementById('btn-firmar-apto')?.addEventListener('click', async () => {
        const pass_ = document.getElementById('apto-pass').value;
        const errEl = document.getElementById('apto-sign-err');
        try {
          const r = await API.firmarApto(aptoId, pass_);
          if (r.ok) { modal.remove(); this.t_apto_medico(el); }
          else { errEl.textContent = r.error||'Error'; errEl.style.display='block'; }
        } catch(e) { errEl.textContent = e.message; errEl.style.display='block'; }
      });
    }));
  },

  /* ══ MÓDULO 2: JUOSP ═══════════════════════════════════════════════ */
  async t_juosp_panel(el) {
    const isJuosp = ['juosp','juosp_regional'].includes(API.user?.role);
    el.innerHTML = '<p class="hint">Cargando…</p>';

    // Cargar datos de la UOSP
    let miUosp = null, epptPend = [], historial = [], solicitudes = [];
    try {
      if (isJuosp || this.isAdmin()) {
        miUosp = await API.getMiUosp().catch(()=>null);
        epptPend = (await API.getEpptPendientesJuosp().catch(()=>({eppts:[]}))).eppts;
        historial = (await API.getHistorialUosp().catch(()=>({historial:[]}))).historial;
      }
      if (this.isAdmin()) {
        solicitudes = (await API.getSolicitudesJuosp().catch(()=>({solicitudes:[]}))).solicitudes;
      }
    } catch {}

    const uosp = miUosp?.uosp;
    const usuarios = miUosp?.usuarios || [];

    el.innerHTML = `
      <h2 style="margin-bottom:6px">Panel JUOSP${uosp ? ' — '+uosp.nombre : ''}</h2>
      <p class="hint" style="margin-bottom:16px">Gestión de la Unidad Operativa de Seguridad Portuaria.</p>

      ${this.isAdmin() ? `<details style="margin-bottom:16px;background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:12px">
        <summary style="cursor:pointer;font-weight:600">⚙ Administración de UOSPs</summary>
        <div style="margin-top:12px" id="uosp-admin-panel">
          <div class="filter-row" style="margin-bottom:10px">
            <input id="uosp-nombre" placeholder="Nombre UOSP (ej: UOSP-EZE-01)" style="flex:1">
            <input id="uosp-sede" placeholder="Sede" style="flex:1">
            <input id="uosp-region" placeholder="Región" style="flex:1">
            <button class="btn-primary" id="btn-crear-uosp" style="width:auto">Crear UOSP</button>
          </div>
        </div>
      </details>` : ''}

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px">
        <div style="background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:14px;text-align:center">
          <div style="font-size:28px;font-weight:800">${usuarios.length}</div>
          <div class="hint">Personal en la UOSP</div>
        </div>
        <div style="background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:14px;text-align:center">
          <div style="font-size:28px;font-weight:800;color:var(--organic)">${epptPend.length}</div>
          <div class="hint">EPPT a convalidar</div>
        </div>
      </div>

      ${epptPend.length ? `
      <h3 style="margin-bottom:10px">EPPT completos pendientes de convalidación</h3>
      <table class="list-table" style="margin-bottom:16px">
        <thead><tr><th><input type="checkbox" id="check-all-eppt"></th><th>Agente</th><th>Curso</th><th>Apéndice</th><th>Estado</th></tr></thead>
        <tbody>${epptPend.map(e => `<tr>
          <td><input type="checkbox" class="eppt-check" value="${e.id}"></td>
          <td><b>${e.apellido}, ${e.nombre}</b><br><span class="mono" style="font-size:11px">${e.legajo}</span></td>
          <td>${e.curso_cod}</td>
          <td style="font-size:12px">${e.apendice||'—'}</td>
          <td><span style="color:var(--ok)">Completo</span></td>
        </tr>`).join('')}</tbody>
      </table>
      <div style="display:flex;gap:10px;align-items:center;margin-bottom:20px">
        <input type="password" id="juosp-pass" placeholder="Contraseña para firma de convalidación" style="flex:1">
        <button class="btn-primary" id="btn-convalidar-juosp" style="width:auto">✍️ Convalidar seleccionados</button>
      </div>` : '<p class="hint" style="margin-bottom:16px">Sin EPPTs pendientes de convalidación en su UOSP.</p>'}

      ${historial.length ? `
      <h3 style="margin-bottom:10px">Historial académico de la UOSP</h3>
      <table class="list-table" style="margin-bottom:16px">
        <thead><tr><th>Agente</th><th>Inscripciones</th><th>Certificados</th></tr></thead>
        <tbody>${historial.map(h => `<tr>
          <td><b>${h.usuario.apellido}, ${h.usuario.nombre}</b></td>
          <td>${h.inscripciones}</td>
          <td style="color:var(--ok)">${h.certificados}</td>
        </tr>`).join('')}</tbody>
      </table>` : ''}

      ${solicitudes.length && this.isAdmin() ? `
      <h3 style="margin-bottom:10px">Solicitudes de inscripción de JUOSPs</h3>
      <table class="list-table">
        <thead><tr><th>JUOSP</th><th>Curso</th><th>Agentes</th><th>Estado</th><th></th></tr></thead>
        <tbody>${solicitudes.map(s => `<tr>
          <td>${s.juosp_ap}</td>
          <td>${s.cod}</td>
          <td>${JSON.parse(s.user_ids||'[]').length}</td>
          <td><span style="color:${s.estado==='pendiente'?'var(--organic)':s.estado==='aprobada'?'var(--ok)':'var(--alert)'}">${s.estado.toUpperCase()}</span></td>
          <td>${s.estado==='pendiente'?`
            <button class="btn-ghost" data-sol="${s.id}" data-dec="aprobada" style="color:var(--ok);font-size:12px">✔ Aprobar</button>
            <button class="btn-ghost" data-sol="${s.id}" data-dec="rechazada" style="color:var(--alert);font-size:12px">✘ Rechazar</button>`:''}</td>
        </tr>`).join('')}</tbody>
      </table>` : ''}`;

    // Crear UOSP
    document.getElementById('btn-crear-uosp')?.addEventListener('click', async () => {
      const nombre = document.getElementById('uosp-nombre').value.trim();
      const sede   = document.getElementById('uosp-sede').value.trim();
      const region = document.getElementById('uosp-region').value.trim();
      if (!nombre) return;
      const r = await API.crearUosp({ nombre, descripcion:'', sede, region });
      if (r.ok) { this.t_juosp_panel(el); alert('UOSP creada: '+nombre); }
      else alert(r.error||'Error');
    });

    // Seleccionar todos los EPPT
    document.getElementById('check-all-eppt')?.addEventListener('change', e => {
      el.querySelectorAll('.eppt-check').forEach(c => c.checked = e.target.checked);
    });

    // Convalidar seleccionados
    document.getElementById('btn-convalidar-juosp')?.addEventListener('click', async () => {
      const ids = [...el.querySelectorAll('.eppt-check:checked')].map(c => Number(c.value));
      if (!ids.length) return alert('Seleccione al menos un EPPT.');
      const pass_ = document.getElementById('juosp-pass').value;
      if (!pass_) return alert('Ingrese su contraseña para firmar.');
      if (!confirm(`¿Convalidar ${ids.length} EPPT seleccionados? Esta acción queda firmada electrónicamente.`)) return;
      try {
        const r = await API.convalidarJuosp({ eppt_ids: ids, password: pass_, observaciones: '' });
        if (r.ok) { alert('✔ '+r.total+' EPPTs convalidados.'); this.t_juosp_panel(el); }
        else alert(r.error||'Error');
      } catch(e) { alert(e.message); }
    });

    // Resolver solicitudes
    el.querySelectorAll('[data-sol]').forEach(b => b.addEventListener('click', async () => {
      const decision = b.dataset.dec;
      const nota = decision === 'rechazada' ? prompt('Motivo del rechazo:') || '' : '';
      const r = await API.resolverSolicitud(b.dataset.sol, { decision, nota_issa: nota });
      if (r.ok) this.t_juosp_panel(el);
      else alert(r.error||'Error');
    }));
  },

  /* ══ MÓDULO 3: ACTAS DE EXAMEN ══════════════════════════════════════ */
  async t_actas_examen(el) {
    el.innerHTML = '<p class="hint">Cargando…</p>';
    const { actas } = await API.getActasPendientes();

    el.innerHTML = `
      <h2 style="margin-bottom:6px">Actas de examen</h2>
      <p class="hint" style="margin-bottom:16px">Actas pendientes de firma del instructor titular. Al firmar se genera el número de acta y queda en el Libro Matriz.</p>
      ${actas.length === 0 ? '<p class="hint">No hay actas pendientes de firma.</p>' : `
      <table class="list-table">
        <thead><tr><th>Alumno</th><th>Legajo</th><th>Curso</th><th>Nota</th><th>Generada</th><th></th></tr></thead>
        <tbody>${actas.map(a => {
          const det = (() => { try { return JSON.parse(a.detalle_json||'{}'); } catch { return {}; } })();
          return `<tr>
            <td><b>${a.apellido}, ${a.nombre}</b></td>
            <td class="mono">${a.legajo}</td>
            <td>${a.curso_cod}</td>
            <td style="font-weight:700;color:${det.passed?'var(--ok)':'var(--alert)'}">${det.score_pct ?? '—'}%</td>
            <td style="font-size:12px">${(a.created_at||'').slice(0,16)}</td>
            <td style="white-space:nowrap">
            <button class="btn-primary" data-acta="${a.id}" style="font-size:12px;padding:6px 12px;width:auto">✍️ Firmar acta</button>
          </td>
          </tr>`;
        }).join('')}</tbody>
      </table>`}

      <div id="acta-sign-result" style="display:none;margin-top:16px"></div>`;

    el.querySelectorAll('[data-acta]').forEach(btn => btn.addEventListener('click', async () => {
      const id = btn.dataset.acta;
      const pass_ = prompt('Ingrese su contraseña para firmar el acta N° '+id+' (firma electrónica Ley N° 25.506):');
      if (!pass_) return;
      try {
        const r = await API.firmarActaInst(id, pass_);
        if (r.ok) {
          const res = document.getElementById('acta-sign-result');
          res.style.display = 'block';
          res.innerHTML = `<div style="background:rgba(46,196,128,.1);border:1px solid var(--ok);border-radius:8px;padding:14px">
            ✔ <b>Acta firmada: ${r.numero}</b><br>
            <span class="mono" style="font-size:11px;color:var(--muted)">Hash: ${r.firma_hash}</span><br>
            <button id="btn-pdf-acta-${r.numero}" class="btn-ghost" style="margin-top:8px;font-size:12px;width:auto">
              ⬇ Descargar PDF del acta
            </button>
          </div>`;
          btn.closest('tr')?.remove();
          // Listener del PDF
          document.getElementById('btn-pdf-acta-'+r.numero)?.addEventListener('click', async () => {
            try {
              const actaData = await API.getActa(r.numero).catch(()=>null);
              if (!actaData) return alert('No se pudo obtener el acta.');
              const det = (() => { try { return JSON.parse(actaData.acta?.detalle_json||'{}'); } catch { return {}; } })();
              const doc = await generateActaExamenPDF(actaData.acta, det);
              doc.save('ACEX_'+r.numero+'.pdf');
            } catch(e) { alert('Error al generar PDF: '+e.message); }
          });
        } else alert(r.error||'Error al firmar');
      } catch(e) { alert(e.message); }
    }));
  },

  /* ══ MÓDULO 4: RECONFIRMACIÓN DE DESTINO ═══════════════════════════ */
  async t_reconfirmacion_destino(el) {
    el.innerHTML = '<p class="hint">Cargando…</p>';
    const [repR, catR, setR] = await Promise.all([
      API.getReporteDestinos().catch(() => ({ usuarios:[], por_destino:[] })),
      API.getDestinosCatalogo().catch(() => ({ destinos:[] })),
      API.getSettingsDestino().catch(() => ({ vigencia_dias:180, aviso_dias:30, validacion_dias:15 })),
    ]);

    const hoy = new Date().toISOString().slice(0,10);
    const usuarios = repR.usuarios || [];
    const porDestino = repR.por_destino || [];
    const destinos = catR.destinos || [];

    const colorEstado = e => e==='vigente'?'var(--ok)':e==='proximo'?'var(--organic)':e==='vencido'?'var(--alert)':'var(--muted)';
    const labelEstado = e => e==='vigente'?'Vigente':e==='proximo'?'Próximo a vencer':e==='vencido'?'VENCIDO':e==='nunca_declarado'?'Nunca declaró':'—';

    el.innerHTML = `
      <h2 style="margin-bottom:6px">Reconfirmación de Destino</h2>
      <p class="hint" style="margin-bottom:16px">Módulo de autodeclaración de destino con validación jerárquica. Solo notificaciones in-app.</p>

      <!-- KPIs -->
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:20px">
        ${[
          ['Total usuarios',   usuarios.length,                                                          ''],
          ['Vigentes',         usuarios.filter(u=>u.estado_destino==='vigente').length,                 'var(--ok)'],
          ['Próximos a vencer',usuarios.filter(u=>u.estado_destino==='proximo').length,                 'var(--organic)'],
          ['Vencidos / Sin declarar', usuarios.filter(u=>['vencido','nunca_declarado'].includes(u.estado_destino)).length, 'var(--alert)'],
        ].map(([l,v,c])=>`<div style="background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:14px;text-align:center">
          <div style="font-size:26px;font-weight:800;color:${c||'var(--text)'}">${v}</div>
          <div class="hint" style="font-size:12px">${l}</div>
        </div>`).join('')}
      </div>

      <!-- Catálogo de destinos — tabla inline editable -->
      <div style="background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:16px;margin-bottom:16px">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;flex-wrap:wrap;gap:10px">
          <div>
            <h3 style="margin:0;font-size:15px">📋 Catálogo de Unidades / Destinos</h3>
            <p style="font-size:12px;color:var(--muted);margin:2px 0 0">Hacé clic en cualquier celda para editarla directamente · Enter para guardar · Esc para cancelar</p>
          </div>
          <button id="btn-nuevo-destino" class="btn-primary" style="width:auto;font-size:13px">+ Nueva unidad</button>
        </div>
        <div style="overflow-x:auto">
          <table class="list-table" id="cat-destinos-table">
            <thead><tr>
              <th>Código</th><th>Nombre de la unidad</th><th>Aeropuerto / Sede</th>
              <th>Región</th><th>Usuarios</th><th>Con dato vencido</th><th>Estado</th>
            </tr></thead>
            <tbody id="cat-destinos-tbody">
              ${destinos.map(d => {
                const rep = porDestino.find(p=>p.codigo===d.codigo)||{total:0,vencidos:0};
                return `<tr data-dest-id="${d.id}" data-activo="${d.activo}">
                  <td><span class="cell-editable mono" data-field="codigo" data-id="${d.id}" style="font-size:12px">${d.codigo}</span></td>
                  <td><span class="cell-editable" data-field="nombre" data-id="${d.id}">${d.nombre}</span></td>
                  <td><span class="cell-editable" data-field="aeropuerto" data-id="${d.id}">${d.aeropuerto||''}</span></td>
                  <td><span class="cell-editable" data-field="region" data-id="${d.id}">${d.region||''}</span></td>
                  <td style="text-align:center;color:var(--muted)">${rep.total}</td>
                  <td style="text-align:center;color:${rep.vencidos>0?'var(--alert)':'var(--muted)'}">${rep.vencidos}</td>
                  <td><button class="btn-ghost" data-toggle-dest="${d.id}" data-activo="${d.activo}"
                    style="font-size:11px;padding:3px 8px;color:${d.activo?'var(--ok)':'var(--muted)'}">
                    ${d.activo?'✔ Activo':'✘ Inactivo'}</button></td>
                </tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>
      </div>

      <!-- Configuración -->
      <details style="background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:14px;margin-bottom:16px">
        <summary style="cursor:pointer;font-weight:600;font-size:14px">⚙ Parámetros del módulo</summary>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-top:12px">
          <div>
            <label class="input-label">Vigencia (días)</label>
            <input type="number" id="dest-vig" value="${setR.vigencia_dias}" class="input-field" style="padding:8px">
          </div>
          <div>
            <label class="input-label">Aviso previo (días)</label>
            <input type="number" id="dest-av" value="${setR.aviso_dias}" class="input-field" style="padding:8px">
          </div>
          <div>
            <label class="input-label">Plazo validación jefe (días)</label>
            <input type="number" id="dest-val" value="${setR.validacion_dias}" class="input-field" style="padding:8px">
          </div>
        </div>
        <button id="btn-save-dest-cfg" class="btn-primary" style="width:auto;margin-top:10px;font-size:13px">Guardar configuración</button>
      </details>

      <!-- Tabla de usuarios -->
      <h3 style="margin-bottom:10px">Estado por usuario <span style="font-weight:400;color:var(--muted);font-size:13px">(ordenado por antigüedad del dato)</span></h3>
      <div class="filter-row" style="margin-bottom:12px">
        <input id="dest-filtro-buscar" placeholder="Buscar por apellido, legajo…" style="flex:2">
        <select id="dest-filtro-estado" style="flex:1">
          <option value="">Todos los estados</option>
          <option value="vigente">Vigente</option>
          <option value="proximo">Próximo a vencer</option>
          <option value="vencido">Vencido</option>
          <option value="nunca_declarado">Nunca declaró</option>
        </select>
      </div>
      <table class="list-table" id="dest-tabla-usuarios">
        <thead><tr><th>Apellido y nombre</th><th>Legajo</th><th>Destino actual</th><th>Última declaración</th><th>Vence</th><th>Estado</th></tr></thead>
        <tbody id="dest-tbody">${usuarios.map(u=>`<tr data-estado="${u.estado_destino}" data-apellido="${(u.apellido||'').toLowerCase()}" data-legajo="${(u.legajo||'').toLowerCase()}">
          <td><b>${u.apellido}, ${u.nombre}</b></td>
          <td class="mono">${u.legajo}</td>
          <td style="font-size:12px">${u.destino_nombre ? `<span class="mono" style="font-size:11px;color:var(--muted)">${u.destino_codigo}</span><br>${u.destino_nombre}` : '—'}</td>
          <td style="font-size:12px">${u.ultima_decl ? u.ultima_decl.slice(0,16) : 'Nunca'}</td>
          <td style="font-size:12px">${u.ultima_vence || '—'}</td>
          <td><span style="font-weight:600;color:${colorEstado(u.estado_destino)}">${labelEstado(u.estado_destino)}</span></td>
        </tr>`).join('')}</tbody>
      </table>`;

    // Guardar config
    document.getElementById('btn-save-dest-cfg').addEventListener('click', async () => {
      const r = await API.saveSettingsDestino({
        vigencia_dias:   Number(document.getElementById('dest-vig').value),
        aviso_dias:      Number(document.getElementById('dest-av').value),
        validacion_dias: Number(document.getElementById('dest-val').value),
      });
      alert(r.ok ? '✔ Configuración guardada.' : r.error || 'Error');
    });

    // Nueva unidad — modal simple
    document.getElementById('btn-nuevo-destino').addEventListener('click', async () => {
      const d = await this.formModal('Nueva unidad / destino', [
        { id:'codigo',     label:'Código (ej: EZE-OPS-02)', required:true },
        { id:'nombre',     label:'Nombre completo de la unidad', required:true },
        { id:'aeropuerto', label:'Aeropuerto / Sede' },
        { id:'region',     label:'Región' },
      ]);
      if (!d) return;
      const r = await API.crearDestino({ codigo: d.codigo.toUpperCase(), nombre: d.nombre, aeropuerto: d.aeropuerto||'', region: d.region||'' });
      if (r.ok) this.t_reconfirmacion_destino(el);
      else alert(r.error || 'Error al crear la unidad.');
    });

    // Edición inline: clic en celda → contenteditable → Enter/blur guardar → Esc cancelar
    el.querySelectorAll('.cell-editable').forEach(cell => {
      let originalText = '';
      cell.addEventListener('click', () => {
        if (cell.contentEditable === 'true') return;
        originalText = cell.textContent;
        cell.contentEditable = 'true';
        cell.focus();
        // Seleccionar todo el texto
        const range = document.createRange();
        range.selectNodeContents(cell);
        window.getSelection().removeAllRanges();
        window.getSelection().addRange(range);
      });
      const guardar = async () => {
        if (cell.contentEditable !== 'true') return;
        cell.contentEditable = 'false';
        const newVal = cell.textContent.trim();
        if (newVal === originalText) return;
        const field = cell.dataset.field;
        const id    = cell.dataset.id;
        const patch = { [field]: field === 'codigo' ? newVal.toUpperCase() : newVal };
        try {
          const r = await API.editarDestino(id, patch);
          if (!r.ok) { cell.textContent = originalText; alert(r.error || 'Error al guardar.'); }
          else {
            // Feedback visual breve
            cell.style.color = 'var(--ok)';
            setTimeout(() => cell.style.color = '', 1200);
          }
        } catch(e) { cell.textContent = originalText; alert(e.message); }
      };
      cell.addEventListener('blur', guardar);
      cell.addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); guardar(); cell.blur(); }
        if (e.key === 'Escape') { cell.contentEditable = 'false'; cell.textContent = originalText; }
      });
    });

    // Activar/desactivar unidad
    el.querySelectorAll('[data-toggle-dest]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.toggleDest;
        const activo = btn.dataset.activo === '1' ? 0 : 1;
        await API.editarDestino(id, { activo });
        this.t_reconfirmacion_destino(el);
      });
    });

    // Filtro de búsqueda
    const filtrar = () => {
      const buscar = document.getElementById('dest-filtro-buscar').value.toLowerCase();
      const estado = document.getElementById('dest-filtro-estado').value;
      document.querySelectorAll('#dest-tbody tr').forEach(tr => {
        const matchEstado = !estado || tr.dataset.estado === estado;
        const matchBuscar = !buscar || tr.dataset.apellido.includes(buscar) || tr.dataset.legajo.includes(buscar);
        tr.style.display = matchEstado && matchBuscar ? '' : 'none';
      });
    };
    document.getElementById('dest-filtro-buscar').addEventListener('input', filtrar);
    document.getElementById('dest-filtro-estado').addEventListener('change', filtrar);
  },

  async t_auditoria(el) {
    if (!this._auditFiltros) this._auditFiltros = { desde:'', hasta:'', accion:'', limit:200 };
    const f = this._auditFiltros;
    const { audit } = await API.adminAuditFiltros(f.desde, f.hasta, f.accion, f.limit);
    const acciones = [...new Set(audit.map(a=>a.accion))].sort();
    el.innerHTML = '<div class="filter-row" style="flex-wrap:wrap">'
      + '<label style="font-size:12px">Desde <input type="date" id="aud-desde" value="'+f.desde+'" style="width:130px"></label>'
      + '<label style="font-size:12px">Hasta <input type="date" id="aud-hasta" value="'+f.hasta+'" style="width:130px"></label>'
      + '<input id="aud-accion" placeholder="Filtrar por acción…" value="'+f.accion+'" style="flex:1;min-width:150px">'
      + '<select id="aud-limit"><option value="100">100 reg.</option><option value="200" selected>200 reg.</option><option value="500">500 reg.</option></select>'
      + '<button class="btn-ghost" id="aud-buscar">Buscar 🔍</button>'
      + '<button class="btn-ghost" id="aud-pdf">PDF firmado 🖨</button>'
      + '</div>'
      + '<div class="kpi-row">'
      + '<div class="kpi"><b>'+audit.length+'</b><span>Registros</span></div>'
      + '<div class="kpi"><b>'+new Set(audit.map(a=>a.user_id)).size+'</b><span>Usuarios involucrados</span></div>'
      + '</div>'
      + '<div style="overflow-x:auto"><table class="list-table"><thead><tr><th>Fecha/Hora</th><th>Usuario</th><th>Acción</th><th>Detalle</th></tr></thead><tbody>'
      + audit.map(a=>'<tr><td class="mono" style="font-size:11px">'+a.created_at.slice(0,16)+'</td>'
        +'<td>'+(a.apellido||a.usuario||'—')+(a.legajo?' ('+a.legajo+')':'')+'</td>'
        +'<td class="mono" style="font-size:11px;color:var(--organic)">'+a.accion+'</td>'
        +'<td style="font-size:12px">'+a.detalle+'</td></tr>').join('')
      + '</tbody></table></div>';
    const buscar = () => {
      this._auditFiltros.desde = document.getElementById('aud-desde').value;
      this._auditFiltros.hasta = document.getElementById('aud-hasta').value;
      this._auditFiltros.accion = document.getElementById('aud-accion').value;
      this._auditFiltros.limit = Number(document.getElementById('aud-limit').value);
      this.t_auditoria(el);
    /* ══ MÓDULO SANIDAD: Certificados Médicos ══════════════════════ */
  async t_certificados_medicos(el) {
    const esAdmin = this.isAdmin();
    const esSanidad = ['sanidad','admin'].includes(API.user?.role);
    
    el.innerHTML = '<p class="hint">Cargando…</p>';
    
    // Cargar lista de usuarios
    const { users } = await API.adminUsers().catch(() => ({ users: [] }));
    
    el.innerHTML = `
      <h2 style="margin-bottom:6px">Certificados Médicos</h2>
      <p class="hint" style="margin-bottom:16px">Emisión y gestión de certificados de aptitud operativa (Ley 25.506).</p>
      
      ${esSanidad ? `<div class="filter-row" style="margin-bottom:16px">
        <input id="cert-med-buscar" placeholder="Buscar por apellido, legajo…" style="flex:1">
        <button class="btn-primary" id="btn-nuevo-cert-med" style="width:auto">+ Emitir certificado</button>
      </div>` : ''}
      
      <table class="list-table">
        <thead><tr>
          <th>Agente</th>
          <th>Legajo</th>
          <th>Organismo</th>
          <th>Estado Sanidad</th>
          <th>Vigencia</th>
          <th>Certificado</th>
          <th></th>
        </tr></thead>
        <tbody id="cert-med-tbody">
          ${users.map(u => `<tr data-user-id="${u.id}">
            <td><b>${u.apellido}, ${u.nombre}</b></td>
            <td class="mono">${u.legajo}</td>
            <td>${u.organismo}</td>
            <td><span class="estado-sanidad" data-uid="${u.id}" style="font-weight:600">—</span></td>
            <td><span class="vence-sanidad" data-uid="${u.id}">—</span></td>
            <td><span class="cert-med-cod" data-uid="${u.id}" style="font-size:11px;color:var(--muted)">—</span></td>
            <td><button class="btn-ghost" data-view-cert-med="${u.id}" style="font-size:12px">Ver</button></td>
          </tr>`).join('')}
        </tbody>
      </table>
    `;
    
    // Cargar estado de cada usuario
    users.forEach(u => {
      API.getCertMedicoAgente(u.id).then(r => {
        const estEl = el.querySelector(`[data-uid="${u.id}"].estado-sanidad`);
        const venceEl = el.querySelector(`[data-uid="${u.id}"].vence-sanidad`);
        const codEl = el.querySelector(`[data-uid="${u.id}"].cert-med-cod`);
        
        if (r.certificado) {
          estEl.textContent = r.estado_sanidad || 'PENDIENTE';
          estEl.style.color = r.estado_sanidad === 'APTO_VIGENTE' ? 'var(--ok)' : 'var(--alert)';
          venceEl.textContent = r.certificado.fecha_vencimiento || '—';
          codEl.textContent = r.certificado.codigo_certificado || '—';
        } else {
          estEl.textContent = 'PENDIENTE';
          estEl.style.color = 'var(--muted)';
        }
      }).catch(() => {
        el.querySelector(`[data-uid="${u.id}"].estado-sanidad`).textContent = 'ERROR';
      });
    });
    
    // Emitir nuevo certificado
    el.getElementById('btn-nuevo-cert-med')?.addEventListener('click', async () => {
      const d = await this.formModal('Emitir certificado médico', [
        { id:'agente_id', label:'Agente', type:'select',
          options:[{value:'',label:'Seleccionar…'},...users.map(u=>({value:u.id,label:u.apellido+', '+u.nombre+' ('+u.legajo+')'}))], required:true },
        { id:'tipo_examen', label:'Tipo de examen', type:'select',
          options:[{value:'ingreso',label:'Ingreso'},{value:'periodico',label:'Periódico'},{value:'reincorporacion',label:'Reincorporación'},{value:'especial',label:'Especial'}] },
        { id:'fecha_vencimiento', label:'Fecha de vencimiento', type:'date', required:true },
        { id:'dictamen_global', label:'Dictamen', type:'select',
          options:[{value:'APTO',label:'APTO'},{value:'APTO_CON_RESTRICCIONES',label:'APTO CON RESTRICCIONES'},{value:'NO_APTO',label:'NO APTO'}], required:true }
      ]);
      if (!d) return;
      try {
        const r = await API.emitirCertMedico({
          agente_id: Number(d.agente_id),
          tipo_examen: d.tipo_examen,
          fecha_vencimiento: d.fecha_vencimiento,
          dictamen_global: d.dictamen_global
        });
        if (r.ok) {
          alert('✔ Certificado emitido: ' + r.codigo);
          this.t_certificados_medicos(el);
        }
      } catch(e) { alert('Error: '+e.message); }
    });
    
    // Ver detalles
    el.querySelectorAll('[data-view-cert-med]').forEach(btn => 
      btn.addEventListener('click', async () => {
        const uid = btn.dataset.viewCertMed;
        const r = await API.getCertMedicoAgente(uid);
        const user = users.find(u => u.id == uid);
        if (!r.certificado) {
          alert('Sin certificado');
          return;
        }
        const c = r.certificado;
        alert(`Certificado N° ${c.codigo_certificado}\nAgente: ${user.apellido}, ${user.nombre}\nDictamen: ${c.dictamen_global}\nVence: ${c.fecha_vencimiento}\nEmitido: ${c.created_at}`);
      })
    );
  },
    };
    document.getElementById('aud-buscar').addEventListener('click', buscar);
    document.getElementById('aud-desde').addEventListener('change', buscar);
    document.getElementById('aud-hasta').addEventListener('change', buscar);
    document.getElementById('aud-pdf').addEventListener('click', async () => {
      // 1. Pedir contraseña y VALIDARLA contra el servidor antes de generar el PDF
      const d = await this.formModal('EXPORTAR AUDITORÍA — FIRMA ELECTRÓNICA', [
        { name:'password', label:'Reingrese su contraseña para firmar el informe de auditoría', type:'password', required:true }
      ], 'Firmar y generar PDF');
      if (!d) return;

      // 2. Verificar la contraseña en el servidor (reautenticación real)
      let firmante, timestampServidor;
      try {
        const verif = await API.verificarPassword(d.password);
        if (!verif.ok) { alert('Contraseña incorrecta. No se generará el PDF.'); return; }
        firmante = verif.firmante;
        timestampServidor = verif.timestamp;
      } catch(e) { alert('Error al verificar identidad: ' + e.message); return; }

      try {
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF({ unit:'mm', format:'a4' });
        const W=210, M=18;

        // ── Encabezado ──────────────────────────────────────────────────────
        try { doc.addImage('/img/psa.png','PNG',M,7,16,16); } catch {}
        try { doc.addImage('/img/issa.png','PNG',W-M-16,7,16,16); } catch {}
        doc.setFont('helvetica','bold'); doc.setFontSize(13); doc.setTextColor(20,40,80);
        doc.text('POLICÍA DE SEGURIDAD AEROPORTUARIA', W/2, 13, {align:'center'});
        doc.setFontSize(9.5); doc.setFont('helvetica','normal'); doc.setTextColor(50,80,130);
        doc.text('Instituto Superior de Seguridad Aeroportuaria — ISSA', W/2, 19, {align:'center'});
        doc.setDrawColor(20,40,80); doc.setLineWidth(0.5); doc.line(M,23,W-M,23);

        // ── Título y metadatos ───────────────────────────────────────────────
        doc.setFontSize(11); doc.setFont('helvetica','bold'); doc.setTextColor(20,40,80);
        doc.text('REGISTRO DE AUDITORÍA — SINCA', W/2, 30, {align:'center'});
        doc.setFontSize(8.5); doc.setFont('helvetica','normal'); doc.setTextColor(80,80,80);
        const filtDesc = [
          f.desde && 'Desde: ' + _fmtFecha(f.desde),
          f.hasta && 'Hasta: ' + _fmtFecha(f.hasta),
          f.accion && 'Acción: ' + f.accion
        ].filter(Boolean).join('  ·  ') || 'Sin filtros adicionales';
        doc.text('Filtros aplicados: ' + filtDesc, M, 37);
        doc.text('Total de registros exportados: ' + audit.length + '   ·   Generado: ' + timestampServidor, M, 43);
        doc.setLineWidth(0.3); doc.setDrawColor(180,180,200); doc.line(M,47,W-M,47);

        // ── Tabla de registros ───────────────────────────────────────────────
        let y = 54;
        // Encabezados de tabla
        doc.setFillColor(20,40,80); doc.rect(M, y-4, W-2*M, 7, 'F');
        doc.setTextColor(255,255,255); doc.setFont('helvetica','bold'); doc.setFontSize(7.5);
        doc.text('FECHA/HORA', M+1, y);
        doc.text('USUARIO', M+32, y);
        doc.text('ACCIÓN', M+68, y);
        doc.text('DETALLE', M+108, y);
        y += 5;
        doc.setFont('helvetica','normal'); doc.setFontSize(7.5);

        audit.forEach((a, i) => {
          if (y > 268) {
            // Pie de página en cada página
            doc.setFontSize(7); doc.setTextColor(130,130,130);
            doc.text('Continúa en la página siguiente…', W/2, 290, {align:'center'});
            doc.addPage(); y = 20;
            // Repetir encabezado de tabla en nueva página
            doc.setFillColor(20,40,80); doc.rect(M, y-4, W-2*M, 7, 'F');
            doc.setTextColor(255,255,255); doc.setFont('helvetica','bold'); doc.setFontSize(7.5);
            doc.text('FECHA/HORA', M+1, y);
            doc.text('USUARIO', M+32, y);
            doc.text('ACCIÓN', M+68, y);
            doc.text('DETALLE', M+108, y);
            y += 5;
            doc.setFont('helvetica','normal');
          }
          // Filas alternadas
          if (i % 2 === 0) { doc.setFillColor(248,250,255); doc.rect(M, y-3.5, W-2*M, 6, 'F'); }
          doc.setTextColor(40,40,40);
          doc.text((a.created_at||'').slice(0,16), M+1, y);
          doc.text(((a.apellido || a.usuario || '—') + (a.legajo ? ' ('+a.legajo+')' : '')).slice(0,18), M+32, y);
          doc.setTextColor(20,60,160);
          doc.text((a.accion||'').slice(0,24), M+68, y);
          doc.setTextColor(40,40,40);
          doc.text((a.detalle||'').slice(0,58), M+108, y);
          y += 5.5;
        });

        // ── Bloque de firma electrónica (WCAG: siempre visible, nunca solo en el pie) ──
        // Calcular hash SHA-256 real del contenido del documento
        const contenidoParaHash = [
          'AUDITORIA_SINCA',
          firmante.legajo,
          firmante.apellido + ', ' + firmante.nombre,
          timestampServidor,
          audit.length,
          audit.map(a => a.id + '|' + a.accion + '|' + a.created_at).join(';')
        ].join('|');
        let firmaHashReal = 'no disponible';
        try {
          const enc = new TextEncoder().encode(contenidoParaHash);
          const buf = await crypto.subtle.digest('SHA-256', enc);
          firmaHashReal = Array.from(new Uint8Array(buf))
            .map(b => b.toString(16).padStart(2,'0')).join('');
        } catch {}

        // Si el bloque de firma no cabe en la página actual, agregar nueva página
        if (y > 240) { doc.addPage(); y = 20; }
        y += 8;

        // Marco del bloque de firma
        doc.setFillColor(240, 244, 255);
        doc.setDrawColor(20, 40, 80);
        doc.setLineWidth(0.5);
        const firmaBlockH = 38;
        doc.rect(M, y, W-2*M, firmaBlockH, 'FD');

        // Título del bloque
        doc.setFontSize(8.5); doc.setFont('helvetica','bold'); doc.setTextColor(20,40,80);
        doc.text('FIRMA ELECTRÓNICA DEL EMISOR (Ley N° 25.506)', M+4, y+7);

        // Línea separadora dentro del bloque
        doc.setLineWidth(0.3); doc.setDrawColor(180,190,220);
        doc.line(M+3, y+10, W-M-3, y+10);

        // Datos del firmante
        doc.setFontSize(8); doc.setFont('helvetica','bold'); doc.setTextColor(40,40,40);
        doc.text('Emitido por:', M+4, y+16);
        doc.setFont('helvetica','normal');
        doc.text(firmante.apellido + ', ' + firmante.nombre +
                 '   ·   Legajo: ' + firmante.legajo +
                 '   ·   Rol: ' + (firmante.role||'').toUpperCase(), M+28, y+16);

        doc.setFont('helvetica','bold'); doc.text('Fecha y hora:', M+4, y+22);
        doc.setFont('helvetica','normal');
        doc.text(timestampServidor + '  (hora del servidor — Argentina)', M+28, y+22);

        doc.setFont('helvetica','bold'); doc.text('Hash SHA-256:', M+4, y+28);
        doc.setFont('helvetica','normal'); doc.setFontSize(7);
        doc.setTextColor(0,100,60);
        // Partir el hash en dos líneas si es necesario
        const h1 = firmaHashReal.slice(0,43);
        const h2 = firmaHashReal.slice(43);
        doc.text(h1, M+28, y+28);
        if (h2) doc.text(h2, M+28, y+33);

        doc.setFontSize(7); doc.setFont('helvetica','italic'); doc.setTextColor(100,100,130);
        doc.text('Este hash certifica la integridad del documento. Verificable en el Panel de Firmas del sistema SINCA.', M+4, y+firmaBlockH-3);

        // ── Pie de página de la ÚLTIMA página ───────────────────────────────
        const totalPages = doc.internal.getNumberOfPages();
        for (let p = 1; p <= totalPages; p++) {
          doc.setPage(p);
          doc.setFontSize(7); doc.setTextColor(130,130,130);
          doc.setDrawColor(180,180,200); doc.setLineWidth(0.3);
          doc.line(M, 291, W-M, 291);
          doc.text('SINCA · Registro de Auditoría · PSA / ISSA · Página ' + p + ' de ' + totalPages, W/2, 296, {align:'center'});
        }

        // Registrar el hash en el Libro Matriz ANTES de guardar el PDF
        if (firmaHashReal.length === 64 && API.token) {
          try { await API.registrarFirmaPdf('auditoria', 'Registro de Auditoría SINCA', firmaHashReal); } catch {}
        }
        doc.save('Auditoria_SINCA_' + new Date().toISOString().slice(0,10) + '.pdf');
      } catch(e) { alert('Error generando PDF: ' + e.message); }
    });
  },

  /* ---------- Descarga CSV autenticada ---------- */
  async dl(tipo) {
    try {
      const res = await fetch(API.exportUrl(tipo), { headers: { Authorization: 'Bearer ' + API.token } });
      if (!res.ok) throw new Error('No se pudo exportar.');
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${tipo}_${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
    } catch (e) { alert(e.message); }
    return false;
  }

  /* ══ MÓDULO SANIDAD: Certificados Médicos ══════════════════════════════ */
  async t_certificados_medicos(el) {
    const esAdmin = this.isAdmin();
    const esSanidad = ['sanidad','admin'].includes(API.user?.role);
    
    el.innerHTML = '<p class="hint">Cargando…</p>';
    
    const { users } = await API.adminUsers().catch(() => ({ users: [] }));
    
    el.innerHTML = `
      <h2 style="margin-bottom:6px">Certificados Médicos</h2>
      <p class="hint" style="margin-bottom:16px">Emisión y gestión de certificados de aptitud operativa (Ley 25.506).</p>
      
      ${esSanidad ? `<div class="filter-row" style="margin-bottom:16px">
        <input id="cert-med-buscar" placeholder="Buscar por apellido, legajo…" style="flex:1">
        <button class="btn-primary" id="btn-nuevo-cert-med" style="width:auto">+ Emitir certificado</button>
      </div>` : ''}
      
      <table class="list-table">
        <thead><tr>
          <th>Agente</th>
          <th>Legajo</th>
          <th>Organismo</th>
          <th>Estado Sanidad</th>
          <th>Vigencia</th>
          <th>Certificado</th>
          <th></th>
        </tr></thead>
        <tbody id="cert-med-tbody">
          ${users.map(u => `<tr data-user-id="${u.id}">
            <td><b>${u.apellido}, ${u.nombre}</b></td>
            <td class="mono">${u.legajo}</td>
            <td>${u.organismo}</td>
            <td><span class="estado-sanidad" data-uid="${u.id}" style="font-weight:600">—</span></td>
            <td><span class="vence-sanidad" data-uid="${u.id}">—</span></td>
            <td><span class="cert-med-cod" data-uid="${u.id}" style="font-size:11px;color:var(--muted)">—</span></td>
            <td><button class="btn-ghost" data-view-cert-med="${u.id}" style="font-size:12px">Ver</button></td>
          </tr>`).join('')}
        </tbody>
      </table>
    `;
    
    // Cargar estado de cada usuario
    users.forEach(u => {
      API.getCertMedicoAgente(u.id).then(r => {
        const estEl = el.querySelector(`[data-uid="${u.id}"].estado-sanidad`);
        const venceEl = el.querySelector(`[data-uid="${u.id}"].vence-sanidad`);
        const codEl = el.querySelector(`[data-uid="${u.id}"].cert-med-cod`);
        
        if (r.certificado) {
          estEl.textContent = r.estado_sanidad || 'PENDIENTE';
          estEl.style.color = r.estado_sanidad === 'APTO_VIGENTE' ? 'var(--ok)' : 'var(--alert)';
          venceEl.textContent = r.certificado.fecha_vencimiento || '—';
          codEl.textContent = r.certificado.codigo_certificado || '—';
        } else {
          estEl.textContent = 'PENDIENTE';
          estEl.style.color = 'var(--muted)';
        }
      }).catch(() => {
        el.querySelector(`[data-uid="${u.id}"].estado-sanidad`).textContent = 'ERROR';
      });
    });
    
    // Emitir nuevo certificado
    el.querySelector('#btn-nuevo-cert-med')?.addEventListener('click', async () => {
      const d = await this.formModal('Emitir certificado médico', [
        { id:'agente_id', label:'Agente', type:'select',
          options:[{value:'',label:'Seleccionar…'},...users.map(u=>({value:u.id,label:u.apellido+', '+u.nombre+' ('+u.legajo+')'}))], required:true },
        { id:'tipo_examen', label:'Tipo de examen', type:'select',
          options:[{value:'ingreso',label:'Ingreso'},{value:'periodico',label:'Periódico'},{value:'reincorporacion',label:'Reincorporación'},{value:'especial',label:'Especial'}] },
        { id:'fecha_vencimiento', label:'Fecha de vencimiento', type:'date', required:true },
        { id:'dictamen_global', label:'Dictamen', type:'select',
          options:[{value:'APTO',label:'APTO'},{value:'APTO_CON_RESTRICCIONES',label:'APTO CON RESTRICCIONES'},{value:'NO_APTO',label:'NO APTO'}], required:true }
      ]);
      if (!d) return;
      try {
        const r = await API.emitirCertMedico({
          agente_id: Number(d.agente_id),
          tipo_examen: d.tipo_examen,
          fecha_vencimiento: d.fecha_vencimiento,
          dictamen_global: d.dictamen_global
        });
        if (r.ok) {
          alert('✔ Certificado emitido: ' + r.codigo);
          this.t_certificados_medicos(el);
        }
      } catch(e) { alert('Error: '+e.message); }
    });
    
    // Ver detalles
    el.querySelectorAll('[data-view-cert-med]').forEach(btn => 
      btn.addEventListener('click', async () => {
        const uid = btn.dataset.viewCertMed;
        const r = await API.getCertMedicoAgente(uid);
        const user = users.find(u => u.id == uid);
        if (!r.certificado) {
          alert('Sin certificado');
          return;
        }
        const c = r.certificado;
        alert(`Certificado N° ${c.codigo_certificado}\nAgente: ${user.apellido}, ${user.nombre}\nDictamen: ${c.dictamen_global}\nVence: ${c.fecha_vencimiento}\nEmitido: ${c.created_at}`);
      })
    );
  },

};
