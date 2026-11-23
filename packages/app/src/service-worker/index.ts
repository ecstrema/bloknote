import { self } from "$app/service-worker";
import { immutable, assets } from "$app/manifest";
import { resolve } from "$app/paths";

// Caches have stable names: an app update only downloads what actually changed. Immutable assets
// are content-hashed, so unchanged chunks (like the maplibre bundle) keep their url and their
// cached copy across updates. Fresh pages still arrive through the network-first strategy below.
const APP_CACHE = "app-v1";
const MAP_TILES_CACHE = "map-tiles-v1";

// Wikimedia Commons topo images: cached apart from the app and the data, so they survive app and
// dataset updates. Unreferenced images are pruned with a simple FIFO cap: the least recently
// downloaded first. The check runs every few downloads and only touches the cache key list.
const COMMONS_IMAGES_CACHE = "commons-images-v1";
const COMMONS_IMAGES_LIMIT = 500;
const COMMONS_PRUNE_EVERY = 25;
let commonsImagePuts = 0;

const KEPT_CACHES = new Set([APP_CACHE, MAP_TILES_CACHE, COMMONS_IMAGES_CACHE]);
const IMMUTABLE_PATH = `${resolve("/").replace(/\/$/, "")}/_app/immutable/`;

const ASSETS = [
  ...immutable.map((a) => resolve(a.path)), // the app itself
  ...assets.map((a) => resolve(a.path)), // everything in `static`
];

self.addEventListener("install", (event) => {
  // Only download the files that are not cached yet
  async function cacheMissingFiles() {
    if (import.meta.env.DEV) return;
    const cache = await caches.open(APP_CACHE);
    await Promise.all(
      ASSETS.map(async (url) => {
        if (await cache.match(url)) return;
        try {
          const res = await fetch(url);
          if (res.ok) await cache.put(url, res);
        } catch {
          // Offline install: the files are simply fetched on demand later
        }
      }),
    );
  }

  event.waitUntil(cacheMissingFiles());
});

self.addEventListener("activate", (event) => {
  // Remove caches from previous versions of the service worker: the old per-version app caches
  // and any other cache no longer kept here. Map tiles and Commons images are preserved.
  async function deleteOldCaches() {
    for (const key of await caches.keys()) {
      if (!KEPT_CACHES.has(key)) await caches.delete(key);
    }
  }

  event.waitUntil(deleteOldCaches());
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  const url = new URL(event.request.url);

  // Map tile and style caching (OpenFreeMap vector tiles, fonts, sprites, OpenTopoMap, etc.)
  if (
    url.hostname.includes("openfreemap.org") ||
    url.hostname.includes("opentopomap.org") ||
    url.hostname.includes("tile.openstreetmap.org") ||
    url.pathname.endsWith(".pbf")
  ) {
    event.respondWith(handleMapTile(event.request));
    return;
  }

  // Topo images from Wikimedia Commons: cache-first, kept across app and data updates
  if (url.hostname === "upload.wikimedia.org" || url.hostname === "commons.wikimedia.org") {
    // The commons api answers are dynamic: only the image files are cached
    if (url.hostname === "commons.wikimedia.org" && !url.pathname.startsWith("/wiki/Special:FilePath/")) return;
    event.respondWith(handleCommonsImage(event.request));
    return;
  }

  // Cross-origin requests (other than the ones handled above) go straight to the network.
  if (url.origin !== self.location.origin) return;

  // Climbing data is handled by the local SQLite database: the only cache for the data.
  if (url.pathname.includes("/api/")) return;

  // SvelteKit's update check must always hit the network, a cached copy makes it report stale versions.
  if (url.pathname.endsWith("/_app/version.json")) return;

  // Content-hashed bundles never change: answer from the cache without a request
  if (url.pathname.startsWith(IMMUTABLE_PATH)) {
    event.respondWith(handleImmutableFile(event.request));
    return;
  }

  // The remaining files (pages, static assets): fresh from the network, last cached copy offline
  event.respondWith(handleAppFile(event.request, url.pathname));
});

async function handleMapTile(request: Request): Promise<Response> {
  const cache = await caches.open(MAP_TILES_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  try {
    const res = await safeFetch(request);
    if (res.status === 200 && !res.headers.get("cache-control")?.includes("no-store")) {
      cache.put(request, res.clone());
    }
    return res;
  } catch (err) {
    if (cached) return cached;
    // Report a normal HTTP error instead of throwing inside respondWith, so the
    // browser logs maplibre's standard tile failure rather than a service worker error.
    return new Response(undefined, { status: 504, statusText: "tile fetch failed" });
  }
}

// Pages and static assets. Fresh from the network when online; the last fetched copy answers offline.
async function handleAppFile(request: Request, pathname: string): Promise<Response> {
  if (import.meta.env.DEV) return safeFetch(request);
  const cache = await caches.open(APP_CACHE);
  try {
    const res = await safeFetch(request);
    if (res.ok && !res.headers.get("cache-control")?.includes("no-store")) {
      // do not await to do it in the background
      cache.put(pathname, res.clone());
    }
    return res;
  } catch {
    const cached = await cache.match(pathname);
    if (cached) return cached;
    return new Response(undefined, { status: 504, statusText: "app file fetch failed" });
  }
}

// Content-hashed bundles never change: answered from the cache, downloaded only once
async function handleImmutableFile(request: Request): Promise<Response> {
  const cache = await caches.open(APP_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const res = await safeFetch(request);
  if (res.ok) cache.put(request, res.clone());
  return res;
}

// Topo images: cached on first download, answered from the cache afterwards. Opaque image
// responses (no-cors <img> requests) cannot be inspected, so pruning only touches the key list.
async function handleCommonsImage(request: Request): Promise<Response> {
  const cache = await caches.open(COMMONS_IMAGES_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  try {
    const res = await safeFetch(request);
    if (res.ok || res.type === "opaque") {
      void cache.put(request, res.clone()).then(() => pruneCommonsImages());
    }
    return res;
  } catch {
    return new Response(undefined, { status: 504, statusText: "image fetch failed" });
  }
}

/** FIFO pruning: drops the oldest downloads until the cache holds 80% of the limit */
async function pruneCommonsImages() {
  if (++commonsImagePuts % COMMONS_PRUNE_EVERY !== 0) return;
  const cache = await caches.open(COMMONS_IMAGES_CACHE);
  const keys = await cache.keys();
  const keep = Math.floor(COMMONS_IMAGES_LIMIT * 0.8);
  if (keys.length <= keep) return;
  // Keys are ordered by insertion time: the first ones are the oldest downloads
  for (const req of keys.slice(0, keys.length - keep)) {
    await cache.delete(req);
  }
}

/** if we're offline, fetch can return a value that is not a Response instead of throwing - and we can't pass this non-Response to respondWith, so we throw here */
async function safeFetch(request: Request) {
  const res = await fetch(request);
  if (!(res instanceof Response)) {
    throw new Error("invalid response from fetch");
  }
  return res;
}
