import { describe, expect, it } from "vitest";
import type { OsmFeature } from "osm-api";
import {
  addRawSectorStats,
  computeRawSectorStats,
  computeSectorStats,
  emptyRawSectorStats,
  expandRawSectorStats,
  featureRawSectorStats,
} from "./sector-stats.js";

function route(id: number, tags: Record<string, string>): OsmFeature {
  return { type: "node", id, lat: 0, lon: 0, tags } as OsmFeature;
}

describe("computeSectorStats", () => {
  it("computes route/boulder/ice category counts, sport/trad/unknown splits, and sorted grade buckets", () => {
    const features: OsmFeature[] = [
      route(1, { sport: "climbing", climbing: "route_bottom", "climbing:sport": "yes", "climbing:grade:french": "7a" }),
      route(2, { sport: "climbing", climbing: "route_bottom", "climbing:trad": "yes", "climbing:grade:french": "6a" }),
      route(3, { sport: "climbing", climbing: "route_bottom", "climbing:mixed": "yes", "climbing:grade:french": "6a" }),
      route(4, { sport: "climbing", climbing: "route_bottom", "climbing:grade:french": "6a" }),
      route(5, { sport: "climbing", climbing: "boulder", "climbing:grade:fb": "6A" }),
      route(6, { sport: "climbing", climbing: "route_bottom", "climbing:ice": "yes", "climbing:grade:ice": "WI4" }),
      route(7, { sport: "climbing", climbing: "route_bottom", name: "Project" }),
    ];

    const stats = computeSectorStats(features);
    expect(stats.total).toBe(7);
    expect(stats.ungraded).toBe(1);
    expect(stats.categories).toEqual({ route: 5, boulder: 1, ice: 1, other: 0 });
    expect(stats.typeDistribution.map((t) => [t.style, t.count])).toEqual([
      ["sport", 1],
      ["trad", 2],
      ["unknown", 2],
      ["boulder", 1],
      ["ice", 1],
    ]);

    const g6a = stats.gradeDistribution.find((b) => b.grade === "6a")!;
    expect(g6a.total).toBe(3);
    expect(g6a.byStyle).toEqual({ trad: 2, unknown: 1 });
    expect(stats.gradeDistribution.map((b) => b.grade)).toEqual(["WI4", "6a", "6A", "7a"]);
  });

  it("converts grades to the provided single display scales", () => {
    const features: OsmFeature[] = [
      route(1, { sport: "climbing", climbing: "route_bottom", "climbing:sport": "yes", "climbing:grade:french": "6a" }),
    ];
    const stats = computeSectorStats(features, { routeScale: "YDS" });
    expect(stats.gradeDistribution[0]?.grade).toBe("5.10a");
  });
});

describe("raw sector stats (issue #114)", () => {
  const features: OsmFeature[] = [
    route(1, { sport: "climbing", climbing: "route_bottom", "climbing:sport": "yes", "climbing:grade:french": "7a" }),
    route(2, { sport: "climbing", climbing: "route_bottom", "climbing:trad": "yes", "climbing:grade:french": "6a" }),
    route(3, { sport: "climbing", climbing: "boulder", "climbing:grade:fb": "6A" }),
  ];

  it("merges raw stats of subtrees and round-trips through expandRawSectorStats", () => {
    const merged = emptyRawSectorStats();
    addRawSectorStats(merged, computeRawSectorStats(features.slice(0, 2)));
    addRawSectorStats(merged, computeRawSectorStats(features.slice(2)));
    expect(merged.total).toBe(3);
    expect(merged.grades).toEqual([
      { scale: "French", grade: "7a", byStyle: { sport: 1 } },
      { scale: "French", grade: "6a", byStyle: { trad: 1 } },
      { scale: "FB", grade: "6A", byStyle: { boulder: 1 } },
    ]);

    // Expanding with a display scale matches a direct computation over the features
    const direct = computeSectorStats(features, { routeScale: "YDS", boulderScale: "Hueco" });
    const expanded = expandRawSectorStats(merged, { routeScale: "YDS", boulderScale: "Hueco" });
    expect(expanded).toEqual(direct);
  });

  it("subtracts feature contributions to apply local edits on top of precomputed stats", () => {
    const raw = computeRawSectorStats(features);
    // The route 7a is regraded to 7b locally: subtract the old, add the new
    addRawSectorStats(raw, featureRawSectorStats(features[0]!), -1);
    addRawSectorStats(
      raw,
      featureRawSectorStats(
        route(1, {
          sport: "climbing",
          climbing: "route_bottom",
          "climbing:sport": "yes",
          "climbing:grade:french": "7b",
        }),
      ),
    );
    expect(raw.total).toBe(3);
    expect(raw.grades.find((g) => g.grade === "7a")).toBeUndefined();
    expect(raw.grades.find((g) => g.grade === "7b")?.byStyle).toEqual({ sport: 1 });

    const expanded = expandRawSectorStats(raw);
    expect(expanded.total).toBe(3);
    expect(expanded.gradeDistribution.map((b) => b.grade)).toEqual(["6a", "6A", "7b"]);
  });
});
