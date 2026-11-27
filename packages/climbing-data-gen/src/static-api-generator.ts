import { readFileSync, readdirSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";

import { ReverseGeolocator } from "./reverse-geolocation.ts";
import type { Coordinates, DataJSON, GeographicFolderElement, OverpassRequest } from "./types.ts";
import { ensureDirExists, slugify, USER_AGENT } from "@bloknote/reverse-geocoding-data";
import {
  addRawSectorStats,
  computeRawSectorStats,
  emptyRawSectorStats,
  type RawSectorStats,
} from "@bloknote/osm-climbing";
import type { OsmFeature } from "osm-api";
import { getStaticIdentifier, osmIndexFile } from "@bloknote/common";
import { RSS_PREVIOUS_VERSIONS_CACHE } from "./config.ts";
import {
  isRecentItem,
  OSM_BASE_URL,
  recentItemXml,
  renderRssFeed,
  RSS_CHANGES_FETCH_DELAY_MS,
  RSS_CHANGES_FETCH_LIMIT,
  type RecentItem,
  RSS_MAX_ITEMS,
} from "./rss.ts";

export type StaticApiGeneratorOptions = {
  outApiDirectory: string;
  /** Overpass responses, for instance one per tile. An element may be in several of them. */
  osmDataFiles: string[];
  geoIndexFile: string;
  reverseGeocodingDataDirectory: string;
  maxCacheSize?: number;
};

export async function generateStaticAPI(options: StaticApiGeneratorOptions) {
  ensureDirExists(options.outApiDirectory);

  console.info("Processing OSM Climbing Data...");
  const allElements = readOsmData(options.osmDataFiles);
  const rootNodes = getRootOsmDataNodes(allElements);

  console.info("Writing static API endpoints");
  await writeStaticApi(options, allElements, rootNodes);
}

function readOsmData(osmDataFiles: string[]): Map<string, OsmFeature> {
  // Index all elements
  const osmElementsMap = new Map<string, OsmFeature>();
  for (const osmDataFile of osmDataFiles) {
    if (!existsSync(osmDataFile)) {
      throw new Error(`Missing OSM Data: Please ensure ${osmDataFile} exists.`);
    }

    const rawData: OverpassRequest = JSON.parse(readFileSync(osmDataFile, "utf8"));
    for (const el of rawData.elements) {
      const id = getStaticIdentifier(el.type, el.id);
      // The files may have been downloaded at different times: keep the latest version
      const existing = osmElementsMap.get(id);
      if (existing && (existing.version ?? 0) >= (el.version ?? 0)) continue;
      osmElementsMap.set(id, el);
    }
  }
  console.info(`${osmElementsMap.size} elements in ${osmDataFiles.length} files`);

  return osmElementsMap;
}

function getRootOsmDataNodes(allElements: Map<string, OsmFeature>): OsmFeature[] {
  // Identify dependent children (so we don't geolocate a route that belongs to a crag)
  const osmParentSet = new Set<string>();
  for (const el of allElements.values()) {
    if (el.type === "way" && el.nodes) {
      el.nodes.forEach((n: number) => osmParentSet.add(getStaticIdentifier("node", n)));
    }
    if (el.type === "relation" && el.members) {
      el.members.forEach((m) => osmParentSet.add(getStaticIdentifier(m.type, m.ref)));
    }
  }

  // Process only root elements (Areas/Crags that aren't inside another relation)
  const rootElements = Array.from(allElements.values()).filter(
    (el) => !osmParentSet.has(getStaticIdentifier(el.type, el.id)),
  );

  // Recursively add children to parents
  return rootElements;
}

function* iterateOsmFeaturesChildren(element: OsmFeature, allElements: Map<string, OsmFeature>) {
  if (element.type === "way" && element.nodes) {
    for (const nodeId of element.nodes) {
      const child = allElements.get(getStaticIdentifier("node", nodeId));
      if (child) {
        yield child;
      }
    }
  } else if (element.type === "relation" && element.members) {
    for (const member of element.members) {
      const child = allElements.get(getStaticIdentifier(member.type, member.ref));
      if (child) {
        yield child;
      }
    }
  }
}

function* recursiveIterateOsmFeatureChildren(
  el: OsmFeature,
  allElements: Map<string, OsmFeature>,
  path: OsmFeature[] = [el],
): Generator<{ path: OsmFeature[]; el: OsmFeature }> {
  yield { path, el };
  for (const child of iterateOsmFeaturesChildren(el, allElements)) {
    yield* recursiveIterateOsmFeatureChildren(child, allElements, [...path, child]);
  }
}

// Find a lat/lon to use for reverse geocoding
function getRepresentativeCoordinates(
  element: OsmFeature,
  allElements: Map<string, OsmFeature>,
): Coordinates | undefined {
  if (element.type === "node") return { lon: element.lon, lat: element.lat };
  // @ts-ignore
  if (element.center) return { lon: element.center.lon, lat: element.center.lat };
  // @ts-ignore
  if (element.geometry?.length > 0) {
    // @ts-ignore
    return { lon: element.geometry[0].lon, lat: element.geometry[0].lat };
  }

  // TODO: compute center
  if (element.type === "way" && element.nodes?.length > 0) {
    const child = allElements.get(getStaticIdentifier("node", element.nodes[0]!));
    if (child) return getRepresentativeCoordinates(child, allElements);
  }
  if (element.type === "relation" && element.members?.length > 0) {
    if (!element.members[0]) return;
    const child = allElements.get(getStaticIdentifier(element.members[0].type, element.members[0].ref));
    if (child) return getRepresentativeCoordinates(child, allElements);
  }
}

interface MapTree {
  children: Map<string, MapTree>;
}

function addPathToMapTree(mapTree: MapTree, path: string[], index = 0) {
  if (!path[index] || !mapTree) {
    return;
  }
  addPathToMapTree(
    mapTree.children.getOrInsertComputed(path[index], () => ({ children: new Map() })),
    path,
    index + 1,
  );
}

function getName(el: OsmFeature): string | undefined {
  const tags = el.tags;
  if (tags) {
    return tags.official_name || tags.name || tags["name:en"] || tags["name:fr"];
  }
}

function getPathName(el: OsmFeature): string {
  return slugify(getName(el) || `${el.type}:${el.id}`);
}

function getOsmPath(els: OsmFeature[]) {
  return els.map((el) => getPathName(el));
}

function writeDataJson(options: StaticApiGeneratorOptions, path: string, el: OsmFeature) {
  const targetPath = join(options.outApiDirectory, path, "data.json");
  ensureDirExists(dirname(targetPath));
  writeFileSync(targetPath, JSON.stringify(el));
}

async function writeStaticApi(
  options: StaticApiGeneratorOptions,
  allElements: Map<string, OsmFeature>,
  rootNodes: OsmFeature[],
) {
  const geolocator = new ReverseGeolocator(
    options.geoIndexFile,
    options.reverseGeocodingDataDirectory,
    options.maxCacheSize,
  );

  // Create the geographic hierarchy
  const geographicTree: MapTree = { children: new Map() };

  // Current slug of every OSM feature, by index file
  const osmIndex = new Map<string, Record<string, string>>();
  let noTags = 0;
  let emptyTags = 0;
  let cliffs = 0;
  const outsideRegions: string[] = [];
  for (const rootNode of rootNodes) {
    const coordinates = getRepresentativeCoordinates(rootNode, allElements);
    if (!coordinates) {
      console.error("Failed to get representative coordinates for node", rootNode);
      continue;
    }
    const location = geolocator.geolocate(coordinates.lon, coordinates.lat);

    // Outside of every region of @bloknote/reverse-geocoding-data: not in the API until a region
    // is added there
    if (!location) {
      outsideRegions.push(`${rootNode.type}/${rootNode.id} (${coordinates.lon},${coordinates.lat})`);
      continue;
    }

    addPathToMapTree(geographicTree, location);
    mkdirSync(join(options.outApiDirectory, ...location), { recursive: true });

    const visited = new Set<string>();

    for (const { el, path } of recursiveIterateOsmFeatureChildren(rootNode, allElements)) {
      if (!el.tags) {
        noTags++;
        continue;
      }
      if (el.tags && Object.keys(el.tags).length === 0) {
        emptyTags++;
        continue;
      }
      // Sectors sometimes include the contour of their cliffs
      if (el.type === "way" && el.tags?.natural === "cliff") {
        cliffs++;
        let hasChildrenWithTags = false;
        for (const child of iterateOsmFeaturesChildren(el, allElements)) {
          if (child.tags) {
            hasChildrenWithTags = true;
            break;
          }
        }
        if (!hasChildrenWithTags) {
          continue;
        }
      }

      const completePath = [...location, ...getOsmPath(path)];
      let pathString = completePath.join("/");
      let duplicate = visited.has(pathString);
      if (duplicate) {
        console.warn(
          "Duplicate path:",
          pathString,
          "For routes or projects, disambiguate the name (e.g. 'Project 1'. If this shows up for a route with the same name as its sector, don't forget to set the sector as a relation and add this route to the relation.",
        );
      }
      visited.add(pathString);

      writeDataJson(options, pathString, el);
      const indexFile = osmIndexFile(el.type, el.id);
      const bucket = osmIndex.get(indexFile) ?? {};
      bucket[el.id] = pathString.slice("world/".length);
      osmIndex.set(indexFile, bucket);
    }
  }
  console.info("no tags:", noTags);
  console.info("empty tags:", emptyTags);
  console.info("cliffs:", cliffs);
  if (outsideRegions.length > 0) {
    console.warn(
      `${outsideRegions.length} root elements are outside of every region, and skipped:`,
      outsideRegions.slice(0, 20).join(", ") + (outsideRegions.length > 20 ? ", ..." : ""),
    );
  }

  for (const [file, bucket] of osmIndex) {
    const target = join(options.outApiDirectory, file);
    ensureDirExists(dirname(target));
    writeFileSync(target, JSON.stringify(bucket));
  }

  // Add info to the geographicTree api endpoints by iterating through it.
  writeChildrenDataToGeoTree([options.outApiDirectory], geographicTree, geolocator);

  console.info("Writing static child, download, and stats endpoints");
  await writeStaticApiMetadata(join(options.outApiDirectory, "world"), RSS_PREVIOUS_VERSIONS_CACHE);
}

function writeChildrenDataToGeoTree(path: string[], mapTree: MapTree, geolocator: ReverseGeolocator) {
  for (const [childName, childMapTree] of mapTree.children) {
    const newPath = [...path, childName];

    const { id, name } = geolocator.getName(newPath.slice(1));
    const data: GeographicFolderElement = {
      type: "geographic",
      name,
      nameId: id,
      bbox: geolocator.getBBox(newPath.slice(1)),
    };

    writeFileSync(join(newPath.join("/"), "data.json"), JSON.stringify(data satisfies DataJSON));

    writeChildrenDataToGeoTree(newPath, childMapTree, geolocator);
  }
}

type DataJSONRecord = Record<string, DataJSON>;

interface GeneratedDirectory {
  data?: DataJSON;
  totalRoutes: number;
  /** Raw climbing stats of the whole subtree (issue #114), stored in stats.json */
  raw: RawSectorStats;
  /** Recently added or edited features in this subtree, newest first (see rss.ts) */
  recent: RecentItem[];
}

const routeClimbingValues = new Set([
  "route_bottom",
  "route_top",
  "route",
  "route_start",
  "boulder",
  "bouldering",
  "abseil_route",
  "abseil",
  "toprope",
  "drytooling",
]);

function isRoute(data: DataJSON | undefined): boolean {
  if (!data || data.type === "geographic" || !data.tags?.climbing) return false;
  return data.tags.climbing.split(";").some((value) => routeClimbingValues.has(value.trim()));
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Gathers every recent OSM feature of the built tree, newest edits first */
function collectRecentFeatures(directory: string, features: OsmFeature[] = []): OsmFeature[] {
  const dataPath = join(directory, "data.json");
  if (existsSync(dataPath)) {
    const data = JSON.parse(readFileSync(dataPath, "utf8")) as DataJSON;
    if (data.type !== "geographic" && isRecentItem(data as OsmFeature)) features.push(data as OsmFeature);
  }
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) collectRecentFeatures(join(directory, entry.name), features);
  }
  return features;
}

