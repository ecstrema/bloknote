import { describe, expect, it } from "vitest";
import {
  commonsImageKey,
  findMatchingImageTag,
  findNextImageTagKey,
  formatPath,
  getImagesFromTags,
  normalizeCommonsTitle,
  parsePath,
} from "./topo-helpers.js";

describe("topo-helpers", () => {
  it("normalizes commons titles and URLs", () => {
    expect(normalizeCommonsTitle("https://commons.wikimedia.org/wiki/File:My_Crag.jpg")).toBe("File:My Crag.jpg");
    expect(commonsImageKey("File:My_Crag.jpg")).toBe(commonsImageKey("file:My Crag.jpg"));
  });

  it("extracts, matches, and increments image keys", () => {
    const tags = {
      wikimedia_commons: "File:Crag_A.jpg",
      "wikimedia_commons:path": "0.100,0.900|0.200,0.500A",
      "wikimedia_commons:1": "File:Crag_B.jpg",
    };
    const images = getImagesFromTags(tags);
    expect(images).toHaveLength(2);
    expect(images[0]!.key).toBe("wikimedia_commons");
    expect(images[1]!.key).toBe("wikimedia_commons:1");
    expect(findMatchingImageTag(tags, "file:Crag B.jpg")?.key).toBe("wikimedia_commons:1");
    expect(findNextImageTagKey(tags)).toBe("wikimedia_commons:2");
    expect(findNextImageTagKey({})).toBe("wikimedia_commons");
  });

  it("parses and formats route paths", () => {
    const raw = "0.100,0.900|0.500,0.500B:|0.600,0.200A";
    const parsed = parsePath(raw);
    expect(parsed).toEqual([
      { x: 0.1, y: 0.9, marker: "", dottedAfter: false },
      { x: 0.5, y: 0.5, marker: "B", dottedAfter: true },
      { x: 0.6, y: 0.2, marker: "A", dottedAfter: false },
    ]);
    expect(formatPath(parsed)).toBe(raw);
    expect(parsePath("2.0,0.5")).toEqual([]);
  });
});
