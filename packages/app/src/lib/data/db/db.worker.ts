import sqlite3InitModule, { type Database } from "@sqlite.org/sqlite-wasm";
import type { DataJSON } from "@bloknote/climbing-data-gen";
import { featureToType, getName } from "#lib/data/parse/data.js";
import { getParentSlug } from "#lib/helpers/slug.js";
import { getCoordinates, getGrade, getGradeReference } from "#lib/data/parse/osm-tags.js";
import type { OsmFeature } from "osm-api";
import { getColorFromGrade } from "#lib/data/network/grade.js";
import {
  buildSectorContour,
  extractRouteStyle,
  FEATURE_COLORS,
  ROUTE_STYLE_COLORS,
} from "#lib/data/parse/route-styles.js";
import type { DbRequest, DbResponse, MapElementFeature, NearbyCandidate, OsmRefEntry, SearchFilters, TickRouteMatch } from "./types";

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
      const pool = await installPool(sqlite3);
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

/** When a leader tab closes, the browser releases its OPFS sync handles asynchronously: the newly
 * elected leader could briefly fail to install the pool and wrongly fall back to memory, so a
 * short retry loop bridges the handoff (issue #208) */
async function installPool(sqlite3: Awaited<ReturnType<typeof sqlite3InitModule>>) {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      return await withTimeout(sqlite3.installOpfsSAHPoolVfs({ name: "bloknote" }), 10_000);
    } catch (err) {
      lastErr = err;
      await new Promise((resolve) => setTimeout(resolve, 150 * (attempt + 1)));
    }
  }
  throw lastErr;
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

let buildPromise: Promise<void> | undefined;
const buildIds = new Set<number>();

/** Progress goes to every tab that asked for the build, not only to the first requester */
function postBuildProgress(loaded: number, total: number | undefined, phase: "download" | "parsing") {
  for (const id of buildIds) self.postMessage({ id, type: "progress", loaded, total, phase } satisfies DbResponse);
}

async function buildDatabase(url: string, version: string, bytes: number | undefined, id: number) {
  buildIds.add(id);
  // Several tabs can ask for the same build (a tab opened on an empty database, a replayed
  // request after a leader handoff): they share the running one instead of racing on downloads
  // and db.transaction (issue #208)
  buildPromise ??= doBuild(url, version, bytes).finally(() => {
    buildPromise = undefined;
  });
  try {
    await buildPromise;
  } finally {
    buildIds.delete(id);
  }
}

