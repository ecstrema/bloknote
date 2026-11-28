import { describe, expect, it } from "bun:test";
import {
  changesetItemXml,
  describeChanges,
  describeClimbingFeature,
  describeGeometryChange,
  describeTagChanges,
  escapeXml,
  isRecentItem,
  renderRssFeed,
  RSS_ELEMENTS_PER_POST,
  RSS_MAX_ITEMS,
  type ChangesetEntry,
} from "./rss.ts";
import type { OsmFeature } from "osm-api";

const NOW = Date.parse("2026-11-23T12:00:00Z");

function feature(overrides: Partial<OsmFeature> & { id: number }): OsmFeature {
  return { type: "node", lat: 48.4, lon: 2.6, ...overrides } as OsmFeature;
}

function entry(overrides: Partial<OsmFeature> & { id: number }, slug = "world/x", path = "X"): ChangesetEntry {
  return { feature: feature(overrides), slug, path };
}

describe("rss", () => {
  it("escapes XML special characters", () => {
    expect(escapeXml(`A & B < "C" > 'D'`)).toBe("A &amp; B &lt; &quot;C&quot; &gt; &apos;D&apos;");
  });

  it("describes climbing features from their tags", () => {
    expect(describeClimbingFeature(feature({ id: 1, tags: { climbing: "route_bottom", name: "X" } }))).toBe("Route");
    expect(describeClimbingFeature(feature({ id: 2, tags: { climbing: "crag", name: "X" } }))).toBe("Crag");
    expect(describeClimbingFeature(feature({ id: 3, tags: { climbing: "boulder", name: "X" } }))).toBe("Boulder");
    expect(describeClimbingFeature(feature({ id: 4, tags: { natural: "cliff", name: "X" } }))).toBe("Cliff");
    expect(describeClimbingFeature(feature({ id: 5, tags: { name: "X" } }))).toBe("Climbing feature");
  });

  it("groups the elements of one changeset into a single post (issue #281)", () => {
    const item = changesetItemXml(
      12345,
      [
        entry(
          {
            id: 1,
            version: 1,
            timestamp: "2026-11-20T10:00:00Z",
            user: "Alice",
            tags: { climbing: "route_bottom", name: "La Marie Rose" },
          },
          "world/europe/france/la-marie-rose",
          "Île-de-France > France > Europe",
        ),
        entry(
          {
            id: 2,
            version: 3,
            timestamp: "2026-11-20T10:05:00Z",
            user: "Alice",
            tags: { climbing: "crag", name: "Bas Cuvier" },
          },
          "world/europe/france/bas-cuvier",
          "Île-de-France > France > Europe",
        ),
      ],
      NOW,
    )!;
    // One item for the whole changeset, not one per element
    expect(item.slugs).toEqual(["europe/france/la-marie-rose", "europe/france/bas-cuvier"]);
    expect(item.xml).toContain("<title>Alice created 1 route and updated 1 crag</title>");
    expect(item.xml).toContain('isPermaLink="false">osm-changeset-12345<');
    expect(item.xml).toContain("<link>https://www.openstreetmap.org/changeset/12345</link>");
    expect(item.xml).toContain("Fri, 20 Nov 2026 10:05:00 GMT");
    expect(item.xml).toContain("changed 2 climbing elements (1 created, 1 modified) on 2026-11-20");
    expect(item.xml).toContain("changeset 12345");
    // Both elements are listed with their full path
    expect(item.xml).toContain("La Marie Rose");
    expect(item.xml).toContain("Bas Cuvier");
    // The path separator is escaped once for the HTML and once for the XML description
    expect(item.xml).toContain("Île-de-France &amp;gt; France &amp;gt; Europe");
  });

  it("credits the contributor and falls back to the element without a changeset id", () => {
    const item = changesetItemXml(
      1,
      [entry({ id: 1, version: 2, timestamp: "2026-11-20T10:00:00Z", user: "Jérôme", tags: { name: "X" } })],
      NOW,
    )!;
    expect(item.xml).toContain("<title>Jérôme updated 1 climbing feature</title>");
    const anonymous = changesetItemXml(
      undefined,
      [entry({ id: 1, version: 1, timestamp: "2026-11-20T10:00:00Z", tags: { name: "X" } })],
      NOW,
    )!;
    expect(anonymous.xml).toContain("<title>An anonymous editor created 1 climbing feature</title>");
    // Without a changeset id, the post falls back to the element itself
    expect(anonymous.xml).toContain('isPermaLink="false">osm-node-1-v1<');
    expect(anonymous.xml).toContain("<link>https://www.openstreetmap.org/node/1</link>");
    expect(anonymous.xml).not.toContain("changeset");
  });

  it("lists the elements with kind, grade and change summary", () => {
    const item = changesetItemXml(
      7,
      [
        entry({
          id: 1,
          version: 4,
          timestamp: "2026-11-20T10:00:00Z",
          user: "Bob",
          tags: { climbing: "crag", name: "New", "climbing:grade:french": "6a" },
        }),
      ],
      NOW,
    )!;
    expect(item.xml).toContain("Crag graded 6a");
    // Change summary comes from the previous version diff (issue #222)
    const withChanges = changesetItemXml(
      7,
      [
        {
          ...entry({
            id: 1,
            version: 4,
            timestamp: "2026-11-20T10:00:00Z",
            user: "Bob",
            tags: { climbing: "crag", name: "New" },
          }),
          changes: describeChanges(
            feature({ id: 1, version: 3, tags: { climbing: "crag", name: "Old" } }),
            feature({ id: 1, version: 4, tags: { climbing: "crag", name: "New" } }),
          ),
        },
      ],
      NOW,
    )!;
    expect(withChanges.xml).toContain(`changed name from “Old” to “New”`);
  });

  it("includes Wikimedia Commons photos of the changed elements", () => {
    const item = changesetItemXml(
      1,
      [
        entry({
          id: 1,
          version: 1,
          timestamp: "2026-11-20T10:00:00Z",
          tags: { name: "Bas Cuvier", wikimedia_commons: "File:Bas Cuvier.jpg" },
        }),
      ],
      NOW,
    )!;
    expect(item.xml).toContain("https://commons.wikimedia.org/wiki/Special:FilePath/File:Bas%20Cuvier.jpg?width=480");
    expect(item.xml).toContain("https://commons.wikimedia.org/wiki/File:Bas%20Cuvier.jpg");
    expect(item.xml).toContain("Photo of Bas Cuvier");
    // Multiple files and percent-encoded titles
    const multi = changesetItemXml(
      1,
      [
        entry({
          id: 1,
          version: 1,
          timestamp: "2026-11-20T10:00:00Z",
          tags: { name: "X", wikimedia_commons: "File:A.jpg;File:B & C.png" },
        }),
      ],
      NOW,
    )!;
    expect(multi.xml).toContain("A.jpg");
    expect(multi.xml).toContain("Special:FilePath/File:B%20%26%20C.png");
    const none = changesetItemXml(
      1,
      [entry({ id: 1, version: 1, timestamp: "2026-11-20T10:00:00Z", tags: { name: "X" } })],
      NOW,
    )!;
    expect(none.xml).not.toContain("commons.wikimedia.org");
  });

  it("skips empty groups and changesets older than the recent window", () => {
    expect(changesetItemXml(1, [], NOW)).toBeUndefined();
    expect(
      changesetItemXml(1, [entry({ id: 1, timestamp: "2020-01-01T10:00:00Z", tags: { name: "X" } })], NOW),
    ).toBeUndefined();
  });

  it("truncates long element lists", () => {
    const entries = Array.from({ length: RSS_ELEMENTS_PER_POST + 3 }, (_, i) =>
      entry({ id: i, version: 1, timestamp: "2026-11-20T10:00:00Z", tags: { name: `Element ${i}` } }),
    );
    const item = changesetItemXml(1, entries, NOW)!;
    expect(item.xml).toContain(`Element ${RSS_ELEMENTS_PER_POST - 1}`);
    expect(item.xml).not.toContain(`Element ${RSS_ELEMENTS_PER_POST}`);
    expect(item.xml).toContain("and 3 more elements");
  });

  it("renders a full feed document", () => {
    const item = changesetItemXml(
      7,
      [
        entry(
          {
            id: 7,
            version: 2,
            timestamp: "2026-11-21T10:00:00Z",
            tags: { climbing: "route_bottom", name: "La Marie Rose" },
          },
          "world/europe/france/la-marie-rose",
        ),
      ],
      NOW,
    )!;
    const feed = renderRssFeed({ title: "France", slug: "world/europe/france", items: [item] });
    expect(feed).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(feed).toContain('<rss version="2.0">');
    expect(feed).toContain("<title>France</title>");
    expect(feed).toContain("Recently added or edited climbing routes and crags in France");
    expect(feed).toContain(item.xml);
    expect(feed.endsWith("</rss>\n")).toBe(true);
  });

  it("caps the number of items per feed", () => {
    expect(RSS_MAX_ITEMS).toBeGreaterThan(0);
  });

  it("keeps only recent named elements in the feeds", () => {
    expect(isRecentItem(feature({ id: 1, timestamp: "2026-11-20T10:00:00Z" }), NOW)).toBe(false);
    expect(isRecentItem(feature({ id: 1, tags: { name: "X" } }), NOW)).toBe(false);
    expect(isRecentItem(feature({ id: 1, timestamp: "2020-01-01T10:00:00Z", tags: { name: "X" } }), NOW)).toBe(false);
    expect(isRecentItem(feature({ id: 1, timestamp: "2026-11-10T10:00:00Z", tags: { name: "X" } }), NOW)).toBe(true);
  });

  it("summarizes tag changes between two versions (issue #222)", () => {
    expect(
      describeTagChanges(
        feature({ id: 1, tags: { name: "Old Name", "climbing:grade:french": "6a" } }),
        feature({ id: 1, tags: { name: "New Name", "climbing:grade:french": "6a" } }),
      ),
    ).toBe(`changed name from “Old Name” to “New Name”`);
    expect(
      describeTagChanges(
        feature({ id: 1, tags: { name: "X" } }),
        feature({ id: 1, tags: { name: "X", "climbing:grade:french": "7a", description: "Nice" } }),
      ),
    ).toBe(`set climbing:grade:french to “7a”, set description to “Nice”`);
    expect(
      describeTagChanges(
        feature({ id: 1, tags: { name: "X", description: "Old" } }),
        feature({ id: 1, tags: { name: "X" } }),
      ),
    ).toBe("removed description");
    expect(describeTagChanges(feature({ id: 1, tags: { name: "X" } }), feature({ id: 1, tags: { name: "X" } }))).toBe(
      undefined,
    );
    // More than four changes are truncated
    expect(
      describeTagChanges(
        feature({ id: 1, tags: {} }),
        feature({ id: 1, tags: { a: "1", b: "2", c: "3", d: "4", e: "5" } as unknown as OsmFeature["tags"] }),
      ),
    ).toBe(`set a to “1”, set b to “2”, set c to “3”, set d to “4”, and 1 more tags`);
  });

  it("summarizes geometry changes between two versions (issue #222)", () => {
    expect(
      describeGeometryChange(feature({ id: 1, lat: 48.4, lon: 2.6 }), feature({ id: 1, lat: 48.4001, lon: 2.6 })),
    ).toBe("moved 11 m");
    expect(
      describeGeometryChange(feature({ id: 1, lat: 48.4, lon: 2.6 }), feature({ id: 1, lat: 48.4, lon: 2.6 })),
    ).toBe(undefined);
    expect(
      describeGeometryChange(
        { type: "way", id: 1, nodes: [1, 2, 3] } as OsmFeature,
        { type: "way", id: 1, nodes: [1, 2, 4] } as OsmFeature,
      ),
    ).toBe("node list changed");
  });
});
