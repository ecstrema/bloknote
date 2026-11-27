import { describe, expect, it } from "vitest";
import type { OsmFeature } from "osm-api";
import { computePulseStats, formatAge, historyVersions } from "./pulse.js";

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
      [feature("2020-01-01T00:00:00Z"), feature("2024-01-01T00:00:00Z"), feature("2026-05-25T00:00:00Z")],
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

describe("historyVersions", () => {
  function versioned(version: number, tags: Record<string, string>, timestamp: string): OsmFeature {
    return { ...feature(timestamp), version, tags };
  }

  it("builds a newest-first timeline with per-version tag changes", () => {
    const history = [
      versioned(1, { climbing: "route", name: "Old name" }, "2024-01-01T00:00:00Z"),
      versioned(2, { climbing: "route", name: "New name" }, "2025-06-15T00:00:00Z"),
      versioned(3, { climbing: "route", name: "New name", "climbing:grade:french": "6a" }, "2026-02-20T00:00:00Z"),
    ];
    expect(historyVersions(history)).toEqual([
      {
        version: 3,
        timestamp: Date.parse("2026-02-20T00:00:00Z"),
        user: "tester",
        changeset: 1,
        visible: true,
        tagChanges: [{ key: "climbing:grade:french", from: undefined, to: "6a" }],
        geometryChange: undefined,
      },
      {
        version: 2,
        timestamp: Date.parse("2025-06-15T00:00:00Z"),
        user: "tester",
        changeset: 1,
        visible: true,
        tagChanges: [{ key: "name", from: "Old name", to: "New name" }],
        geometryChange: undefined,
      },
      {
        version: 1,
        timestamp: Date.parse("2024-01-01T00:00:00Z"),
        user: "tester",
        changeset: 1,
        visible: true,
        tagChanges: [],
        geometryChange: undefined,
      },
    ]);
  });

  it("reports removed tags", () => {
    const history = [
      versioned(1, { climbing: "boulder", note: "temp" }, "2024-01-01T00:00:00Z"),
      versioned(2, { climbing: "boulder" }, "2025-01-01T00:00:00Z"),
    ];
    const [latest] = historyVersions(history);
    expect(latest!.tagChanges).toEqual([{ key: "note", from: "temp", to: undefined }]);
  });

  it("reports node position moves", () => {
    const moved = { ...feature("2025-01-01T00:00:00Z"), version: 2, lat: 48.401, lon: 2.601 };
    const [latest] = historyVersions([feature("2024-01-01T00:00:00Z"), moved]);
    expect(latest!.geometryChange).toMatch(/^moved \d+ m$/);
  });

  it("ignores sub-decimeter node moves", () => {
    const moved = { ...feature("2025-01-01T00:00:00Z"), version: 2, lon: 2.6000000001 };
    const [latest] = historyVersions([feature("2024-01-01T00:00:00Z"), moved]);
    expect(latest!.geometryChange).toBeUndefined();
  });

  it("reports way node list and relation member changes", () => {
    const wayV1: OsmFeature = { ...feature("2024-01-01T00:00:00Z"), type: "way", id: 2, version: 1, nodes: [1, 2, 3] };
    const wayV2: OsmFeature = { ...wayV1, version: 2, nodes: [1, 2, 4] };
    const relationV1: OsmFeature = {
      ...feature("2024-01-01T00:00:00Z"),
      type: "relation",
      id: 3,
      version: 1,
      members: [{ type: "way", ref: 2, role: "outer" }],
    };
    const relationV2: OsmFeature = {
      ...relationV1,
      version: 2,
      members: [
        { type: "way", ref: 2, role: "outer" },
        { type: "node", ref: 1, role: "entrance" },
      ],
    };
    const [latestWay] = historyVersions([wayV1, wayV2]);
    const [latestRelation] = historyVersions([relationV1, relationV2]);
    expect(latestWay!.geometryChange).toBe("node list changed");
    expect(latestRelation!.geometryChange).toBe("member list changed");
  });

  it("detects way geometry changes when only a member node moved (issue #220)", () => {
    const wayV1: OsmFeature = {
      ...feature("2024-01-01T00:00:00Z"),
      type: "way",
      id: 2,
      version: 1,
      nodes: [10, 11],
    };
    const wayV2: OsmFeature = { ...wayV1, version: 2, timestamp: "2025-06-01T00:00:00Z" };
    const node10 = [
      { ...feature("2024-01-01T00:00:00Z"), id: 10, lat: 48.4, lon: 2.6 },
      { ...feature("2024-01-01T00:00:00Z"), id: 10, version: 2, lat: 48.41, lon: 2.6, timestamp: "2025-03-01T00:00:00Z" },
    ];
    const node11 = [{ ...feature("2024-01-01T00:00:00Z"), id: 11, lat: 48.4, lon: 2.61 }];
    const nodeHistories = new Map([
      [10, node10],
      [11, node11],
    ]);
    const [latest] = historyVersions([wayV1, wayV2], nodeHistories);
    expect(latest!.geometryChange).toMatch(/^nodes moved 1\.1 km \(1 node: 10\)$/);

    // Without the resolved node histories, the blind spot remains
    expect(historyVersions([wayV1, wayV2])[0]!.geometryChange).toBeUndefined();

    // Sub-decimeter moves are ignored
    const tinyMove = new Map([
      [10, [node10[0]!]],
      [11, [{ ...node11[0]!, lat: 48.4, lon: 2.6100000001 }]],
    ]);
    const [unchanged] = historyVersions([wayV1, wayV2], tinyMove);
    expect(unchanged!.geometryChange).toBeUndefined();
  });

  it("marks deleted versions", () => {
    const deleted: OsmFeature = { ...feature("2025-01-01T00:00:00Z"), version: 2, visible: false, tags: {} };
    const [latest] = historyVersions([feature("2024-01-01T00:00:00Z"), deleted]);
    expect(latest!.version).toBe(2);
    expect(latest!.visible).toBe(false);
    expect(latest!.tagChanges).toEqual([{ key: "climbing", from: "route", to: undefined }]);
  });

  it("tolerates a single version and missing timestamps", () => {
    expect(historyVersions([versioned(1, { climbing: "route" }, "")])).toEqual([
      {
        version: 1,
        timestamp: undefined,
        user: "tester",
        changeset: 1,
        visible: true,
        tagChanges: [],
        geometryChange: undefined,
      },
    ]);
    expect(historyVersions([])).toEqual([]);
  });
});
