import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  BOUNDARY_EXTENSION,
  DATA_DIR,
  ensureDirExists,
  HIERARCHY_INDEX,
  LARGE_BOUNDARY_BYTES,
  OUTPUT_DIR,
  slugify,
  type BoundingBox,
  type IndexNode,
} from "./index.ts";

let errors = 0;
function error(message: string) {
  console.error(`❌ ${message}`);
  errors++;
}

function emptyBBox(): BoundingBox {
  return { x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity };
}

function mergeBBox(target: BoundingBox, source: BoundingBox): BoundingBox {
  if (source.x0 < target.x0) target.x0 = source.x0;
  if (source.x1 > target.x1) target.x1 = source.x1;
  if (source.y0 < target.y0) target.y0 = source.y0;
  if (source.y1 > target.y1) target.y1 = source.y1;
  return target;
}

function visitCoords(coords: unknown, bbox: BoundingBox): void {
  if (!Array.isArray(coords) || coords.length === 0) return;
  if (typeof coords[0] === "number" && typeof coords[1] === "number") {
    const [lon, lat] = coords as [number, number];
    if (lon < bbox.x0) bbox.x0 = lon;
    if (lon > bbox.x1) bbox.x1 = lon;
    if (lat < bbox.y0) bbox.y0 = lat;
    if (lat > bbox.y1) bbox.y1 = lat;
    return;
  }
  for (const child of coords) visitCoords(child, bbox);
}

function readLeaf(file: string, relativePath: string): IndexNode {
  const size = statSync(file).size;
  if (size > LARGE_BOUNDARY_BYTES) {
    console.warn(
      `⚠️  ${relativePath} is ${Math.round(size / 1024)} KB (> ${LARGE_BOUNDARY_BYTES / 1024} KB): consider simplifying it in /edit-map.`,
    );
  }

  let geojson: any;
  try {
    geojson = JSON.parse(readFileSync(file, "utf8"));
  } catch (e) {
    error(`${relativePath} is not valid JSON: ${e}`);
    return { _bbox: emptyBBox() };
  }
  if (geojson?.type !== "FeatureCollection" || !Array.isArray(geojson.features)) {
    error(`${relativePath} must be a FeatureCollection`);
    return { _bbox: emptyBBox() };
  }
  const polygons = geojson.features.filter(
    (f: any) => f.geometry?.type === "Polygon" || f.geometry?.type === "MultiPolygon",
  );
  if (!polygons.length) error(`${relativePath} has no Polygon or MultiPolygon`);

  const bbox = emptyBBox();
  for (const feature of geojson.features) {
    if (feature.geometry?.coordinates) visitCoords(feature.geometry.coordinates, bbox);
  }
  return { _bbox: bbox };
}

/**
 * Builds the index of a directory of data/. Children are sorted by slug: the geolocation tries
 * them in this order, so the first matching sibling wins.
 */
function buildHierarchyTree(dir: string, relativePath: string): IndexNode {
  const self: IndexNode = { _bbox: emptyBBox() };
  const children = new Map<string, IndexNode>();

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const path = join(dir, entry.name);
    const childRelativePath = `${relativePath}/${entry.name}`;
    let slug: string;
    let child: IndexNode;

    if (entry.isDirectory()) {
      slug = entry.name;
      child = buildHierarchyTree(path, childRelativePath);
      if (Object.keys(child).length === 1) error(`${childRelativePath}/ has no region`);
    } else if (entry.isFile() && entry.name.endsWith(BOUNDARY_EXTENSION)) {
      slug = entry.name.slice(0, -BOUNDARY_EXTENSION.length);
      child = readLeaf(path, childRelativePath);
    } else {
      error(`Unexpected file ${childRelativePath}: data/ only contains directories and *${BOUNDARY_EXTENSION}`);
      continue;
    }

    if (slug !== slugify(slug)) error(`${childRelativePath} is not a slug (expected ${slugify(slug)})`);
    if (children.has(slug)) {
      error(
        `${relativePath}/${slug} is both a directory and a ${BOUNDARY_EXTENSION} file: only leaves have a boundary`,
      );
      continue;
    }
    children.set(slug, child);
  }

  for (const slug of [...children.keys()].sort()) {
    const child = children.get(slug)!;
    mergeBBox(self._bbox, child._bbox);
    self[slug] = child;
  }
  return self;
}

ensureDirExists(OUTPUT_DIR);
const worldTree = buildHierarchyTree(join(DATA_DIR, "world"), "world");
if (errors) {
  console.error(`\n${errors} error(s) in ${DATA_DIR}`);
  process.exit(1);
}

writeFileSync(HIERARCHY_INDEX, JSON.stringify({ world: worldTree }));
console.log(`🎯 Spatial Index written successfully -> ${HIERARCHY_INDEX}`);
