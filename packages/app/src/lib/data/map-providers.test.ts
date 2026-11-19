import { describe, expect, it } from "vitest";
import { isMapProviderDefaultEnabled, MAP_PROVIDERS } from "./map-providers.js";

describe("map-providers", () => {
  it("enables mobile-only defaults on mobile and hides them by default on desktop", () => {
    const geo = MAP_PROVIDERS.find((p) => p.id === "geo")!;
    const osm = MAP_PROVIDERS.find((p) => p.id === "osm")!;
    const comaps = MAP_PROVIDERS.find((p) => p.id === "comaps")!;

    expect(isMapProviderDefaultEnabled(geo, true)).toBe(true);
    expect(isMapProviderDefaultEnabled(geo, false)).toBe(false);
    expect(isMapProviderDefaultEnabled(osm, true)).toBe(true);
    expect(isMapProviderDefaultEnabled(osm, false)).toBe(true);
    expect(isMapProviderDefaultEnabled(comaps, true)).toBe(false);
  });

  it("builds valid links for coordinates and optional name", () => {
    const coords = { lat: 48.4, lon: 2.6 };
    for (const provider of MAP_PROVIDERS) {
      const href = provider.buildHref(coords, "Fontainebleau & Co");
      expect(href).toContain("48.4");
      expect(href).toContain("2.6");
    }
  });
});
