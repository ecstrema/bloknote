import { describe, expect, test } from "bun:test";
import { findOsmRecoveryCandidates, relinkOsmElement } from "./recovery.ts";
import type { CandidateFeature } from "./recovery.ts";

describe("OSM recovery mechanism", () => {
  test("recovers route when node ID changed or converted to way via OSM history query", () => {
    // When node 123456 is reported deleted, the client queries OSM API history to get its prior state:
    const historicalDeletedNode: CandidateFeature = {
      type: "node",
      id: 123456,
      name: "Biographie",
      coordinates: { latitude: 44.498, longitude: 5.792 },
      grade: "9a+",
    };

    const nearbyFeatures: CandidateFeature[] = [
      {
        type: "way",
        id: 987654,
        name: "Biographie",
        coordinates: { latitude: 44.49805, longitude: 5.79205 }, // ~7 meters away
        grade: "9a+",
      },
      {
        type: "node",
        id: 555555,
        name: "Dédié",
        coordinates: { latitude: 44.4981, longitude: 5.7921 }, // ~13 meters away
        grade: "8c",
      },
      {
        type: "node",
        id: 888888,
        name: "Action Directe",
        coordinates: { latitude: 49.0, longitude: 11.0 }, // Far away
        grade: "9a",
      },
    ];

    const candidates = findOsmRecoveryCandidates(historicalDeletedNode, nearbyFeatures);

    expect(candidates.length).toBeGreaterThan(0);
    // Highest confidence candidate should be Biographie as way:987654
    const topCandidate = candidates[0]!;
    expect(topCandidate.feature.id).toBe(987654);
    expect(topCandidate.feature.type).toBe("way");
    expect(topCandidate.nameMatch).toBe("exact");
    expect(topCandidate.confidence).toBeGreaterThan(0.9);

    // Relink element with replacement feature
    const updatedRef = relinkOsmElement(topCandidate.feature);
    expect(updatedRef.type).toBe("way");
    expect(updatedRef.id).toBe(987654);
  });

  test("handles route when only coordinate proximity or name match is available", () => {
    const historicalDeletedNode: CandidateFeature = {
      type: "node",
      id: 111,
      name: "The Real Thing",
    };

    const features: CandidateFeature[] = [
      {
        type: "node",
        id: 222,
        name: "The Real Thing",
      },
      {
        type: "node",
        id: 333,
        name: "Something Else",
      },
    ];

    const candidates = findOsmRecoveryCandidates(historicalDeletedNode, features);
    expect(candidates.length).toBe(1);
    expect(candidates[0]?.feature.id).toBe(222);
    expect(candidates[0]?.nameMatch).toBe("exact");
  });
});
