# `packages/climbing-data-gen` Agent Guidelines

`packages/climbing-data-gen` generates the static JSON world API consumed by the frontend. It pairs worldwide OpenStreetMap climbing data with the geographic boundary regions defined in `@bloknote/reverse-geocoding-data`.

---

## 1. Pipeline Architecture

```text
Overpass API (sport=climbing)
          |
          v
  src/climbing.json (cached raw OSM response)
          |
          +<-- @bloknote/reverse-geocoding-data (output/hierarchy-index.json)
          |
          v
  Point-in-Polygon Geolocation Walker
  (first sibling boundary containing point wins)
          |
          v
  build/
    |-- world/.../<region>/
    |     |-- data.json      (clustered climbing feature for this region)
    |     |-- children.json  (direct children, used for tree navigation)
    |     `-- stats.json     (total route counts for this subtree)
    |-- world/download.json  (flat record of every feature, keyed by slug)
    |-- world/data-version.json (SHA-256 of download.json, used for client change detection)
    `-- osm-index/node-*.json   (sharded OSM node index for live OSM lookups)
```

---

## 2. Key Modules

- **`src/download.ts`**: Queries the worldwide Overpass endpoint for all `sport=climbing` nodes, ways, and relations. Retries with 60s delays on timeout. Caches raw JSON in `src/climbing.json`.
- **`src/reverse-geolocation.ts`**: Evaluates point coordinates against the hierarchy bounding box index (`HIERARCHY_INDEX`), then performs precise Turf point-in-polygon checks on leaf GeoJSON boundaries.
- **`src/static-api-generator.ts`**: Partitions climbing places into regional directory buckets, writes per-region `data.json`, `children.json`, and `stats.json`, and assembles the top-level `download.json` (every feature in one flat record) plus `data-version.json` (SHA-256 of `download.json`).
- **`src/world-points.ts`**: Extracts lightweight point coordinates and attributes for fast spatial sorting and map rendering.

---

## 3. Commands

```bash
# Generate static API using cached src/climbing.json
bun run build

# Refresh climbing cache from Overpass and regenerate API
bun run update
```

---

## 4. Agent Warnings

- **Large Datasets**: `src/climbing.json` is tens of MB and the `build/` output directory contains hundreds of thousands of files across gigabytes. Never run unfiltered file searches or recursive grep over this directory.
- **Deterministic Placement**: A climbing place is assigned to the first sibling by alphabetical slug whose boundary polygon contains it. Points outside of all boundaries are dropped.
- **Client Sync Is a Full Redownload**: The app compares `world/data-version.json` against the version marker stored in the browser. On any mismatch, the client re-downloads the entire `world/download.json` (currently ~42 MB raw / ~6 MB gzipped) and rebuilds its local SQLite database in a worker. There is no incremental/delta update mechanism; keep `download.json` compact because every user pays for it on every dataset change.
- **Overpass Header Latency**: Overpass sends response headers only when the whole query is done. `src/download.ts` uses raw `https.request` (not `fetch`, which gives up after 5 minutes) and retries up to 10 times with 60 s delays, so a refresh can legitimately run for many minutes.
