/**
 * seed_pnisac.js — Catálogo de cursos del PNISAC (Apéndice 2)
 * Cargas horarias, modalidades, destinatarios, vigencias y contenidos mínimos
 * según el Programa Nacional de Instrucción en Seguridad de la Aviación Civil.
 * Los bancos de preguntas son editables por el docente desde la plataforma.
 */

// modalidad: P = Presencial, S = Semipresencial, E = E-learning
// vigencia_meses: 0 = sin recurrencia fija (ver observaciones)
// simulador: true = el práctico usa el simulador de rayos X integrado

const COURSES = [
  {
    cod: 'COD-PSA 001', nombre: 'Curso de Seguridad Aeroportuaria — Básico',
    destinatarios: 'Personal de explotadores y concesionarios con responsabilidades AVSEC, personal del Decreto N° 157/06 y personal de la PSA',
    horas: 36, horas_teoricas: 30, horas_practicas: 6, modalidades: 'P,S',
    vigencia_meses: 12, recurrente_cod: 'COD-PSA 001/A', nota_min: 70,
    asistencia_min: 90, simulador: false,
    unidades: [
      'Marco jurídico AVSEC y actos de interferencia ilícita',
      'Actividades sospechosas y perfilación de comportamiento',
      'Puntos de control de acceso y sistema de permisos',
      'Registro de pasajeros y equipaje',
      'Objetos prohibidos y métodos de ocultamiento',
      'Custodia de personas',
      'Contingencias aeroportuarias'
    ]
  },
  {
    cod: 'COD-PSA 001/A', nombre: 'Curso de Seguridad Aeroportuaria — Actualización',
    destinatarios: 'Mismos destinatarios que el curso básico (recurrencia anual)',
    horas: 5, horas_teoricas: 5, horas_practicas: 0, modalidades: 'P,E',
    vigencia_meses: 12, recurrente_cod: null, nota_min: 70, asistencia_min: 100, simulador: false,
    unidades: [
      'Repaso y modificaciones del marco jurídico',
      'Sistema de permisos: novedades',
      'Objetos prohibidos: actualización',
      'Control de acceso e inspección de aeronaves'
    ]
  },
  {
    cod: 'COD-PSA 002', nombre: 'Curso de Operación de Equipos de Rayos X e Interpretación de Imágenes — Básico',
    destinatarios: 'Personal de la PSA y personal del Decreto N° 157/06',
    horas: 26, horas_teoricas: 20, horas_practicas: 6, modalidades: 'P,S',
    vigencia_meses: 12, recurrente_cod: 'COD-PSA 002/A', nota_min: 70,
    asistencia_min: 100, simulador: true,
    unidades: [
      'Radio-física sanitaria y protección radiológica',
      'Componentes del equipo de rayos X',
      'Procesamiento e interpretación de imágenes (pseudocolor, filtros, penetración)',
      'Métodos de ocultamiento de armas y explosivos',
      'Artefactos Explosivos Improvisados (AEI): componentes y detección',
      'Mercancías peligrosas'
    ]
  },
  {
    cod: 'COD-PSA 002/A', nombre: 'Curso de Operación de Equipos de Rayos X e Interpretación de Imágenes — Actualización',
    destinatarios: 'Personal de la PSA y personal del Decreto N° 157/06 (recurrencia anual)',
    horas: 8, horas_teoricas: 4, horas_practicas: 4, modalidades: 'P,S,E',
    vigencia_meses: 12, recurrente_cod: null, nota_min: 70, asistencia_min: 100, simulador: true,
    unidades: [
      'Repaso de principios de operación',
      'Procesamiento de imágenes: repaso aplicado',
      'Mercancías peligrosas: actualización',
      'Nuevas técnicas de ocultamiento'
    ]
  },
  {
    cod: 'COD-PSA 003', nombre: 'Curso Seguridad Aeroportuaria para Transporte de Caudales — Básico',
    destinatarios: 'Personal abocado al transporte de caudales en el ámbito aeroportuario',
    horas: 6, horas_teoricas: 6, horas_practicas: 0, modalidades: 'P,E',
    vigencia_meses: 12, recurrente_cod: 'COD-PSA 003/A', nota_min: 70, asistencia_min: 100, simulador: false,
    unidades: [
      'Sistema de permisos aeroportuarios',
      'Reglas de movimiento en el área de operaciones',
      'Control de accesos y comunicaciones',
      'Procedimientos de transporte en zona pública y restringida'
    ]
  },
  {
    cod: 'COD-PSA 003/A', nombre: 'Curso Seguridad Aeroportuaria para Transporte de Caudales — Actualización',
    destinatarios: 'Personal abocado al transporte de caudales (recurrencia anual)',
    horas: 3, horas_teoricas: 3, horas_practicas: 0, modalidades: 'P,E',
    vigencia_meses: 12, recurrente_cod: null, nota_min: 70, asistencia_min: 100, simulador: false,
    unidades: ['Actualización normativa y repaso de procedimientos de transporte de caudales']
  },
  {
    cod: 'COD-PSA 004', nombre: 'Curso Supervisor de Seguridad Aeroportuaria',
    destinatarios: 'Personal de la PSA y personal de explotadores/concesionarios con personal a cargo',
    horas: 20, horas_teoricas: 20, horas_practicas: 0, modalidades: 'P,S',
    vigencia_meses: 24, recurrente_cod: null, nota_min: 70, asistencia_min: 100, simulador: false,
    unidades: [
      'Planificación de recursos humanos',
      'Organización de turnos y dotaciones',
      'Evaluación de personal y entrevistas',
      'Verificación de medios técnicos',
      'Redacción de reportes de incidentes'
    ]
  },
  {
    cod: 'COD-PSA 005', nombre: 'Curso Seguridad Aeroportuaria en Terminales Aéreas de Carga y Correo',
    destinatarios: 'Personal de la PSA, explotadores aerocomerciales y agentes de escala/carga',
    horas: 36, horas_teoricas: 30, horas_practicas: 6, modalidades: 'P,S',
    vigencia_meses: 24, recurrente_cod: null, nota_min: 70, asistencia_min: 100, simulador: false,
    unidades: [
      'Cadena de custodia de la carga',
      'Métodos de inspección según naturaleza de la carga',
      'Mercancías peligrosas ocultas',
      'Procedimientos para aeronaves de carga'
    ]
  },
  {
    cod: 'COD-PSA 006', nombre: 'Curso Gestión de la Seguridad Aeroportuaria',
    destinatarios: 'Personal de la PSA, gerencias de empresas aerocomerciales y concesionarios',
    horas: 30, horas_teoricas: 30, horas_practicas: 0, modalidades: 'P,S',
    vigencia_meses: 24, recurrente_cod: null, nota_min: 70, asistencia_min: 100, simulador: false,
    unidades: [
      'Evaluación de amenaza y riesgo',
      'Elaboración de programas de seguridad',
      'Planificación financiera y de RRHH',
      'Control de calidad AVSEC'
    ]
  },
  {
    cod: 'COD-PSA 007', nombre: 'Curso Concienciación en Seguridad Aeroportuaria',
    destinatarios: 'Personal con permiso aeroportuario sin responsabilidades específicas AVSEC (comunidad aeroportuaria)',
    horas: 4, horas_teoricas: 4, horas_practicas: 0, modalidades: 'P,E',
    vigencia_meses: 0, recurrente_cod: null, nota_min: 70, asistencia_min: 100, simulador: false,
    observaciones: 'Se actualiza ante cada renovación del Permiso Personal Aeroportuario.',
    unidades: [
      'Conceptos AVSEC básicos',
      'Actos de interferencia ilícita',
      'Sistema de permisos y sectores del aeropuerto',
      'Contingencias: cómo actuar ante amenaza de bomba'
    ]
  },
  {
    cod: 'COD-PSA 008', nombre: 'Curso Inspector Nacional en Seguridad de la Aviación Civil',
    destinatarios: 'Personal de la PSA',
    horas: 50, horas_teoricas: 40, horas_practicas: 10, modalidades: 'P,S',
    vigencia_meses: 24, recurrente_cod: null, nota_min: 70, asistencia_min: 100, simulador: false,
    unidades: [
      'Marco del control de calidad AVSEC',
      'Técnicas de auditoría e inspección',
      'Actividades prácticas de auditoría en terreno aeroportuario',
      'Redacción de hallazgos e informes'
    ]
  },
  {
    cod: 'COD-PSA 009', nombre: 'Curso Instructor Nacional en Seguridad de la Aviación Civil',
    destinatarios: 'Personal de la PSA',
    horas: 55, horas_teoricas: 45, horas_practicas: 10, modalidades: 'P,S',
    vigencia_meses: 24, recurrente_cod: null, nota_min: 70, asistencia_min: 100, simulador: false,
    observaciones: 'Para mantener la certificación el instructor debe dictar un mínimo de 20 horas/reloj de clases al año.',
    unidades: [
      'Elementos de la presentación oral',
      'Uso de ayudas visuales',
      'Armado de diapositivas y material didáctico',
      'Desarrollo y conducción de clases'
    ]
  },
  {
    cod: 'COD-PSA 010', nombre: 'Taller Manejo de Crisis',
    destinatarios: 'Personal de PSA, Fuerzas de Seguridad, Justicia Federal y actores del plan de contingencia',
    horas: 20, horas_teoricas: 14, horas_practicas: 6, modalidades: 'P,S',
    vigencia_meses: 0, recurrente_cod: null, nota_min: 70, asistencia_min: 100, simulador: false,
    unidades: [
      'Estructura de manejo de crisis',
      'Toma de decisiones bajo presión',
      'Trabajo final: simulacro de contingencia grupal'
    ]
  },
  {
    cod: 'COD-PSA 011', nombre: 'Curso Agente de Control de Calidad Interno',
    destinatarios: 'Personal de la PSA, explotadores y concesionarios',
    horas: 16, horas_teoricas: 16, horas_practicas: 0, modalidades: 'P,S',
    vigencia_meses: 24, recurrente_cod: null, nota_min: 70, asistencia_min: 100, simulador: false,
    unidades: [
      'Comportamiento ético del agente de control',
      'Técnicas de formulación de preguntas y entrevistas',
      'Ejecución del plan de control de calidad interno',
      'Redacción de informes'
    ]
  },
  {
    cod: 'COD-PSA 012', nombre: 'Taller Pruebas de Seguridad',
    destinatarios: 'Personal de la PSA',
    horas: 12, horas_teoricas: 6, horas_practicas: 6, modalidades: 'P',
    vigencia_meses: 0, recurrente_cod: null, nota_min: 70, asistencia_min: 100, simulador: false,
    unidades: [
      'Preparación de pruebas de seguridad',
      'Artículos normalizados de prueba',
      'Ejecución y registro de pruebas'
    ]
  },
  {
    cod: 'COD-PSA 013', nombre: 'Taller de Gestión del Riesgo',
    destinatarios: 'Personal de la PSA',
    horas: 20, horas_teoricas: 20, horas_practicas: 0, modalidades: 'P,S',
    vigencia_meses: 0, recurrente_cod: null, nota_min: 70, asistencia_min: 100, simulador: false,
    unidades: [
      'Concepto de gestión del riesgo',
      'Mitigación de riesgos AVSEC',
      'Actualización de niveles de amenaza y vulnerabilidad'
    ]
  },
  {
    cod: 'COD-PSA 014', nombre: 'Taller Preparación de Ejercicios de Seguridad',
    destinatarios: 'Personal de la PSA',
    horas: 15, horas_teoricas: 9, horas_practicas: 6, modalidades: 'P',
    vigencia_meses: 0, recurrente_cod: null, nota_min: 70, asistencia_min: 100, simulador: false,
    unidades: [
      'Planificación de simulacros de contingencia',
      'Ejecución de ejercicios',
      'Evaluación y lecciones aprendidas'
    ]
  },
  {
    cod: 'COD-PSA 015', nombre: 'Curso de Operación de Sistemas de Inspección por Tomografía Computarizada',
    destinatarios: 'Personal de la PSA y del Decreto N° 157/06',
    horas: 12, horas_teoricas: 6, horas_practicas: 6, modalidades: 'P',
    vigencia_meses: 12, recurrente_cod: null, nota_min: 70, asistencia_min: 100, simulador: true,
    unidades: [
      'Principios operacionales de la tomografía computarizada',
      'Interpretación de imágenes volumétricas',
      'Aplicación práctica en inspección de equipaje'
    ]
  },
  {
    cod: 'COD-PSA 016', nombre: 'Curso de Operación Equipo Body Scanner',
    destinatarios: 'Personal perteneciente a la PSA',
    horas: 10, horas_teoricas: 5, horas_practicas: 5, modalidades: 'P',
    vigencia_meses: 12, recurrente_cod: null, nota_min: 70, asistencia_min: 100, simulador: false,
    unidades: [
      'Radio-física sanitaria del equipo',
      'Interpretación de imágenes corporales',
      'Detección de elementos: introducido, ingestado y envainado'
    ]
  },
  {
    cod: 'COD-PSA 017', nombre: 'Curso de Operación Sistemas de Detección por Ondas Milimétricas',
    destinatarios: 'Personal perteneciente a la PSA',
    horas: 10, horas_teoricas: 5, horas_practicas: 5, modalidades: 'P',
    vigencia_meses: 12, recurrente_cod: null, nota_min: 70, asistencia_min: 100, simulador: false,
    unidades: [
      'Concepto de ondas milimétricas (MMW)',
      'Autocalibración del equipo',
      'Detección por indicadores'
    ]
  },
  {
    cod: 'COD-PSA 018', nombre: 'Curso de Operación Equipos de Detección por Trazas',
    destinatarios: 'Personal de la PSA y del Decreto N° 157/06',
    horas: 6, horas_teoricas: 3, horas_practicas: 3, modalidades: 'P',
    vigencia_meses: 12, recurrente_cod: null, nota_min: 70, asistencia_min: 100, simulador: false,
    unidades: [
      'Operación segura del equipo de trazas',
      'Ejercicios prácticos de detección'
    ]
  },
  {
    cod: 'COD-PSA 019', nombre: 'Curso Capacitador en Seguridad de la Aviación',
    destinatarios: 'Personal de organismos públicos o privados con Plan de Capacitación aprobado',
    horas: 55, horas_teoricas: 45, horas_practicas: 10, modalidades: 'P,S',
    vigencia_meses: 24, recurrente_cod: null, nota_min: 70, asistencia_min: 100, simulador: false,
    unidades: [
      'Presentaciones orales para instrucción AVSEC',
      'Ayudas visuales y material didáctico',
      'Desarrollo de temáticas AVSEC'
    ]
  },
  {
    cod: 'COD-PSA 020', nombre: 'Taller Cultura de la Seguridad de la Aviación',
    destinatarios: 'Personal gerencial de organismos públicos/privados y personal de la PSA',
    horas: 8, horas_teoricas: 8, horas_practicas: 0, modalidades: 'P,S',
    vigencia_meses: 0, recurrente_cod: null, nota_min: 70, asistencia_min: 100, simulador: false,
    unidades: [
      'Elementos de la cultura de seguridad',
      'Casos de estudio',
      'Aplicación práctica en la organización'
    ]
  }
];