/**
 * Fetches the previous version of the most recent edited elements (issue #222): the change
 * summaries are built by diffing the two versions, instead of querying changesets. Only the
 * elements that can make it into a feed are fetched (capped at RSS_CHANGES_FETCH_LIMIT), with
 * a delay between requests to stay polite with the OSM API. Failures are skipped: items simply
 * get no "Changes" paragraph.
 *
 * The fetched versions are persisted between builds (issue #228): only edits newer than the
 * last build require a request. The cache maps "type/id" to the feature at `version` and the
 * previous-version feature that was used for its change summary, so two consecutive builds
 * chain without re-fetching (the feature of the previous build is the new previous version).
 */
type PreviousVersionsCacheEntry = { version: number; feature: OsmFeature; previous?: OsmFeature };
type PreviousVersionsCache = Record<string, PreviousVersionsCacheEntry>;

function loadPreviousVersionsCache(cacheFile: string): PreviousVersionsCache {
  try {
    return JSON.parse(readFileSync(cacheFile, "utf8")) as PreviousVersionsCache;
  } catch {
    return {};
  }
}

function savePreviousVersionsCache(cacheFile: string, cache: PreviousVersionsCache, keepKeys: Set<string>) {
  const pruned = Object.fromEntries(Object.entries(cache).filter(([key]) => keepKeys.has(key)));
  try {
    writeFileSync(cacheFile, JSON.stringify(pruned));
  } catch (error) {
    console.info(`Could not persist the RSS previous-versions cache: ${error}`);
  }
}

