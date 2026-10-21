/* Cards No Cards service worker.
 *
 * Caches only things that contain no private data:
 *   - same-origin static build output and icons (cache-first);
 *   - the HTML shells of the offline-capable pages (network-first, keyed by
 *     path without the query string). These pages are client-rendered: the
 *     HTML holds no vocabulary — words and questions are loaded by the page
 *     from IndexedDB or the API.
 * API responses are never cached here; offline practice data lives in
 * IndexedDB and is managed by the app itself.
 */

const CACHE = "cnc-static-v2";

const STATIC_PREFIXES = ["/_next/static/", "/icons/"];
const STATIC_EXACT = ["/manifest.webmanifest"];

/** Pages that work offline; their HTML shell is cached on every online visit. */
const OFFLINE_PAGES = ["/", "/practice", "/practice/session"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      // Best effort: warm the page shells so practice works offline even
      // before the user has visited every page. Failures are ignored.
      const cache = await caches.open(CACHE);
      await Promise.all(
        OFFLINE_PAGES.map(async (path) => {
          try {
            const response = await fetch(path, { credentials: "same-origin" });
            if (!isStorableShell(response)) return;
            const html = await response.clone().text();
            await cache.put(path, response);
            await cacheReferencedAssets(cache, html);
          } catch {
            /* offline during install */
          }
        }),
      );
      await self.skipWaiting();
    })(),
  );
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

/** Caches the build assets a page shell references, so it can boot offline. */
async function cacheReferencedAssets(cache, html) {
  const urls = new Set(html.match(/\/_next\/static\/[^"'\s)\\]+/g) || []);
  await Promise.all(
    [...urls].map(async (url) => {
      if (await cache.match(url)) return;
      try {
        const response = await fetch(url);
        if (response.ok) await cache.put(url, response);
      } catch {
        /* best effort */
      }
    }),
  );
}

/** Shown for pages that need the network when there is none. */
function offlinePage() {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#0b0b10"><title>Offline · Cards No Cards</title>
<style>
  body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0b0b10;color:#ececf1;
    font-family:system-ui,-apple-system,"SF Pro Text",sans-serif;padding:24px;box-sizing:border-box}
  main{max-width:360px;text-align:center}
  .emoji{font-size:48px}
  p{color:#9c9cab;line-height:1.5}
  a{display:inline-block;margin-top:8px;padding:14px 28px;border-radius:12px;background:#7c9cff;
    color:#0a1028;font-weight:600;text-decoration:none}
</style></head><body><main>
<div class="emoji">📡</div><h1>You are offline</h1>
<p>This page needs a connection. Practice still works offline — your answers will sync later.</p>
<a href="/practice">Go to Practice</a>
</main></body></html>`;
  return new Response(html, {
    status: 503,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });
}

function isCacheableStatic(url) {
  if (STATIC_EXACT.includes(url.pathname)) return true;
  return STATIC_PREFIXES.some((prefix) => url.pathname.startsWith(prefix));
}

function normalizePath(pathname) {
  return pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
}

/** Only plain successful HTML — never redirects (e.g. to a sign-in page). */
function isStorableShell(response) {
  return (
    response.ok &&
    !response.redirected &&
    response.type === "basic" &&
    (response.headers.get("content-type") || "").includes("text/html")
  );
}

async function handleNavigation(request, path) {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(request);
    if (isStorableShell(response)) await cache.put(path, response.clone());
    return response;
  } catch (error) {
    const cached = (await cache.match(path)) || (await cache.match("/practice"));
    if (cached) return cached;
    throw error;
  }
}

async function handleStatic(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(CACHE);
    await cache.put(request, response.clone());
  }
  return response;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;

  if (request.mode === "navigate") {
    const path = normalizePath(url.pathname);
    event.respondWith(
      OFFLINE_PAGES.includes(path)
        ? handleNavigation(request, path)
        : fetch(request).catch(() => offlinePage()),
    );
    return;
  }

  if (isCacheableStatic(url)) event.respondWith(handleStatic(request));
});
