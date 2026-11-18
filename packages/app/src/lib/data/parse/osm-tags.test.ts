import { describe, expect, it } from "vitest";
import type { OsmFeature } from "osm-api";
import {
  featureToTypeOSM,
  getClimbingStyles,
  getGrade,
  getLength,
  getPhone,
  getRelatedGradeScales,
  getTagRule,
  isProjectRoute,
  parseClimbingLength,
  scaleIdToTag,
} from "./osm-tags";

function feature(tags: Record<string, string>): OsmFeature {
  return { type: "node", id: 1, lat: 0, lon: 0, tags } as OsmFeature;
}

describe("featureToTypeOSM", () => {
  it.each(["route_bottom", "route_top", "route", "route_start", "abseil_route", "abseil", "toprope", "drytooling"])(
    "classifies climbing=%s as a route",
    (climbing) => {
      expect(featureToTypeOSM(feature({ climbing }))).toBe("route");
    },
  );

  it.each(["boulder", "bouldering"])("classifies climbing=%s as an area", (climbing) => {
    expect(featureToTypeOSM(feature({ climbing }))).toBe("area");
  });

  it("prefers route classification for mixed route and boulder values", () => {
    expect(featureToTypeOSM(feature({ climbing: "route; boulder" }))).toBe("route");
  });

  it.each(["sports_centre", "sports_hall", "fitness_centre", "sport_centre"])(
    "classifies sport=climbing at leisure=%s as a gym",
    (leisure) => {
      expect(featureToTypeOSM(feature({ leisure, sport: "climbing" }))).toBe("gym");
    },
  );

  it("classifies leisure=pitch as a gym", () => {
    expect(featureToTypeOSM(feature({ leisure: "pitch" }))).toBe("gym");
  });

  it("classifies other climbing sport features as areas", () => {
    expect(featureToTypeOSM(feature({ sport: "climbing" }))).toBe("area");
  });

  it("keeps non-climbing features unclassified", () => {
    expect(featureToTypeOSM(feature({ sport: "hiking" }))).toBeUndefined();
  });
});

describe("climbing grades", () => {
  it.each([
    ["climbing:grade:saxon", "VIIb", "Saxon"],
    ["climbing:grade:norwegian", "6+", "Scandinavian"],
    ["climbing:grade:british_adjectival", "E2", "UKAdj"],
    ["climbing:grade:british_technical", "6a", "UKTech"],
    ["climbing:grade:ewbank", "25", "Ewbank"],
    ["climbing:grade:polish", "VI.2", "Polish"],
    ["climbing:grade:ice", "WI4", "WI"],
    ["climbing:grade:mixed", "M7", "Mixed"],
    ["climbing:grade:dry", "D6", "DryTooling"],
    ["climbing:grade:aid", "A2", "Aid"],
  ])("maps %s to its grading scale", (key, value, scale) => {
    expect(getGrade({ [key]: value })).toMatchObject({ v: { scale } });
  });

  it.each([
    ["Saxon", "climbing:grade:saxon"],
    ["Scandinavian", "climbing:grade:norwegian"],
    ["Ewbank", "climbing:grade:ewbank"],
    ["Polish", "climbing:grade:polish"],
  ] as const)("maps scale %s to %s", (scale, key) => {
    expect(scaleIdToTag(scale)).toBe(key);
  });
});

describe("climbing styles", () => {
  it("returns enabled styles and route counts while ignoring no values", () => {
    expect(
      getClimbingStyles({
        "climbing:sport": "yes",
        "climbing:trad": "2",
        "climbing:ice": "no",
      }),
    ).toEqual([
      { key: "sport", label: "Sport", count: undefined },
      { key: "trad", label: "Trad", count: 2 },
    ]);
  });
});

describe("climbing lengths", () => {
  it("converts an unsupported feet value to meters for display", () => {
    expect(parseClimbingLength("100'")).toEqual({ meters: 30.48, sourceUnit: "feet" });
    expect(getLength({ "climbing:length": "100'" })).toBe(30.48);
  });

  it("accepts meter values and common feet spellings", () => {
    expect(parseClimbingLength("12.5 m")).toEqual({ meters: 12.5, sourceUnit: "meters" });
    expect(parseClimbingLength("100 ft")).toEqual({ meters: 30.48, sourceUnit: "feet" });
    expect(parseClimbingLength("unknown")).toBeUndefined();
  });
});

describe("gym phone numbers", () => {
  it("prefers phone and falls back to contact:phone", () => {
    expect(getPhone({ phone: "+1 555 0100", "contact:phone": "+1 555 0200" })).toBe("+1 555 0100");
    expect(getPhone({ "contact:phone": "+1 555 0200" })).toBe("+1 555 0200");
  });
});

describe("isProjectRoute", () => {
  it("detects routes with 'project' or variations in name", () => {
    expect(isProjectRoute({ name: "Project" })).toBe(true);
    expect(isProjectRoute({ name: "The Big Project" })).toBe(true);
    expect(isProjectRoute({ name: "Open Projet" })).toBe(true);
    expect(isProjectRoute({ name: "Projekt 1" })).toBe(true);
    expect(isProjectRoute({ name: "Progetto 5" })).toBe(true);
  });

  it("returns false for regular names or undefined", () => {
    expect(isProjectRoute(undefined)).toBe(false);
    expect(isProjectRoute({ name: "Action Directe" })).toBe(false);
    expect(isProjectRoute({ name: "Projection" })).toBe(false);
  });
});

describe("deprecated tags in processedTags / getTagRule", () => {
  it("marks ele and ele:* tags as deprecated with guidance on routes and areas", () => {
    const routeEle = getTagRule("route", "ele");
    expect(routeEle).toEqual({
      deprecated: expect.stringContaining("climbing:length"),
    });
    expect(getTagRule("route", "ele:ft")).toEqual(routeEle);

    const areaEle = getTagRule("area", "ele");
    expect(areaEle).toEqual({
      deprecated: expect.stringContaining("discouraged"),
    });
    expect(getTagRule("gym", "ele:source")).toEqual(areaEle);
  });

  it("keeps regular validators and unknown tags unaffected", () => {
    expect(typeof getTagRule("route", "name")).toBe("function");
    expect(typeof getTagRule("route", "description:fr")).toBe("function");
    expect(typeof getTagRule("gym", "opening_hours")).toBe("function");
    expect(typeof getTagRule("route", "climbing:length")).toBe("function");
    expect(getTagRule("route", "element" as any)).toBeUndefined();
    expect(getTagRule(undefined, "ele")).toBeUndefined();
  });

  it("offers grading scales matching the climbing style", () => {
    expect(getRelatedGradeScales({ "climbing:boulder": "yes" }).map((s) => s.id)).toEqual(["FB", "Hueco"]);
    expect(getRelatedGradeScales({ "climbing:ice": "yes" }).map((s) => s.id)).toEqual(["WI", "Mixed", "DryTooling"]);
    expect(getRelatedGradeScales({ "climbing:aid": "yes" }).map((s) => s.id)).toEqual(["Aid"]);
    expect(getRelatedGradeScales({ "climbing:sport": "yes" }).map((s) => s.id)).toContain("French");
    expect(getRelatedGradeScales({ "climbing:sport": "yes" }).map((s) => s.id)).not.toContain("FB");
  });
});
