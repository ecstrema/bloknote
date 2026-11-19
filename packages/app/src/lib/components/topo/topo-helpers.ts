import type { AppDataTree } from "#lib/data/app-data-tree.svelte.js";
import { featureToType } from "#lib/data/parse/data.js";
import { getGrade } from "#lib/data/parse/osm-tags.js";
import type { DataTree, Grade } from "#lib/types.js";
import type { Key, OsmFeature, Tags } from "osm-api";

export type CommonsImage = {
  key: string;
  pathKey: string;
  title: string;
  normalizedTitle: string;
};

export type RoutePoint = {
  x: number;
  y: number;
  marker: string;
  dottedAfter: boolean;
};

export type ResolvedImage = {
  src: string;
  page: string;
};

export type TreeRouteInfo = {
  slug: string;
  name: string;
  grade?: Grade;
  feature: OsmFeature;
};

export type RouteOverlayPath = {
  slug: string;
  label: string;
  points: RoutePoint[];
  active: boolean;
  selectedPoint?: number;
};

export function normalizeCommonsTitle(value: string): string {
  return value
    .trim()
    .replace(/^https?:\/\/commons\.wikimedia\.org\/wiki\//i, "")
    .replaceAll("_", " ");
}

export function commonsImageKey(value: string): string {
  return normalizeCommonsTitle(value).toLowerCase();
}

export function getImagesFromTags(tags: Tags | undefined): CommonsImage[] {
  if (!tags) return [];
  return Object.entries(tags)
    .filter(([key, value]) => /^wikimedia_commons(?::\d+)?$/.test(key) && value)
    .map(([key, title]) => ({
      key,
      pathKey: `${key}:path`,
      title: title!,
      normalizedTitle: normalizeCommonsTitle(title!),
    }))
    .sort((a, b) => a.key.localeCompare(b.key, undefined, { numeric: true }));
}

export function findMatchingImageTag(tags: Tags | undefined, title: string): CommonsImage | undefined {
  const target = commonsImageKey(title);
  return getImagesFromTags(tags).find((img) => commonsImageKey(img.title) === target);
}

export function findNextImageTagKey(tags: Tags | undefined): Key {
  const t = tags ?? {};
  if (!t.wikimedia_commons) return "wikimedia_commons";
  let suffix = 1;
  while (t[`wikimedia_commons:${suffix}`]) suffix++;
  return `wikimedia_commons:${suffix}` as Key;
}

export function parsePath(value: string | undefined): RoutePoint[] {
  if (!value) return [];
  const points: RoutePoint[] = [];
  for (const segment of value.split("|")) {
    const match = /^(\d*\.?\d+),(\d*\.?\d+)([BAPSU]?)(:?)$/.exec(segment);
    if (!match) return [];
    const x = Number(match[1]);
    const y = Number(match[2]);
    if (x < 0 || x > 1 || y < 0 || y > 1) return [];
    points.push({ x, y, marker: match[3]!, dottedAfter: match[4] === ":" });
  }
  return points;
}

export function formatPath(points: RoutePoint[]): string {
  return points
    .map(({ x, y, marker, dottedAfter }) => `${x.toFixed(3)},${y.toFixed(3)}${marker}${dottedAfter ? ":" : ""}`)
    .join("|");
}

function collectRoutesUnder(node: DataTree | undefined, out: TreeRouteInfo[], visited = new Set<DataTree>()) {
  if (!node || visited.has(node)) return;
  visited.add(node);
  for (const [childSlug, child] of Object.entries(node.children ?? {})) {
    if (child.feature.type === "geographic") continue;
    const type = featureToType(child.feature);
    if (type === "route") {
      const f = child.feature as OsmFeature;
      out.push({
        slug: childSlug,
        name: f.tags?.name || "Unnamed route",
        grade: f.tags ? getGrade(f.tags)?.v : undefined,
        feature: f,
      });
    } else if (type === "area") {
      collectRoutesUnder(child, out, visited);
    }
  }
}

/** Collects routes from the tree related to `featureSlug` (descendant routes for an area, or self + siblings for a route). */
export function getRelatedTreeRoutes(tree: AppDataTree, featureSlug: string): TreeRouteInfo[] {
  const current = tree.getReactiveNode(featureSlug);
  if (!current || current.feature.type === "geographic") return [];

  const currentType = featureToType(current.feature);
  const routes: TreeRouteInfo[] = [];

  if (currentType === "route") {
    const f = current.feature as OsmFeature;
    routes.push({
      slug: featureSlug,
      name: f.tags?.name || "Unnamed route",
      grade: f.tags ? getGrade(f.tags)?.v : undefined,
      feature: f,
    });
    const parent = tree.getParentReactiveNode(featureSlug);
    if (parent) {
      const siblings: TreeRouteInfo[] = [];
      collectRoutesUnder(parent, siblings);
      for (const s of siblings) {
        if (s.slug !== featureSlug) routes.push(s);
      }
    }
  } else {
    collectRoutesUnder(current, routes);
  }

  return routes;
}

/** Collects distinct images from parent / siblings / children that can be reused on the current feature. */
export function getReusableTreeImages(
  tree: AppDataTree,
  featureSlug: string,
  ownImages: CommonsImage[],
): CommonsImage[] {
  const ownKeys = new Set(ownImages.map((img) => commonsImageKey(img.title)));
  const seen = new Set<string>();
  const result: CommonsImage[] = [];

  const addFromFeature = (f: OsmFeature | undefined) => {
    if (!f?.tags) return;
    for (const img of getImagesFromTags(f.tags)) {
      const k = commonsImageKey(img.title);
      if (ownKeys.has(k) || seen.has(k)) continue;
      seen.add(k);
      result.push(img);
    }
  };

  const parent = tree.getParentReactiveNode(featureSlug);
  if (parent && parent.feature.type !== "geographic") {
    addFromFeature(parent.feature);
    for (const child of Object.values(parent.children ?? {})) {
      if (child.feature.type !== "geographic") addFromFeature(child.feature);
    }
  }
  const current = tree.getReactiveNode(featureSlug);
  for (const child of Object.values(current?.children ?? {})) {
    if (child.feature.type !== "geographic") addFromFeature(child.feature);
  }

  return result;
}

/** Resolves direct image URL + page URL for a Wikimedia Commons title (non-category) or uses cached category resolution. */
export function directCommonsImage(
  image: CommonsImage,
  resolvedCategories: Record<string, ResolvedImage | undefined>,
): ResolvedImage | undefined {
  if (/^category:/i.test(image.normalizedTitle)) return resolvedCategories[image.key];
  const file = image.normalizedTitle.replace(/^(file|image):/i, "");
  const page = `https://commons.wikimedia.org/wiki/${encodeURIComponent(image.normalizedTitle.replaceAll(" ", "_"))}`;
  return {
    src: `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(file)}?width=1600`,
    page,
  };
}

export async function resolveCommonsCategoryImage(title: string): Promise<ResolvedImage | undefined> {
  const normalized = normalizeCommonsTitle(title);
  if (!/^category:/i.test(normalized)) return undefined;
  const page = `https://commons.wikimedia.org/wiki/${encodeURIComponent(normalized.replaceAll(" ", "_"))}`;
  const params = new URLSearchParams({
    action: "query",
    generator: "categorymembers",
    gcmtitle: normalized,
    gcmtype: "file",
    gcmlimit: "1",
    prop: "imageinfo",
    iiprop: "url",
    iiurlwidth: "1600",
    format: "json",
    origin: "*",
  });
  const response = await fetch(`https://commons.wikimedia.org/w/api.php?${params}`);
  if (!response.ok) return undefined;
  const data = await response.json();
  const pages = Object.values(data.query?.pages ?? []) as {
    imageinfo?: { thumburl?: string; url?: string }[];
  }[];
  const imageInfo = pages[0]?.imageinfo?.[0];
  const src = imageInfo?.thumburl ?? imageInfo?.url;
  return src ? { src, page } : undefined;
}
