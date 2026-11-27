import { describe, expect, it } from "vitest";
import { formatTagFilter, parseTagFilter } from "./tag-filter.js";

describe("parseTagFilter", () => {
  it("parses bare keys as presence checks", () => {
    expect(parseTagFilter("climbing:rock")).toEqual({ key: "climbing:rock", value: "" });
    expect(parseTagFilter("  climbing:rock  ")).toEqual({ key: "climbing:rock", value: "" });
  });

  it("parses comparison expressions (issue #236)", () => {
    expect(parseTagFilter("climbing:length>40")).toEqual({ key: "climbing:length", op: ">", value: "40" });
    expect(parseTagFilter("climbing:length>=30")).toEqual({ key: "climbing:length", op: ">=", value: "30" });
    expect(parseTagFilter("climbing:length<20")).toEqual({ key: "climbing:length", op: "<", value: "20" });
    expect(parseTagFilter("climbing:pitches<=2")).toEqual({ key: "climbing:pitches", op: "<=", value: "2" });
    expect(parseTagFilter("climbing:rock!=sandstone")).toEqual({ key: "climbing:rock", op: "!=", value: "sandstone" });
    expect(parseTagFilter("name~crag")).toEqual({ key: "name", op: "~", value: "crag" });
    expect(parseTagFilter("climbing:rock=sandstone")).toEqual({ key: "climbing:rock", op: "=", value: "sandstone" });
  });

  it("keeps later operators in the value", () => {
    expect(parseTagFilter("name=a=b")).toEqual({ key: "name", op: "=", value: "a=b" });
  });

  it("returns undefined without a key", () => {
    expect(parseTagFilter("")).toBeUndefined();
    expect(parseTagFilter(">40")).toBeUndefined();
  });
});

describe("formatTagFilter", () => {
  it("renders the expression form", () => {
    expect(formatTagFilter({ key: "climbing:rock", value: "" })).toBe("climbing:rock");
    expect(formatTagFilter({ key: "climbing:length", op: ">", value: "40" })).toBe("climbing:length>40");
    expect(formatTagFilter({ key: "name", value: "Céüse" })).toBe("name=Céüse");
  });
});
