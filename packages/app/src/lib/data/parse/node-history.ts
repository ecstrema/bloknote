import { getFeatureHistory } from "osm-api";
import type { OsmFeature } from "osm-api";
import type { NodeHistoryIndex } from "./pulse.js";

/**
 * Client-side session cache of node histories, used to detect way geometry changes that only
 * show up on the member nodes themselves (issue #220): the OSM API has no bulk historical
 * fetch for ways, so each member node history is fetched individually and cached.
 */
const cache = new Map<number, Promise<OsmFeature[]>>();

/** Maximum member nodes resolved for one way: larger ways keep the node-list detection only */
const MAX_NODES = 100;
/** Node histories fetched concurrently, to stay polite with the OSM API */
const BATCH_SIZE = 8;

export async function loadNodeHistories(nodeIds: number[] | undefined): Promise<NodeHistoryIndex> {
  const unique = [...new Set(nodeIds ?? [])];
  const out: NodeHistoryIndex = new Map();
  if (unique.length === 0 || unique.length > MAX_NODES) return out;
  const missing = unique.filter((id) => !cache.has(id));
  for (let i = 0; i < missing.length; i += BATCH_SIZE) {
    const batch = missing.slice(i, i + BATCH_SIZE);
    for (const id of batch) {
      cache.set(id, getFeatureHistory("node", id).catch(() => []));
    }
    await Promise.all(batch.map((id) => cache.get(id)));
  }
  for (const id of unique) out.set(id, (await cache.get(id)) ?? []);
  return out;
}
