import sqlite3InitModule, { type Database } from "@sqlite.org/sqlite-wasm";
import type { DataJSON } from "@bloknote/climbing-data-gen";
import { featureToType, getName } from "#lib/data/parse/data.js";
import { getParentSlug } from "#lib/helpers/slug.js";
import { getCoordinates, getGrade, getGradeReference } from "#lib/data/parse/osm-tags.js";
import { getColorFromGrade } from "#lib/data/network/grade.js";
import {
  buildSectorContour,
  extractRouteStyle,
  FEATURE_COLORS,
  ROUTE_STYLE_COLORS,
} from "#lib/data/parse/route-styles.js";
import type { DbRequest, DbResponse, MapElementFeature, NearbyCandidate, OsmRefEntry, SearchFilters } from "./types";

/** Bump when the tables change: the database is then downloaded again */
const SCHEMA = 3;

let dbPromise: Promise<{ db: Database; persistent: boolean; opfsUsable: boolean }> | undefined;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/**
 * OPFS sync access handles are exclusive: while the pool of another tab holds them, requests hang
 * forever instead of failing. A short probe on a scratch file tells whether OPFS works at all,
 * which distinguishes "another tab is using the database" from "the browser has no OPFS".
 */
async function probeOpfs(): Promise<boolean> {
  try {
    await withTimeout(
      (async () => {
        const root = await navigator.storage.getDirectory();
        const name = ".bloknote-opfs-probe";
        const handle = await root.getFileHandle(name, { create: true });
        const access = await (handle as FileSystemFileHandle & { createSyncAccessHandle(): { close(): void } }).createSyncAccessHandle();
        access.close();
        await root.removeEntry(name);
      })(),
      3000,
    );
    return true;
  } catch {
    return false;
  }
}

function openDb() {
  dbPromise ??= (async () => {
    const sqlite3 = await sqlite3InitModule();
    let db: Database;
    let persistent = false;
    let opfsUsable = false;
    try {
      const pool = await withTimeout(sqlite3.installOpfsSAHPoolVfs({ name: "bloknote" }), 10_000);
      db = new pool.OpfsSAHPoolDb("/bloknote.sqlite3");
      persistent = true;
      opfsUsable = true;
    } catch (err) {
      console.warn("Persistent database unavailable, using the in-memory fallback:", err);
      opfsUsable = await probeOpfs();
      db = new sqlite3.oo1.DB(":memory:");
    }
    db.exec("CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)");
    return { db, persistent, opfsUsable };
  })();
  return dbPromise;
}

function createSchema(db: Database) {
  db.exec(`
    DROP TABLE IF EXISTS elements;
    DROP TABLE IF EXISTS stats;
    DROP TABLE IF EXISTS places;
    CREATE TABLE elements (
      slug TEXT PRIMARY KEY, parent_slug TEXT NOT NULL, data TEXT NOT NULL, type TEXT NOT NULL, grade_ref REAL,
      osm_ref TEXT
    );
    CREATE INDEX elements_parent ON elements (parent_slug);
    CREATE INDEX elements_osm_ref ON elements (osm_ref);
    CREATE TABLE stats (slug TEXT PRIMARY KEY, total_routes INTEGER NOT NULL);
    CREATE VIRTUAL TABLE places USING fts5(
      name, slug UNINDEXED,
      tokenize = 'unicode61 remove_diacritics 2', prefix = '2 3'
    );
  `);
}

function getMeta(db: Database, key: string): string | undefined {
  return db.selectValue("SELECT value FROM meta WHERE key = ?", [key]) as string | undefined;
}

