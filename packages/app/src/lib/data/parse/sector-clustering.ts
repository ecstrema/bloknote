import type { Coordinates } from "@bloknote/climbing-data-gen";
import type { DataTree } from "#lib/types.js";
import { featureToType, getName } from "./data.js";
import { getCoordinates } from "@bloknote/osm-climbing";
import { formatDistance, haversineMeters } from "./pulse.js";

/**
 * Route clustering for automatic sector suggestions (issue #157): routes of an area that are not
 * organized into a sector yet are grouped by proximity, and the user confirms the proposed sectors.
 */

/** A route of the parent that is not within a sector yet, with its position */
export interface OrphanRoute {
  slug: string;
  name: string | undefined;
  coordinates: Coordinates;
}

/** A proposed sector: routes whose coordinates are close to each other */
export interface RouteCluster {
  slugs: string[];
  names: string[];
  center: Coordinates;
  /** Greatest distance from a member to the center, in meters */
  radiusMeters: number;
}

/** Direct route children of the parent: the routes not within a sector yet (issue #157) */
export function collectOrphanRoutes(parent: DataTree): { routes: OrphanRoute[]; unplaced: number } {
  const routes: OrphanRoute[] = [];
  let unplaced = 0;
  for (const [slug, child] of Object.entries(parent.children ?? {})) {
    const feature = child.feature;
    if (feature.type === "geographic" || featureToType(feature) !== "route") continue;
    const coordinates = getCoordinates(feature);
    if (coordinates) routes.push({ slug, name: getName(feature), coordinates });
    else unplaced++;
  }
  return { routes, unplaced };
}

/**
 * Groups routes whose coordinates are within `thresholdMeters` of each other (single-linkage:
 * chains of nearby routes end up in the same cluster). Clusters are sorted biggest first, so the
 * first one is the primary automatic selection.
 */
export function clusterRoutes(routes: OrphanRoute[], thresholdMeters: number): RouteCluster[] {
  const roots = routes.map((_, index) => index);
  const root = (index: number): number => (roots[index] === index ? index : (roots[index] = root(roots[index]!)));
  for (let i = 0; i < routes.length; i++) {
    for (let j = i + 1; j < routes.length; j++) {
      if (haversineMeters(routes[i]!.coordinates, routes[j]!.coordinates) <= thresholdMeters) {
        roots[root(j)] = root(i);
      }
    }
  }

  const members = new Map<number, OrphanRoute[]>();
  routes.forEach((route, index) => {
    const rootIndex = root(index);
    const group = members.get(rootIndex);
    if (group) group.push(route);
    else members.set(rootIndex, [route]);
  });

  const clusters = [...members.values()].map((group) => {
    const center = {
      lat: group.reduce((sum, r) => sum + r.coordinates.lat, 0) / group.length,
      lon: group.reduce((sum, r) => sum + r.coordinates.lon, 0) / group.length,
    };
    return {
      slugs: group.map((r) => r.slug),
      names: group.map((r) => r.name).filter((name): name is string => !!name),
      center,
      radiusMeters: Math.max(...group.map((r) => haversineMeters(center, r.coordinates))),
    };
  });
  return clusters.sort((a, b) => b.slugs.length - a.slugs.length || a.center.lat - b.center.lat);
}

/** "5 routes · 40 m" summary of a proposed cluster */
export function describeClusterSize(cluster: RouteCluster): string {
  const routes = `${cluster.slugs.length} route${cluster.slugs.length === 1 ? "" : "s"}`;
  return cluster.slugs.length > 1 ? `${routes} · ${formatDistance(cluster.radiusMeters)}` : routes;
}