async function fetchPreviousVersions(
  features: OsmFeature[],
  cache: PreviousVersionsCache,
): Promise<Map<string, OsmFeature>> {
  const previous = new Map<string, OsmFeature>();
  for (const feature of features.slice(0, RSS_CHANGES_FETCH_LIMIT)) {
    const version = feature.version ?? 1;
    if (version <= 1) continue;
    const key = `${feature.type}/${feature.id}`;
    const entry = cache[key];
    // Cache hit: the entry matches the current version (reused across builds, issue #228),
    // or is exactly one version behind (its feature is the previous version we need)
    if (entry?.previous && entry.version === version) {
      previous.set(key, entry.previous);
      continue;
    }
    if (entry?.version === version - 1) {
      cache[key] = { version, feature, previous: entry.feature };
      previous.set(key, entry.feature);
      continue;
    }
    try {
      const url = `${OSM_BASE_URL}/api/0.6/${feature.type}/${feature.id}/${version - 1}.json`;
      const response = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      const element = ((await response.json()) as { elements: OsmFeature[] }).elements.find(
        (e) => e.type === feature.type && e.id === feature.id,
      );
      if (element) {
        cache[key] = { version, feature, previous: element };
        previous.set(`${feature.type}/${feature.id}`, element);
      }
    } catch (error) {
      console.info(`Skipping change summary for ${feature.type}/${feature.id}: ${error}`);
    }
    await sleep(RSS_CHANGES_FETCH_DELAY_MS);
  }
  return previous;
}

