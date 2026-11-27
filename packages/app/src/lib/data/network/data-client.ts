import { browser } from "$app/env";
import { apiUrl, type ApiFile } from "./api-url";
import type { DataJSON } from "@bloknote/climbing-data-gen";
import type { AreaStats, DataJSONRecord } from "#lib/types.js";
import { localDb } from "../db/local-db.svelte";
import type { MapElementFeatureCollection, TopLevelPoint } from "../db/types";
import { settings } from "../settings.svelte";
import type { DataTree } from "#lib/types.js";
import type { OsmFeature } from "osm-api";

/**
 * Gets the data from the local SQLite database when it holds the whole dataset, and from the
 * static API otherwise (server side, low data mode, or before the first download is finished).
 *
 * Unless the user asked for low data usage, the whole dataset is downloaded once in the background.
 */
class DataClient {
  private autoDownloadStarted = false;
  #localNodes = new Map<string, DataTree>();

  registerLocalNode(slug: string, node: DataTree) {
    this.#localNodes.set(slug, node);
    // Mirror the element into the local database once it is ready: the ticks list can already
    // place it under its parent, before it is pushed to OSM (issue #154). The wait also starts
    // the dataset download when the database is still empty.
    void this.waitUntilLocalReady(120_000).then((ready) => {
      if (ready) void localDb.upsertElement(slug, node.feature as OsmFeature);
    });
  }

  unregisterLocalNode(slug: string) {
    this.#localNodes.delete(slug);
    void localDb.deleteElement(slug);
  }

  /** Re-mirrors every local node into the database: called after a push assigns real OSM ids */
  syncLocalNodesToDb() {
    for (const [slug, node] of this.#localNodes) {
      void localDb.upsertElement(slug, node.feature as OsmFeature);
    }
  }

  getLocalSlugByOsmId(id: string): string | undefined {
    for (const [slug, node] of this.#localNodes) {
      const feature = node.feature;
      if (feature.type !== "geographic" && `${feature.type}-${feature.id}` === id) return slug;
    }
  }

  /** The locally created element matching an OSM reference like `node-123`, with its slug */
  getLocalNodeByOsmRef(ref: string): { slug: string; feature: OsmFeature } | undefined {
    for (const [slug, node] of this.#localNodes) {
      const feature = node.feature;
      if (feature.type !== "geographic" && `${feature.type}-${feature.id}` === ref) {
        return { slug, feature: feature as OsmFeature };
      }
    }
  }

  /** The locally created element with this slug (e.g. to resolve its name before it reaches the database) */
  getLocalNodeBySlug(slug: string): DataTree | undefined {
    return this.#localNodes.get(slug);
  }

  private async localReady(): Promise<boolean> {
    if (!browser) return false;
    if (localDb.status === "ready") return true;
    if (localDb.status === "error") return false;

    if (localDb.hasMarker) {
      await localDb.init();
      if (localDb.ready) return true;
    }
    this.startAutoDownload();
    return false;
  }

  private startAutoDownload() {
    if (this.autoDownloadStarted || settings.lowData) return;
    this.autoDownloadStarted = true;
    localDb.init().then(() => {
      // Without any persistent storage the download would have to be repeated on every visit, so
      // it is left to the user. But when OPFS works while the persistent database is merely held
      // by another tab, downloading into memory makes this tab fully functional as well.
      if (!settings.lowData && (localDb.persistent || localDb.opfsAvailable)) return localDb.download();
    });
  }

  /**
   * Resolves true once the whole dataset is available locally, waiting for a pending download.
   * Right after a reload the database may still be opening (or an in-memory copy is still
   * re-downloading because another tab holds the OPFS pool), so callers must not treat a
   * not-yet-ready database as a hard failure.
   */
  async waitUntilLocalReady(timeoutMs = 60_000): Promise<boolean> {
    if (await this.localReady()) return true;
    if (settings.lowData || localDb.status === "error") return false;
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (localDb.ready) return true;
      // The cast defeats the narrowing from the check above: the status changes asynchronously
      if ((localDb.status as string) === "error") return false;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    return localDb.ready;
  }

  private async fetchJson<T>(slug: string, file: ApiFile, customFetch: typeof fetch): Promise<T | undefined> {
    if (import.meta.env.SSR) {
      const { readApiJson } = await import("./server-files");
      return readApiJson<T>(slug, file);
    }
    const path = apiUrl(slug, file);
    const res = await customFetch(path);
    if (!res.ok) {
      console.error(`Failed to fetch ${path}`);
      return undefined;
    }
    return res.json();
  }

  async getNode(slug: string, customFetch: typeof fetch = globalThis.fetch): Promise<DataJSON | undefined> {
    const localNode = this.#localNodes.get(slug);
    if (localNode) return localNode.feature as DataJSON;
    if (await this.localReady()) {
      const data = await localDb.getNode(slug);
      if (data) return data;
    }
    return this.fetchJson<DataJSON>(slug, "data.json", customFetch);
  }

  async getChildren(slug: string, customFetch: typeof fetch = globalThis.fetch): Promise<DataJSONRecord | undefined> {
    const localNode = this.#localNodes.get(slug);
    if (localNode) {
      return Object.fromEntries(
        Object.entries(localNode.children ?? {}).map(([childSlug, child]) => [childSlug, child.feature as DataJSON]),
      );
    }
    if (await this.localReady()) return localDb.getChildren(slug);
    return this.fetchJson<DataJSONRecord>(slug, "children.json", customFetch);
  }

  /** Only available once the whole dataset is downloaded */
  async getTopLevelPoints(): Promise<TopLevelPoint[]> {
    return (await this.localReady()) ? localDb.getTopLevelPoints() : [];
  }

  async getAllMapElements(): Promise<MapElementFeatureCollection | undefined> {
    return (await this.localReady()) ? localDb.getAllMapElements() : undefined;
  }

  async getStats(slug: string, customFetch: typeof fetch = globalThis.fetch): Promise<AreaStats | undefined> {
    if (this.#localNodes.has(slug)) return undefined;
    if (await this.localReady()) return localDb.getStats(slug);
    return this.fetchJson<AreaStats>(slug, "stats.json", customFetch);
  }
}

export const dataClient = new DataClient();
