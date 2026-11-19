import type { BoulderScaleId, RouteScaleId } from "@bloknote/holy-grade";

export interface RegionGradingDefaults {
  route: RouteScaleId;
  boulder: BoulderScaleId;
}

const PREFIX_DEFAULTS: [prefix: string, defaults: RegionGradingDefaults][] = [
  ["europe/germany/saxony", { route: "Saxon", boulder: "FB" }],
  ["europe/united-kingdom", { route: "UKTech", boulder: "FB" }],
  ["europe/ireland", { route: "UKTech", boulder: "FB" }],
  ["europe/germany", { route: "UIAA", boulder: "FB" }],
  ["europe/austria", { route: "UIAA", boulder: "FB" }],
  ["europe/switzerland", { route: "UIAA", boulder: "FB" }],
  ["europe/norway", { route: "Scandinavian", boulder: "FB" }],
  ["europe/sweden", { route: "Scandinavian", boulder: "FB" }],
  ["europe/poland", { route: "Polish", boulder: "FB" }],
  ["oceania/australia", { route: "Ewbank", boulder: "Hueco" }],
  ["oceania/new-zealand", { route: "Ewbank", boulder: "Hueco" }],
  ["africa/south-africa", { route: "Ewbank", boulder: "Hueco" }],
  ["americas/north", { route: "YDS", boulder: "Hueco" }],
  ["americas/central", { route: "YDS", boulder: "Hueco" }],
  ["americas/antilles", { route: "YDS", boulder: "Hueco" }],
  ["americas/south", { route: "French", boulder: "Hueco" }],
];

const WORLD_DEFAULT: RegionGradingDefaults = { route: "French", boulder: "FB" };

/** Returns default route and boulder grading scales for a geographic/climbing slug. */
export function getDefaultGradingScales(slug: string): RegionGradingDefaults {
  const normalized = slug.toLowerCase();
  for (const [prefix, defaults] of PREFIX_DEFAULTS) {
    if (normalized === prefix || normalized.startsWith(`${prefix}/`)) {
      return defaults;
    }
  }
  return WORLD_DEFAULT;
}
