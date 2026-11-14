/*
 * Sklubot service worker: lets the installed app open without a network.
 * It caches the app shell only (the page, its scripts and styles, the icons).
 * Requests under /api/ are never handled here, so they always go straight to the network.
 */
const CACHE = "sklubot-shell-v1";
const SHELL = ["/", "/manifest.webmanifest", "/icon.svg", "/icon-192.png", "/icon-512.png", "/apple-touch-icon.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .catch(() => undefined)
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

function store(request, response) {
  if (response && response.ok && response.type === "basic") {
    const copy = response.clone();
    caches.open(CACHE).then((cache) => cache.put(request, copy)).catch(() => undefined);
  }
  return response;
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // Network only: the API (data, files, the event stream) is never cached or answered from here.
  if (url.pathname === "/api" || url.pathname.startsWith("/api/") || url.pathname.startsWith("/download/")) return;

  // Opening the app: try the network for a fresh page, fall back to the cached shell when offline.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => store("/", response))
        .catch(() => caches.match("/").then((cached) => cached || Response.error())),
    );
    return;
  }

  // Built assets have a content hash in their name, so a cached copy is always the right one.
  if (url.pathname.startsWith("/assets/")) {
    event.respondWith(caches.match(request).then((cached) => cached || fetch(request).then((response) => store(request, response))));
    return;
  }

  // Icons and the manifest: answer from the cache, refresh it in the background.
  event.respondWith(
    caches.match(request).then((cached) => {
      const fresh = fetch(request).then((response) => store(request, response));
      if (!cached) return fresh;
      fresh.catch(() => undefined);
      return cached;
    }),
  );
});
