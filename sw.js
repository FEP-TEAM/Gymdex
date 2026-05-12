const CACHE = 'gymdex-v3';
const ASSETS = ['./index.html','./manifest.json','./icon-192.png','./icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
  ));
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin) {
    e.respondWith(fetch(e.request).catch(() => new Response('')));
    return;
  }
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(res => {
        if (res && res.status === 200) {
          caches.open(CACHE).then(c => c.put(e.request, res.clone()));
        }
        return res;
      }).catch(() => caches.match('./index.html'));
    })
  );
});

/* Timer/workout notifications sent from the app via postMessage */
self.addEventListener('message', e => {
  if (!e.data) return;

  if (e.data.type === 'TIMER_DONE') {
    self.registration.showNotification('⏱ Descanso acabou!', {
      body: e.data.next ? `Próximo: ${e.data.next}` : 'Hora de continuar! 💪',
      icon: './icon-192.png',
      badge: './icon-192.png',
      vibrate: [300, 100, 300, 100, 300],
      tag: 'timer-done',
      renotify: true
    });
  }

  if (e.data.type === 'WORKOUT_DONE') {
    self.registration.showNotification('🏆 Treino concluído!', {
      body: 'Parabéns! Cada série te deixa mais forte.',
      icon: './icon-192.png',
      badge: './icon-192.png',
      vibrate: [200, 100, 200, 100, 400],
      tag: 'workout-done',
      renotify: true
    });
  }
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const c of list) if ('focus' in c) return c.focus();
      return clients.openWindow('./index.html');
    })
  );
});
