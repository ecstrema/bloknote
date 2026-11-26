import type { RegionCliffs } from "@bloknote/climbing-data-gen";
import { getFeature, type OsmNode } from "osm-api";
import type { OsmUser } from "./network/osm.svelte.js";
import { apiUrl } from "./network/api-url.js";
import { getParentSlugs } from "#lib/helpers/slug.js";
import { SvelteMap } from "svelte/reactivity";

/**
 * Cliffs of the mapped regions (issue #55). They are generated on the build and downloaded on
 * demand by the map at high zoom. They never reach the data tree or the sidebar: they only live
 * on the map, as a background the user can edit.
 */
export type CliffPoint = RegionCliffs["cliffs"][number];

const cache = new Map<string, Promise<RegionCliffs | undefined>>();

/** Fetches the cliffs.json of one region from the static API, memoized (a 404 resolves to undefined) */
function fetchRegionCliffs(region: string): Promise<RegionCliffs | undefined> {
  let pending = cache.get(region);
  if (!pending) {
    pending = fetch(apiUrl(region, "cliffs.json"))
      .then((res) => (res.ok ? res.json() : undefined))
      .catch(() => undefined);
    cache.set(region, pending);
  }
  return pending;
}

/**
 * Fetches the cliffs of the region containing `slug`. The cliffs file only exists at the region
 * directories holding climbing data, so the geographic ancestors are tried deepest first.
 */
export async function getRegionCliffs(slug: string): Promise<RegionCliffs | undefined> {
  for (const region of getParentSlugs(slug).reverse()) {
    const cliffs = await fetchRegionCliffs(region);
    if (cliffs) return cliffs;
  }
  return undefined;
}

/** Cliff nodes created on the map but not uploaded to OSM yet, by cliff slug (`cliff/n<temp id>`) */
export const createdCliffs = new SvelteMap<string, OsmNode>();

/** Cliff nodes dragged to a new position, pending upload with the next changeset, by cliff slug */
export const movedCliffs = new SvelteMap<string, { initial: OsmNode; final: OsmNode }>();

/**
 * Records a move of a cliff node as a pending OSM edit. The current node is fetched from the OSM
 * API (the static cliffs files carry no version), then marked dirty under a `cliff/` slug: the
 * pending edit then flows through the regular changeset submission.
 */
export async function moveCliffNode(
  osmUser: OsmUser,
  /** OSM reference of the cliff, like `n123` */
  ref: string,
  position: { lat: number; lon: number },
): Promise<void> {
  if (!ref.startsWith("n")) return;
  const slug = `cliff/${ref}`;
  const pending = movedCliffs.get(slug);
  if (pending) {
    const final = { ...pending.final, lat: position.lat, lon: position.lon };
    movedCliffs.set(slug, { ...pending, final });
    osmUser.markAsDirty(pending.initial, slug, final);
    return;
  }
  let initial: OsmNode;
  try {
    [initial] = await getFeature("node", Number(ref.slice(1)));
  } catch (e) {
    console.warn(`Could not fetch cliff ${ref} from OSM:`, e);
    return;
  }
  if (!initial) return;
  const final = { ...initial, lat: position.lat, lon: position.lon };
  movedCliffs.set(slug, { initial, final });
  osmUser.markAsDirty(initial, slug, final);
}

/** Current position of a cliff point, taking the pending moves into account */
export function cliffPosition(point: CliffPoint): { lon: number; lat: number } {
  const pending = movedCliffs.get(`cliff/${point.id}`);
  if (pending) return { lon: pending.final.lon, lat: pending.final.lat };
  return { lon: point.lon, lat: point.lat };
}

/** True when the cliff node has pending local edits or was created locally */
export function cliffIsPending(ref: string): boolean {
  return createdCliffs.has(`cliff/${ref}`) || movedCliffs.has(`cliff/${ref}`);
}

/** Clears the module caches and pending edits (tests only) */
export function resetCliffsForTests() {
  cache.clear();
  createdCliffs.clear();
  movedCliffs.clear();
}
