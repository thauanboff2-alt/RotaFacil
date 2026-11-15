// Bump this on every deploy that changes the app shell. The activate handler
// deletes every cache whose name differs, so bumping it is what forces an
// already-installed PWA to throw away stale assets.
const CACHE_NAME = "rotafacil-v4";

// Only version-independent assets. The HTML shell is deliberately NOT cached:
// it references hashed JS chunk filenames that change on every deploy, so a
// stale shell would load and then fail to fetch its own scripts.
const STATIC_ASSETS = ["/manifest.json", "/icon.svg"];

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Never cache API calls
  if (url.pathname.startsWith("/api/")) {
    event.respondWith(fetch(request));
    return;
  }

  // Navigation always goes to the network. Serving a cached shell here would
  // hand the browser an old document pointing at JS chunks that no longer
  // exist on the server, which looks like "the app opens but does nothing".
  if (request.mode === "navigate") {
    event.respondWith(fetch(request));
  } else {
    event.respondWith(
      caches.match(request).then((cached) => cached || fetch(request))
    );
  }
});
