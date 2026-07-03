const CACHE_NAME = "jams-shell-20260703-6";
const APP_SHELL = [
  "./",
  "./index.html",
  "./auth.html",
  "./verify.html",
  "./styles.css",
  "./app.js",
  "./auth.js",
  "./config.js",
  "./pwa.js",
  "./manifest.webmanifest",
  "./assets/hm-logo.png",
  "./assets/hm-logo-transparent.png",
  "./assets/jams-icon-192.png",
  "./assets/jams-icon-512.png",
];

const CACHEABLE_PATHS = new Set(APP_SHELL.map((path) => new URL(path, self.location.href).pathname));

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(() => {
        const fallback = url.pathname.endsWith("/verify.html")
          ? "./verify.html"
          : url.pathname.endsWith("/auth.html")
            ? "./auth.html"
            : "./index.html";
        return caches.match(new URL(fallback, self.location.href).toString());
      }),
    );
    return;
  }

  if (!CACHEABLE_PATHS.has(url.pathname)) return;
  event.respondWith(
    fetch(request).catch(() => caches.match(new URL(url.pathname, self.location.origin).toString())),
  );
});
