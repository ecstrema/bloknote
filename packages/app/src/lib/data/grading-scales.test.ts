import { beforeEach, describe, expect, it } from "vitest";
import type { RouteScaleId } from "@bloknote/holy-grade";
import { gradingScales, isValidScaleId, storedScales } from "./grading-scales.svelte.js";

describe("storedScales", () => {
  it("returns undefined without an object", () => {
    expect(storedScales(null)).toBeUndefined();
    expect(storedScales("nope")).toBeUndefined();
  });

  it("drops unknown and mistyped scale ids from storage (issue #229)", () => {
    const parsed = storedScales({
      known: { route: ["French", "local", "Bogus", "FB"], boulder: ["Hueco", "French"], viaFerrata: ["Nope"] },
      preferred: { route: "local", boulder: "FB", viaFerrata: "Bogus" },
    });
    expect(parsed?.known).toEqual({ route: ["French"], boulder: ["Hueco"], viaFerrata: [] });
    expect(parsed?.preferred).toEqual({ boulder: "FB" });
  });
});

describe("isValidScaleId", () => {
  it("accepts only ids of a scale with the matching grade type", () => {
    expect(isValidScaleId("French", "route")).toBe(true);
    expect(isValidScaleId("FB", "boulder")).toBe(true);
    // A real scale id, but of the wrong type
    expect(isValidScaleId("French", "boulder")).toBe(false);
    expect(isValidScaleId("local" as RouteScaleId, "route")).toBe(false);
  });
});

describe("gradingScales.effective", () => {
  beforeEach(() => {
    gradingScales.setPreferred("route", undefined);
    gradingScales.setPreferred("boulder", undefined);
    gradingScales.setPreferred("viaFerrata", undefined);
  });

  it("falls back to the default scale instead of crashing on an unknown preferred id (issue #229)", () => {
    gradingScales.setPreferred("route", "local" as RouteScaleId);
    expect(gradingScales.effective("route")).toBe("French");
  });

  it("returns the default scales when nothing is set", () => {
    expect(gradingScales.effective("route")).toBe("French");
    expect(gradingScales.effective("boulder")).toBe("FB");
    expect(gradingScales.effective("viaFerrata")).toBe("Huesler");
  });
});