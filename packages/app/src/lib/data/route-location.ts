import type { Coordinates } from "@bloknote/climbing-data-gen";
import type { DataTree } from "#lib/types.js";
import { getCoordinates } from "@bloknote/osm-climbing";
import { getParentSlug } from "#lib/helpers/slug.js";

/** Temporary in-memory coordinates for newly created empty sectors placed from the map */
const fallbackCoordinates = new Map<string, Coordinates>();

export function setFallbackCoordinates(slug: string, coords: Coordinates) {
  fallbackCoordinates.set(slug, coords);
}

export function getFallbackCoordinates(slug: string): Coordinates | undefined {
  return fallbackCoordinates.get(slug);
}

/** ~2 meters in degrees longitude at the equator, used to place a new route right next to a node */
export const NEXT_TO_NODE_OFFSET = 0.00002;

export function getTreeCenter(item: DataTree): Coordinates | undefined {
  if (item.feature.type === "geographic") {
    const bbox = item.feature.bbox;
    if (bbox) {
      return { lat: (bbox.y0 + bbox.y1) / 2, lon: (bbox.x0 + bbox.x1) / 2 };
    }
    return getChildrenCenter(item);
  }

  const own = getCoordinates(item.feature);
  if (own) return own;

  return getChildrenCenter(item);
}

function getChildrenCenter(item: DataTree): Coordinates | undefined {
  let latSum = 0;
  let lonSum = 0;
  let count = 0;

  const visit = (node: DataTree) => {
    for (const child of Object.values(node.children ?? {})) {
      if (child.feature.type !== "geographic") {
        const coords = getCoordinates(child.feature);
        if (coords) {
          latSum += coords.lat;
          lonSum += coords.lon;
          count++;
        }
      }
      visit(child);
    }
  };

  visit(item);
  if (count === 0) return undefined;
  return { lat: latSum / count, lon: lonSum / count };
}

export function placeNextToNode(coords: Coordinates): Coordinates {
  const lon =
    coords.lon + NEXT_TO_NODE_OFFSET <= 180 ? coords.lon + NEXT_TO_NODE_OFFSET : coords.lon - NEXT_TO_NODE_OFFSET;
  return { lat: coords.lat, lon };
}

export function getDefaultRouteCoordinates(options: {
  mapCenter?: Coordinates;
  currentPage?: { item: DataTree; slug: string };
  fallbackParent?: { item: DataTree; slug: string };
  getNode: (slug: string) => DataTree | undefined;
}): Coordinates {
  if (options.mapCenter) return options.mapCenter;

  const resolveFromNode = (entry: { item: DataTree; slug: string }): Coordinates | undefined => {
    if (entry.item.feature.type === "node") {
      return placeNextToNode({ lat: entry.item.feature.lat, lon: entry.item.feature.lon });
    }
    const center = getTreeCenter(entry.item);
    if (center) return center;

    let parentSlug = getParentSlug(entry.slug);
    while (parentSlug !== undefined) {
      const parent = options.getNode(parentSlug);
      if (parent) {
        const parentCenter = getTreeCenter(parent);
        if (parentCenter) return parentCenter;
      }
      parentSlug = getParentSlug(parentSlug);
    }
    return undefined;
  };

  if (options.currentPage) {
    const coords = resolveFromNode(options.currentPage);
    if (coords) return coords;
  }

  if (options.fallbackParent) {
    const coords = resolveFromNode(options.fallbackParent);
    if (coords) return coords;
  }

  return { lat: 0, lon: 0 };
}
