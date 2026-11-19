import { describe, expect, it } from "vitest";
import type { OsmFeature } from "osm-api";
import { computePulseStats, formatAge } from "./pulse.js";

function feature(timestamp?: string): OsmFeature {
  return {
    type: "node",
    id: 1,
    lat: 48.4,
    lon: 2.6,
    timestamp: timestamp ?? "",
    tags: { climbing: "route" },
    changeset: 1,
    user: "tester",
    uid: 1,
    version: 1,
  };
}

// 2026-06-01T00:00:00Z
const NOW = Date.parse("2026-06-01T00:00:00Z");

describe("computePulseStats", () => {
  it("returns empty stats without features", () => {
    const stats = computePulseStats([], NOW);
    expect(stats.total).toBe(0);
    expect(stats.lastEditAgeMs).toBeUndefined();
    expect(stats.editsPerYear).toEqual([]);
    expect(stats.recencyDistribution.every((b) => b.count === 0)).toBe(true);
  });

  it("counts items without timestamps as untimed", () => {
    const stats = computePulseStats([feature(), feature("2026-05-01T00:00:00Z")], NOW);
    expect(stats.total).toBe(1);
    expect(stats.untimed).toBe(1);
    expect(stats.lastEditAgeMs).toBe(31 * 86_400_000);
  });

  it("computes last, oldest and median edit ages", () => {
    const stats = computePulseStats(
      [
        feature("2020-01-01T00:00:00Z"),
        feature("2024-01-01T00:00:00Z"),
        feature("2026-05-25T00:00:00Z"),
      ],
      NOW,
    );
    expect(stats.total).toBe(3);
    expect(stats.lastEditAgeMs).toBe(7 * 86_400_000);
    expect(stats.medianAgeMs).toBeGreaterThan(stats.lastEditAgeMs!);
    expect(stats.oldestEditAgeMs).toBeGreaterThan(stats.medianAgeMs!);
  });

  it("buckets ages into recency ranges in order", () => {
    const stats = computePulseStats(
      [
        feature("2026-05-25T00:00:00Z"), // 7 days
        feature("2026-04-01T00:00:00Z"), // ~2 months
        feature("2024-01-01T00:00:00Z"), // ~2.4 years
        feature("2015-01-01T00:00:00Z"), // > 5 years
      ],
      NOW,
    );
    expect(stats.recencyDistribution.map((b) => b.count)).toEqual([1, 1, 0, 0, 1, 1]);
  });

  it("fills gaps in the per-year distribution", () => {
    const stats = computePulseStats([feature("2020-01-01T00:00:00Z"), feature("2026-01-01T00:00:00Z")], NOW);
    expect(stats.editsPerYear).toEqual([
      { year: "2020", count: 1 },
      { year: "2021", count: 0 },
      { year: "2022", count: 0 },
      { year: "2023", count: 0 },
      { year: "2024", count: 0 },
      { year: "2025", count: 0 },
      { year: "2026", count: 1 },
    ]);
  });
});

describe("formatAge", () => {
  it("formats relative ages", () => {
    expect(formatAge(30_000)).toBe("just now");
    expect(formatAge(3 * 60_000)).toBe("3 minutes ago");
    expect(formatAge(2 * 3_600_000)).toBe("2 hours ago");
    expect(formatAge(5 * 86_400_000)).toBe("5 days ago");
    expect(formatAge(100 * 86_400_000)).toBe("3 months ago");
    expect(formatAge(3.2 * 365.25 * 86_400_000)).toBe("3 years ago");
  });

  it("uses singular forms", () => {
    expect(formatAge(60_000)).toBe("1 minute ago");
    expect(formatAge(86_400_000)).toBe("1 day ago");
  });
});