async function buildDatabase(url: string, version: string, bytes: number | undefined, id: number) {
  const { db } = await openDb();
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download ${url}: ${res.status}`);
  // Prefer the exact decompressed size published in data-version.json: with gzip/brotli the
  // transfer content-length is smaller than the bytes read from the decoded stream, which made
  // the percentage go way above 100%. Fall back to content-length for unencoded responses.
  const length = Number(res.headers.get("content-length"));
  const total = bytes ?? (length > 0 && !res.headers.get("content-encoding") ? length : undefined);
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  const reader = res.body!.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.length;
    self.postMessage({ id, type: "progress", loaded, total, phase: "download" } satisfies DbResponse);
  }
  const records: Record<string, DataJSON> = JSON.parse(await new Blob(chunks as BlobPart[]).text());

  // Deepest first, so that a node's total is complete before it is added to its parent
  const slugs = Object.keys(records).sort((a, b) => b.split("/").length - a.split("/").length);
  const totals = new Map<string, number>();
  for (const slug of slugs) {
    const parent = getParentSlug(slug);
    if (parent === undefined) continue;
    const isRoute = featureToType(records[slug]!) === "route";
    totals.set(parent, (totals.get(parent) ?? 0) + (isRoute ? 1 : (totals.get(slug) ?? 0)));
  }

  db.transaction(() => {
    createSchema(db);
    db.exec("DELETE FROM meta;");
    const insertElement = db.prepare(
      "INSERT INTO elements (slug, parent_slug, data, type, grade_ref, osm_ref) VALUES (?, ?, ?, ?, ?, ?)",
    );
    const insertPlace = db.prepare("INSERT INTO places (name, slug) VALUES (?, ?)");
    const insertStats = db.prepare("INSERT INTO stats (slug, total_routes) VALUES (?, ?)");
    try {
      const slugs = Object.keys(records);
      for (let i = 0; i < slugs.length; i++) {
        const feature = records[slugs[i]!]!;
        const gradeRef = feature.type === "geographic" ? undefined : getGradeReference(feature.tags ?? {});
        insertElement
          .bind([
            slugs[i],
            getParentSlug(slugs[i]!) ?? "",
            JSON.stringify(feature),
            featureToType(feature) ?? "other",
            gradeRef ?? null,
            feature.type === "geographic" ? null : `${feature.type}-${feature.id}`,
          ])
          .stepReset();
        const name = getName(feature);
        if (name) insertPlace.bind([name, slugs[i]]).stepReset();
        // Parsing and inserting is slow: report progress so the UI can show how far along it is
        if (i % 2000 === 0) {
          self.postMessage({ id, type: "progress", loaded: i, total: slugs.length, phase: "parsing" } satisfies DbResponse);
        }
      }
      for (const [slug, total] of totals) insertStats.bind([slug, total]).stepReset();
    } finally {
      insertElement.finalize();
      insertPlace.finalize();
      insertStats.finalize();
    }
    db.exec({ sql: "INSERT INTO meta (key, value) VALUES ('version', ?)", bind: [`${version}:${SCHEMA}`] });
  });
}

function toMatchQuery(query: string): string | undefined {
  const tokens = query.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  if (tokens.length === 0) return;
  return tokens.map((t) => `"${t}"*`).join(" ");
}

function tagPath(key: string): string {
  return `$.tags."${key.replaceAll('"', "")}"`;
}

function buildFilterQuery(filters: SearchFilters): { sql: string; bind: (string | number)[] } | undefined {
  const where: string[] = [];
  const bind: (string | number)[] = [];

  const match = toMatchQuery(filters.text);
  if (match) {
    where.push("slug IN (SELECT slug FROM places WHERE places MATCH ?)");
    bind.push(match);
  }
  if (filters.types.length > 0) {
    where.push(`type IN (${filters.types.map(() => "?").join(", ")})`);
    bind.push(...filters.types);
  }
  if (filters.gradeMin !== undefined) {
    where.push("grade_ref >= ?");
    bind.push(filters.gradeMin);
  }
  if (filters.gradeMax !== undefined) {
    where.push("grade_ref <= ?");
    bind.push(filters.gradeMax);
  }
  if (filters.styles.length > 0) {
    // A route graded in a style's own scale (e.g. climbing:grade:ice) belongs to that style
    where.push(
      `(${filters.styles
        .map(
          () =>
            "(json_extract(data, ?) = 'yes' OR CAST(json_extract(data, ?) AS REAL) > 0 OR json_extract(data, ?) IS NOT NULL)",
        )
        .join(" OR ")})`,
    );
    bind.push(
      ...filters.styles.flatMap((style) => [
        tagPath(`climbing:${style}`),
        tagPath(`climbing:${style}`),
        tagPath(`climbing:grade:${style}`),
      ]),
    );
  }
  for (const { key, value } of filters.tags) {
    if (value) {
      where.push("json_extract(data, ?) = ?");
      bind.push(tagPath(key), value);
    } else {
      where.push("json_extract(data, ?) IS NOT NULL");
      bind.push(tagPath(key));
    }
  }
  if (where.length === 0) return;
  return { sql: `SELECT slug FROM elements WHERE ${where.join(" AND ")}`, bind };
}

