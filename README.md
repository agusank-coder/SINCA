# SINCA — Sistema Institucional de Capacitación y Acreditación

Plataforma de instrucción y acreditación del **Instituto Superior de Seguridad
Aeroportuaria (ISSA)** — Policía de Seguridad Aeroportuaria, República Argentina.

Cubre el ciclo completo del Programa Nacional de Instrucción para la Seguridad
en la Aviación Civil (PNISAC): instrucción con micro-videos, evaluación teórica
con supervisión por IA, simulador de Rayos X, entrenamiento práctico en el puesto
(EPPT) con firma dual, certificación con firma electrónica y acreditación.

> **Uso interno PSA.** Este repositorio debe permanecer **privado**.

---

## 1. Requisitos

| Componente | Versión mínima |
|---|---|
| Node.js | 22 LTS |
| Navegador | Chrome 120+ / Edge 120+ (con cámara para exámenes) |
| RAM del servidor | 2 GB (4 GB para 200 sesiones simultáneas) |

---

## 2. Instalación local

```bash
npm install
node server.js
```

Abrir `http://localhost:3000`

**Administrador inicial:** `eheinrich` / `506065`
→ Cambiar la contraseña en el primer acceso desde *Mi perfil*.

---

## 3. Estructura del proyecto

```
server.js              Servidor Express — endpoints REST y lógica de negocio
db.js                  Esquema SQLite, migraciones automáticas y datos iniciales
public/index.html      Punto de entrada de la aplicación
public/js/             Módulos del cliente (campus, gestión, proctor, PDF…)
public/css/style.css   Sistema de diseño
assets/xray_images/    Banco de imágenes del simulador de Rayos X
data/                  Base de datos y evidencias — NO se versiona
tests/                 30 pruebas automatizadas (npm test)
```

---

## 4. Variables de entorno

| Variable | Para qué sirve | Obligatoria en producción |
|---|---|---|
| `PORT` | Puerto de escucha (por defecto 3000) | La asigna el hosting |
| `JWT_SECRET` | Clave de firma de los tokens de sesión | **Sí** |

Si `JWT_SECRET` no se define, el servidor genera una y la guarda en
`data/.jwt_secret`. En un hosting con disco efímero eso invalida todas las
sesiones en cada reinicio, por lo que conviene definirla como variable de entorno.

Para generar una clave:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

---

## 5. Condiciones de despliegue

Dos requisitos que no son negociables:

**HTTPS obligatorio.** El módulo de supervisión de exámenes usa la cámara del
alumno. Los navegadores solo permiten acceso a la cámara sobre HTTPS (o en
`localhost`). Sin HTTPS los exámenes no funcionan.

**Disco persistente.** La base de datos (`data/plataforma_pnisac.db`) y las
evidencias de supervisión (`data/proctor/`) viven en el sistema de archivos.
Un hosting con disco efímero borra todo en cada reinicio o despliegue.

---

## 6. Puesta en producción

### Opción A — Túnel desde un equipo propio (sin costo)

Los datos quedan en el disco del equipo y el túnel provee HTTPS.
Requiere que el equipo esté encendido durante las pruebas.

```bash
# Terminal 1 — arrancar SINCA
node server.js

# Terminal 2 — exponerlo con HTTPS
npx cloudflared tunnel --url http://localhost:3000
```

Cloudflare devuelve una URL `https://….trycloudflare.com` para compartir.

### Opción B — Hosting en la nube

Cualquier proveedor con Node 22, HTTPS y **disco persistente**:

- Comando de build: `npm install`
- Comando de inicio: `npm start`
- Variable de entorno: `JWT_SECRET`
- Disco persistente montado en la carpeta `data/`

> Los planes gratuitos de la mayoría de los proveedores usan disco efímero.
> Sirven para verificar que el despliegue funciona, pero pierden los datos
> en cada reinicio.

### Opción C — Servidor institucional PSA

Node.js + PM2 detrás de un proxy inverso (nginx o IIS) con certificado TLS
de la PSA:

```bash
npm install -g pm2
pm2 start server.js --name sinca
pm2 save
pm2 startup
```

---

## 7. Antes de habilitar usuarios reales

- [ ] Cambiar la contraseña de `eheinrich`
- [ ] Desactivar los usuarios de prueba (`instructor`, `supervisor`, `estudiante`, `demo`)
- [ ] Definir `JWT_SECRET` como variable de entorno
- [ ] Cargar los DNI autorizados (*Gestión → DNIs autorizados*)
- [ ] Verificar que el registro público está cerrado (*Gestión → Tablero*)
- [ ] Cargar el banco de preguntas real de cada curso
- [ ] Cargar los videos institucionales de las unidades
- [ ] Cargar el banco de imágenes de Rayos X con sus anotaciones
- [ ] Programar backups periódicos (*Gestión → Tablero → Generar backup*)

---

## 8. Actualizar una instalación existente

```bash
git pull
npm install
pm2 restart sinca      # o volver a ejecutar: node server.js
```

Las migraciones de base de datos se aplican solas al arrancar.
**No borrar `data/`**: contiene los usuarios, certificados y evidencias.

---

## 9. Pruebas

```bash
npm test
```

30 pruebas sobre autenticación, examen, EPPT y certificados.
Deben pasar las 30 antes de desplegar cualquier cambio.

---

## 10. Roles del sistema

| Rol | Alcance |
|---|---|
| `estudiante` | Cursa, rinde y descarga sus certificados |
| `supervisor` | Firma jornadas EPPT en el puesto de trabajo |
| `instructor` | Inscribe alumnos, revisa supervisión IA, firma actas |
| `admin` | Acceso total al sistema |
| `fiscalizador` | Consulta y descarga, sin modificar nada |
| `sanidad` | Carga y firma exámenes de aptitud psicofísica |
| `juosp` | Convalida EPPT y gestiona el personal de su UOSP |
| `juosp_regional` | Igual que JUOSP, sobre todas las UOSP de su región |

---

## 11. Marco normativo

- PNISAC — COD-PSA 001 a 020 y sus actualizaciones
- Apéndices 05, 06, 08 y 09 del PNISAC (entrenamiento en el puesto)
- Ley N° 25.506 — Firma Digital
- Ley N° 25.326 — Protección de Datos Personales
- Decreto 456/2025 — Jerarquías del personal de seguridad aeroportuaria
- Resolución MSN N° 468/26 — Detección temprana de trata de personas

---

*Desarrollado en la Subdirección Nacional — Policía de Seguridad Aeroportuaria.*
