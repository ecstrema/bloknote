import { resolve as resolvePath } from "$app/paths";
import type { GeographicFolderElement } from "@bloknote/climbing-data-gen";
import type { IndexNode } from "@bloknote/reverse-geocoding-data";
import type { AppState } from "./app-state.js";
import { featureToType } from "./parse/data.js";
import { getLocalizedName } from "./parse/localized-name.js";
import type { DataTree } from "#lib/types.js";

export interface ParentOption {
  slug: string;
  label: string;
  depth: number;
}

let hierarchyIndexPromise: Promise<IndexNode | undefined> | undefined;

export function loadHierarchyIndex(): Promise<IndexNode | undefined> {
  hierarchyIndexPromise ??= fetch(`${resolvePath("/").replace(/\/$/, "")}/api/hierarchy-index.json`)
    .then((res) => (res.ok ? (res.json() as Promise<IndexNode>) : undefined))
    .catch(() => undefined);
  return hierarchyIndexPromise;
}

function bboxContains(bbox: IndexNode["_bbox"] | undefined, lon: number, lat: number): boolean {
  if (!bbox) return true;
  return lon >= bbox.x0 && lon <= bbox.x1 && lat >= bbox.y0 && lat <= bbox.y1;
}

function bboxArea(bbox: IndexNode["_bbox"] | undefined): number {
  if (!bbox) return Infinity;
  return Math.max(0, bbox.x1 - bbox.x0) * Math.max(0, bbox.y1 - bbox.y0);
}

function getIndexNode(indexRoot: IndexNode, regionSlug: string): IndexNode | undefined {
  let current: IndexNode | undefined = (indexRoot.world as IndexNode | undefined) ?? indexRoot;
  if (!regionSlug) return current;
  for (const segment of regionSlug.split("/")) {
    if (!current || !(segment in current)) return undefined;
    current = current[segment] as IndexNode;
  }
  return current;
}

/**
 * Returns all leaf region slugs in `hierarchy-index.json` whose bounding box contains `(lon, lat)`.
 */
export function findCandidateRegionSlugs(indexRoot: IndexNode, lon: number, lat: number): string[] {
  const world = (indexRoot.world as IndexNode | undefined) ?? indexRoot;
  const matches: string[] = [];

  const visit = (node: IndexNode, path: string[]) => {
    if (!bboxContains(node._bbox, lon, lat)) return;
    const childKeys = Object.keys(node).filter((k) => k !== "_bbox");
    if (childKeys.length === 0) {
      if (path.length > 0) matches.push(path.join("/"));
      return;
    }
    for (const key of childKeys) {
      visit(node[key] as IndexNode, [...path, key]);
    }
  };

  visit(world, []);
  return matches;
}

/**
 * Picks the best matching region slug for a point. Prefers `preferredSlug`'s region when matched,
 * otherwise picks the leaf region with the smallest bounding box area.
 */
export function pickBestRegionSlug(
  candidates: string[],
  indexRoot: IndexNode,
  preferredSlug?: string,
): string | undefined {
  if (candidates.length === 0) return undefined;
  if (preferredSlug) {
    const preferred = candidates.find((c) => preferredSlug === c || preferredSlug.startsWith(`${c}/`));
    if (preferred) return preferred;
  }
  return [...candidates].sort((a, b) => bboxArea(getIndexNode(indexRoot, a)?._bbox) - bboxArea(getIndexNode(indexRoot, b)?._bbox))[0];
}

/**
 * Ensures `regionSlug` and all its geographic ancestor nodes exist in `appState.tree`,
 * synthesizing missing geographic folders from `hierarchy-index.json` when a region had no prior climbs.
 */
export async function ensureRegionLoaded(
  appState: AppState,
  regionSlug: string,
  indexRoot: IndexNode,
): Promise<DataTree | undefined> {
  const segments = regionSlug ? regionSlug.split("/") : [];
  let currentSlug = "";
  await appState.fetchChildren("");

  for (const segment of segments) {
    const parentSlug = currentSlug;
    const parent = appState.tree.getReactiveNode(parentSlug);
    if (!parent) return undefined;

    currentSlug = parentSlug ? `${parentSlug}/${segment}` : segment;
    if (!appState.tree.getReactiveNode(currentSlug)) {
      const indexNode = getIndexNode(indexRoot, currentSlug);
      const feature: GeographicFolderElement = {
        type: "geographic",
        name: segment,
        bbox: indexNode?._bbox,
      };
      appState.tree.integrateNodeIntoTree({ feature, children: {}, childrenFetched: true }, currentSlug, parentSlug);
    }
    await appState.fetchChildren(currentSlug);
  }

  return appState.tree.getReactiveNode(regionSlug);
}

/**
 * Loads and collects the region itself plus all descendant `area` nodes (children, grandchildren, etc.)
 * as parent options for placing a new route or sector.
 */
export async function collectRegionParentOptions(appState: AppState, regionSlug: string): Promise<ParentOption[]> {
  const regionNode = appState.tree.getReactiveNode(regionSlug);
  if (!regionNode) return [];

  const options: ParentOption[] = [
    { slug: regionSlug, label: `${getLocalizedName(regionNode.feature) || regionSlug} (region)`, depth: 0 },
  ];
  const visited = new Set<string>([regionSlug]);

  const walk = async (node: DataTree, slug: string, depth: number) => {
    if (!node.childrenFetched) {
      await appState.fetchChildren(slug);
    }
    const entries = Object.entries(node.children ?? {}).sort(([, a], [, b]) =>
      (getLocalizedName(a.feature) || "").localeCompare(getLocalizedName(b.feature) || ""),
    );
    for (const [childSlug, child] of entries) {
      if (visited.has(childSlug)) continue;
      if (featureToType(child.feature) !== "area") continue;
      visited.add(childSlug);
      options.push({
        slug: childSlug,
        label: getLocalizedName(child.feature) || "Unnamed sector",
        depth,
      });
      await walk(child, childSlug, depth + 1);
    }
  };

  await walk(regionNode, regionSlug, 1);
  return options;
}