interface Search {
  stmt: ReturnType<Database["prepare"]>;
  running: boolean;
  cancelled: boolean;
}
const searches = new Map<number, Search>();

function endSearch(searchId: number) {
  searches.get(searchId)?.stmt.finalize();
  searches.delete(searchId);
}

const BATCH_SIZE = 200;

/** Streams matches until the time budget is spent. Returns true when there are no more rows. */
async function runSearch(searchId: number, search: Search, budgetMs: number): Promise<boolean> {
  const deadline = performance.now() + budgetMs;
  search.running = true;
  try {
    for (;;) {
      const slugs: string[] = [];
      let finished = false;
      while (slugs.length < BATCH_SIZE) {
        if (!search.stmt.step()) {
          finished = true;
          break;
        }
        slugs.push(search.stmt.get(0) as string);
      }
      if (slugs.length > 0) self.postMessage({ type: "matchBatch", searchId, slugs } satisfies DbResponse);
      if (finished) {
        endSearch(searchId);
        return true;
      }
      if (performance.now() > deadline) return false;
      // Lets cancellations and other requests run between batches
      await new Promise((resolve) => setTimeout(resolve));
      if (search.cancelled) {
        endSearch(searchId);
        return true;
      }
    }
  } finally {
    search.running = false;
  }
}

