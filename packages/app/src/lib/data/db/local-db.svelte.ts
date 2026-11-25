import { browser, version } from "$app/env";
import { apiUrl } from "../network/api-url";
import type { DataJSON } from "@bloknote/climbing-data-gen";
import type { OsmFeature } from "osm-api";
import type { AreaStats } from "#lib/types.js";
import type { DbRequest, DbResponse, MapElementFeatureCollection, NearbyCandidate, OsmRefEntry, SearchFilters, TickRouteMatch, TopLevelPoint } from "./types";

export type LocalDbStatus = "unknown" | "empty" | "downloading" | "ready" | "error";

/** Days after which the user is explicitly prompted to refresh an ageing dataset */
export const DATA_STALE_AFTER_DAYS = 7;

type DistributiveOmit<T, K extends keyof any> = T extends unknown ? Omit<T, K> : never;

export interface FilterSearch {
  next(): Promise<boolean>;
  cancel(): void;
}

/** Marks that this browser has a local database and records its dataset version. */
const MARKER_KEY = "bloknote:db-version";

/** The whole dataset in SQLite (FTS5) in a worker, in the browser's private file storage when available. */
class LocalDb {
  status = $state<LocalDbStatus>("unknown");
  /** False when the database lives in memory only, and would be lost on reload */
  persistent = $state(true);
  /** Whether the browser could actually use OPFS, even though another tab may hold the database */
  opfsAvailable = $state(false);
  /** True when a visited page showed that OSM has newer data than the downloaded dataset */
  upstreamChanged = $state(false);
  /** Bytes downloaded so far, and the total when the server tells it */
  loaded = $state(0);
  total = $state<number>();
  /** Whether loaded/total currently refers to the download or to the parsing/insertion */
  phase = $state<"download" | "parsing">("download");

  private worker?: Worker;
  private nextId = 0;
  private pending = new Map<number, { resolve: (r: DbResponse) => void; reject: (e: Error) => void }>();
  private initPromise?: Promise<void>;
  private searches = new Map<number, (slugs: string[]) => void>();

  get ready(): boolean {
    return this.status === "ready";
  }

