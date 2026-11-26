import type { SettingsRecord } from "@bloknote/common";
import type { BoulderScaleId, RouteScaleId, ViaFerrataScaleId } from "@bloknote/holy-grade";

/**
 * Mapping between the locally stored grading-scale preferences and the fields of the
 * org.bloknote.actor.settings record synced on the user's ATProto repository (issue #238).
 * Pure module: imported by both the reactive store (grading-scales.svelte.ts) and the ATProto
 * client, which must not import each other.
 */

export interface StoredScales {
  known: { route: RouteScaleId[]; boulder: BoulderScaleId[]; viaFerrata: ViaFerrataScaleId[] };
  preferred: { route?: RouteScaleId; boulder?: BoulderScaleId; viaFerrata?: ViaFerrataScaleId };
}

/**
 * All six record fields for these preferences. Unset preferences map to `undefined`, so a push
 * through saveSettings (which merges with spread) also clears them in the remote record.
 */
export function scalesToRecordFields(scales: StoredScales): Partial<SettingsRecord> {
  return {
    knownRouteScales: scales.known.route,
    knownBoulderScales: scales.known.boulder,
    knownViaFerrataScales: scales.known.viaFerrata,
    preferredRouteScale: scales.preferred.route,
    preferredBoulderScale: scales.preferred.boulder,
    preferredViaFerrataScale: scales.preferred.viaFerrata,
  };
}

/** The inverse mapping, in the raw shape expected by the storedScales() validation (issue #229) */
export function recordToScales(record: SettingsRecord) {
  return {
    known: {
      route: record.knownRouteScales ?? [],
      boulder: record.knownBoulderScales ?? [],
      viaFerrata: record.knownViaFerrataScales ?? [],
    },
    preferred: {
      route: record.preferredRouteScale,
      boulder: record.preferredBoulderScale,
      viaFerrata: record.preferredViaFerrataScale,
    },
  };
}

/** Whether the record carries any grading-scale preference (records predating issue #238 do not) */
export function hasScaleFields(record: SettingsRecord): boolean {
  return (
    !!record.knownRouteScales?.length ||
    !!record.knownBoulderScales?.length ||
    !!record.knownViaFerrataScales?.length ||
    !!record.preferredRouteScale ||
    !!record.preferredBoulderScale ||
    !!record.preferredViaFerrataScale
  );
}