async function writeStaticApiMetadata(worldDirectory: string, cacheFile?: string) {
  const recentFeatures = collectRecentFeatures(worldDirectory).sort(
    (a, b) => Date.parse(b.timestamp!) - Date.parse(a.timestamp!),
  );
  const cache = cacheFile ? loadPreviousVersionsCache(cacheFile) : {};
  const previousVersions = await fetchPreviousVersions(recentFeatures, cache);
  if (cacheFile) {
    const keepKeys = new Set(recentFeatures.map((f) => `${f.type}/${f.id}`));
    savePreviousVersionsCache(cacheFile, cache, keepKeys);
  }
  /** Every node of the world, written once at the root for the app to download */
  const download: DataJSONRecord = {};

  function visit(directory: string, slug: string): GeneratedDirectory {
    const dataPath = join(directory, "data.json");
    const data = existsSync(dataPath) ? (JSON.parse(readFileSync(dataPath, "utf8")) as DataJSON) : undefined;
    const childDirectories = readdirSync(directory, { withFileTypes: true }).filter((entry) => entry.isDirectory());
    const children: DataJSONRecord = {};
    const childResults: { slug: string; directory: string; result: GeneratedDirectory }[] = [];
    let totalRoutes = 0;
    // Raw climbing stats of this subtree, aggregated bottom-up (issue #114): the clients then only
    // convert the few grade buckets to their preferred scale instead of parsing every feature.
    const raw = emptyRawSectorStats();
    if (data && data.type !== "geographic") addRawSectorStats(raw, computeRawSectorStats([data as OsmFeature]));

    for (const entry of childDirectories) {
      const childSlug = slug ? `${slug}/${entry.name}` : entry.name;
      const childDirectory = join(directory, entry.name);
      const result = visit(childDirectory, childSlug);
      childResults.push({ slug: childSlug, directory: childDirectory, result });

      if (!result.data) continue;
      children[childSlug] = result.data;
      download[childSlug] = result.data;
      totalRoutes += isRoute(result.data) ? 1 : result.totalRoutes;
      addRawSectorStats(raw, result.raw);
    }

    // RSS feed of the recently added or edited features in this subtree (see issue #142)
    const recent: RecentItem[] = [];
    if (data && data.type !== "geographic") {
      const feature = data as OsmFeature;
      const item = recentItemXml(feature, slug, Date.now(), previousVersions.get(`${feature.type}/${feature.id}`));
      if (item) recent.push(item);
    }
    for (const { result } of childResults) {
      recent.push(...result.recent);
    }
    recent.sort((a, b) => b.timestamp - a.timestamp);
    if (recent.length > 0) {
      const fallbackTitle = slug.replace(/^world\/?/, "") || "Worldwide climbing";
      const title =
        data?.type === "geographic" ? data.name : ((data as OsmFeature | undefined)?.tags?.name ?? fallbackTitle);
      writeFileSync(join(directory, "feed.xml"), renderRssFeed({ title, slug, items: recent.slice(0, RSS_MAX_ITEMS) }));
    }

    writeFileSync(join(directory, "children.json"), JSON.stringify(children));
    writeFileSync(join(directory, "stats.json"), JSON.stringify({ totalRoutes, raw }));

    return { data, totalRoutes, raw, recent: recent.slice(0, RSS_MAX_ITEMS) };
  }

  visit(worldDirectory, "");
  const downloadJson = JSON.stringify(download);
  writeFileSync(join(worldDirectory, "download.json"), downloadJson);
  // The version is the generation date, so clients can show how old their downloaded data is.
  const generatedAt = new Date();
  const version = Number(
    `${generatedAt.getUTCFullYear()}${String(generatedAt.getUTCMonth() + 1).padStart(2, "0")}${String(generatedAt.getUTCDate()).padStart(2, "0")}`,
  );
  writeFileSync(
    join(worldDirectory, "data-version.json"),
    // bytes is the decompressed size of download.json: when the static host serves it with
    // gzip/brotli, the transfer content-length is smaller and cannot be used as download total.
    JSON.stringify({ version, date: generatedAt.toISOString(), bytes: Buffer.byteLength(downloadJson) }),
  );
}
