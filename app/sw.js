const CACHE = 'stride-shell-v7';
const FILES = ['./', './index.html', './style.css', './build.js', './manifest.webmanifest', './icon.svg'];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(FILES)));
  self.skipWaiting();
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)))));
  self.clients.claim();
});
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const path=new URL(event.request.url).pathname;
  if(path.endsWith('/emoji-picker.js')||path.endsWith('/emoji-data.json')) {
    event.respondWith(caches.open(CACHE).then(async cache=>{
      try {const response=await fetch(event.request);if(response.ok)await cache.put(event.request,response.clone());return response}
      catch {return cache.match(event.request)}
    }));
    return;
  }
  event.respondWith(fetch(event.request).catch(() => caches.match(event.request)));
});
