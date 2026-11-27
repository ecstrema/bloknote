import { describe, expect, it } from "vitest";
import { buildSectorContour, extractRouteStyle, FEATURE_COLORS, isTradRoute, ROUTE_STYLE_COLORS } from "./route-styles";

describe("route-styles", () => {
  it("extracts route styles correctly from tags", () => {
    expect(extractRouteStyle({ "climbing:boulder": "yes" })).toBe("boulder");
    expect(extractRouteStyle({ climbing: "boulder" })).toBe("boulder");
    expect(extractRouteStyle({ "climbing:aid": "yes" })).toBe("aid");
    expect(extractRouteStyle({ "climbing:grade:aid": "A2" })).toBe("aid");
    expect(extractRouteStyle({ "climbing:ice": "yes" })).toBe("ice");
    expect(extractRouteStyle({ "climbing:trad": "yes" })).toBe("trad");
    expect(extractRouteStyle({ "climbing:sport": "yes" })).toBe("sport");
    expect(extractRouteStyle({ "climbing:toprope": "yes" })).toBe("toprope");
    expect(extractRouteStyle({ highway: "via_ferrata" })).toBe("viaferrata");
    expect(extractRouteStyle({ climbing: "via_ferrata" })).toBe("viaferrata");
    expect(extractRouteStyle({})).toBe("sport");
  });

  it("has distinct stroke colors for all route styles", () => {
    expect(ROUTE_STYLE_COLORS.sport).toBe("#3b82f6");
    expect(ROUTE_STYLE_COLORS.boulder).toBe("#a855f7");
    expect(ROUTE_STYLE_COLORS.trad).toBe("#f59e0b");
    expect(ROUTE_STYLE_COLORS.aid).toBe("#ef4444");
    expect(ROUTE_STYLE_COLORS.ice).toBe("#06b6d4");
  });

  it("has feature colors for cliffs, areas, and gyms", () => {
    expect(FEATURE_COLORS.cliff.fill).toBe("#78350f");
    expect(FEATURE_COLORS.area.fill).toBe("#ea580c");
    expect(FEATURE_COLORS.gym.fill).toBe("#059669");
  });

  it("builds sector contour around route points", () => {
    const pts: [number, number][] = [
      [5.0, 45.0],
      [5.001, 45.0],
      [5.0, 45.001],
    ];
    const contour = buildSectorContour(pts);
    expect(contour.length).toBeGreaterThanOrEqual(4);
    // Closed ring
    expect(contour[0]).toEqual(contour[contour.length - 1]);
  });

  it("identifies trad and mixed routes for cam symbol display", () => {
    expect(isTradRoute({ "climbing:trad": "yes" })).toBe(true);
    expect(isTradRoute({ "climbing:mixed": "yes" })).toBe(true);
    expect(isTradRoute({ "climbing:sport": "yes", "climbing:trad": "yes" })).toBe(true);
    expect(isTradRoute({ "climbing:grade:mixed": "M7" })).toBe(true);
    expect(isTradRoute({ "climbing:sport": "yes" })).toBe(false);
    expect(isTradRoute({ "climbing:boulder": "yes" })).toBe(false);
    expect(isTradRoute({})).toBe(false);
    expect(isTradRoute(undefined)).toBe(false);
  });
});
