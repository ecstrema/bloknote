import { describe, expect, it } from "vitest";
import type { OsmFeature } from "osm-api";
import type { DataTree } from "#lib/types.js";
import { buildTypstDocument } from "./typst.js";

describe("buildTypstDocument", () => {
  it("generates a valid Typst table for a climbing sector and escapes special characters", () => {
    const sector: DataTree = {
      feature: {
        type: "relation",
        id: 1,
        members: [],
        tags: {
          sport: "climbing",
          climbing: "crag",
          name: "Pic #1 [East]",
          description: "Granite wall *classic*",
        },
      } as unknown as OsmFeature,
      children: {
        "estrie/pic/r1": {
          feature: {
            type: "node",
            id: 2,
            lat: 45,
            lon: -72,
            tags: {
              sport: "climbing",
              climbing: "route_bottom",
              name: "Voie $A",
              "climbing:grade:yds": "5.10a",
              "climbing:sport": "yes",
              "climbing:length": "25",
            },
          } as unknown as OsmFeature,
        },
      },
    };

    const typ = buildTypstDocument(sector, "estrie/pic");
    expect(typ).toContain("= Pic \\#1 \\[East\\]");
    expect(typ).toContain("Granite wall \\*classic\\*");
    expect(typ).toContain("[Voie \\$A], [5.10a], [Sport], [25 m], [1], []");
    expect(typ).toContain("== Routes (1)");
  });
});
