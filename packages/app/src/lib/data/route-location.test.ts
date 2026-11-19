import { describe, expect, it } from "vitest";
import type { DataTree } from "#lib/types.js";
import type { OsmNode, OsmRelation } from "osm-api";
import { getDefaultRouteCoordinates, NEXT_TO_NODE_OFFSET } from "./route-location.js";

function makeNode(id: number, lat: number, lon: number): DataTree<OsmNode> {
  return {
    feature: {
      type: "node",
      id,
      version: 1,
      lat,
      lon,
      changeset: 1,
      timestamp: "",
      uid: 1,
      user: "",
      tags: { sport: "climbing", climbing: "route_bottom" },
    },
  };
}

function makeRelation(
  id: number,
  children: Record<string, DataTree> = {},
  center?: { lat: number; lon: number },
): DataTree {
  const feature = {
    type: "relation",
    id,
    version: 1,
    members: [],
    changeset: 1,
    timestamp: "",
    uid: 1,
    user: "",
    tags: { sport: "climbing", climbing: "crag" },
    ...(center ? { center } : {}),
  } as OsmRelation & { center?: { lat: number; lon: number } };

  return { feature, children };
}

describe("getDefaultRouteCoordinates", () => {
  it("uses the map center when the map tab is active", () => {
    const currentPage = { item: makeNode(1, 45.1, 6.2), slug: "europe/france/crag/route-1" };
    const result = getDefaultRouteCoordinates({
      mapCenter: { lat: 45.5, lon: 6.8 },
      currentPage,
      getNode: () => undefined,
    });
    expect(result).toEqual({ lat: 45.5, lon: 6.8 });
  });

  it("places the route right next to the current page when it is a node", () => {
    const currentPage = { item: makeNode(1, 45.12345, 6.54321), slug: "europe/france/crag/route-1" };
    const result = getDefaultRouteCoordinates({
      currentPage,
      getNode: () => undefined,
    });
    expect(result).toEqual({ lat: 45.12345, lon: 6.54321 + NEXT_TO_NODE_OFFSET });
  });

  it("uses the center of a geographic page bbox", () => {
    const geo: DataTree = {
      feature: {
        type: "geographic",
        name: "France",
        bbox: { x0: 2, x1: 6, y0: 44, y1: 48 },
      },
    };
    const result = getDefaultRouteCoordinates({
      currentPage: { item: geo, slug: "europe/france" },
      getNode: () => undefined,
    });
    expect(result).toEqual({ lat: 46, lon: 4 });
  });

  it("uses the own center of an area relation when available", () => {
    const area = makeRelation(10, {}, { lat: 43.2, lon: 5.4 });
    const result = getDefaultRouteCoordinates({
      currentPage: { item: area, slug: "europe/france/crag" },
      getNode: () => undefined,
    });
    expect(result).toEqual({ lat: 43.2, lon: 5.4 });
  });

  it("averages descendant coordinates when an area has no own center", () => {
    const area = makeRelation(10, {
      "europe/france/crag/r1": makeNode(1, 44, 6),
      "europe/france/crag/r2": makeNode(2, 46, 8),
    });
    const result = getDefaultRouteCoordinates({
      currentPage: { item: area, slug: "europe/france/crag" },
      getNode: () => undefined,
    });
    expect(result).toEqual({ lat: 45, lon: 7 });
  });

  it("falls back to ancestor coordinates when the current empty sector has none", () => {
    const emptySector = makeRelation(20);
    const parentCrag = makeRelation(10, { "europe/france/crag/sector": emptySector }, { lat: 47.5, lon: 7.5 });
    const nodes: Record<string, DataTree> = {
      "europe/france/crag": parentCrag,
      "europe/france/crag/sector": emptySector,
    };

    const result = getDefaultRouteCoordinates({
      currentPage: { item: emptySector, slug: "europe/france/crag/sector" },
      getNode: (s) => nodes[s],
    });
    expect(result).toEqual({ lat: 47.5, lon: 7.5 });
  });

  it("falls back to the target parent when the current page has no coordinates", () => {
    const root: DataTree = { feature: { type: "geographic", name: "World" } };
    const targetArea = makeRelation(10, {}, { lat: 42.1, lon: 1.9 });

    const result = getDefaultRouteCoordinates({
      currentPage: { item: root, slug: "" },
      fallbackParent: { item: targetArea, slug: "europe/andorra/crag" },
      getNode: () => undefined,
    });
    expect(result).toEqual({ lat: 42.1, lon: 1.9 });
  });
});
