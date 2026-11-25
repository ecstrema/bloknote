import { describe, expect, it } from "vitest";
import type { OsmNode, OsmRelation } from "osm-api";
import { orderCreatedForDiffUpload } from "./osm.svelte.js";

function node(id: number, name: string): OsmNode {
  return {
    type: "node",
    id,
    version: 0,
    lat: 45,
    lon: 5,
    changeset: 0,
    timestamp: "",
    uid: -1,
    user: "",
    tags: { sport: "climbing", climbing: "route_bottom", name },
  };
}

function relation(id: number, name: string, members: OsmRelation["members"]): OsmRelation {
  return {
    type: "relation",
    id,
    version: 0,
    changeset: 0,
    timestamp: "",
    uid: -1,
    user: "",
    members,
    tags: { sport: "climbing", climbing: "area", name },
  };
}

describe("orderCreatedForDiffUpload", () => {
  it("moves placeholder definitions before the relations referencing them", () => {
    // The changes map holds the crag first: it was created before the sector placed inside it
    const sector = relation(-1221, "Sector", []);
    const crag = relation(-1220, "Crag", [{ type: "relation", ref: -1221, role: "" }]);
    const route = node(-1222, "Route");

    const ordered = orderCreatedForDiffUpload([crag, sector, route]);

    // The crag is emitted last: the sector it references comes before it
    expect(ordered.map((f) => f.id)).toEqual([-1221, -1222, -1220]);
  });

  it("keeps independent elements in insertion order", () => {
    const a = node(-1, "A");
    const b = relation(-2, "B", [{ type: "node", ref: 123, role: "" }]);
    const c = node(-3, "C");

    expect(orderCreatedForDiffUpload([a, b, c]).map((f) => f.id)).toEqual([-1, -2, -3]);
  });

  it("handles deep chains of nested creations", () => {
    const route = node(-3, "Route");
    const sector = relation(-2, "Sector", [{ type: "node", ref: -3, role: "" }]);
    const crag = relation(-1, "Crag", [{ type: "relation", ref: -2, role: "" }]);

    expect(orderCreatedForDiffUpload([crag, sector, route]).map((f) => f.id)).toEqual([-3, -2, -1]);
  });
});
