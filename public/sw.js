/* Cards No Cards service worker.
 *
 * Deliberately conservative: it precaches nothing private and only ever caches
 * safe, same-origin *static* assets (the Next.js build output and app icons).
 * API requests and page navigations are never cached, so authenticated
 * responses and private vocabulary never land in the cache.
 */

const CACHE = "cnc-static-v1";

/** Only these same-origin path prefixes are eligible for caching. */
const STATIC_PREFIXES = ["/_next/static/", "/icons/"];
const STATIC_EXACT = ["/manifest.webmanifest"];

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)));
      await self.clients.claim();
    })(),
  );
});

function isCacheableStatic(url) {
  if (url.origin !== self.location.origin) return false;
  if (STATIC_EXACT.includes(url.pathname)) return true;
  return STATIC_PREFIXES.some((prefix) => url.pathname.startsWith(prefix));
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // Never touch API traffic or anything that is not a safe static asset.
  if (url.pathname.startsWith("/api/") || !isCacheableStatic(url)) {
    return;
  }

  event.respondWith(
    (async () => {
      const cached = await caches.match(request);
      if (cached) return cached;
      try {
        const response = await fetch(request);
        if (response.ok) {
          const cache = await caches.open(CACHE);
          cache.put(request, response.clone());
        }
        return response;
      } catch (error) {
        if (cached) return cached;
        throw error;
      }
    })(),
  );
});
