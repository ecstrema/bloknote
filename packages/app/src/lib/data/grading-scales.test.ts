import { beforeEach, describe, expect, it } from "vitest";
import type { SettingsRecord } from "@bloknote/common";
import type { RouteScaleId } from "@bloknote/holy-grade";
import { gradingScales, isValidScaleId, storedScales } from "./grading-scales.svelte.js";
import { hasScaleFields, recordToScales, scalesToRecordFields } from "./grading-scale-record.js";

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

describe("grading-scale record mapping (issue #238)", () => {
  it("round-trips preferences through the settings record fields", () => {
    const fields = scalesToRecordFields({
      known: { route: ["French", "YDS"], boulder: [], viaFerrata: ["Schall"] },
      preferred: { boulder: "FB" },
    } as never);
    expect(fields.knownRouteScales).toEqual(["French", "YDS"]);
    expect(fields.knownBoulderScales).toEqual([]);
    expect(fields.knownViaFerrataScales).toEqual(["Schall"]);
    expect(fields.preferredBoulderScale).toBe("FB");
    // Unset preferences are dropped from the JSON written to the PDS, clearing them remotely
    expect(JSON.parse(JSON.stringify(fields))).not.toHaveProperty("preferredRouteScale");
    const scales = storedScales(recordToScales(fields as SettingsRecord));
    expect(scales?.known).toEqual({ route: ["French", "YDS"], boulder: [], viaFerrata: ["Schall"] });
    expect(scales?.preferred).toEqual({ boulder: "FB" });
  });

  it("detects records without any scale field (created before issue #238)", () => {
    expect(hasScaleFields({ mode: "dark" } as SettingsRecord)).toBe(false);
    expect(hasScaleFields({ knownRouteScales: [] } as SettingsRecord)).toBe(false);
    expect(hasScaleFields({ preferredBoulderScale: "FB" } as SettingsRecord)).toBe(true);
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