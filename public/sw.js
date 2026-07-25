/*! Open Historia — minimal service worker (PWA installability only, no caching) */
// This project's data (scenarios, games, world state) is fetched live from
// the server on every read — a caching service worker would risk serving
// stale game state. This one exists only to satisfy install criteria; it
// passes every request straight through to the network.
self.addEventListener("install", () => {
    self.skipWaiting();
});

self.addEventListener("activate", (event) => {
    event.waitUntil(self.clients.claim());
});

// Deliberately does NOT call respondWith. This worker caches nothing, so taking
// over a request could only ever re-issue it — and re-issuing a cross-origin one
// through fetch() loses the mode/credentials the browser chose for it. Map tiles
// are exactly that case: terrain from s3.amazonaws.com and basemaps from
// arcgisonline came back as "A ServiceWorker intercepted the request and
// encountered an unexpected error", and the tiles simply failed to load.
// Leaving the handler in place (but passive) keeps the install criteria that
// wanted a fetch listener, while the browser handles every request itself.
self.addEventListener("fetch", () => {});
