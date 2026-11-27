import {
  convertGrade,
  getReference,
  getScale,
  type BoulderScaleId,
  type RouteScaleId,
  type ScaleId,
} from "@bloknote/holy-grade";
import type { OsmFeature } from "osm-api";
import { featureToTypeOSM, getGrade } from "./osm-tags.js";
import { extractRouteStyle, isTradRoute, ROUTE_STYLE_COLORS, ROUTE_STYLE_LABELS } from "./route-styles.js";

export type StatStyleKey =
  | "sport"
  | "viaferrata"
  | "trad"
  | "unknown"
  | "boulder"
  | "ice"
  | "aid"
  | "dry"
  | "toprope"
  | "deepwater";

export const STAT_STYLE_LABELS: Record<StatStyleKey, string> = {
  sport: ROUTE_STYLE_LABELS.sport!,
  viaferrata: ROUTE_STYLE_LABELS.viaferrata!,
  trad: "Trad / Mixed",
  unknown: "Unknown style",
  boulder: ROUTE_STYLE_LABELS.boulder!,
  ice: ROUTE_STYLE_LABELS.ice!,
  aid: ROUTE_STYLE_LABELS.aid!,
  dry: ROUTE_STYLE_LABELS.dry!,
  toprope: ROUTE_STYLE_LABELS.toprope!,
  deepwater: ROUTE_STYLE_LABELS.deepwater!,
};

export const STAT_STYLE_COLORS: Record<StatStyleKey, string> = {
  sport: ROUTE_STYLE_COLORS.sport!,
  viaferrata: ROUTE_STYLE_COLORS.viaferrata!,
  trad: ROUTE_STYLE_COLORS.trad!,
  unknown: ROUTE_STYLE_COLORS.other!,
  boulder: ROUTE_STYLE_COLORS.boulder!,
  ice: ROUTE_STYLE_COLORS.ice!,
  aid: ROUTE_STYLE_COLORS.aid!,
  dry: ROUTE_STYLE_COLORS.dry!,
  toprope: ROUTE_STYLE_COLORS.toprope!,
  deepwater: ROUTE_STYLE_COLORS.deepwater!,
};

export const STAT_STYLE_ORDER: StatStyleKey[] = [
  "sport",
  "viaferrata",
  "trad",
  "unknown",
  "boulder",
  "ice",
  "toprope",
  "deepwater",
  "aid",
  "dry",
];

export function classifyClimbStyle(tags: Record<string, string> | undefined): StatStyleKey {
  if (!tags) return "unknown";
  if (isTradRoute(tags)) return "trad";
  const extracted = extractRouteStyle(tags);
  if (extracted === "viaferrata") return "viaferrata";
  if (extracted === "boulder") return "boulder";
  if (extracted === "ice") return "ice";
  if (extracted === "aid") return "aid";
  if (extracted === "dry") return "dry";
  if (extracted === "toprope") return "toprope";
  if (extracted === "deepwater") return "deepwater";
  if (tags["climbing:sport"] === "yes") return "sport";
  return "unknown";
}

export interface GradeDistributionBucket {
  grade: string;
  rank: number;
  total: number;
  byStyle: Partial<Record<StatStyleKey, number>>;
}

export interface TypeDistributionEntry {
  style: StatStyleKey;
  label: string;
  color: string;
  count: number;
}

export interface SectorStatsSummary {
  total: number;
  ungraded: number;
  categories: {
    route: number;
    boulder: number;
    ice: number;
    other: number;
  };
  typeDistribution: TypeDistributionEntry[];
  gradeDistribution: GradeDistributionBucket[];
}

/**
 * Aggregated climbing counts for a subtree, independent of any display grading scale (issue #114).
 * It is computed statically by the data generation pipeline (and stored in `stats.json`), so
 * clients only convert the handful of grade buckets to their preferred scale instead of
 * re-parsing every feature of the subtree.
 */
export interface RawSectorStats {
  total: number;
  ungraded: number;
  categories: { route: number; boulder: number; ice: number; other: number };
  /** Number of climbs per style */
  styles: Partial<Record<StatStyleKey, number>>;
  /** Grade buckets keyed by the original grade value and its scale */
  grades: { scale: string; grade: string; byStyle: Partial<Record<StatStyleKey, number>> }[];
}

export function emptyRawSectorStats(): RawSectorStats {
  return { total: 0, ungraded: 0, categories: { route: 0, boulder: 0, ice: 0, other: 0 }, styles: {}, grades: [] };
}

/** Deep clone, so locally cached raw stats can be adjusted without mutating the shared object */
export function cloneRawSectorStats(raw: RawSectorStats): RawSectorStats {
  return JSON.parse(JSON.stringify(raw)) as RawSectorStats;
}

/** Accumulates the stats contribution of one feature into `raw` */
function accumulateRawSectorStats(raw: RawSectorStats, feature: OsmFeature) {
  const type = featureToTypeOSM(feature);
  const tags = feature.tags ?? {};
  const parsedGrade = getGrade(tags);
  const isGradedBoulder = type === "area" && tags.climbing === "boulder" && !!parsedGrade;
  if (type !== "route" && !isGradedBoulder) return;
  raw.total++;

  const style = classifyClimbStyle(tags);
  raw.styles[style] = (raw.styles[style] ?? 0) + 1;

  if (style === "boulder") raw.categories.boulder++;
  else if (style === "ice") raw.categories.ice++;
  else if (style === "aid" || style === "dry") raw.categories.other++;
  else raw.categories.route++;

  if (!parsedGrade || parsedGrade.v.scale === "unknown" || !getScale(parsedGrade.v.scale)) {
    raw.ungraded++;
    return;
  }

  const entry = raw.grades.find((g) => g.scale === parsedGrade!.v.scale && g.grade === parsedGrade!.v.v);
  const bucket =
    entry ?? raw.grades[raw.grades.push({ scale: parsedGrade.v.scale, grade: parsedGrade.v.v, byStyle: {} }) - 1]!;
  bucket.byStyle[style] = (bucket.byStyle[style] ?? 0) + 1;
}

