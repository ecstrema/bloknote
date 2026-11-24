import { describe, expect, it } from "vitest";
import type { DataJSON } from "@bloknote/climbing-data-gen";
import { findDuplicatedRoutePartNames, findRoutePartPairs, routeCompanionsBySlug } from "./route-parts.js";

function node(id: number, tags: Record<string, string>): DataJSON {
  return { type: "node", id, lat: 0, lon: 0, tags } as DataJSON;
}

describe("findRoutePartPairs", () => {
  it("pairs bottom and top nodes that share the same name", () => {
    const children = {
      "a/alpha": node(1, { climbing: "route_bottom", name: "Alpha" }),
      "a/alpha-top": node(2, { climbing: "route_top", name: "Alpha" }),
      "a/beta": node(3, { climbing: "route_bottom", name: "Beta" }),
    };
    expect(findRoutePartPairs(children)).toEqual([{ bottomSlug: "a/alpha", topSlug: "a/alpha-top" }]);
  });

  it("maps companions in both directions", () => {
    const children = {
      bottom: node(1, { climbing: "route_bottom", name: "Alpha" }),
      top: node(2, { climbing: "route_top", name: "Alpha" }),
    };
    const companions = routeCompanionsBySlug(findRoutePartPairs(children));
    expect(companions.get("bottom")).toBe("top");
    expect(companions.get("top")).toBe("bottom");
  });

  it("ignores unnamed parts and parts without a counterpart", () => {
    const children = {
      unnamedBottom: node(1, { climbing: "route_bottom" }),
      lonelyTop: node(2, { climbing: "route_top", name: "Lonely" }),
      plain: node(3, { climbing: "route", name: "Plain" }),
    };
    expect(findRoutePartPairs(children)).toEqual([]);
  });

  it("matches names case-insensitively and trims whitespace", () => {
    const children = {
      bottom: node(1, { climbing: "route_bottom", name: "  TranSit  " }),
      top: node(2, { climbing: "route_top", name: "transit" }),
    };
    expect(findRoutePartPairs(children)).toEqual([{ bottomSlug: "bottom", topSlug: "top" }]);
  });
});

describe("findDuplicatedRoutePartNames", () => {
  it("lists names referenced with both a bottom and a top in the same parent", () => {
    const children = [
      node(1, { climbing: "route_bottom", name: "Alpha" }),
      node(2, { climbing: "route_top", name: "Alpha" }),
      node(3, { climbing: "route_bottom", name: "Beta" }),
    ] as unknown as Parameters<typeof findDuplicatedRoutePartNames>[0];
    expect(findDuplicatedRoutePartNames(children)).toEqual(["Alpha"]);
  });
});
