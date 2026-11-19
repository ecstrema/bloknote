import { describe, expect, it } from "vitest";
import type { IndexNode } from "@bloknote/reverse-geocoding-data";
import { findCandidateRegionSlugs, pickBestRegionSlug } from "./region-locator.js";

const mockIndex: IndexNode = {
  _bbox: { x0: -180, x1: 180, y0: -90, y1: 90 },
  world: {
    _bbox: { x0: -180, x1: 180, y0: -90, y1: 90 },
    europe: {
      _bbox: { x0: -10, x1: 40, y0: 35, y1: 70 },
      france: {
        _bbox: { x0: -5, x1: 9, y0: 41, y1: 51 },
        "seine-et-marne": {
          _bbox: { x0: 2.3, x1: 3.5, y0: 48.1, y1: 49.1 },
        },
        essonne: {
          _bbox: { x0: 1.9, x1: 2.6, y0: 48.2, y1: 48.8 },
        },
      },
    },
  },
};

describe("region-locator", () => {
  it("finds matching leaf region slugs by bounding box", () => {
    expect(findCandidateRegionSlugs(mockIndex, 2.7, 48.4)).toEqual(["europe/france/seine-et-marne"]);
    expect(findCandidateRegionSlugs(mockIndex, 2.5, 48.4)).toEqual([
      "europe/france/seine-et-marne",
      "europe/france/essonne",
    ]);
    expect(findCandidateRegionSlugs(mockIndex, -70, 40)).toEqual([]);
  });

  it("prefers the current region on overlap and otherwise picks the smallest bbox", () => {
    const candidates = findCandidateRegionSlugs(mockIndex, 2.5, 48.4);
    expect(pickBestRegionSlug(candidates, mockIndex, "europe/france/seine-et-marne/fontainebleau")).toBe(
      "europe/france/seine-et-marne",
    );
    expect(pickBestRegionSlug(candidates, mockIndex)).toBe("europe/france/essonne");
  });
});
