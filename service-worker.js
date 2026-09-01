const CACHE_VERSION = "2026-09-01-1";
const STATIC_CACHE = `smart-schedule-static-${CACHE_VERSION}`;
const DATA_CACHE = `smart-schedule-data-${CACHE_VERSION}`;
const APP_SHELL = [
  "./",
  "./index.html",
  "./update.html",
  "./offline.html",
  "./styles.css",
  "./update.css",
  "./app.js",
  "./update.js",
  "./firebase-client.js",
  "./pwa.js",
  "./manifest.webmanifest",
  "./icons/app-icon.svg",
  "./icons/app-icon-192.png",
  "./icons/app-icon-512.png",
  "./icons/app-icon-maskable-512.png",
  "./icons/apple-touch-icon.png",
  "./data/schedule.json",
  "./data/schedule-profile.json",
  "./schedule.ics"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((key) => key.startsWith("smart-schedule-") && ![STATIC_CACHE, DATA_CACHE].includes(key))
          .map((key) => caches.delete(key)),
      ))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(networkFirstPage(request));
    return;
  }

  if (url.pathname.endsWith("/data/schedule.json") || url.pathname.endsWith("/data/schedule-profile.json")) {
    event.respondWith(networkFirstData(request));
    return;
  }

  if (request.destination === "script" || request.destination === "style") {
    event.respondWith(networkFirstAsset(request));
    return;
  }

  event.respondWith(cacheFirst(request));
});

async function networkFirstPage(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(STATIC_CACHE);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    return (await caches.match(request, { ignoreSearch: true }))
      || (await caches.match("./index.html"))
      || caches.match("./offline.html");
  }
}

async function networkFirstData(request) {
  const cache = await caches.open(DATA_CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch {
    return (await cache.match(request, { ignoreSearch: true }))
      || (await caches.match(request, { ignoreSearch: true }))
      || new Response(JSON.stringify({ error: "Schedule data is unavailable offline." }), {
        status: 503,
        headers: { "Content-Type": "application/json" },
      });
  }
}

async function networkFirstAsset(request) {
  const cache = await caches.open(STATIC_CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) await cache.put(request, response.clone());
    return response;
  } catch {
    return (await cache.match(request, { ignoreSearch: true }))
      || new Response("Offline", { status: 503, statusText: "Offline" });
  }
}

async function cacheFirst(request) {
  const cached = await caches.match(request, { ignoreSearch: true });
  if (cached) {
    refreshCachedAsset(request);
    return cached;
  }

  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(STATIC_CACHE);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    return new Response("Offline", { status: 503, statusText: "Offline" });
  }
}

async function refreshCachedAsset(request) {
  try {
    const response = await fetch(request);
    if (!response.ok) return;
    const cache = await caches.open(STATIC_CACHE);
    await cache.put(request, response);
  } catch {
    // The cached response is already available, so an offline refresh failure is safe to ignore.
  }
}
