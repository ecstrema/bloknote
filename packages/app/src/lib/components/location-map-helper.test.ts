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
});
