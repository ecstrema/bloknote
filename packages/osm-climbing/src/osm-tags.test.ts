import { describe, expect, it } from "vitest";
import type { OsmFeature } from "osm-api";
import {
  areaClimbingValues,
  featureToTypeOSM,
  getClimbingStyles,
  getGrade,
  getLength,
  getPhone,
  getRelatedGradeScales,
  getTagRule,
  isProjectRoute,
  isViaFerrata,
  parseClimbingLength,
  routeClimbingValues,
  scaleIdToTag,
} from "./osm-tags";

function feature(tags: Record<string, string>): OsmFeature {
  return { type: "node", id: 1, lat: 0, lon: 0, tags } as OsmFeature;
}

/** Applies a value to a tag rule, skipping the deprecated-tag entries which are not callable */
function callRule(rule: ReturnType<typeof getTagRule>, value: string): boolean | undefined {
  return typeof rule === "function" ? rule(value) : undefined;
}

describe("featureToTypeOSM", () => {
  it.each([
    "route_bottom",
    "route_top",
    "route",
    "route_start",
    "abseil_route",
    "abseil",
    "toprope",
    "drytooling",
    "via_ferrata",
  ])("classifies climbing=%s as a route", (climbing) => {
    expect(featureToTypeOSM(feature({ climbing }))).toBe("route");
  });

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

  it("classifies highway=via_ferrata as a route", () => {
    expect(featureToTypeOSM(feature({ highway: "via_ferrata", name: "Via Ferrata" }))).toBe("route");
    expect(featureToTypeOSM(feature({ highway: "via_ferrata", climbing: "via_ferrata" }))).toBe("route");
  });

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

describe("sac_scale on via ferratas (issue #234)", () => {
  it("uses sac_scale as the written grade of a via ferrata", () => {
    expect(getGrade({ climbing: "via_ferrata", sac_scale: "T3" })).toEqual({
      v: { v: "T3", scale: "unknown" },
      source: "sac_scale",
    });
    expect(getGrade({ highway: "via_ferrata", sac_scale: "alpine_hiking" })).toMatchObject({
      v: { v: "alpine_hiking", scale: "unknown" },
      source: "sac_scale",
    });
  });

  it("keeps dedicated via ferrata grades ahead of sac_scale", () => {
    expect(getGrade({ climbing: "via_ferrata", via_ferrata_scale: "K3", sac_scale: "T3" })).toMatchObject({
      v: { scale: "Huesler" },
      source: "via_ferrata_scale",
    });
  });

  it("ignores sac_scale on non-via-ferrata features", () => {
    expect(getGrade({ climbing: "route", sac_scale: "T3" })).toBeUndefined();
  });

  it("recognizes sac_scale as a valid route tag", () => {
    const rule = getTagRule("route", "sac_scale");
    const accepts = (value: string) => (typeof rule === "function" ? rule(value) : false);
    expect(accepts("T3")).toBe(true);
    expect(accepts("t6")).toBe(true);
    expect(accepts("alpine_hiking")).toBe(true);
    expect(accepts("bananas")).toBe(false);
  });

  it("treats sac_scale as a via ferrata grade, not an element type indicator", () => {
    expect(isViaFerrata({ sac_scale: "T2" })).toBe(false);
    expect(isViaFerrata({ highway: "via_ferrata" })).toBe(true);
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

  it("marks recognized climbing tags as known on every feature type", () => {
    for (const featureType of ["route", "area", "gym"] as const) {
      expect(typeof getTagRule(featureType, "climbing:multipitch")).toBe("function");
      expect(typeof getTagRule(featureType, "climbing:rock")).toBe("function");
      expect(typeof getTagRule(featureType, "access")).toBe("function");
      expect(typeof getTagRule(featureType, "wikimedia_commons")).toBe("function");
    }
    // yes/no tags only accept those values
    expect(callRule(getTagRule("area", "climbing:summit_log"), "yes")).toBe(true);
    expect(callRule(getTagRule("area", "climbing:summit_log"), "sometimes")).toBe(false);
    // numeric tags only accept numbers
    expect(callRule(getTagRule("route", "climbing:bolts"), "12")).toBe(true);
    expect(callRule(getTagRule("route", "climbing:bolts"), "many")).toBe(false);
    // grade ranges carry plain grades of the same scale
    expect(callRule(getTagRule("route", "climbing:grade:french:min"), "6a")).toBe(true);
  });

  it("marks recognized tag prefix families as known", () => {
    expect(typeof getTagRule("area", "name:en")).toBe("function");
    expect(typeof getTagRule("area", "name:oc")).toBe("function");
    expect(typeof getTagRule("route", "climbing:url:thecrag")).toBe("function");
    expect(typeof getTagRule("area", "climbing:hazard:loose_rock")).toBe("function");
    expect(callRule(getTagRule("area", "climbing:hazard:loose_rock"), "no")).toBe(true);
    expect(typeof getTagRule("route", "climbing:inclination:slab")).toBe("function");
  });

  it("recognizes every climbing value used to type features", () => {
    for (const value of routeClimbingValues) {
      expect(callRule(getTagRule("route", "climbing"), value)).toBe(true);
    }
    for (const value of areaClimbingValues) {
      expect(callRule(getTagRule("area", "climbing"), value)).toBe(true);
    }
  });

  it("offers grading scales matching the climbing style", () => {
    expect(getRelatedGradeScales({ "climbing:boulder": "yes" }).map((s) => s.id)).toEqual(["FB", "Hueco"]);
    expect(getRelatedGradeScales({ "climbing:ice": "yes" }).map((s) => s.id)).toEqual(["WI", "Mixed", "DryTooling"]);
    expect(getRelatedGradeScales({ "climbing:aid": "yes" }).map((s) => s.id)).toEqual(["Aid"]);
    expect(getRelatedGradeScales({ "climbing:sport": "yes" }).map((s) => s.id)).toContain("French");
    expect(getRelatedGradeScales({ "climbing:sport": "yes" }).map((s) => s.id)).not.toContain("FB");
  });
});

describe("diagnostic whitelists", () => {
  it("accepts sport=via_ferrata, the legacy via ferrata tagging (issue #252)", () => {
    expect(callRule(getTagRule("route", "sport"), "via_ferrata")).toBe(true);
    expect(callRule(getTagRule("area", "sport"), "via_ferrata")).toBe(true);
    expect(featureToTypeOSM(feature({ sport: "via_ferrata" }))).toBe("route");
    expect(isViaFerrata({ sport: "via_ferrata" })).toBe(true);
  });

  it("accepts fee=donation (issue #250)", () => {
    expect(callRule(getTagRule("area", "fee"), "donation")).toBe(true);
    expect(callRule(getTagRule("area", "fee"), "maybe")).toBe(false);
  });

  it("accepts leisure=pitch (issue #248)", () => {
    expect(callRule(getTagRule("gym", "leisure"), "pitch")).toBe(true);
    expect(featureToTypeOSM(feature({ leisure: "pitch" }))).toBe("gym");
  });
});
