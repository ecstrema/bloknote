import { self } from "$app/service-worker";
import { version } from "$app/env";
import { immutable, assets } from "$app/manifest";
import { resolve } from "$app/paths";

// Create a unique cache name for this deployment
const APP_CACHE = `APP-${version}`;
const MAP_TILES_CACHE = "map-tiles-v1";
const API_CACHE = "api-json-v1";

// The static API is mounted under the app base path, like apiUrl() on the main thread
const API_WORLD_PATH = `${resolve("/").replace(/\/$/, "")}/api/world`;
/** Files excluded from the API fallback cache: the dataset download is handled by the SQLite worker, and the version check must stay fresh */
const UNCACHED_API_FILES = new Set(["download.json", "data-version.json"]);

const ASSETS = [
  ...immutable.map((a) => resolve(a.path)), // the app itself
  ...assets.map((a) => resolve(a.path)), // everything in `static`
];

self.addEventListener("install", (event) => {
  // Create a new cache and add all files to it
  async function addFilesToCache() {
    if (!import.meta.env.DEV) {
      const cache = await caches.open(APP_CACHE);
      await cache.addAll(ASSETS);
    }
  }

  event.waitUntil(addFilesToCache());
});

self.addEventListener("activate", (event) => {
  // Remove previous cached data from disk
  async function deleteOldCaches() {
    for (const key of await caches.keys()) {
      // Delete old app caches, preserve map tiles and api fallback caches
      if (key !== APP_CACHE && key !== MAP_TILES_CACHE && key !== API_CACHE) {
        await caches.delete(key);
      }
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

  // Cross-origin requests (other than map tiles handled above) go straight to the network.
  if (url.origin !== self.location.origin) return;

  // Climbing data is handled by the local SQLite database, or fetched directly in low data mode.
  // Network-first with a cache fallback, so pages already visited keep working offline.
  if (url.pathname.startsWith(API_WORLD_PATH)) {
    const file = url.pathname.split("/").at(-1) ?? "";
    if (!UNCACHED_API_FILES.has(file)) event.respondWith(handleApiJson(event.request, url.pathname));
    return;
  }

  // SvelteKit's update check must always hit the network, a cached copy makes it report stale versions.
  if (url.pathname.endsWith("/_app/version.json")) return;

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

// App files. Those are automatically up to date, because when a new service worker is installed,
// it installs the new version of the app too, and uninstalls the old version.
async function handleAppFile(request: Request, pathname: string): Promise<Response> {
  const appCache = await caches.open(APP_CACHE);
  return import.meta.env.DEV ? safeFetch(request) : safeFetchWithCache(appCache, pathname, request);
}

// Static API json. Fresh from the network when online; the last fetched copy answers offline.
async function handleApiJson(request: Request, pathname: string): Promise<Response> {
  const cache = await caches.open(API_CACHE);
  try {
    return await safeFetchAndCache(cache, pathname, request);
  } catch {
    const cached = await cache.match(pathname);
    if (cached) return cached;
    return new Response(undefined, { status: 504, statusText: "api fetch failed" });
  }
}

async function safeFetchWithCache(cache: Cache, pathname: string, request: Request) {
  return (await cache.match(pathname)) || (await safeFetchAndCache(cache, pathname, request));
}

async function safeFetchAndCache(cache: Cache, pathname: string, request: Request) {
  const res = await safeFetch(request);
  if (res.status === 200 && !res.headers.get("cache-control")?.includes("no-store")) {
    // do not await to do it in the background
    cache.put(pathname, res.clone());
  }
  return res;
}

/** if we're offline, fetch can return a value that is not a Response instead of throwing - and we can't pass this non-Response to respondWith, so we throw here */
async function safeFetch(request: Request) {
  const res = await fetch(request);
  if (!(res instanceof Response)) {
    throw new Error("invalid response from fetch");
  }
  return res;
}
