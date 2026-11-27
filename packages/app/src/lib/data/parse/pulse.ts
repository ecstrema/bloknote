import type { OsmFeature } from "osm-api";

const MS_PER_DAY = 86_400_000;

export interface RecencyBucket {
  key: string;
  label: string;
  /** Upper bound of the bucket in milliseconds of age; `Infinity` for the last bucket */
  maxAgeMs: number;
  count: number;
}

const RECENCY_BUCKET_DEFS: { key: string; label: string; maxAgeMs: number }[] = [
  { key: "lt1m", label: "< 1 month", maxAgeMs: 30 * MS_PER_DAY },
  { key: "1to6m", label: "1-6 months", maxAgeMs: 182 * MS_PER_DAY },
  { key: "6to12m", label: "6-12 months", maxAgeMs: 365 * MS_PER_DAY },
  { key: "1to2y", label: "1-2 years", maxAgeMs: 730 * MS_PER_DAY },
  { key: "2to5y", label: "2-5 years", maxAgeMs: 1826 * MS_PER_DAY },
  { key: "gt5y", label: "> 5 years", maxAgeMs: Infinity },
];

export interface EditYearEntry {
  year: string;
  count: number;
}

export interface PulseStats {
  /** Items with a known edit timestamp */
  total: number;
  /** Items without a usable timestamp (e.g. created locally, not yet uploaded) */
  untimed: number;
  /** Age in ms of the most recent edit */
  lastEditAgeMs: number | undefined;
  /** Age in ms of the oldest edit */
  oldestEditAgeMs: number | undefined;
  /** Median edit age in ms */
  medianAgeMs: number | undefined;
  recencyDistribution: RecencyBucket[];
  editsPerYear: EditYearEntry[];
}

export function computePulseStats(features: OsmFeature[], now: number = Date.now()): PulseStats {
  const ages: number[] = [];
  const perYear = new Map<number, number>();
  let untimed = 0;

  for (const feature of features) {
    const ts = feature.timestamp ? Date.parse(feature.timestamp) : NaN;
    if (!Number.isFinite(ts)) {
      untimed++;
      continue;
    }
    ages.push(now - ts);
    const year = new Date(ts).getUTCFullYear();
    perYear.set(year, (perYear.get(year) ?? 0) + 1);
  }
  ages.sort((a, b) => a - b);

  const recencyDistribution: RecencyBucket[] = RECENCY_BUCKET_DEFS.map((bucket) => ({ ...bucket, count: 0 }));
  for (const age of ages) {
    const bucket = recencyDistribution.find((b) => age <= b.maxAgeMs);
    if (bucket) bucket.count++;
  }

  const editsPerYear: EditYearEntry[] = [];
  const years = [...perYear.keys()];
  if (years.length > 0) {
    const min = Math.min(...years);
    const max = Math.max(...years);
    for (let year = min; year <= max; year++) editsPerYear.push({ year: String(year), count: perYear.get(year) ?? 0 });
  }

  return {
    total: ages.length,
    untimed,
    lastEditAgeMs: ages.length > 0 ? ages[0] : undefined,
    oldestEditAgeMs: ages.length > 0 ? ages[ages.length - 1] : undefined,
    medianAgeMs: ages.length > 0 ? ages[Math.floor(ages.length / 2)] : undefined,
    recencyDistribution,
    editsPerYear,
  };
}

export interface ItemTagChange {
  key: string;
  /** Previous value, `undefined` when the tag was added */
  from: string | undefined;
  /** New value, `undefined` when the tag was removed */
  to: string | undefined;
}

export interface ItemVersion {
  version: number;
  timestamp: number | undefined;
  user: string | undefined;
  changeset: number | undefined;
  /** False when this version deleted the element */
  visible: boolean;
  /** Tag changes relative to the previous version; empty for the first version */
  tagChanges: ItemTagChange[];
  /** Human-readable geometry change relative to the previous version (issue #218) */
  geometryChange: string | undefined;
}

export function haversineMeters(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h));
}

export function formatDistance(meters: number): string {
  return meters < 1000 ? `${Math.round(meters)} m` : `${(meters / 1000).toFixed(1)} km`;
}

/**
 * Resolved member-node histories of a way, used to detect geometry changes that only show
 * up on the member nodes themselves (issue #220): the way keeps the same node ids while a
 * node was moved in its own history.
 */
export type NodeHistoryIndex = Map<number, OsmFeature[]>;

