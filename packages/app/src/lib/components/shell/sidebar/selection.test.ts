import { describe, expect, it } from "vitest";
import { computeRangeSelection } from "./selection.svelte.js";

describe("computeRangeSelection", () => {
  const ordered = ["a", "b", "c", "d", "e"];

  it("selects everything between anchor and target inclusive (forward and backward)", () => {
    expect(computeRangeSelection(ordered, "b", "d")).toEqual(["b", "c", "d"]);
    expect(computeRangeSelection(ordered, "d", "b")).toEqual(["b", "c", "d"]);
  });

  it("falls back to target only when anchor is missing or not visible", () => {
    expect(computeRangeSelection(ordered, undefined, "c")).toEqual(["c"]);
    expect(computeRangeSelection(ordered, "missing", "c")).toEqual(["c"]);
    expect(computeRangeSelection(ordered, "a", "unknown")).toEqual(["unknown"]);
  });
});