/** Merges raw stats (e.g. the children of a subtree) into `target`, in place. `sign` is -1 to subtract. */
export function addRawSectorStats(target: RawSectorStats, source: RawSectorStats, sign: 1 | -1 = 1) {
  target.total += sign * source.total;
  target.ungraded += sign * source.ungraded;
  for (const key of ["route", "boulder", "ice", "other"] as const) {
    target.categories[key] += sign * source.categories[key];
  }
  for (const [style, count] of Object.entries(source.styles) as [StatStyleKey, number][]) {
    target.styles[style] = (target.styles[style] ?? 0) + sign * count;
  }
  for (const grade of source.grades) {
    const entryIndex = target.grades.findIndex((g) => g.scale === grade.scale && g.grade === grade.grade);
    if (entryIndex === -1) {
      if (sign === -1) continue;
      target.grades.push({ scale: grade.scale, grade: grade.grade, byStyle: {} });
    }
    const entry = target.grades[entryIndex === -1 ? target.grades.length - 1 : entryIndex]!;
    for (const [style, count] of Object.entries(grade.byStyle) as [StatStyleKey, number][]) {
      const value = (entry.byStyle[style] ?? 0) + sign * count;
      if (value === 0) delete entry.byStyle[style];
      else entry.byStyle[style] = value;
    }
    // Fully subtracted buckets disappear, so raw stats stay minimal
    if (sign === -1 && Object.keys(entry.byStyle).length === 0) target.grades.splice(entryIndex, 1);
  }
}

/** Computes the raw stats of a list of features (a subtree, flat) */
export function computeRawSectorStats(features: OsmFeature[]): RawSectorStats {
  const raw = emptyRawSectorStats();
  for (const feature of features) accumulateRawSectorStats(raw, feature);
  return raw;
}

/** Computes the raw stats contribution of a single feature, to adjust precomputed subtree stats */
export function featureRawSectorStats(feature: OsmFeature): RawSectorStats {
  const raw = emptyRawSectorStats();
  accumulateRawSectorStats(raw, feature);
  return raw;
}

/**
 * Converts raw stats into the display summary, converting the grade buckets to the preferred
 * route and boulder scales when set (issue #188).
 */
export function expandRawSectorStats(
  raw: RawSectorStats,
  options?: {
    /** The single route scale all route grades are converted to (issue #188) */
    routeScale?: RouteScaleId;
    /** The single boulder scale all boulder grades are converted to (issue #188) */
    boulderScale?: BoulderScaleId;
  },
): SectorStatsSummary {
  const gradeBuckets = new Map<
    string,
    { rank: number; total: number; byStyle: Partial<Record<StatStyleKey, number>> }
  >();

  for (const { scale: sourceScaleId, grade, byStyle } of raw.grades) {
    const sourceScale = getScale(sourceScaleId as ScaleId);
    if (!sourceScale) continue;

    let displayLabel = grade;
    let displayScale = sourceScale;

    if (sourceScale.gradeType === "route" && options?.routeScale) {
      const target = getScale(options.routeScale);
      const converted = target ? convertGrade(grade, sourceScale, target) : undefined;
      if (target && converted) {
        displayLabel = converted;
        displayScale = target;
      }
    } else if (sourceScale.gradeType === "boulder" && options?.boulderScale) {
      const target = getScale(options.boulderScale);
      const converted = target ? convertGrade(grade, sourceScale, target) : undefined;
      if (target && converted) {
        displayLabel = converted;
        displayScale = target;
      }
    }

    const rank = getReference(displayLabel, displayScale) ?? getReference(grade, sourceScale) ?? 0;
    const bucket = gradeBuckets.get(displayLabel) ?? { rank, total: 0, byStyle: {} };
    for (const [style, count] of Object.entries(byStyle) as [StatStyleKey, number][]) {
      bucket.byStyle[style] = (bucket.byStyle[style] ?? 0) + count;
    }
    bucket.total += Object.values(byStyle).reduce((sum, count) => sum + count, 0);
    gradeBuckets.set(displayLabel, bucket);
  }

  const typeDistribution: TypeDistributionEntry[] = STAT_STYLE_ORDER.filter(
    (style) => (raw.styles[style] ?? 0) > 0,
  ).map((style) => ({
    style,
    label: STAT_STYLE_LABELS[style],
    color: STAT_STYLE_COLORS[style],
    count: raw.styles[style]!,
  }));

  const gradeDistribution: GradeDistributionBucket[] = [...gradeBuckets.entries()]
    .map(([grade, data]) => ({ grade, ...data }))
    .sort((a, b) => a.rank - b.rank || a.grade.localeCompare(b.grade));

  return {
    total: raw.total,
    ungraded: raw.ungraded,
    categories: { ...raw.categories },
    typeDistribution,
    gradeDistribution,
  };
}

export function computeSectorStats(
  features: OsmFeature[],
  options?: {
    /** The single route scale all route grades are converted to (issue #188) */
    routeScale?: RouteScaleId;
    /** The single boulder scale all boulder grades are converted to (issue #188) */
    boulderScale?: BoulderScaleId;
  },
): SectorStatsSummary {
  return expandRawSectorStats(computeRawSectorStats(features), options);
}
