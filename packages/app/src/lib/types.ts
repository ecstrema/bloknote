import type { DataJSON } from "@bloknote/climbing-data-gen";
import type { RawSectorStats } from "@bloknote/osm-climbing";
import type { OsmFeature } from "osm-api";

export interface BreadcrumbSegment {
  data?: DataTree;
  slug: string;
}

export type DataJSONRecord = Record<string, DataJSON>;
export type AreaStatsRecord = Record<string, AreaStats>;

export interface AreaStats {
  totalRoutes: number;
  /**
   * Raw precomputed climbing stats of the subtree (issue #114), computed statically by the data
   * pipeline. Absent in datasets built before it existed: the stats are then computed from the
   * subtree features instead.
   */
  raw?: RawSectorStats;
}

/** Tree structure for the OSM data.
 *
 * Use the type parameter to set the particular type of the contained feature. For example, if you know the feature is not a 'geographic' feature, set the type to {@link OsmFeature}.
 **/
export interface DataTree<Feature extends DataJSON = DataJSON> {
  childrenFetched?: true;
  children?: Record<string, DataTree>;
  feature: Feature;
  stats?: AreaStats;
}

export type { Grade } from "@bloknote/osm-climbing";
