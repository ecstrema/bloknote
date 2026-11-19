import { describe, expect, it } from "bun:test";
import { parseWorldClimbingPoints } from "./world-points.ts";

describe("parseWorldClimbingPoints", () => {
  it("keeps climbing places and filters out individual routes and bolts", () => {
    const parsed = parseWorldClimbingPoints({
      osm3s: { timestamp_osm_base: "2026-05-31T22:37:44Z" },
      elements: [
        { type: "node", id: 1, lat: 48.4, lon: 2.6, tags: { climbing: "crag", name: "Bas Cuvier" } },
        {
          type: "relation",
          id: 2,
          center: { lat: 48.41, lon: 2.61 },
          tags: { sport: "climbing", type: "site", name: "Fontainebleau" },
        },
        {
          type: "node",
          id: 3,
          lat: 48.42,
          lon: 2.62,
          tags: { sport: "climbing", leisure: "sports_centre", name: "Block'Out" },
        },
        { type: "node", id: 4, lat: 48.43, lon: 2.63, tags: { climbing: "boulder", name: "La Marie Rose" } },
        {
          type: "node",
          id: 5,
          lat: 48.44,
          lon: 2.64,
          tags: { sport: "climbing", climbing: "route_bottom", name: "Route A" },
        },
        { type: "node", id: 6, lat: 48.45, lon: 2.65, tags: { climbing: "route", name: "Route B" } },
        { type: "node", id: 7, lat: 48.46, lon: 2.66, tags: { climbing: "bolt" } },
        { type: "node", id: 8, lat: 48.47, lon: 2.67, tags: { climbing: "abseil_route" } },
        { type: "node", id: 9, lat: 48.48, lon: 2.68, tags: { sport: "climbing", name: "Mystery Spot" } },
      ],
    });

    expect(parsed.timestamp).toBe("2026-05-31T22:37:44Z");
    expect(parsed.points).toEqual([
      { id: "n1", lat: 48.4, lon: 2.6, kind: "crag", name: "Bas Cuvier" },
      { id: "r2", lat: 48.41, lon: 2.61, kind: "area", name: "Fontainebleau" },
      { id: "n3", lat: 48.42, lon: 2.62, kind: "gym", name: "Block'Out" },
      { id: "n4", lat: 48.43, lon: 2.63, kind: "boulder", name: "La Marie Rose" },
      { id: "n9", lat: 48.48, lon: 2.68, kind: "other", name: "Mystery Spot" },
    ]);
  });
});
