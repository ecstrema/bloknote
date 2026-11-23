import type { DataJSON } from "@bloknote/climbing-data-gen";
import type { AreaStats } from "#lib/types.js";

export interface TagFilter {
  key: string;
  /** Empty means that the tag only has to be present */
  value: string;
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
  | { id: number; type: "getStats"; slug: string }
  /** Looks elements up by OSM references like `way-123456` */
  | { id: number; type: "getOsmRefs"; refs: string[] }
  | { id: number; type: "filterStart"; searchId: number; filters: SearchFilters; budgetMs: number }
  /** Continues a search that paused after using its time budget */
  | { id: number; type: "filterMore"; searchId: number; budgetMs: number }
  | { id: number; type: "filterCancel"; searchId: number };

export interface OsmRefEntry {
  slug: string;
  data: DataJSON;
}

export type DbResponse =
  | { id: number; type: "status"; ready: boolean; persistent: boolean; opfsUsable: boolean }
  | { id: number; type: "node"; data: DataJSON | undefined }
  | { id: number; type: "children"; data: Record<string, DataJSON> }
  | { id: number; type: "subtreeElements"; data: Record<string, DataJSON>; truncated: boolean }
  | { id: number; type: "stats"; data: AreaStats | undefined }
  | { id: number; type: "osmRefs"; data: Record<string, OsmRefEntry> }
  | { id: number; type: "topLevel"; data: TopLevelPoint[] }
  | { id: number; type: "allMapElements"; data: MapElementFeatureCollection }
  /** Streamed while a search runs, without being a reply to a request */
  | { type: "matchBatch"; searchId: number; slugs: string[] }
  /** The search used its time budget (`exhausted` false) or has no more results */
  | { id: number; type: "matchPause"; exhausted: boolean }
  | { id: number; type: "progress"; loaded: number; total: number | undefined; phase?: "download" | "parsing" }
  | { id: number; type: "error"; message: string };
