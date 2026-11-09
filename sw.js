// sw.js - service worker of the installed app.
// Pages, scripts and styles: network first (so a new deploy shows at once), the last copy when offline or slow.
// API calls and anything else are never touched.
const CACHE = 'portal-shell-v1';
const SHELL = ['./', 'index.html', 'styles.css'];
const CDN_HOSTS = ['cdn.tailwindcss.com', 'cdnjs.cloudflare.com'];
const NETWORK_WAIT_MS = 4000;

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE)
            .then(cache => cache.addAll(SHELL).catch(() => {}))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys()
            .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
            .then(() => self.clients.claim())
    );
});

const fromNetwork = (request) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('slow')), NETWORK_WAIT_MS);
    fetch(request).then(res => { clearTimeout(timer); resolve(res); }, err => { clearTimeout(timer); reject(err); });
});

self.addEventListener('fetch', (event) => {
    const { request } = event;
    if (request.method !== 'GET') return;
    const url = new URL(request.url);
    const sameOrigin = url.origin === self.location.origin;
    if (!sameOrigin && !CDN_HOSTS.includes(url.hostname)) return;   // the API and other sites go straight to the network

    event.respondWith((async () => {
        const cache = await caches.open(CACHE);
        try {
            const res = await fromNetwork(request);
            if (res && (res.ok || res.type === 'opaque')) cache.put(request, res.clone());
            return res;
        } catch (err) {
            const cached = await cache.match(request, { ignoreSearch: false });
            if (cached) return cached;
            if (request.mode === 'navigate') {
                const shell = await cache.match('index.html') || await cache.match('./');
                if (shell) return shell;
            }
            throw err;
        }
    })());
});
