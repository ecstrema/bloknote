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
      route({
        sport: "climbing",
        climbing: "route_bottom",
        name: "Tall Route",
        "climbing:grade:french": "6a",
        ele: "25 m",
      }),
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
    const diags = getFeatureDiagnostics(route({ climbing: "route_bottom", "climbing:length": "not-a-number" }));
    expect(diags.map((d) => d.id)).toEqual(
      expect.arrayContaining(["invalid:climbing:length", "missing:sport", "missing:name", "missing:grade"]),
    );
  });

  it("flags climbing=crag containing sub-areas and suggests changing to climbing=area", () => {
    const crag = {
      type: "relation",
      id: 10,
      members: [],
      tags: { sport: "climbing", climbing: "crag", name: "Big" },
    } as unknown as OsmFeature;
    const subArea = {
      type: "node",
      id: 11,
      lat: 0,
      lon: 0,
      tags: { sport: "climbing", climbing: "crag", name: "Sub" },
    } as unknown as OsmFeature;
    const diags = getFeatureDiagnostics(crag, [subArea]);
    const diag = diags.find((d) => d.id === "crag:has-subareas");
    expect(diag).toBeDefined();
    expect(diag!.fixes?.[0]?.patch).toEqual({ set: { climbing: "area" } });
  });

  it("flags routes referencing both a bottom and a top point in the same parent (issue #135)", () => {
    const crag = {
      type: "relation",
      id: 10,
      members: [],
      tags: { sport: "climbing", climbing: "area", name: "Crag" },
    } as unknown as OsmFeature;
    const bottom = {
      type: "node",
      id: 11,
      lat: 0,
      lon: 0,
      tags: { sport: "climbing", climbing: "route_bottom", name: "Transit" },
    } as unknown as OsmFeature;
    const top = {
      type: "node",
      id: 12,
      lat: 1,
      lon: 1,
      tags: { sport: "climbing", climbing: "route_top", name: "Transit" },
    } as unknown as OsmFeature;

    const both = getFeatureDiagnostics(crag, [bottom, top]);
    const diag = both.find((d) => d.id === "duplicate:route-parts:transit");
    expect(diag).toBeDefined();
    expect(diag!.severity).toBe("warning");

    // Only the bottom is referenced: no diagnostic
    expect(getFeatureDiagnostics(crag, [bottom]).some((d) => d.id.startsWith("duplicate:route-parts"))).toBe(false);
  });

  it("flags useless default-valued tags such as deepwater=no (issue #233)", () => {
    const diags = getFeatureDiagnostics(
      route({
        sport: "climbing",
        climbing: "route_bottom",
        name: "DWS",
        "climbing:grade:french": "6a",
        deepwater: "no",
      }),
    );
    const diag = diags.find((d) => d.id === "useless:deepwater");
    expect(diag).toBeDefined();
    expect(diag!.severity).toBe("warning");
    expect(diag!.fixes?.[0]?.patch).toEqual({ remove: ["deepwater"] });

    // Any other value is meaningful: no diagnostic
    expect(
      getFeatureDiagnostics(route({ sport: "climbing", climbing: "route_bottom", deepwater: "yes" })).some(
        (d) => d.id === "useless:deepwater",
      ),
    ).toBe(false);
  });

  it("does not flag missing sport=climbing on highway=via_ferrata (issue #251)", () => {
    const diags = getFeatureDiagnostics(
      route({ highway: "via_ferrata", name: "Via Ferrata", sac_scale: "alpine_hiking" }),
    );
    expect(diags.some((d) => d.id === "missing:sport")).toBe(false);
  });

  it("still flags missing sport=climbing on regular routes", () => {
    const diags = getFeatureDiagnostics(route({ climbing: "route_bottom", name: "Route" }));
    expect(diags.some((d) => d.id === "missing:sport")).toBe(true);
  });

  it("does not flag a missing name on children playground=climbingwall (issue #258)", () => {
    const diags = getFeatureDiagnostics(route({ sport: "climbing", playground: "climbingwall" }));
    expect(diags.some((d) => d.id === "missing:name")).toBe(false);

    // Named walls, and other unnamed features, still get the warning
    expect(getFeatureDiagnostics(route({ sport: "climbing", playground: "climbingwall", name: "Wall" })).length).toBe(0);
    expect(getFeatureDiagnostics(route({ sport: "climbing", climbing: "indoor_wall" })).some((d) => d.id === "missing:name")).toBe(
      true,
    );
  });

  it("flags duplicate email tags and suggests keeping one (issue #249)", () => {
    const diags = getFeatureDiagnostics(
      route({
        sport: "climbing",
        climbing: "indoor_wall",
        name: "Gym",
        email: "a@gym.com",
        "contact:email": "b@gym.com",
      }),
    );
    const diag = diags.find((d) => d.id === "duplicate:email");
    expect(diag).toBeDefined();
    expect(diag!.fixes?.map((f) => f.patch)).toContainEqual({ remove: ["contact:email"] });

    // A single email tag is fine
    expect(
      getFeatureDiagnostics(
        route({ sport: "climbing", climbing: "indoor_wall", name: "Gym", email: "a@gym.com" }),
      ).some((d) => d.id === "duplicate:email"),
    ).toBe(false);
  });
});
