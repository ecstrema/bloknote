import type { DataJSON } from "@bloknote/climbing-data-gen";
import type { OsmFeature } from "osm-api";
import type { AreaStats } from "#lib/types.js";

export interface TagFilter {
  key: string;
  /** Empty means that the tag only has to be present */
  value: string;
  /**
   * Comparison operator applied to the tag value (issue #236): `=` and `!=` compare the raw
   * string, `~` is a substring match, and `>`, `>=`, `<`, `<=` compare numerically. Undefined
   * means `=`. Comparisons are handled in SQL by the database worker.
   */
  op?: "!=" | ">=" | "<=" | "=" | ">" | "<" | "~";
}

export interface SearchFilters {
  text: string;
  /** A place matches any of the types. Empty means any type. */
  types: ("route" | "area" | "gym")[];
  /** Grade reference numbers, see getGradeReference */
  gradeMin?: number | undefined;
  gradeMax?: number | undefined;
  /** Styles like sport or trad, matching the `climbing:<style>=yes` tag. A place matches any of them. */
  styles: string[];
  tags: TagFilter[];
  /**
   * OSM refs (like `way-123`) of the elements referenced by the user's ticks, bookmarks, comments
   * and ratings: an element only matches when its ref is in this list. Not persisted: derived
   * from the premade logbook filters (issue #166) at search time, since the records live in the
   * ATProto caches, not in the database.
   */
  mineRefs?: string[];
  /** Minimum `climbing:length` in meters */
  minLength?: number | undefined;
}

export interface TopLevelPoint {
  slug: string;
  name: string | undefined;
  lat: number;
  lon: number;
}

export interface MapElementFeature {
  type: "Feature";
  geometry: {
    type: "Point" | "LineString" | "Polygon";
    coordinates: any;
  };
  properties: {
    slug: string;
    name: string;
    elementType: "route" | "area" | "gym" | "cliff" | "sector" | "other";
    routeStyle?: string;
    grade?: string;
    fillColor: string;
    strokeColor: string;
    href: string;
    /** True when the feature is excluded by the active search filters and faded on the map (issue #215) */
    dimmed?: boolean;
  };
}

export interface MapElementFeatureCollection {
  type: "FeatureCollection";
  features: MapElementFeature[];
}

export type DbRequest =
  | { id: number; type: "status"; version: string }
  | { id: number; type: "getTopLevel" }
  | { id: number; type: "getAllMapElements" }
  | { id: number; type: "build"; url: string; version: string; bytes?: number }
  | { id: number; type: "getNode"; slug: string }
  | { id: number; type: "getChildren"; slug: string }
  | { id: number; type: "getSubtreeElements"; slug: string; limit?: number }
  | { id: number; type: "getElements"; slugs: string[] }
  | { id: number; type: "getStats"; slug: string }
  /** Looks elements up by OSM references like `way-123456` */
  | { id: number; type: "getOsmRefs"; refs: string[] }
  /** Named elements within a bounding box, used to find replacements for deleted elements */
  | { id: number; type: "getNearbyElements"; lat: number; lon: number; radiusMeters: number }
  /** Area-scoped route name matches for the tick import (issue #154) */
  | { id: number; type: "matchTicks"; queries: { name: string; area?: string | string[] }[] }
  /** Area name matches, to pick a parent when adding a route to OSM from a tick (issue #154) */
  | { id: number; type: "matchAreas"; queries: string[] }
  /** Walks a hierarchical location hint shallowest-first, constraining each segment to the previous match */
  | { id: number; type: "matchAreaChain"; segments: string[] }
  /** Inserts or updates a locally created (not yet pushed) element so it resolves like dataset elements */
  | { id: number; type: "upsertElement"; slug: string; feature: OsmFeature }
  /** Removes a locally created element from the database (e.g. the creation was undone) */
  | { id: number; type: "deleteElement"; slug: string }
  | { id: number; type: "filterStart"; searchId: number; filters: SearchFilters; budgetMs: number }
  /** Continues a search that paused after using its time budget */
  | { id: number; type: "filterMore"; searchId: number; budgetMs: number }
  | { id: number; type: "filterCancel"; searchId: number };

export interface OsmRefEntry {
  slug: string;
  data: DataJSON;
}

/** A route inside a matched area, for the tick import (issue #154) */
export interface TickRouteMatch {
  slug: string;
  /** Slug of the area the route belongs to */
  parentSlug: string;
  data: DataJSON;
}

/** A named element candidate for relinking records whose OSM element was deleted or moved */
export interface NearbyCandidate {
  type: "node" | "way" | "relation";
  id: number;
  name?: string;
  latitude?: number;
  longitude?: number;
  grade?: string;
}

export type DbResponse =
  | { id: number; type: "status"; ready: boolean; persistent: boolean; opfsUsable: boolean }
  | { id: number; type: "node"; data: DataJSON | undefined }
  | { id: number; type: "children"; data: Record<string, DataJSON> }
  | { id: number; type: "subtreeElements"; data: Record<string, DataJSON>; truncated: boolean }
  | { id: number; type: "elements"; data: Record<string, DataJSON> }
  | { id: number; type: "stats"; data: AreaStats | undefined }
  | { id: number; type: "osmRefs"; data: Record<string, OsmRefEntry> }
  | { id: number; type: "nearbyElements"; data: NearbyCandidate[] }
  | { id: number; type: "topLevel"; data: TopLevelPoint[] }
  | { id: number; type: "allMapElements"; data: MapElementFeatureCollection }
  /** For each query, up to a few route candidates matching by name */
  | { id: number; type: "placeNames"; data: Record<string, { slug: string; data: DataJSON }[]> }
  /** For each query, the route candidates found inside the queried area (aligned with the queries) */
  | { id: number; type: "tickMatches"; data: TickRouteMatch[][] }
  /** For each query, the area candidates matching by name (aligned with the queries) */
  | { id: number; type: "areaMatches"; data: { slug: string; data: DataJSON }[][] }
  /** For each hint segment, its resolved region/area or null when absent (aligned with the segments) */
  | { id: number; type: "areaChain"; chain: ({ slug: string; data: DataJSON } | null)[] }
  | { id: number; type: "elementUpserted" }
  | { id: number; type: "elementDeleted" }
  /** Streamed while a search runs, without being a reply to a request */
  | { type: "matchBatch"; searchId: number; slugs: string[] }
  /** The search used its time budget (`exhausted` false) or has no more results */
  | { id: number; type: "matchPause"; exhausted: boolean }
  | { id: number; type: "progress"; loaded: number; total: number | undefined; phase?: "download" | "parsing" }
  | { id: number; type: "error"; message: string };