/** Resolves the position of a node as of a given time: the latest version created at or before `at` */
function nodePositionAt(history: OsmFeature[] | undefined, at: number): { lat: number; lon: number } | undefined {
  if (!history || history.length === 0) return undefined;
  let best: OsmFeature | undefined;
  for (const version of [...history].sort((a, b) => a.version - b.version)) {
    const ts = Date.parse(version.timestamp);
    if (!Number.isFinite(ts) || ts <= at) best = version;
    else break;
  }
  const resolved = best ?? history[0];
  return resolved?.type === "node" && resolved.lat !== undefined && resolved.lon !== undefined ? resolved : undefined;
}

/** Geometry change description between two versions, `undefined` when unchanged */
function geometryChange(
  previous: OsmFeature,
  feature: OsmFeature,
  nodeHistories?: NodeHistoryIndex,
): string | undefined {
  if (feature.type === "node" && previous.type === "node") {
    const moved = haversineMeters(previous, feature);
    return moved >= 0.1 ? `moved ${formatDistance(moved)}` : undefined;
  }
  if (feature.type === "way" && previous.type === "way") {
    if (JSON.stringify(previous.nodes) !== JSON.stringify(feature.nodes)) return "node list changed";
    // The node list is unchanged: detect member-node moves through their resolved positions
    // (issue #220). Positions may be unavailable (histories not fetched or too many nodes).
    if (!nodeHistories) return undefined;
    const at = Date.parse(feature.timestamp);
    const before = Date.parse(previous.timestamp);
    let total = 0;
    let movedCount = 0;
    const movedIds: number[] = [];
    for (const nodeId of feature.nodes ?? []) {
      const a = nodePositionAt(nodeHistories.get(nodeId), before);
      const b = nodePositionAt(nodeHistories.get(nodeId), at);
      if (!a || !b) continue;
      const moved = haversineMeters(a, b);
      if (moved < 0.1) continue;
      total += moved;
      movedCount++;
      movedIds.push(nodeId);
    }
    if (movedCount === 0) return undefined;
    const ids = movedIds.slice(0, 5).join(", ");
    return `nodes moved ${formatDistance(total)} (${movedCount} node${movedCount === 1 ? "" : "s"}: ${ids}${movedIds.length > 5 ? ",…" : ""})`;
  }
  if (feature.type === "relation" && previous.type === "relation") {
    return JSON.stringify(previous.members) === JSON.stringify(feature.members) ? undefined : "member list changed";
  }
  return undefined;
}

/**
 * Turns an OSM feature history (all versions of one element, as returned by the OSM API
 * `/history` endpoint) into a newest-first version timeline with the tags that changed at each
 * version (issue #217).
 */
export function historyVersions(history: OsmFeature[], nodeHistories?: NodeHistoryIndex): ItemVersion[] {
  const sorted = [...history].sort((a, b) => a.version - b.version);
  const versions: ItemVersion[] = [];
  let previous: OsmFeature | undefined;
  for (const feature of sorted) {
    const tagChanges: ItemTagChange[] = [];
    if (previous) {
      const keys = new Set([...Object.keys(previous.tags ?? {}), ...Object.keys(feature.tags ?? {})]);
      for (const key of keys) {
        const from = previous.tags?.[key];
        const to = feature.tags?.[key];
        if (from !== to) tagChanges.push({ key, from, to });
      }
      tagChanges.sort((a, b) => a.key.localeCompare(b.key));
    }
    const ts = Date.parse(feature.timestamp);
    versions.unshift({
      version: feature.version,
      timestamp: Number.isFinite(ts) ? ts : undefined,
      user: feature.user,
      changeset: feature.changeset,
      visible: feature.visible !== false,
      tagChanges,
      geometryChange: previous ? geometryChange(previous, feature, nodeHistories) : undefined,
    });
    previous = feature;
  }
  return versions;
}

function unit(value: number, singular: string, plural: string): string {
  return `${value} ${value === 1 ? singular : plural}`;
}

/** Human-readable relative age, e.g. "3 days ago", "just now" */
export function formatAge(ageMs: number): string {
  if (ageMs < 0) return "in the future";
  const minutes = Math.floor(ageMs / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${unit(minutes, "minute", "minutes")} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${unit(hours, "hour", "hours")} ago`;
  const days = Math.floor(hours / 24);
  if (days <= 60) return `${unit(days, "day", "days")} ago`;
  const months = Math.floor(days / 30.44);
  if (months < 24) return `${unit(months, "month", "months")} ago`;
  return `${unit(Math.floor(days / 365.25), "year", "years")} ago`;
}