  private send<T extends DbResponse["type"]>(
    req: DistributiveOmit<DbRequest, "id">,
    _expected?: T,
  ): Promise<Extract<DbResponse, { type: T }>> {
    this.worker ??= this.createWorker();
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (r: DbResponse) => void, reject });
      // Requests can carry reactive proxies straight from the app tree (e.g. upsertElement
      // mirroring a locally created route): proxies cannot be structured-cloned into the
      // worker, so they are deep-unwrapped here first, otherwise postMessage throws
      // "Proxy object could not be cloned" and the element never reaches the database
      this.worker!.postMessage($state.snapshot({ ...req, id }));
    });
  }

  private createWorker() {
    const worker = new Worker(new URL("./db.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (event: MessageEvent<DbResponse>) => {
      if (event.data.type === "progress") {
        this.loaded = event.data.loaded;
        this.total = event.data.total;
        this.phase = event.data.phase ?? "download";
        return;
      }
      if (event.data.type === "matchBatch") {
        this.searches.get(event.data.searchId)?.(event.data.slugs);
        return;
      }
      const entry = this.pending.get(event.data.id);
      if (!entry) return;
      this.pending.delete(event.data.id);
      if (event.data.type === "error") entry.reject(new Error(event.data.message));
      else entry.resolve(event.data);
    };
    return worker;
  }

  /** True when a previous visit stored a local database version marker */
  get hasMarker(): boolean {
    return browser && localStorage.getItem(MARKER_KEY) !== null;
  }

  get dataVersion(): string | undefined {
    return browser ? (localStorage.getItem(MARKER_KEY) ?? undefined) : undefined;
  }

  /** Days since the downloaded dataset version, when the version marker encodes a date (YYYYMMDD) */
  get dataAgeDays(): number | undefined {
    const version = this.dataVersion;
    if (!version || !/^\d{8}$/.test(version)) return undefined;
    const date = new Date(
      Date.UTC(Number(version.slice(0, 4)), Number(version.slice(4, 6)) - 1, Number(version.slice(6, 8))),
    );
    return Math.floor((Date.now() - date.getTime()) / 86_400_000);
  }

  /** Called when a visited page turned out to have newer data upstream than the local dataset */
  markUpstreamChanged(): void {
    this.upstreamChanged = true;
  }

  /** Opens the database and checks whether it holds the current data. Safe to call repeatedly. */
  init(): Promise<void> {
    if (!browser) return Promise.resolve();
    this.initPromise ??= this.send({ type: "status", version: this.dataVersion ?? version }, "status")
      .then((res) => {
        this.persistent = res.persistent;
        this.opfsAvailable = res.opfsUsable;
        this.status = res.ready ? "ready" : "empty";
        if (!res.ready) localStorage.removeItem(MARKER_KEY);
      })
      .catch((err) => {
        console.error("Local database unavailable:", err);
        this.status = "error";
      });
    return this.initPromise;
  }

  /** Downloads the whole dataset once and stores it. */
  async download(): Promise<void> {
    await this.init();
    if (this.status === "downloading" || this.status === "ready" || this.status === "error") return;
    this.status = "downloading";
    this.loaded = 0;
    this.total = undefined;
    // Record the published dataset version rather than the app version, so the marker
    // stays comparable with the version passed to refresh() later on.
    let version = this.dataVersion;
    let bytes: number | undefined;
    try {
      const res = await fetch(apiUrl("", "data-version.json"), { cache: "no-store" });
      if (res.ok) {
        const data = (await res.json()) as { version: number; bytes?: number };
        version = String(data.version);
        bytes = data.bytes;
      }
    } catch {
      // Keep the previous marker when the published version cannot be fetched
    }
    try {
      await this.send({ type: "build", version: version ?? "unknown", url: apiUrl("", "download.json"), bytes }, "status");
      localStorage.setItem(MARKER_KEY, version ?? "unknown");
      this.status = "ready";
    } catch (err) {
      console.error("Failed to build the local database:", err);
      this.status = "error";
    }
  }

  /** Rebuilds the local database only when the published dataset has changed. */
  async refresh(dataVersion: string, bytes?: number): Promise<void> {
    await this.init();
    if (this.status !== "ready") return;

    const current = await this.send({ type: "status", version: dataVersion }, "status");
    if (current.ready) {
      localStorage.setItem(MARKER_KEY, dataVersion);
      return;
    }

    this.status = "downloading";
    this.loaded = 0;
    this.total = undefined;
    try {
      await this.send({ type: "build", version: dataVersion, url: apiUrl("", "download.json"), bytes }, "status");
      localStorage.setItem(MARKER_KEY, dataVersion);
      this.upstreamChanged = false;
      this.status = "ready";
    } catch (err) {
      console.error("Failed to refresh the local database:", err);
      this.status = "ready";
    }
  }

  async getNode(slug: string): Promise<DataJSON | undefined> {
    return (await this.send({ type: "getNode", slug }, "node")).data;
  }

  async getChildren(slug: string): Promise<Record<string, DataJSON>> {
    return (await this.send({ type: "getChildren", slug }, "children")).data;
  }

  async getSubtreeElements(
    slug: string,
    limit?: number,
  ): Promise<{ data: Record<string, DataJSON>; truncated: boolean }> {
    const res = await this.send({ type: "getSubtreeElements", slug, limit }, "subtreeElements");
    return { data: res.data, truncated: res.truncated };
  }

  /** Fetches the raw elements for the given slugs, used by the search results overview (issue #166) */
  async getElements(slugs: string[]): Promise<Record<string, DataJSON>> {
    if (slugs.length === 0) return {};
    await this.init();
    if (!this.ready) return {};
    return (await this.send({ type: "getElements", slugs }, "elements")).data;
  }

  async getTopLevelPoints(): Promise<TopLevelPoint[]> {
    return (await this.send({ type: "getTopLevel" }, "topLevel")).data;
  }

  async getAllMapElements(): Promise<MapElementFeatureCollection> {
    return (await this.send({ type: "getAllMapElements" }, "allMapElements")).data;
  }

  async getStats(slug: string): Promise<AreaStats | undefined> {
    return (await this.send({ type: "getStats", slug }, "stats")).data;
  }

  /** Looks elements up by OSM references like `way-123456`. Returns an entry only for the refs found. */
  async getByOsmRefs(refs: string[]): Promise<Record<string, OsmRefEntry>> {
    if (refs.length === 0) return {};
    await this.init();
    if (!this.ready) return {};
    return (await this.send({ type: "getOsmRefs", refs }, "osmRefs")).data;
  }

  /** Named elements within `radiusMeters` of a coordinate, to find replacements for deleted OSM elements */
  async getNearbyElements(lat: number, lon: number, radiusMeters: number): Promise<NearbyCandidate[]> {
    await this.init();
    if (!this.ready) return [];
    return (await this.send({ type: "getNearbyElements", lat, lon, radiusMeters }, "nearbyElements")).data;
  }

  /** Route candidates matching each queried name inside its area, for the tick import (issue #154) */
  async matchTicks(queries: { name: string; area?: string | string[] }[]): Promise<TickRouteMatch[][]> {
    await this.init();
    if (!this.ready || queries.length === 0) return [];
    return (await this.send({ type: "matchTicks", queries }, "tickMatches")).data;
  }

  /** Area candidates matching each queried name, to pick a parent when adding a route to OSM */
  async matchAreas(queries: string[]): Promise<{ slug: string; data: DataJSON }[][]> {
    await this.init();
    if (!this.ready || queries.length === 0) return [];
    return (await this.send({ type: "matchAreas", queries }, "areaMatches")).data;
  }

  /**
   * Walks a hierarchical location hint (shallowest segment first) against the dataset: each
   * segment resolves to a region or area below the previous match, or null when absent
   * (issue #154). Used by the "Add to OSM" dialog to locate the parent crag of a tick.
   */
  async matchAreaChain(segments: string[]): Promise<({ slug: string; data: DataJSON } | null)[]> {
    await this.init();
    if (!this.ready || segments.length === 0) return [];
    return (await this.send({ type: "matchAreaChain", segments }, "areaChain")).chain;
  }

  /**
   * Inserts or updates a locally created (not yet pushed) element, so it resolves like dataset
   * elements: the ticks list can already place it, and the OSM reference stays stable until the
   * changeset is pushed and the element gets its real id (issue #154).
   */
  async upsertElement(slug: string, feature: OsmFeature): Promise<void> {
    await this.init();
    // Local creations can happen while the dataset is still downloading: wait instead of
    // silently dropping the element, or the ticks list could never place it
    if (!(await this.#whenReady())) return;
    await this.send({ type: "upsertElement", slug, feature }, "elementUpserted");
  }

  /** Removes a locally created element from the database (e.g. the creation was undone) */
  async deleteElement(slug: string): Promise<void> {
    await this.init();
    if (!(await this.#whenReady())) return;
    await this.send({ type: "deleteElement", slug }, "elementDeleted");
  }

  /** Waits shortly for the database to become ready (downloads can take a while) */
  async #whenReady(timeoutMs = 20_000): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (!this.ready) {
      if (this.status === "error" || Date.now() > deadline) return false;
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    return true;
  }

  /** Streams the matching slugs to `onBatch`. `next()` runs for `budgetMs`, and resolves true when there are no more results. */
  filter(filters: SearchFilters, onBatch: (slugs: string[]) => void, budgetMs = 10_000): FilterSearch {
    const searchId = this.nextId++;
    this.searches.set(searchId, onBatch);
    let started = false;
    return {
      next: async () => {
        const first = !started;
        started = true;
        const res = await this.send(
          first ? { type: "filterStart", searchId, filters, budgetMs } : { type: "filterMore", searchId, budgetMs },
          "matchPause",
        );
        if (res.exhausted) this.searches.delete(searchId);
        return res.exhausted;
      },
      cancel: () => {
        this.searches.delete(searchId);
        if (started) this.worker?.postMessage({ type: "filterCancel", searchId, id: this.nextId++ });
      },
    };
  }
}

export const localDb = new LocalDb();