async function handle(req: DbRequest): Promise<DbResponse> {
  const { db, persistent, opfsUsable } = await openDb();
  switch (req.type) {
    case "status":
      return { id: req.id, type: "status", ready: getMeta(db, "version") === `${req.version}:${SCHEMA}`, persistent, opfsUsable };
    case "build":
      await buildDatabase(req.url, req.version, req.bytes, req.id);
      return { id: req.id, type: "status", ready: true, persistent, opfsUsable };
    case "getNode": {
      const data = db.selectValue("SELECT data FROM elements WHERE slug = ?", [req.slug]) as string | undefined;
      return { id: req.id, type: "node", data: data === undefined ? undefined : JSON.parse(data) };
    }
    case "getChildren": {
      const rows = db.selectArrays("SELECT slug, data FROM elements WHERE parent_slug = ?", [req.slug]);
      const data = Object.fromEntries(rows.map(([slug, json]) => [slug as string, JSON.parse(json as string)]));
      return { id: req.id, type: "children", data };
    }
    case "getSubtreeElements": {
      const limit = req.limit ?? 2000;
      const rows = req.slug
        ? db.selectArrays(
            "SELECT slug, data FROM elements WHERE type != 'geographic' AND (slug = ? OR substr(slug, 1, ?) = ?) LIMIT ?",
            [req.slug, req.slug.length + 1, `${req.slug}/`, limit + 1],
          )
        : db.selectArrays("SELECT slug, data FROM elements WHERE type != 'geographic' LIMIT ?", [limit + 1]);
      const truncated = rows.length > limit;
      const data = Object.fromEntries(
        (truncated ? rows.slice(0, limit) : rows).map(([slug, json]) => [slug as string, JSON.parse(json as string)]),
      );
      return { id: req.id, type: "subtreeElements", data, truncated };
    }
    case "getTopLevel": {
      // Places directly under a geographic folder, with their coordinates (center for ways and relations)
      const rows = db.selectArrays(`
        SELECT slug, json_extract(data, '$.tags.name'),
          COALESCE(json_extract(data, '$.lat'), json_extract(data, '$.center.lat')),
          COALESCE(json_extract(data, '$.lon'), json_extract(data, '$.center.lon'))
        FROM elements
        WHERE type != 'geographic' AND parent_slug IN (SELECT slug FROM elements WHERE type = 'geographic')
      `);
      const data = rows.flatMap(([slug, name, lat, lon]) =>
        typeof lat === "number" && typeof lon === "number"
          ? [{ slug: slug as string, name: (name as string | null) ?? undefined, lat, lon }]
          : [],
      );
      return { id: req.id, type: "topLevel", data };
    }
    case "getAllMapElements": {
      const rows = db.selectArrays(`
        SELECT slug, type, parent_slug, data
        FROM elements
        WHERE type != 'geographic' AND (json_extract(data, '$.lat') IS NOT NULL OR json_extract(data, '$.center.lat') IS NOT NULL)
      `);

      const parsedItems: {
        slug: string;
        type: string;
        parentSlug: string;
        lat: number;
        lon: number;
        item: any;
      }[] = [];
      const nodeCoords = new Map<number, [number, number]>();
      const sectorRoutes = new Map<string, [number, number][]>();

      for (const [slug, type, parentSlug, dataJson] of rows) {
        const item = JSON.parse(dataJson as string);
        const lat = item.lat ?? item.center?.lat;
        const lon = item.lon ?? item.center?.lon;
        if (typeof lat !== "number" || typeof lon !== "number") continue;

        if (item.type === "node") {
          nodeCoords.set(item.id, [lon, lat]);
        }

        const isRoute = (type as string) === "route";
        if (isRoute && parentSlug) {
          if (!sectorRoutes.has(parentSlug as string)) {
            sectorRoutes.set(parentSlug as string, []);
          }
          sectorRoutes.get(parentSlug as string)!.push([lon, lat]);
        }

        parsedItems.push({
          slug: slug as string,
          type: type as string,
          parentSlug: parentSlug as string,
          lat,
          lon,
          item,
        });
      }

      const features: MapElementFeature[] = [];

      for (const { slug, type, lat, lon, item } of parsedItems) {
        const tags = item.tags ?? {};
        const isCliff = tags.natural === "cliff";

        if (isCliff) {
          // Cliffs should be paths made out of their nodes, not circles
          let coords: [number, number][] = [];
          if (item.type === "way" && Array.isArray(item.nodes)) {
            coords = item.nodes.map((id: number) => nodeCoords.get(id)).filter(Boolean) as [number, number][];
          }
          if (coords.length < 2) {
            // Short line segment path through node/center
            coords = [
              [lon - 0.00015, lat],
              [lon + 0.00015, lat],
            ];
          }
          features.push({
            type: "Feature",
            geometry: { type: "LineString", coordinates: coords },
            properties: {
              slug,
              name: tags.name ?? "Cliff",
              elementType: "cliff",
              fillColor: "transparent",
              strokeColor: FEATURE_COLORS.cliff.fill,
              href: "",
            },
          });
          continue;
        }

        if (type === "route") {
          const routeStyle = extractRouteStyle(tags);
          const strokeColor = ROUTE_STYLE_COLORS[routeStyle] ?? "#64748b";
          let fillColor = "#94a3b8";
          let gradeStr: string | undefined;
          const gradeObj = getGrade(tags)?.v;
          if (gradeObj) {
            gradeStr = gradeObj.v;
            if (gradeObj.scale !== "unknown") {
              fillColor = getColorFromGrade(gradeObj.v, gradeObj.scale);
            }
          }
          const properties = {
            slug,
            name: tags.name ?? "Unnamed",
            elementType: "route" as const,
            routeStyle,
            grade: gradeStr,
            fillColor,
            strokeColor,
            href: "",
          };
          // Routes mapped as ways are drawn along their nodes, like cliffs (issue #135)
          if (item.type === "way" && Array.isArray(item.nodes)) {
            const coords = item.nodes.map((id: number) => nodeCoords.get(id)).filter(Boolean) as [number, number][];
            if (coords.length >= 2) {
              features.push({
                type: "Feature",
                geometry: { type: "LineString", coordinates: coords },
                properties,
              });
              continue;
            }
          }
          features.push({
            type: "Feature",
            geometry: { type: "Point", coordinates: [lon, lat] },
            properties,
          });
          continue;
        }

        if (type === "area") {
          const routes = sectorRoutes.get(slug);
          if (routes && routes.length > 0) {
            // Sector with routes: show as contour around its routes, not as center point
            const contour = buildSectorContour(routes);
            if (contour.length >= 3) {
              features.push({
                type: "Feature",
                geometry: { type: "LineString", coordinates: contour },
                properties: {
                  slug,
                  name: tags.name ?? "Sector",
                  elementType: "sector",
                  fillColor: "transparent",
                  strokeColor: "#64748b",
                  href: "",
                },
              });
              continue;
            }
          }
          // Area without child routes: show as general area point
          features.push({
            type: "Feature",
            geometry: { type: "Point", coordinates: [lon, lat] },
            properties: {
              slug,
              name: tags.name ?? "Unnamed",
              elementType: "area",
              fillColor: FEATURE_COLORS.area.fill,
              strokeColor: FEATURE_COLORS.area.stroke,
              href: "",
            },
          });
          continue;
        }

        if (type === "gym") {
          features.push({
            type: "Feature",
            geometry: { type: "Point", coordinates: [lon, lat] },
            properties: {
              slug,
              name: tags.name ?? "Unnamed",
              elementType: "gym",
              fillColor: FEATURE_COLORS.gym.fill,
              strokeColor: FEATURE_COLORS.gym.stroke,
              href: "",
            },
          });
        }
      }

      return { id: req.id, type: "allMapElements", data: { type: "FeatureCollection", features } };
    }
    case "getStats": {
      const total = db.selectValue("SELECT total_routes FROM stats WHERE slug = ?", [req.slug]) as number | undefined;
      return { id: req.id, type: "stats", data: { totalRoutes: total ?? 0 } };
    }
    case "getOsmRefs": {
      const data: Record<string, OsmRefEntry> = {};
      for (const ref of req.refs) {
        const rows = db.selectArrays("SELECT slug, data FROM elements WHERE osm_ref = ?", [ref]);
        if (rows[0]) data[ref] = { slug: rows[0][0] as string, data: JSON.parse(rows[0][1] as string) };
      }
      return { id: req.id, type: "osmRefs", data };
    }
    case "getNearbyElements": {
      // Degrees per meter: 111320m per latitude degree, longitude shrinks with cos(latitude)
      const latDelta = req.radiusMeters / 111_320;
      const lonDelta = req.radiusMeters / (111_320 * Math.cos((req.lat * Math.PI) / 180));
      const rows = db.selectArrays(
        `
        SELECT data FROM elements
        WHERE type != 'geographic'
          AND json_extract(data, '$.tags.name') IS NOT NULL
          AND COALESCE(json_extract(data, '$.lat'), json_extract(data, '$.center.lat')) BETWEEN ? AND ?
          AND COALESCE(json_extract(data, '$.lon'), json_extract(data, '$.center.lon')) BETWEEN ? AND ?
        LIMIT 500
        `,
        [req.lat - latDelta, req.lat + latDelta, req.lon - lonDelta, req.lon + lonDelta],
      );
      const data: NearbyCandidate[] = rows.flatMap(([json]) => {
        const feature = JSON.parse(json as string) as DataJSON;
        if (feature.type === "geographic") return [];
        const coordinates = getCoordinates(feature);
        return [
          {
            type: feature.type,
            id: feature.id,
            name: feature.tags?.name,
            latitude: coordinates?.lat,
            longitude: coordinates?.lon,
            grade: getGrade(feature.tags ?? {})?.v.v,
          },
        ];
      });
      return { id: req.id, type: "nearbyElements", data };
    }
    case "filterStart": {
      const query = buildFilterQuery(req.filters);
      if (!query) return { id: req.id, type: "matchPause", exhausted: true };
      const stmt = db.prepare(query.sql);
      stmt.bind(query.bind);
      const search: Search = { stmt, running: false, cancelled: false };
      searches.set(req.searchId, search);
      return { id: req.id, type: "matchPause", exhausted: await runSearch(req.searchId, search, req.budgetMs) };
    }
    case "filterMore": {
      const search = searches.get(req.searchId);
      if (!search) return { id: req.id, type: "matchPause", exhausted: true };
      return { id: req.id, type: "matchPause", exhausted: await runSearch(req.searchId, search, req.budgetMs) };
    }
    case "filterCancel": {
      const search = searches.get(req.searchId);
      if (search) {
        search.cancelled = true;
        if (!search.running) endSearch(req.searchId);
      }
      return { id: req.id, type: "matchPause", exhausted: true };
    }
  }
}

self.onmessage = async (event: MessageEvent<DbRequest>) => {
  try {
    self.postMessage(await handle(event.data));
  } catch (err) {
    self.postMessage({ id: event.data.id, type: "error", message: err instanceof Error ? err.message : String(err) });
  }
};
