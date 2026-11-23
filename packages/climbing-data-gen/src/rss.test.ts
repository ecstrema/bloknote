import { describe, expect, it } from "bun:test";
import { describeClimbingFeature, escapeXml, recentItemXml, renderRssFeed, RSS_MAX_ITEMS } from "./rss.ts";
import type { OsmFeature } from "osm-api";

const NOW = Date.parse("2026-11-23T12:00:00Z");

function feature(overrides: Partial<OsmFeature> & { id: number }): OsmFeature {
  return { type: "node", lat: 48.4, lon: 2.6, ...overrides } as OsmFeature;
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

  it("renders an item for a recent named element", () => {
    const item = recentItemXml(
      feature({ id: 42, version: 3, timestamp: "2026-11-20T10:00:00Z", tags: { climbing: "crag", name: "Bas Cuvier" } }),
      "world/europe/france/bas-cuvier",
      NOW,
    );
    expect(item).toBeDefined();
    expect(item!.xml).toContain("<title>Bas Cuvier — Crag</title>");
    expect(item!.xml).toContain("world/europe/france/bas-cuvier");
    expect(item!.xml).toContain('isPermaLink="false">osm-node-42-v3<');
    expect(item!.xml).toContain("Fri, 20 Nov 2026 10:00:00 GMT");
  });

  it("skips unnamed, timestamp-less, and stale elements", () => {
    expect(recentItemXml(feature({ id: 1, timestamp: "2026-11-20T10:00:00Z" }), "world/x", NOW)).toBeUndefined();
    expect(recentItemXml(feature({ id: 1, tags: { name: "X" } }), "world/x", NOW)).toBeUndefined();
    expect(
      recentItemXml(feature({ id: 1, timestamp: "2020-01-01T10:00:00Z", tags: { name: "X" } }), "world/x", NOW),
    ).toBeUndefined();
    expect(
      recentItemXml(feature({ id: 1, timestamp: "2026-11-10T10:00:00Z", tags: { name: "X" } }), "world/x", NOW),
    ).toBeDefined();
  });

  it("renders a full feed document", () => {
    const item = recentItemXml(
      feature({ id: 7, timestamp: "2026-11-21T10:00:00Z", tags: { climbing: "route_bottom", name: "La Marie Rose" } }),
      "world/europe/france/la-marie-rose",
      NOW,
    )!;
    const feed = renderRssFeed({ title: "France", slug: "world/europe/france", items: [item] });
    expect(feed).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(feed).toContain("<rss version=\"2.0\">");
    expect(feed).toContain("<title>France</title>");
    expect(feed).toContain("Recently added or edited climbing routes and crags in France");
    expect(feed).toContain(item.xml);
    expect(feed.endsWith("</rss>\n")).toBe(true);
  });

  it("caps the number of items per feed", () => {
    expect(RSS_MAX_ITEMS).toBeGreaterThan(0);
  });
});
