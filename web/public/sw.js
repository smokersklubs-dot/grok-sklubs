/*
 * Sklubot service worker: lets the installed app open without a network.
 * It caches the app shell only (the page, its scripts and styles, the icons).
 * Requests under /api/ are never handled here, so they always go straight to the network.
 */
const CACHE = "sklubot-shell-v2";
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

/*
 * Push notifications (Web Push). The server sends an encrypted JSON message: { kind, title, body, botId, tag, url }.
 * Every push shows a notification (the subscription is userVisibleOnly). Clicking it opens the app on that bot:
 * an open window is focused and told which bot to show, otherwise a new one opens at `url` (/?bot=<id>).
 * Events: https://developer.mozilla.org/docs/Web/API/ServiceWorkerGlobalScope/push_event and notificationclick_event.
 */
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "Sklubot", body: event.data ? event.data.text() : "" };
  }
  const title = data.title || "Sklubot";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || "",
      tag: data.tag || undefined,
      renotify: !!data.tag,
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      requireInteraction: data.kind === "needs",
      data: { botId: data.botId || null, url: data.url || "/" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const { botId, url } = event.notification.data || {};
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      const open = windows.find((w) => new URL(w.url).origin === self.location.origin);
      if (open) {
        if (botId) open.postMessage({ type: "sklubot-open-bot", botId });
        return open.focus();
      }
      return self.clients.openWindow(url || "/");
    }),
  );
});

// The browser renewed the subscription by itself: register the new one with the same server key.
self.addEventListener("pushsubscriptionchange", (event) => {
  const old = event.oldSubscription;
  const key = old && old.options ? old.options.applicationServerKey : null;
  if (!key) return;
  event.waitUntil(
    self.registration.pushManager
      .subscribe({ userVisibleOnly: true, applicationServerKey: key })
      .then((sub) =>
        fetch("/api/push/subscribe", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ subscription: sub.toJSON(), label: "" }),
        }),
      )
      .catch(() => undefined),
  );
});
