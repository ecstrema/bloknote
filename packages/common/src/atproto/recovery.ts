import type { BasicOsmType } from "../helpers.ts";
import type { GeoPoint, OsmElementRef } from "./types.ts";

export interface CandidateFeature {
  type: BasicOsmType;
  id: number;
  name?: string;
  coordinates?: GeoPoint;
  grade?: string;
}

export interface RecoveryCandidate {
  feature: CandidateFeature;
  distanceMeters?: number;
  nameMatch: "exact" | "similar" | "none";
  confidence: number; // 0.0 to 1.0
}

/**
 * Calculates distance in meters between two coordinates via Haversine formula.
 */
export function haversineDistanceMeters(a: GeoPoint, b: GeoPoint): number {
  const R = 6371000; // meters
  const dLat = ((b.latitude - a.latitude) * Math.PI) / 180;
  const dLon = ((b.longitude - a.longitude) * Math.PI) / 180;
  const lat1 = (a.latitude * Math.PI) / 180;
  const lat2 = (b.latitude * Math.PI) / 180;

  const sinDLat = Math.sin(dLat / 2);
  const sinDLon = Math.sin(dLon / 2);
  const h = sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLon * sinDLon;
  const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  return R * c;
}

function normalizeName(name?: string): string {
  return (name ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

/**
 * Finds potential replacement OSM features when an OSM element has been deleted or converted,
 * using the historical state of the deleted element retrieved from the OpenStreetMap API history.
 * No snapshot metadata needs to be stored on user records.
 */
export function findOsmRecoveryCandidates(
  deletedFeature: CandidateFeature,
  availableFeatures: readonly CandidateFeature[],
  options?: { maxDistanceMeters?: number },
): RecoveryCandidate[] {
  const maxDist = options?.maxDistanceMeters ?? 250; // default 250 meters
  const targetName = normalizeName(deletedFeature.name);
  const candidates: RecoveryCandidate[] = [];

  for (const feature of availableFeatures) {
    let distance: number | undefined;
    if (deletedFeature.coordinates && feature.coordinates) {
      distance = haversineDistanceMeters(deletedFeature.coordinates, feature.coordinates);
      if (distance > maxDist) continue;
    }

    const featureName = normalizeName(feature.name);
    let nameMatch: "exact" | "similar" | "none" = "none";

    if (targetName && featureName) {
      if (targetName === featureName) {
        nameMatch = "exact";
      } else if (targetName.includes(featureName) || featureName.includes(targetName)) {
        nameMatch = "similar";
      }
    }

    // Skip if there's neither a name match nor coordinate proximity
    if (nameMatch === "none" && distance === undefined) continue;

    // Compute confidence score
    let confidence = 0;
    if (nameMatch === "exact") confidence += 0.6;
    else if (nameMatch === "similar") confidence += 0.35;

    if (distance !== undefined) {
      // Within 20 meters = full 0.4 distance score, scaling down to 0 at maxDist
      const distScore = Math.max(0, 1 - distance / maxDist) * 0.4;
      confidence += distScore;
    }

    // Small bonus if grade matches historical grade
    if (
      deletedFeature.grade &&
      feature.grade &&
      feature.grade.toLowerCase() === deletedFeature.grade.toLowerCase()
    ) {
      confidence = Math.min(1.0, confidence + 0.1);
    }

    candidates.push({
      feature,
      distanceMeters: distance !== undefined ? Math.round(distance) : undefined,
      nameMatch,
      confidence: Math.round(confidence * 100) / 100,
    });
  }

  // Rank by confidence descending
  candidates.sort((a, b) => b.confidence - a.confidence);
  return candidates;
}

/**
 * Returns a refreshed OsmElementRef pointing to the replacement feature.
 */
export function relinkOsmElement(replacement: CandidateFeature): OsmElementRef {
  return {
    type: replacement.type,
    id: replacement.id,
  };
}

/** Backward-compatibility alias */
export const relinkOsmSubject = relinkOsmElement;

