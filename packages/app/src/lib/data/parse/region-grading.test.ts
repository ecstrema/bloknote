import { describe, expect, it } from "vitest";
import { getDefaultGradingScales } from "./region-grading.js";

describe("getDefaultGradingScales", () => {
  it("picks regional route and boulder grading schemes by geographic hierarchy", () => {
    expect(getDefaultGradingScales("americas/north/canada/quebec/estrie")).toEqual({ route: "YDS", boulder: "Hueco" });
    expect(getDefaultGradingScales("europe/france/ile-de-france")).toEqual({ route: "French", boulder: "FB" });
    expect(getDefaultGradingScales("europe/germany/bavaria")).toEqual({ route: "UIAA", boulder: "FB" });
    expect(getDefaultGradingScales("europe/united-kingdom/england")).toEqual({ route: "UKTech", boulder: "FB" });
    expect(getDefaultGradingScales("oceania/australia/victoria")).toEqual({ route: "Ewbank", boulder: "Hueco" });
    expect(getDefaultGradingScales("")).toEqual({ route: "French", boulder: "FB" });
  });
});
