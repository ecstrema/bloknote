import { describe, expect, it } from "vitest";
import type { OsmFeature } from "osm-api";
import { computeSectorStats } from "./sector-stats.js";

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
