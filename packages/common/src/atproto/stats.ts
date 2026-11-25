import type { AscentInfo, AttemptStyle, ClimbingGradeRef, OsmElementRef, SendStyle, TickRecord } from "./types.ts";

export interface GradePyramidEntry {
  scale: string;
  grade: string;
  total: number;
  sends: number;
  attempts: number;
}

export interface UserStats {
  totalTicks: number;
  totalSends: number;
  totalAttempts: number;
  byStyle: Partial<Record<SendStyle | AttemptStyle, number>>;
  byAscentInfo: Partial<Record<AscentInfo, number>>;
  pyramid: GradePyramidEntry[];
  lastClimbedAt?: string;
}

/**
 * Derives user climbing statistics directly from an array of ticks.
 * No separate stats record is stored or needed on AT Protocol.
 * Climbing route grade and discipline are derived from OpenStreetMap route features
 * via an optional routeGradeLookup callback.
 */
export function computeUserStats(
  ticks: readonly TickRecord[],
  routeGradeLookup?: (subject: OsmElementRef) => ClimbingGradeRef | undefined,
): UserStats {
  const stats: UserStats = {
    totalTicks: ticks.length,
    totalSends: 0,
    totalAttempts: 0,
    byStyle: {},
    byAscentInfo: {},
    pyramid: [],
    lastClimbedAt: undefined,
  };

  const pyramidMap = new Map<string, GradePyramidEntry>();

  for (const tick of ticks) {
    // Minimal ticks without an outcome are treated as sends
    const isSend = tick.outcome !== "attempt";
    if (isSend) {
      stats.totalSends += 1;
    } else {
      stats.totalAttempts += 1;
    }

    // Send style (default redpoint) or attempt style (default hangdog)
    const style = isSend ? (tick.sendStyle ?? "redpoint") : (tick.attemptStyle ?? "hangdog");
    stats.byStyle[style] = (stats.byStyle[style] ?? 0) + 1;

    // Additional climbing qualifiers / tags (clean, toprope, lead, solo, pinkpoint, etc.)
    if (tick.ascentInfo) {
      for (const info of tick.ascentInfo) {
        stats.byAscentInfo[info] = (stats.byAscentInfo[info] ?? 0) + 1;
      }
    }

    // Grade pyramid tracking from OSM route lookup
    const grade = tick.subject ? routeGradeLookup?.(tick.subject) : undefined;
    if (grade?.scale && grade.value) {
      const key = `${grade.scale}:${grade.value}`;
      let entry = pyramidMap.get(key);
      if (!entry) {
        entry = {
          scale: grade.scale,
          grade: grade.value,
          total: 0,
          sends: 0,
          attempts: 0,
        };
        pyramidMap.set(key, entry);
      }
      entry.total += 1;
      if (isSend) {
        entry.sends += 1;
      } else {
        entry.attempts += 1;
      }
    }

    // Track latest climb date
    if (tick.climbedAt) {
      if (!stats.lastClimbedAt || tick.climbedAt > stats.lastClimbedAt) {
        stats.lastClimbedAt = tick.climbedAt;
      }
    }
  }

  stats.pyramid = Array.from(pyramidMap.values());
  return stats;
}
