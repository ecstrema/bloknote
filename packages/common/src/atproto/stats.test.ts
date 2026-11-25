import { describe, expect, test } from "bun:test";
import { computeUserStats } from "./stats.ts";
import type { ClimbingGradeRef, OsmElementRef, TickRecord } from "./types.ts";

describe("computeUserStats", () => {
  test("computes correct totals, sends, attempts, and pyramid from ticks without separate record", () => {
    const ticks: TickRecord[] = [
      {
        subject: { type: "node", id: 101 },
        outcome: "send",
        sendStyle: "redpoint",
        ascentInfo: ["toprope"],
        comment: "Epic send after many days",
        climbedAt: "2026-05-10T14:30:00Z",
        createdAt: "2026-05-10T18:00:00Z",
      },
      {
        subject: { type: "node", id: 102 },
        outcome: "send",
        sendStyle: "onsight",
        climbedAt: "2026-06-12T11:00:00Z",
        createdAt: "2026-06-12T12:00:00Z",
      },
      {
        subject: { type: "way", id: 201 },
        outcome: "send",
        sendStyle: "flash",
        ascentInfo: ["solo"],
        climbedAt: "2026-04-01T10:00:00Z",
        createdAt: "2026-04-01T11:00:00Z",
      },
      {
        subject: { type: "node", id: 301 },
        outcome: "attempt",
        attemptStyle: "hangdog",
        hangs: 3,
        comment: "Crux move still feels impossible",
        climbedAt: "2026-07-01T15:00:00Z",
        createdAt: "2026-07-01T16:00:00Z",
      },
    ];

    // Mock OSM route grade lookup (simulating local route cache query)
    const mockGradeDb: Record<string, ClimbingGradeRef> = {
      "node:101": { scale: "French", value: "9a+" },
      "node:102": { scale: "French", value: "9a+" },
      "way:201": { scale: "Hueco", value: "V8" },
      "node:301": { scale: "French", value: "9c" },
    };
    const routeLookup = (subject: OsmElementRef) => mockGradeDb[`${subject.type}:${subject.id}`];

    const stats = computeUserStats(ticks, routeLookup);

    expect(stats.totalTicks).toBe(4);
    expect(stats.totalSends).toBe(3); // redpoint, onsight, flash
    expect(stats.totalAttempts).toBe(1); // hangdog

    expect(stats.byStyle.redpoint).toBe(1);
    expect(stats.byStyle.onsight).toBe(1);
    expect(stats.byStyle.flash).toBe(1);
    expect(stats.byStyle.hangdog).toBe(1);

    expect(stats.byAscentInfo.toprope).toBe(1);
    expect(stats.byAscentInfo.solo).toBe(1);

    expect(stats.lastClimbedAt).toBe("2026-07-01T15:00:00Z");

    const french9aPlus = stats.pyramid.find((p) => p.scale === "French" && p.grade === "9a+");
    expect(french9aPlus).toBeDefined();
    expect(french9aPlus?.total).toBe(2);
    expect(french9aPlus?.sends).toBe(2);
    expect(french9aPlus?.attempts).toBe(0);

    const french9c = stats.pyramid.find((p) => p.scale === "French" && p.grade === "9c");
    expect(french9c).toBeDefined();
    expect(french9c?.total).toBe(1);
    expect(french9c?.sends).toBe(0);
    expect(french9c?.attempts).toBe(1);
  });

  test("treats minimal ticks without outcome or climbedAt as sends", () => {
    const stats = computeUserStats([{ subject: { type: "node", id: 401 }, createdAt: "2026-08-01T10:00:00Z" }]);
    expect(stats.totalTicks).toBe(1);
    expect(stats.totalSends).toBe(1);
    expect(stats.totalAttempts).toBe(0);
    // Absent outcome defaults to the redpoint send style
    expect(stats.byStyle.redpoint).toBe(1);
    expect(stats.lastClimbedAt).toBeUndefined();
  });

  test("handles empty ticks gracefully", () => {
    const stats = computeUserStats([]);
    expect(stats.totalTicks).toBe(0);
    expect(stats.totalSends).toBe(0);
    expect(stats.totalAttempts).toBe(0);
    expect(stats.pyramid.length).toBe(0);
    expect(stats.lastClimbedAt).toBeUndefined();
  });
});
