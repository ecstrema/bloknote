import { convertGrade, getReference, getScale, type BoulderScaleId, type RouteScaleId } from "@bloknote/holy-grade";
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

export function computeSectorStats(
  features: OsmFeature[],
  options?: {
    /** The single route scale all route grades are converted to (issue #188) */
    routeScale?: RouteScaleId;
    /** The single boulder scale all boulder grades are converted to (issue #188) */
    boulderScale?: BoulderScaleId;
  },
): SectorStatsSummary {
  const styleCounts = new Map<StatStyleKey, number>();
  const gradeBuckets = new Map<
    string,
    { rank: number; total: number; byStyle: Partial<Record<StatStyleKey, number>> }
  >();

  let total = 0;
  let ungraded = 0;
  const categories = { route: 0, boulder: 0, ice: 0, other: 0 };

  for (const feature of features) {
    const type = featureToTypeOSM(feature);
    const tags = feature.tags ?? {};
    const parsedGrade = getGrade(tags);
    const isGradedBoulder = type === "area" && tags.climbing === "boulder" && !!parsedGrade;
    if (type !== "route" && !isGradedBoulder) continue;
    total++;

    const style = classifyClimbStyle(tags);
    styleCounts.set(style, (styleCounts.get(style) ?? 0) + 1);

    if (style === "boulder") categories.boulder++;
    else if (style === "ice") categories.ice++;
    else if (style === "aid" || style === "dry") categories.other++;
    else categories.route++;

    if (!parsedGrade || parsedGrade.v.scale === "unknown") {
      ungraded++;
      continue;
    }

    const sourceScale = getScale(parsedGrade.v.scale);
    if (!sourceScale) {
      ungraded++;
      continue;
    }

    let displayLabel = parsedGrade.v.v;
    let displayScale = sourceScale;

    if (sourceScale.gradeType === "route" && options?.routeScale) {
      const target = getScale(options.routeScale);
      const converted = target ? convertGrade(parsedGrade.v.v, sourceScale, target) : undefined;
      if (target && converted) {
        displayLabel = converted;
        displayScale = target;
      }
    } else if (sourceScale.gradeType === "boulder" && options?.boulderScale) {
      const target = getScale(options.boulderScale);
      const converted = target ? convertGrade(parsedGrade.v.v, sourceScale, target) : undefined;
      if (target && converted) {
        displayLabel = converted;
        displayScale = target;
      }
    }

    const rank = getReference(displayLabel, displayScale) ?? getReference(parsedGrade.v.v, sourceScale) ?? 0;
    const bucket = gradeBuckets.get(displayLabel) ?? { rank, total: 0, byStyle: {} };
    bucket.total++;
    bucket.byStyle[style] = (bucket.byStyle[style] ?? 0) + 1;
    gradeBuckets.set(displayLabel, bucket);
  }

  const typeDistribution: TypeDistributionEntry[] = STAT_STYLE_ORDER.filter(
    (style) => (styleCounts.get(style) ?? 0) > 0,
  ).map((style) => ({
    style,
    label: STAT_STYLE_LABELS[style],
    color: STAT_STYLE_COLORS[style],
    count: styleCounts.get(style)!,
  }));

  const gradeDistribution: GradeDistributionBucket[] = [...gradeBuckets.entries()]
    .map(([grade, data]) => ({ grade, ...data }))
    .sort((a, b) => a.rank - b.rank || a.grade.localeCompare(b.grade));

  return { total, ungraded, categories, typeDistribution, gradeDistribution };
}
