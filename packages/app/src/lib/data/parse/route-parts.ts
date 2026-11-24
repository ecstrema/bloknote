import type { DataJSON } from "@bloknote/climbing-data-gen";
import type { OsmFeature, Tags } from "osm-api";

/** Values of the `climbing` tag, which can hold several `;`-separated values */
function climbingValues(tags: Tags | undefined): string[] {
  const value = tags?.climbing;
  if (!value) return [];
  return value.split(";").map((v) => v.trim());
}

export function isRouteBottom(feature: DataJSON): boolean {
  return feature.type !== "geographic" && climbingValues(feature.tags).includes("route_bottom");
}

export function isRouteTop(feature: DataJSON): boolean {
  return feature.type !== "geographic" && climbingValues(feature.tags).includes("route_top");
}

function routePartNameKey(feature: DataJSON): string | undefined {
  if (feature.type === "geographic") return undefined;
  const name = feature.tags?.name?.trim().toLowerCase();
  return name ? name : undefined;
}

export interface RoutePartPair {
  bottomSlug: string;
  topSlug: string;
}

/**
 * Pairs `climbing=route_bottom` and `climbing=route_top` siblings that share the same name, so the
 * two points of a single route can be handled together (see issue #135). Unnamed parts are ignored.
 */
export function findRoutePartPairs<T extends DataJSON>(children: Record<string, T>): RoutePartPair[] {
  const bottoms = new Map<string, string>();
  const tops = new Map<string, string>();
  for (const [slug, feature] of Object.entries(children)) {
    const key = routePartNameKey(feature);
    if (!key) continue;
    if (isRouteBottom(feature) && !bottoms.has(key)) bottoms.set(key, slug);
    if (isRouteTop(feature) && !tops.has(key)) tops.set(key, slug);
  }

  const pairs: RoutePartPair[] = [];
  for (const [key, bottomSlug] of bottoms) {
    const topSlug = tops.get(key);
    if (topSlug && topSlug !== bottomSlug) pairs.push({ bottomSlug, topSlug });
  }
  return pairs;
}

/** Companion lookup covering both directions: bottom -> top and top -> bottom */
export function routeCompanionsBySlug(pairs: RoutePartPair[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const { bottomSlug, topSlug } of pairs) {
    map.set(bottomSlug, topSlug);
    map.set(topSlug, bottomSlug);
  }
  return map;
}

/** Names of the routes that have both a bottom and a top point referenced in the same parent */
export function findDuplicatedRoutePartNames(features: OsmFeature[]): string[] {
  const children = Object.fromEntries(features.map((feature, index) => [String(index), feature]));
  const pairs = findRoutePartPairs(children);
  const names = new Set<string>();
  for (const { bottomSlug } of pairs) {
    const feature = features[Number(bottomSlug)]!;
    names.add(feature.tags?.name?.trim() || "Unnamed");
  }
  return [...names];
}
