import { describe, expect, it } from "vitest";
import { featureToMapElement } from "./location-map-helper.js";
import { ROUTE_STYLE_COLORS } from "@bloknote/osm-climbing";
import type { OsmFeature } from "osm-api";

describe("location-map-helper", () => {
  it("converts cliff feature to map element with cliff path styling", () => {
    const cliffNode = {
      type: "node",
      id: 12345,
      lat: 45.0,
      lon: 5.0,
      tags: {
        natural: "cliff",
        name: "Grand Cliff",
      },
    } as unknown as OsmFeature;
    const el = featureToMapElement("world/europe/france/grand-cliff", cliffNode);
    expect(el).toBeDefined();
    expect(el?.properties.elementType).toBe("cliff");
    expect(el?.geometry.type).toBe("LineString");
  });

  it("converts route feature with grade to map element with grade fill and style stroke", () => {
    const routeNode = {
      type: "node",
      id: 67890,
      lat: 45.1,
      lon: 5.1,
      tags: {
        name: "Voie Normale",
        climbing: "route_bottom",
        "climbing:sport": "yes",
        "climbing:grade:french": "6a",
      },
    } as unknown as OsmFeature;
    const el = featureToMapElement("world/europe/france/crag/voie-normale", routeNode);
    expect(el).toBeDefined();
    expect(el?.properties.elementType).toBe("route");
    expect(el?.properties.routeStyle).toBe("sport");
    expect(el?.properties.strokeColor).toBe(ROUTE_STYLE_COLORS.sport);
    expect(el?.properties.grade).toBe("6a");
    expect(el?.properties.fillColor).toContain("hsl(");
  });

  it("treats a way mapped as a route as a route point (issue #280)", () => {
    const wayRoute = {
      type: "way",
      id: 24680,
      center: { lat: 45.2, lon: 5.2 },
      nodes: [1, 2, 3],
      tags: {
        name: "Grande Voie",
        climbing: "route",
        sport: "climbing",
        "climbing:grade:french": "6b",
      },
    } as unknown as OsmFeature;
    const el = featureToMapElement("world/europe/france/crag/grande-voie", wayRoute);
    expect(el).toBeDefined();
    // The way clusters like a route point at its center; its line geometry is drawn separately
    expect(el?.properties.elementType).toBe("route");
    expect(el?.geometry.type).toBe("Point");
    expect(el?.geometry.coordinates).toEqual([5.2, 45.2]);
    expect(el?.properties.grade).toBe("6b");
  });
});