/* ------------------------------------------------------------------
 * Bancos de preguntas iniciales (editables por el docente en la
 * plataforma). Cada pregunta: { q, opts: [4], ok: índice correcto }
 * ------------------------------------------------------------------ */
const QUIZZES = {
  'COD-PSA 001': [
    { q: '¿Qué es un acto de interferencia ilícita?', opts: ['Cualquier demora operativa en el aeropuerto', 'Un acto que compromete la seguridad de la aviación civil, como apoderamiento ilícito de aeronaves o introducción de armas/explosivos', 'Una infracción administrativa de tránsito aeroportuario', 'Un reclamo gremial dentro de la terminal'], ok: 1 },
    { q: 'Ante una actividad sospechosa en la terminal, el primer paso del personal AVSEC es:', opts: ['Intervenir físicamente de inmediato', 'Ignorarla si la persona posee credencial', 'Observar, reportar por el canal establecido y mantener contacto visual sin exponerse', 'Evacuar la terminal completa'], ok: 2 },
    { q: 'El sistema de permisos personales aeroportuarios tiene por finalidad:', opts: ['Cobrar un arancel a los trabajadores', 'Controlar y limitar el acceso a las zonas de seguridad restringidas solo a personas autorizadas', 'Identificar pasajeros frecuentes', 'Reemplazar al DNI dentro del aeropuerto'], ok: 1 },
    { q: 'Un objeto prohibido detectado en el equipaje de mano debe:', opts: ['Devolverse al pasajero sin registro', 'Ser retenido conforme al procedimiento, con registro de la actuación', 'Descartarse en cualquier cesto', 'Entregarse a la aerolínea sin constancia', ], ok: 1 },
    { q: 'El método de ocultamiento "por disimulo" consiste en:', opts: ['Ocultar el objeto dentro del cuerpo', 'Presentar el objeto prohibido con apariencia de un elemento permitido', 'Fraccionar el objeto en varias piezas', 'Sobornar al personal de control'], ok: 1 },
    { q: 'Durante la custodia de una persona en el ámbito aeroportuario corresponde:', opts: ['Retirarle toda documentación y no registrar nada', 'Mantener vigilancia permanente, registrar novedades y respetar sus derechos', 'Delegar la custodia en personal de limpieza', 'Permitirle circular libremente por zona restringida'], ok: 1 },
    { q: 'Ante una amenaza de bomba recibida telefónicamente, el receptor debe:', opts: ['Cortar la llamada de inmediato', 'Mantener la calma, prolongar la conversación, registrar datos de la voz y del mensaje, y dar aviso inmediato', 'Activar personalmente la evacuación general', 'Buscar el artefacto por su cuenta'], ok: 1 },
    { q: 'La inspección de pasajeros y equipaje de mano en el punto de control tiene carácter:', opts: ['Optativo para pasajeros frecuentes', 'Obligatorio para todas las personas que acceden a la zona de seguridad restringida', 'Aleatorio, uno de cada diez pasajeros', 'Exclusivo para vuelos internacionales'], ok: 1 },
    { q: 'Las zonas de seguridad restringidas son:', opts: ['Áreas de acceso público con cámaras', 'Áreas cuyo acceso está controlado y limitado a personas y vehículos autorizados e inspeccionados', 'Los estacionamientos del aeropuerto', 'Las oficinas comerciales de las aerolíneas'], ok: 1 },
    { q: 'Ante el hallazgo de un bulto abandonado en la terminal corresponde:', opts: ['Abrirlo para identificar al dueño', 'Moverlo a un depósito', 'No tocarlo, establecer un perímetro de seguridad y dar aviso conforme al procedimiento', 'Anunciarlo por altoparlantes y esperar 24 horas'], ok: 2 }
  ],
  'COD-PSA 001/A': [
    { q: 'La instrucción de actualización (recurrente) del personal AVSEC debe completarse:', opts: ['Cada 5 años', 'Dentro de los 12 meses desde la capacitación anterior', 'Solo si cambia de función', 'Únicamente si lo pide la empresa'], ok: 1 },
    { q: 'Ante una modificación del listado de objetos prohibidos, el personal debe:', opts: ['Aplicar el listado que conocía', 'Aplicar la versión vigente difundida por la autoridad competente', 'Consultar a los pasajeros', 'Esperar la próxima recurrencia para aplicarla'], ok: 1 },
    { q: 'La inspección de aeronaves en materia de seguridad tiene por objeto:', opts: ['Verificar el estado mecánico del motor', 'Detectar armas, explosivos u objetos sospechosos ocultos en la aeronave', 'Controlar el catering por razones bromatológicas', 'Auditar la contabilidad del explotador'], ok: 1 },
    { q: 'Si un permiso aeroportuario se encuentra vencido, su titular:', opts: ['Puede ingresar acompañado', 'No puede acceder a la zona de seguridad restringida hasta su renovación', 'Ingresa mostrando el DNI', 'Ingresa solo en horario diurno'], ok: 1 },
    { q: 'El repaso del marco jurídico en la actualización incluye principalmente:', opts: ['Normas impositivas', 'Modificaciones normativas AVSEC nacionales e internacionales aplicables', 'Jurisprudencia laboral', 'Reglamentos deportivos'], ok: 1 }
  ],
  'COD-PSA 002': [
    { q: 'En la convención de pseudocolor de los equipos de rayos X, los materiales orgánicos se visualizan en:', opts: ['Azul', 'Verde', 'Naranja', 'Negro'], ok: 2 },
    { q: 'Los metales y materiales de alta densidad se visualizan típicamente en:', opts: ['Naranja', 'Azul oscuro / negro', 'Verde claro', 'Blanco'], ok: 1 },
    { q: 'La función de alta penetración (Hi-Pen) se utiliza para:', opts: ['Aclarar el fondo de la imagen', 'Analizar zonas densas u oscuras donde el haz atraviesa con dificultad', 'Colorear los objetos orgánicos', 'Reducir la radiación emitida'], ok: 1 },
    { q: 'Un Artefacto Explosivo Improvisado (AEI) se compone básicamente de:', opts: ['Solo material explosivo', 'Fuente de energía, iniciador/detonador, carga explosiva y conmutador', 'Únicamente cables y una batería', 'Un temporizador comercial'], ok: 1 },
    { q: 'En la imagen radioscópica, la carga explosiva de un AEI se presenta habitualmente como:', opts: ['Masa metálica azul', 'Masa orgánica densa (tonos naranjas) asociada a componentes eléctricos', 'Zona transparente', 'Silueta verde brillante'], ok: 1 },
    { q: 'La radio-física sanitaria establece que el operador del equipo debe:', opts: ['Permanecer junto al túnel durante la emisión sin restricciones', 'Respetar los principios de protección radiológica: tiempo, distancia y blindaje', 'Desactivar las cortinas plomadas para agilizar', 'Operar sin dosímetro'], ok: 1 },
    { q: 'El método de ocultamiento "en doble fondo" se detecta principalmente por:', opts: ['El peso del bulto', 'Diferencias de densidad y geometría anómala en los límites de la valija', 'El color de la valija', 'La marca del equipaje'], ok: 1 },
    { q: 'Ante una imagen dudosa que no puede resolverse con filtros, corresponde:', opts: ['Despachar el bulto igualmente', 'Derivar a inspección manual/física del equipaje conforme al procedimiento', 'Pedirle al pasajero que describa el contenido y liberarlo', 'Volver a pasar el bulto hasta que se aclare'], ok: 1 },
    { q: 'Las mercancías peligrosas (por ejemplo, aerosoles inflamables o baterías de litio) en equipaje:', opts: ['Nunca están restringidas', 'Se rigen por las disposiciones aplicables y pueden estar prohibidas o limitadas según el caso', 'Se aceptan siempre en bodega', 'Solo importan en vuelos de carga'], ok: 1 },
    { q: 'La rotación de operadores en pantalla se fundamenta en:', opts: ['Razones gremiales', 'La fatiga visual y la caída del rendimiento de detección con el tiempo continuo en pantalla', 'El desgaste del monitor', 'La rotación de los turnos de limpieza'], ok: 1 }
  ],
  'COD-PSA 002/A': [
    { q: 'La certificación del operador de rayos X debe revalidarse:', opts: ['Cada 24 meses', 'Dentro de los 12 meses desde la capacitación anterior', 'Cada 6 meses', 'Solo al cambiar de aeropuerto'], ok: 1 },
    { q: 'En el examen práctico de interpretación de imágenes, la detección del AEI:', opts: ['Es opcional', 'Representa el 40 % del puntaje y constituye condición excluyente', 'Vale igual que cualquier otra amenaza', 'Solo aplica a instructores'], ok: 1 },
    { q: 'El filtro de inversión de imagen (negativo) resulta útil para:', opts: ['Reducir la dosis de radiación', 'Resaltar contornos y objetos finos como cables o hojas metálicas', 'Acelerar la cinta transportadora', 'Eliminar el pseudocolor definitivamente'], ok: 1 },
    { q: 'Las nuevas técnicas de ocultamiento exigen del operador:', opts: ['Memorizar todas las valijas', 'Actualización permanente y análisis sistemático de la imagen completa', 'Confiar en la alarma automática del equipo', 'Inspeccionar solo bultos grandes'], ok: 1 },
    { q: 'Ante una batería de litio de gran capacidad detectada en bodega:', opts: ['Se despacha sin más', 'Se aplica el procedimiento de mercancías peligrosas vigente', 'Se descarta en un cesto común', 'Se entrega al piloto'], ok: 1 }
  ],
  'COD-PSA 003': [
    { q: 'El transporte de caudales dentro del aeropuerto requiere:', opts: ['Solo aviso verbal al guardia', 'Permisos vigentes, itinerarios y procedimientos de coordinación establecidos', 'Circular fuera de horario operativo únicamente', 'Ningún requisito especial'], ok: 1 },
    { q: 'En el área de movimiento, los vehículos de caudales deben:', opts: ['Circular libremente', 'Respetar las reglas de circulación, señalización y autorizaciones del área de operaciones', 'Seguir a las aeronaves', 'Estacionar junto a la plataforma sin autorización'], ok: 1 },
    { q: 'Las comunicaciones durante el traslado de caudales deben ser:', opts: ['Públicas y abiertas', 'Por los canales establecidos, con confirmación de novedades en los puntos previstos', 'Solo por mensajes personales', 'Inexistentes para no llamar la atención'], ok: 1 },
    { q: 'El paso de zona pública a zona restringida con caudales exige:', opts: ['Solo mostrar el uniforme', 'Control de acceso, acreditación del personal y verificación conforme al procedimiento', 'Un pago adicional', 'Autorización del piloto'], ok: 1 },
    { q: 'Ante un intento de robo durante el traslado corresponde priorizar:', opts: ['La carga sobre las personas', 'La integridad de las personas, dar alerta inmediata y aplicar el plan previsto', 'Perseguir a los autores', 'Negociar en el lugar'], ok: 1 }
  ],
  'COD-PSA 007': [
    { q: 'La seguridad de la aviación (AVSEC) busca proteger a la aviación civil contra:', opts: ['Las demoras de vuelos', 'Los actos de interferencia ilícita', 'La competencia comercial', 'El mal clima'], ok: 1 },
    { q: 'Su permiso personal aeroportuario:', opts: ['Puede prestarse a un compañero', 'Es personal e intransferible y debe portarse visible en las zonas que corresponda', 'Sirve en cualquier aeropuerto del mundo', 'No tiene vencimiento'], ok: 1 },
    { q: 'Si observa a una persona sin credencial en zona restringida, usted debe:', opts: ['Ignorarla', 'Reportarla de inmediato al personal de seguridad conforme al procedimiento', 'Pedirle una propina', 'Escoltarla personalmente a la salida'], ok: 1 },
    { q: 'Ante el hallazgo de un objeto o bulto abandonado:', opts: ['Lo abre para revisarlo', 'No lo toca y da aviso inmediato a seguridad', 'Lo lleva a objetos perdidos', 'Lo mueve a un lugar seguro'], ok: 1 },
    { q: 'Ante una amenaza de bomba comunicada por teléfono, quien la recibe debe:', opts: ['Cortar y seguir trabajando', 'Mantener la calma, registrar la mayor cantidad de datos posible y avisar de inmediato', 'Difundirla por redes sociales', 'Evacuar por su cuenta a los presentes'], ok: 1 },
    { q: 'Las puertas y accesos a zonas restringidas deben:', opts: ['Quedar abiertas para ventilar', 'Permanecer cerradas y no debe permitirse el ingreso de personas no autorizadas detrás suyo (tailgating)', 'Trabarse con cuñas', 'Usarse como atajos'], ok: 1 }
  ],
  'COD-PSA 004': [
    { q: 'La planificación de dotaciones del supervisor debe considerar:', opts: ['Solo la antigüedad del personal', 'Demanda operativa, descansos, rotación de puestos y competencias certificadas', 'Preferencias personales exclusivamente', 'El orden alfabético'], ok: 1 },
    { q: 'La verificación de medios técnicos al inicio del turno incluye:', opts: ['Solo encender los equipos', 'Comprobar el funcionamiento operativo de los equipos de inspección y registrar novedades', 'Limpiar los monitores', 'Calibrar la radiación manualmente'], ok: 1 },
    { q: 'Un reporte de incidente debe ser:', opts: ['Verbal y sin registro', 'Escrito, preciso, cronológico y objetivo, con identificación de intervinientes', 'Redactado días después', 'Confidencial incluso para la superioridad'], ok: 1 },
    { q: 'La evaluación de desempeño del personal a cargo tiene por objeto:', opts: ['Aplicar sanciones', 'Identificar brechas de competencia y necesidades de instrucción', 'Definir premios económicos', 'Cumplir un formalismo'], ok: 1 },
    { q: 'Ante la caída del rendimiento de un operador de pantalla, el supervisor debe:', opts: ['Ignorarlo', 'Rotarlo de puesto conforme al esquema previsto y registrar la novedad', 'Duplicarle el turno', 'Retirarle la certificación'], ok: 1 }
  ]
};

