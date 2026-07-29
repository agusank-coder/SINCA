/* ============================================================
 * SINCA — Service Worker v1.0
 * Estrategia: Network First para API, Cache First para assets
 * Permite: instalación offline, carga instantánea de recursos
 * ============================================================ */
const CACHE_NAME   = 'sinca-v1';
const CACHE_STATIC = 'sinca-static-v1';

// Assets que se cachean al instalar (shell de la app)
const PRECACHE = [
  '/',
  '/index.html',
  '/css/style.css',
  '/js/api.js',
  '/js/app.js',
  '/js/campus.js',
  '/js/gestion.js',
  '/js/idle.js',
  '/js/proctor.js',
  '/js/scanner.js',
  '/js/certificate.js',
  '/js/eppt_pdf.js',
  '/js/modes.js',
  '/js/biometria.js',
  '/img/psa.png',
  '/img/issa.png',
];

// ── Instalación: pre-cachear el shell ─────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_STATIC)
      .then(cache => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting())
  );
});

// ── Activación: limpiar caches viejas ─────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k !== CACHE_NAME && k !== CACHE_STATIC)
            .map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// ── Fetch: estrategia según el tipo de request ────────────────
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // 1. API calls → siempre network (nunca cachear respuestas de API)
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(event.request).catch(() =>
        new Response(JSON.stringify({ error: 'Sin conexión. Verificá tu red e intentá de nuevo.' }),
          { status: 503, headers: { 'Content-Type': 'application/json' } })
      )
    );
    return;
  }

  // 2. Modelos de face-api → cache first (son grandes y no cambian)
  if (url.pathname.startsWith('/models/')) {
    event.respondWith(
      caches.match(event.request).then(cached => cached ||
        fetch(event.request).then(res => {
          const clone = res.clone();
          caches.open(CACHE_STATIC).then(c => c.put(event.request, clone));
          return res;
        })
      )
    );
    return;
  }

  // 3. Assets estáticos (JS, CSS, imágenes) → cache first con fallback a network
  if (url.pathname.match(/\.(js|css|png|jpg|svg|ico|woff2?)$/)) {
    event.respondWith(
      caches.match(event.request).then(cached => cached ||
        fetch(event.request).then(res => {
          const clone = res.clone();
          caches.open(CACHE_STATIC).then(c => c.put(event.request, clone));
          return res;
        })
      )
    );
    return;
  }

  // 4. Navegación (HTML) → network first, fallback a index.html cacheado
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).catch(() => caches.match('/index.html'))
    );
    return;
  }

  // 5. Todo lo demás → network
  event.respondWith(fetch(event.request));
});

// ── Push notifications ────────────────────────────────────────
self.addEventListener('push', event => {
  if (!event.data) return;
  let data;
  try { data = event.data.json(); } catch { data = { title: 'SINCA', body: event.data.text() }; }

  event.waitUntil(
    self.registration.showNotification(data.title || 'SINCA — PSA/ISSA', {
      body:    data.body    || '',
      icon:    data.icon    || '/icons/icon-192.png',
      badge:   data.badge   || '/icons/icon-96.png',
      data:    data.url     || '/',
      vibrate: [100, 50, 100],
      actions: data.actions || [],
      tag:     data.tag     || 'sinca-notif',
      renotify: true,
    })
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = event.notification.data || '/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      const existing = list.find(c => c.url.includes(self.location.origin));
      if (existing) { existing.focus(); existing.navigate(url); }
      else clients.openWindow(url);
    })
  );
});
