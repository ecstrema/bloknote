import { describe, expect, it } from "vitest";
import type { OsmFeature } from "osm-api";
import { getFeatureDiagnostics } from "./diagnostics.js";

function route(tags: Record<string, string>): OsmFeature {
  return { type: "node", id: 1, lat: 0, lon: 0, tags } as OsmFeature;
}

describe("getFeatureDiagnostics", () => {
  it("reports clean routes with no diagnostics", () => {
    const diags = getFeatureDiagnostics(
      route({ sport: "climbing", climbing: "route_bottom", name: "Action Directe", "climbing:grade:uiaa": "XI" }),
    );
    expect(diags).toEqual([]);
  });

  it("flags deprecated ele tag on routes and suggests moving to climbing:length", () => {
    const diags = getFeatureDiagnostics(
      route({ sport: "climbing", climbing: "route_bottom", name: "Tall Route", "climbing:grade:french": "6a", ele: "25 m" }),
    );
    const eleDiag = diags.find((d) => d.id === "deprecated:ele");
    expect(eleDiag).toBeDefined();
    expect(eleDiag!.fixes?.map((f) => f.patch)).toContainEqual({
      set: { "climbing:length": "25" },
      remove: ["ele"],
    });
    expect(eleDiag!.fixes?.map((f) => f.patch)).toContainEqual({ remove: ["ele"] });
  });

  it("flags multiple conflicting grade tags while allowing UK adjectival+technical pairs", () => {
    const conflict = getFeatureDiagnostics(
      route({
        sport: "climbing",
        climbing: "route_bottom",
        name: "Dual",
        "climbing:grade:french": "6a",
        "climbing:grade:yds": "5.10a",
      }),
    );
    expect(conflict.some((d) => d.id === "duplicate:grades")).toBe(true);

    const ukTrad = getFeatureDiagnostics(
      route({
        sport: "climbing",
        climbing: "route_bottom",
        name: "UK Trad",
        "climbing:grade:british_adjectival": "E1",
        "climbing:grade:british_technical": "5b",
      }),
    );
    expect(ukTrad.some((d) => d.id === "duplicate:grades")).toBe(false);
  });

  it("flags project routes that have a grade set", () => {
    const diags = getFeatureDiagnostics(
      route({
        sport: "climbing",
        climbing: "route_bottom",
        name: "Open Project",
        "climbing:grade:french": "8a",
      }),
    );
    const projectDiag = diags.find((d) => d.id === "conflict:project-grade");
    expect(projectDiag).toBeDefined();
    expect(projectDiag!.fixes?.[0]?.patch).toEqual({ remove: ["climbing:grade:french"] });
  });

  it("flags missing sport=climbing, missing name, missing grade, and invalid values", () => {
    const diags = getFeatureDiagnostics(
      route({ climbing: "route_bottom", "climbing:length": "not-a-number" }),
    );
    expect(diags.map((d) => d.id)).toEqual(
      expect.arrayContaining(["invalid:climbing:length", "missing:sport", "missing:name", "missing:grade"]),
    );
  });
});