async function doBuild(url: string, version: string, bytes: number | undefined) {
  const { db } = await openDb();
  // A replayed request or another tab may already have built this exact version
  if (getMeta(db, "version") === `${version}:${SCHEMA}`) return;
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
    postBuildProgress(loaded, total, "download");
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
          postBuildProgress(i, slugs.length, "parsing");
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

/** Lowercases, strips diacritics and punctuation: used to compare route and area names (issue #154) */
function normalizeName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Name variants of a route query: the full name, and without a trailing pitch suffix like "(L1)" */
function nameVariants(name: string): string[] {
  const base = normalizeName(name);
  const variants = new Set<string>(base ? [base] : []);
  const withoutPitch = base.replace(/ (l|pitch) \d+$/, "").trim();
  if (withoutPitch && withoutPitch !== base) variants.add(withoutPitch);
  return [...variants];
}

/** Normalizes a hierarchical location — an array of segments (shallowest first) or a raw string
 * using "> ", " - ", or ": " separators (CSV exports) — into segments, deepest first */
function areaSegments(area?: string | string[]): string[] {
  return (Array.isArray(area) ? area : (area ?? "").split(/\s*>\s*|\s+-\s+|\s*:\s*/))
    .map((segment) => segment.trim())
    .filter(Boolean)
    .reverse()
    .slice(0, 4);
}

/** Area candidates matching a name by FTS */
function matchAreaCandidates(db: Database, query: string): { slug: string; data: DataJSON }[] {
  const match = toMatchQuery(query);
  if (!match) return [];
  const areas = db.selectArrays(
    `SELECT e.slug, e.data FROM places JOIN elements e ON e.slug = places.slug
     WHERE places MATCH ? AND e.type = 'area' LIMIT 5`,
    [match],
  );
  // Areas whose name is exactly the queried segment first: FTS prefixes otherwise match loosely
  // ("Sector 5 & 6" would match "sector-5-boulder-6" before the crag actually meant)
  const target = normalizeName(query);
  return areas
    .map(([slug, json]) => ({ slug: slug as string, data: JSON.parse(json as string) }))
    .sort(
      (a, b) =>
        ((normalizeName((b.data as OsmFeature).tags?.name ?? "") === target ? 1 : 0) -
          (normalizeName((a.data as OsmFeature).tags?.name ?? "") === target ? 1 : 0)),
    );
}

/** Token subsets tried for one hint segment, grouped by how many tokens were dropped: the full name first, then dropping leading and trailing tokens */
function relaxedTokenQueries(segment: string): string[][] {
  const tokens = segment.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const levels: string[][] = [];
  for (let drop = 0; drop < tokens.length; drop++) {
    const level: string[] = [];
    for (let dropStart = 0; dropStart <= drop; dropStart++) {
      const dropEnd = drop - dropStart;
      if (dropStart + dropEnd >= tokens.length) continue;
      const subset = tokens.slice(dropStart, tokens.length - dropEnd);
      level.push(subset.map((t) => `"${t}"*`).join(" "));
    }
    if (level.length > 0) levels.push(level);
  }
  return levels;
}

/**
 * Matches one location-hint segment against regions and areas. The FTS AND-query is relaxed
 * token by token (dropping leading ones first) because logbook hints carry noise the OSM names
 * do not have: "15. Laurentides", "3: Main Wall", "Thakhek (Pha Tam Kam)" (issue #154).
 */
function matchSegmentCandidates(db: Database, segment: string): { slug: string; data: DataJSON }[] {
  const target = normalizeName(segment);
  const targetTokens = new Set(target.split(" ").filter(Boolean));
  const best = new Map<string, { slug: string; data: DataJSON; rank: number }>();
  // Collect candidates from the full query and two relaxation levels before ranking: the loosest
  // level alone often matches noise ("Boulders") while the right one sits one level further
  const levels = relaxedTokenQueries(segment).slice(0, 3);
  for (const level of levels) {
    for (const subset of level) {
      const subsetName = normalizeName(subset.replaceAll('"', ""));
      // Common tokens ("north", "15") match many places: shallower slugs (regions) first, so the
      // LIMIT does not cut them off in favour of deep namesakes
      const rows = db.selectArrays(
        `SELECT e.slug, e.data FROM places JOIN elements e ON e.slug = places.slug
         WHERE places MATCH ? AND e.type IN ('geographic', 'area') ORDER BY length(e.slug) ASC LIMIT 10`,
        [subset],
      );
      for (const [slug, json] of rows) {
        if (best.has(slug as string)) continue;
        const data = JSON.parse(json as string) as DataJSON;
        // Regions keep their name at the top level, OSM elements in their tags (see getName)
        const name = normalizeName(getName(data) ?? "");
        const nameTokens = name.split(" ").filter(Boolean);
        // Exact full name, then a name that is exactly the relaxed subset, then a name whose
        // tokens are all part of the hint segment. Anything looser (rank 3) is dropped: the
        // remaining FTS prefixes only match by coincidence ("International" matching a route
        // called "International No hand contest") and derail the whole chain.
        const rank =
          name === target
            ? 0
            : name === subsetName
              ? 1
              : nameTokens.length > 0 && nameTokens.every((t) => targetTokens.has(t))
                ? 2
                : 3;
        if (rank <= 2) best.set(slug as string, { slug: slug as string, data, rank });
      }
    }
    if (best.size > 0 && [...best.values()].some((c) => c.rank <= 1)) break;
  }
  return [...best.values()]
    .sort((a, b) => a.rank - b.rank || a.slug.length - b.slug.length || a.slug.localeCompare(b.slug))
    .slice(0, 5)
    .map(({ slug, data }) => ({ slug, data }));
}

/**
 * Walks a hierarchical location hint from its shallowest segment down (issue #154): each segment
 * must match a region or area below the previous one, so the hint's own hierarchy disambiguates
 * the names ("Sarcophage" is only kept when it sits under the matched Mont-King, not in France).
 * A segment with no descendant match is skipped: logbooks often name levels that OSM does not
 * have, while deeper segments still exist ("Val-David" missing, "Elizabeth Boulder" present).
 */
function matchAreaChain(db: Database, segments: string[]): ({ slug: string; data: DataJSON } | null)[] {
  const chain: ({ slug: string; data: DataJSON } | null)[] = [];
  let parentSlug = "";
  for (const segment of segments) {
    let best: { slug: string; data: DataJSON } | undefined;
    for (const candidate of matchSegmentCandidates(db, segment)) {
      if (parentSlug && candidate.slug !== parentSlug && !candidate.slug.startsWith(`${parentSlug}/`)) continue;
      if (!best || candidate.slug.length < best.slug.length) best = candidate;
    }
    if (best) {
      chain.push(best);
      parentSlug = best.slug;
    } else {
      chain.push(null);
    }
  }
  return chain;
}

/** How many areas may be scanned per tick query, to bound the subtree scans */
const MATCH_TICK_MAX_AREAS = 4;
/** How many route candidates are returned per tick query */
const MATCH_TICK_MAX_ROUTES = 5;

/** Upper bound for an index range scan over all slugs starting with `prefix` (no slug contains
 * U+FFFF, so anything below it and above the prefix starts with the prefix) */
function subtreeUpper(prefix: string): string {
  return `${prefix}\uffff`;
}

function scanAreaSubtree(
  db: Database,
  areaSlug: string,
  variants: string[],
  results: TickRouteMatch[],
  seenSlugs: Set<string>,
) {
  // The slug range uses the primary key index: `substr(slug, 1, ?) = ?` forced a full scan of
  // every route for each area, which made matching a long logbook crawl (issue #239). Only the
  // `area/` subtree is scanned: `matchAreaCandidates` only returns areas, so the `slug = area`
  // arm of the old condition never matched a route anyway.
  const prefix = `${areaSlug}/`;
  const rows = db.selectArrays(
    `SELECT slug, parent_slug, data FROM elements
     WHERE type = 'route' AND slug >= ? AND slug < ? LIMIT 2000`,
    [prefix, subtreeUpper(prefix)],
  );
  for (const [slug, parentSlug, json] of rows) {
    if (results.length >= MATCH_TICK_MAX_ROUTES) return;
    if (seenSlugs.has(slug as string)) continue;
    const data = JSON.parse(json as string) as DataJSON;
    const base = normalizeName((data as OsmFeature).tags?.name ?? "");
    if (!base || !variants.includes(base)) continue;
    seenSlugs.add(slug as string);
    results.push({ slug: slug as string, parentSlug: parentSlug as string, data });
  }
}

/**
 * Finds routes named like the queried tick inside the areas given by the CSV (issue #154).
 * The location hierarchy is tried deepest first (the wall is more specific than the country).
 * A fallback matches the route name globally, but only when the slug path mentions one of the
 * area segments: routes sometimes sit directly under a region while the logbook names its crag.
 * `areaCache` lets consecutive ticks from the same crag reuse the expensive area lookups.
 */
function matchTickQuery(
  db: Database,
  query: { name: string; area?: string | string[] },
  areaCache?: Map<string, { slug: string; data: DataJSON }[]>,
): TickRouteMatch[] {
  const variants = nameVariants(query.name);
  if (variants.length === 0 || !query.area) return [];

  const segments = areaSegments(query.area);
  const results: TickRouteMatch[] = [];
  const seenSlugs = new Set<string>();
  const visitedAreas = new Set<string>();

  for (const segment of segments) {
    if (results.length >= MATCH_TICK_MAX_ROUTES || visitedAreas.size >= MATCH_TICK_MAX_AREAS) break;
    let candidates = areaCache?.get(segment);
    if (!candidates) {
      candidates = matchAreaCandidates(db, segment);
      areaCache?.set(segment, candidates);
    }
    for (const area of candidates) {
      if (results.length >= MATCH_TICK_MAX_ROUTES || visitedAreas.size >= MATCH_TICK_MAX_AREAS) break;
      if (visitedAreas.has(area.slug)) continue;
      visitedAreas.add(area.slug);
      scanAreaSubtree(db, area.slug, variants, results, seenSlugs);
    }
  }
  if (results.length > 0) return results;

  const match = toMatchQuery(query.name);
  if (!match) return [];
  const rows = db.selectArrays(
    `SELECT e.slug, e.data FROM places JOIN elements e ON e.slug = places.slug
     WHERE places MATCH ? AND e.type = 'route' LIMIT 20`,
    [match],
  );
  const segmentBases = segments.map(normalizeName);
  for (const [slug, json] of rows) {
    if (results.length >= MATCH_TICK_MAX_ROUTES) break;
    if (seenSlugs.has(slug as string)) continue;
    const data = JSON.parse(json as string) as DataJSON;
    const base = normalizeName((data as OsmFeature).tags?.name ?? "");
    if (!base || !variants.includes(base)) continue;
    // The slug path must mention one of the CSV's area segments (slugified names)
    const components = (slug as string).split("/").map((c) => normalizeName(c.replaceAll("-", " ")));
    if (!components.some((c) => segmentBases.includes(c))) continue;
    const parentSlug = (slug as string).split("/").slice(0, -1).join("/");
    results.push({ slug: slug as string, parentSlug, data });
  }
  return results;
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
  // Elements referenced by the user's ticks, bookmarks, comments or ratings (issue #166). The
  // refs are chunked so the statement stays within the SQLite variable limit; the chunks are
  // OR-ed together inside the same prepared statement so the search keeps streaming.
  if (filters.mineRefs && filters.mineRefs.length > 0) {
    const chunkSize = 800;
    const chunks: string[] = [];
    for (let i = 0; i < filters.mineRefs.length; i += chunkSize) {
      const chunk = filters.mineRefs.slice(i, i + chunkSize);
      chunks.push(`osm_ref IN (${chunk.map(() => "?").join(", ")})`);
      bind.push(...chunk);
    }
    where.push(`(${chunks.join(" OR ")})`);
  }
  if (filters.minLength !== undefined) {
    // Only plain numeric `climbing:length` values (meters) can be compared in SQL: lengths
    // written with units or in feet are skipped by the database search and still surface
    // through the tree once their node is loaded.
    where.push("CAST(json_extract(data, ?) AS REAL) >= ?");
    bind.push(tagPath("climbing:length"), filters.minLength);
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
    case "getElements": {
      const data: Record<string, DataJSON> = {};
      for (let i = 0; i < req.slugs.length; i += 500) {
        const chunk = req.slugs.slice(i, i + 500);
        const rows = db.selectArrays(
          `SELECT slug, data FROM elements WHERE slug IN (${chunk.map(() => "?").join(", ")})`,
          chunk,
        );
        for (const [slug, json] of rows) data[slug as string] = JSON.parse(json as string) as DataJSON;
      }
      return { id: req.id, type: "elements", data };
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
    case "matchTicks": {
      // Area-scoped matching for the tick import (issue #154): the area from the CSV locates the
      // crag/sector(s), then route names are matched inside their subtrees. Name-only matches are
      // useless: without an area, no candidates are returned.
      const data: TickRouteMatch[][] = [];
      // Logbooks usually repeat the same crag for many ticks: share the area lookups (issue #239)
      const areaCache = new Map<string, { slug: string; data: DataJSON }[]>();
      for (const query of req.queries) {
        data.push(matchTickQuery(db, query, areaCache));
      }
      return { id: req.id, type: "tickMatches", data };
    }
    case "matchAreas": {
      const data: { slug: string; data: DataJSON }[][] = [];
      for (const query of req.queries) {
        data.push(matchAreaCandidates(db, query));
      }
      return { id: req.id, type: "areaMatches", data };
    }
    case "matchAreaChain": {
      return { id: req.id, type: "areaChain", chain: matchAreaChain(db, req.segments) };
    }
    case "upsertElement": {
      // Locally created (not yet pushed) elements are inserted so they resolve like dataset
      // elements: the ticks list can already place them, and they are matched by name
      const { slug, feature } = req;
      const type = featureToType(feature) ?? "other";
      const parentSlug = slug.includes("/") ? slug.slice(0, slug.lastIndexOf("/")) : "";
      const upsert = db.prepare(
        `INSERT INTO elements (slug, parent_slug, data, type, grade_ref, osm_ref) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(slug) DO UPDATE SET parent_slug = excluded.parent_slug, data = excluded.data,
           type = excluded.type, osm_ref = excluded.osm_ref`,
      );
      const name = getName(feature);
      upsert.bind([
        slug,
        parentSlug,
        JSON.stringify(feature),
        type,
        getGradeReference(feature.tags ?? {}) ?? null,
        `${feature.type}-${feature.id}`,
      ]).stepReset();
      db.exec({ sql: "DELETE FROM places WHERE slug = ?", bind: [slug] });
      if (name) db.exec({ sql: "INSERT INTO places (name, slug) VALUES (?, ?)", bind: [name, slug] });
      return { id: req.id, type: "elementUpserted" };
    }
    case "deleteElement": {
      db.exec({ sql: "DELETE FROM elements WHERE slug = ?", bind: [req.slug] });
      db.exec({ sql: "DELETE FROM places WHERE slug = ?", bind: [req.slug] });
      return { id: req.id, type: "elementDeleted" };
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