// Banco genérico para cursos aún sin banco propio: el docente lo edita en la plataforma
const GENERIC_QUIZ = (curso) => ([
  { q: `¿Cuál es el objetivo principal del ${curso.nombre}?`, opts: ['Cumplir una formalidad administrativa', `Desarrollar las competencias que fija el PNISAC para: ${curso.unidades[0].toLowerCase()}`, 'Reemplazar la instrucción presencial obligatoria', 'Otorgar un ascenso automático'], ok: 1 },
  { q: 'La nota mínima de aprobación de las evaluaciones del PNISAC es:', opts: ['60 %', '70 %', '80 %', '90 %'], ok: 1 },
  { q: 'Los registros de instrucción deben conservarse por un plazo mínimo de:', opts: ['1 año', '3 años', '5 años', '10 años'], ok: 2 },
  { q: 'Los certificados de cursos dictados por centros externos son válidos:', opts: ['Siempre', 'Solo con la intervención/validación del ISSA', 'Con la firma del alumno', 'Con un sello comercial'], ok: 1 },
  { q: 'El plantel docente de un centro de instrucción habilitado debe estar conformado por:', opts: ['Cualquier profesional', 'Instructores Nacionales AVSEC certificados (COD-PSA 009)', 'Personal administrativo', 'Estudiantes avanzados'], ok: 1 }
]);

module.exports = { COURSES, QUIZZES, GENERIC_QUIZ };
