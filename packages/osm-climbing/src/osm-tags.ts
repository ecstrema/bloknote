import type { OsmFeature } from "osm-api";
import {
  allAidScales,
  allBoulderScales,
  allDangerScales,
  allIceScales,
  allRouteScales,
  allScales,
  allViaFerrataScales,
  getReference,
  getScale,
  parseGrade,
  type Scale,
  type ScaleId,
} from "@bloknote/holy-grade";
import type { Key, Tags } from "osm-api";
import { isValidOpeningHours } from "./opening-hours.js";

/** A climbing grade value and the scale it is expressed in */
export type Grade = {
  v: string;
  scale: ScaleId | "unknown";
};

/** A point on Earth, in degrees */
export interface Coordinates {
  lon: number;
  lat: number;
}

export type DeprecatedTag = { deprecated: string };
export type TagRule = ((value: string) => boolean) | DeprecatedTag;
/** Tag rules keyed by tag name. Keys are plain strings: arbitrary community keys such as
 * `ele:source` or `description:fr` are resolved through the prefix families in {@link getTagRule}. */
export type ProcessedTags = Record<string, TagRule>;

export function deprecated(message: string): DeprecatedTag {
  return { deprecated: message };
}

export function allowAll(_value: string): boolean {
  return true;
}

export function allowSingleValue(value: string): (value: string) => boolean {
  return (v) => v === value;
}

export function allowFromNormalize(normalize: Scale["normalize"]): (value: string) => boolean {
  return (v) => {
    try {
      normalize(v);
      return true;
    } catch {
      return false;
    }
  };
}

export function allowMultipleValues(values: Set<string>): (value: string) => boolean {
  return (v) => values.has(v);
}

export function getNameOSM(tags: Tags): string | undefined {
  return tags.name;
}

export function isMultipitchRoute(tags: Tags | undefined): boolean {
  if (!tags) return false;
  if (tags["climbing:multipitch"] === "yes") return true;
  const pitches = Number(tags["climbing:pitches"]?.trim());
  return Number.isInteger(pitches) && pitches > 1;
}

export function isProjectRoute(tags: Tags | undefined): boolean {
  if (!tags?.name) return false;
  return /\b(project|projet|projekt|progetto)\b/i.test(tags.name);
}

/** Whether the element is a via ferrata (issue #234). `sport=via_ferrata` is the legacy way of
 * tagging them, before `highway=via_ferrata` was accepted (issue #252) */
export function isViaFerrata(tags: Tags): boolean {
  return (
    tags.climbing === "via_ferrata" ||
    tags.highway === "via_ferrata" ||
    tags.sport === "via_ferrata" ||
    tags.via_ferrata_scale !== undefined
  );
}

const climbingStyleLabels = [
  ["sport", "Sport"],
  ["trad", "Trad"],
  ["boulder", "Boulder"],
  ["toprope", "Top rope"],
  ["speed", "Speed"],
  ["multipitch", "Multi-pitch"],
  ["ice", "Ice"],
  ["mixed", "Mixed"],
  ["dry", "Dry tooling"],
  ["aid", "Aid"],
  ["deepwater", "Deep-water solo"],
] as const;

export function getClimbingStyles(tags: Tags) {
  return climbingStyleLabels.flatMap(([key, label]) => {
    const value = tags[`climbing:${key}` as Key]?.trim();
    if (!value || value.toLowerCase() === "no") return [];
    const count = /^\d+$/.test(value) && Number(value) > 0 ? Number(value) : undefined;
    return [{ key, label, count }];
  });
}

export function getPhone(tags: Tags): string | undefined {
  return tags.phone?.trim() || tags["contact:phone"]?.trim() || undefined;
}

export function getEmail(tags: Tags): string | undefined {
  return tags.email?.trim() || tags["contact:email"]?.trim() || undefined;
}

export const gradeTags: [Key, ScaleId][] = [
  ["climbing:grade:uiaa", "UIAA"],
  ["climbing:grade:yds_class", "YDS"],
  ["climbing:grade:yds", "YDS"],
  ["climbing:grade:french", "French"],
  ["climbing:grade:french_british", "French"],
  ["climbing:grade:fb", "FB"],
  ["climbing:grade:font", "FB"],
  ["climbing:grade:fontainebleau", "FB"],
  ["climbing:grade:hueco", "Hueco"],
  ["climbing:grade:vscale", "Hueco"],
  ["climbing:grade:saxon", "Saxon"],
  ["climbing:grade:norwegian", "Scandinavian"],
  ["climbing:grade:british_adjectival", "UKAdj"],
  ["climbing:grade:british_technical", "UKTech"],
  ["climbing:grade:ewbank", "Ewbank"],
  ["climbing:grade:polish", "Polish"],
  ["climbing:grade:ice", "WI"],
  ["climbing:grade:mixed", "Mixed"],
  ["climbing:grade:dry", "DryTooling"],
  ["climbing:grade:aid", "Aid"],
  ["climbing:grade:yds_danger", "YDSDanger"],
  ["via_ferrata_scale", "Huesler"],
];
const processedGrades: ProcessedTags = {
  "climbing:grade": allowAll,
  ...Object.fromEntries(gradeTags.map(([key, scale]) => [key, allowFromNormalize(getScale(scale)!.normalize)])),
};

/** sac_scale values (SAC hiking scale, often reused to grade via ferratas, issue #234) */
const sacScaleValues = new Set([
  "hiking",
  "mountain_hiking",
  "demanding_mountain_hiking",
  "alpine_hiking",
  "demanding_alpine_hiking",
  "difficult_alpine_hiking",
  "T1",
  "T2",
  "T3",
  "T4",
  "T5",
  "T6",
]);
const sacScaleTag = (value: string) => sacScaleValues.has(value) || sacScaleValues.has(value.toUpperCase());

export function scaleIdToTag(s: ScaleId): Key | undefined {
  return gradeTags.find(([, scale]) => scale === s)?.[0];
}

/** Returns all grading scales relevant to the feature's climbing styles (and current scale if set). */
export function getRelatedGradeScales(tags: Tags, currentScale?: ScaleId | "unknown"): Scale[] {
  const scales = new Map<ScaleId, Scale>();
  const addAll = (list: Scale[]) => {
    for (const s of list) scales.set(s.id, s);
  };

  const isBoulder = tags["climbing:boulder"] === "yes" || tags.climbing === "boulder" || tags.climbing === "bouldering";
  const isIce = tags["climbing:ice"] === "yes" || !!tags["climbing:grade:ice"];
  const isMixed = tags["climbing:mixed"] === "yes" || !!tags["climbing:grade:mixed"];
  const isDry = tags["climbing:dry"] === "yes" || tags.climbing === "drytooling" || !!tags["climbing:grade:dry"];
  const isAid = tags["climbing:aid"] === "yes" || !!tags["climbing:grade:aid"];
  const isViaFerrataElement = isViaFerrata(tags);
  const isRockRoute =
    tags["climbing:sport"] === "yes" ||
    tags["climbing:trad"] === "yes" ||
    tags["climbing:toprope"] === "yes" ||
    tags["climbing:multipitch"] === "yes" ||
    tags["climbing:speed"] === "yes" ||
    tags["climbing:deepwater"] === "yes";

  if (isBoulder) addAll(allBoulderScales);
  if (isDry && !isIce && !isMixed) {
    const dry = allIceScales.find((s) => s.id === "DryTooling");
    if (dry) scales.set(dry.id, dry);
  } else if (isMixed && !isIce) {
    const mixed = allIceScales.find((s) => s.id === "Mixed");
    if (mixed) scales.set(mixed.id, mixed);
  }
  if (isIce || isMixed || isDry) addAll(allIceScales);
  if (isAid) addAll(allAidScales);
  if (isViaFerrataElement) addAll(allViaFerrataScales);
  if (isRockRoute) addAll(allRouteScales);

  if (currentScale && currentScale !== "unknown") {
    const type = getScale(currentScale)?.gradeType;
    if (type === "boulder") addAll(allBoulderScales);
    else if (type === "ice") addAll(allIceScales);
    else if (type === "aid") addAll(allAidScales);
    else if (type === "danger") addAll(allDangerScales);
    else if (type === "viaFerrata") addAll(allViaFerrataScales);
    else if (type === "route") addAll(allRouteScales);
  }

  if (scales.size === 0) addAll(allRouteScales);
  return [...scales.values()];
}

/** See https://wiki.openstreetmap.org/wiki/Climbing#Grading */
export function getGrade(tags: Tags): WithSourceTag<Grade> | undefined {
  const grade = gradeTags.map(([key, scale]) => testKey(key, scale)).find(Boolean);

  if (grade) {
    return grade;
  }

  // Via ferratas are often graded with the SAC hiking scale instead of a dedicated via ferrata
  // scale (issue #234). There is no consensus on how to map it to the via ferrata scales, so the
  // value is displayed as written (unknown scale) instead of being converted.
  if (isViaFerrata(tags) && tags.sac_scale && sacScaleTag(tags.sac_scale)) {
    return { v: { v: tags.sac_scale, scale: "unknown" }, source: "sac_scale" };
  }

  // If no grade was found, check for a generic climbing:grade tag
  const genericGrade = tags["climbing:grade"];
  if (genericGrade) {
    const parsed = parseGrade(genericGrade);
    if (parsed?.primary) {
      return {
        v: { v: parsed.primary.grade, scale: parsed.primary.scale },
        source: "climbing:grade",
      };
    }
    if (parsed?.danger) {
      return {
        v: { v: parsed.danger.grade, scale: parsed.danger.scale },
        source: "climbing:grade",
      };
    }

    // Try to detect the scale from the value
    for (const scale of allScales) {
      const g = scale.normalize(genericGrade);
      if (g)
        return {
          v: { v: g, scale: scale.id },
          source: "climbing:grade",
        };
    }

    // If no scale was detected, return the grade with an unknown scale
    return {
      v: { v: genericGrade, scale: "unknown" },
      source: "climbing:grade",
    };
  }

  return undefined;

  function testKey(key: Key, scale: ScaleId): WithSourceTag<Grade> | undefined {
    const v = tags[key];
    if (v) {
      const parsed = parseGrade(v, scale);
      const normalized = parsed?.primary?.grade ?? getScale(scale)!.normalize(v);
      // validate the grade, but ignore the result
      return {
        v: normalized ? { v: normalized, scale } : { v, scale: "unknown" },
        source: key,
      };
    }
  }
}

export interface ParsedClimbingLength {
  meters: number;
  sourceUnit: "meters" | "feet";
}

const lengthValidator = (value: string) => /^\d+(\.\d+)?$/.test(value.trim());

export function parseClimbingLength(value: string | undefined): ParsedClimbingLength | undefined {
  const normalized = value?.trim().replace(",", ".");
  if (!normalized) return;

  const meters = normalized.match(/^(\d+(?:\.\d+)?)\s*(?:m|meters?|metres?)?$/i);
  if (meters) return { meters: Number(meters[1]), sourceUnit: "meters" };

  const feet = normalized.match(/^(\d+(?:\.\d+)?)\s*(?:'|ft|feet|foot)$/i);
  if (feet) return { meters: Number(feet[1]) * 0.3048, sourceUnit: "feet" };
}

/**
 * Length of a route in metres, as `climbing:length`.
 * See https://wiki.openstreetmap.org/wiki/Climbing#Route_properties
 */
export function getLength(tags: Tags): number | undefined {
  return parseClimbingLength(tags["climbing:length"])?.meters;
}

export function getDescription(tags: Tags): string | undefined {
  return tags.description || undefined;
}

export function getCoordinates(element: OsmFeature): Coordinates | undefined {
  if (element.type === "node") return { lon: element.lon, lat: element.lat };
  // @ts-ignore
  if (element.center) return { lon: element.center.lon, lat: element.center.lat };

  // TODO: element may have a geometry. Is that actually happening?
  // @ts-ignore
  if (element.geometry?.length > 0) {
    // @ts-ignore
    return { lon: element.geometry[0].lon, lat: element.geometry[0].lat };
  }
}

export type ProcessingError = "GradeParsingError" | "GradeMissingScaleSpecifier";

/** We add the source tag to the processed value, so we can bind to it and modify the right value. */
export type WithSourceTag<T> = { v: T; source: Key };

export type OSMClimbingFeatureType = "route" | "area" | "gym";

export const routeClimbingValues = new Set([
  "route_bottom",
  "route_top",
  "route",
  "route_start",
  "abseil_route",
  "abseil",
  "toprope",
  "drytooling",
  "via_ferrata",
]);
export const areaClimbingValues = new Set(["area", "crag", "boulder", "bouldering"]);
const gymClimbingValues = new Set(["indoor_wall", "artificial_wall", "wall", "gym"]);
const gymLeisureValues = new Set(["sports_centre", "sports_hall", "fitness_centre", "sport_centre", "pitch"]);

function hasClimbingValue(value: string | undefined, acceptedValues: ReadonlySet<string>) {
  if (!value) return false;
  if (acceptedValues.has(value)) return true;
  return value.includes(";") && value.split(";").some((part) => acceptedValues.has(part.trim()));
}

export function featureToTypeOSM(feature: OsmFeature): OSMClimbingFeatureType | undefined {
  if (!feature.tags) return;

  const tags = feature.tags;
  if (hasClimbingValue(tags.climbing, routeClimbingValues) || tags.highway === "via_ferrata") return "route";

  // Legacy via ferrata tagging, before highway=via_ferrata was accepted (issue #252)
  if (tags.sport === "via_ferrata") return "route";

  if (hasClimbingValue(tags.climbing, areaClimbingValues)) return "area";

  if (
    hasClimbingValue(tags.climbing, gymClimbingValues) ||
    tags.leisure === "pitch" ||
    (tags.sport === "climbing" && gymLeisureValues.has(tags.leisure || ""))
  ) {
    return "gym";
  }

  // The world import also includes climbing POIs without a more specific climbing tag.
  if (tags.sport === "climbing") return "area";
}

/** Lengths, counts and degrees: plain numbers */
const numericTag = lengthValidator;

/** Yes/no boolean style tags */
const yesNoTag = allowMultipleValues(new Set(["yes", "no"]));

/** `fee=donation` is a valid value per https://wiki.openstreetmap.org/wiki/Key:fee (issue #250) */
const feeTag = allowMultipleValues(new Set(["yes", "no", "donation"]));

const yesNoOrNumericTag = (value: string) => yesNoTag(value) || numericTag(value);

const urlTag = (value: string) => {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
};

/** Grade range tags (`:min`/`:max`/`:mean` suffixes) carry plain grades of the same scale */
const gradeRangeTags: ProcessedTags = Object.fromEntries(
  gradeTags.flatMap(([key, scale]) =>
    [":min", ":max", ":mean"].map((suffix) => [`${key}${suffix}`, allowFromNormalize(getScale(scale)!.normalize)]),
  ),
) as ProcessedTags;

/**
 * Recognized climbing tags that the app understands (or tolerates) but does not act on yet.
 * See https://wiki.openstreetmap.org/wiki/Climbing and the key list in packages/common/src/index.d.ts.
 */
const recognizedClimbingTags: ProcessedTags = {
  "climbing:multipitch": yesNoTag,
  "climbing:bolts": numericTag,
  "climbing:bolt": numericTag,
  "climbing:bolted": yesNoTag,
  "climbing:boulder:indoor": yesNoTag,
  "climbing:chains": yesNoTag,
  "climbing:routes": numericTag,
  "climbing:rock": allowAll,
  "climbing:orientation": allowAll,
  "climbing:quality": allowAll,
  "climbing:chipped": yesNoTag,
  "climbing:summit_log": yesNoTag,
  "climbing:restriction": yesNoTag,
  "climbing:restriction:time_description": allowAll,
  "climbing:family_friendly": yesNoTag,
  "climbing:beginner_friendly": yesNoTag,
  "climbing:length:min": numericTag,
  "climbing:length:max": numericTag,
};

export const sharedProcessedTags: ProcessedTags = {
  name: allowAll,
  description: allowAll,
  official_name: allowAll,
  alt_name: allowAll,
  // sport=via_ferrata is the legacy way of tagging via ferratas (issue #252)
  sport: allowMultipleValues(new Set(["climbing", "via_ferrata"])),
  access: allowAll,
  club: allowAll,
  federation: allowAll,
  ele: deprecated(
    "`ele` is discouraged on standalone climbing elements on OpenStreetMap; remove it unless this element represents a peak or landform.",
  ),
  ...Object.fromEntries(climbingStyleLabels.map(([key]) => [`climbing:${key}`, allowAll])),
  // Contact and metadata
  website: allowAll,
  url: urlTag,
  "contact:website": allowAll,
  phone: allowAll,
  "contact:phone": allowAll,
  email: allowAll,
  "contact:email": allowAll,
  wikimedia_commons: allowAll,
  "wikimedia_commons:path": allowAll,
  author: allowAll,
  opening_hours: isValidOpeningHours,
  fee: feeTag,
  membership: yesNoTag,
  // Physical properties
  height: numericTag,
  direction: allowAll,
  covered: yesNoTag,
  indoor: yesNoTag,
  outdoor: yesNoTag,
  natural: allowAll,
  amenity: allowAll,
  building: allowAll,
  playground: allowSingleValue("climbingwall"),
  "tower:type": allowAll,
  path: allowAll,
  ...recognizedClimbingTags,
  ...gradeRangeTags,
};

export const processedTags: Record<OSMClimbingFeatureType, ProcessedTags> = {
  route: {
    ...sharedProcessedTags,
    ...processedGrades,
    ele: deprecated(
      "Do not use `ele` on climbing routes; move route height to `climbing:length` (in meters) or remove `ele`.",
    ),
    "climbing:length": lengthValidator,
    "climbing:pitches": (v: string) => /^[1-9]\d*$/.test(v.trim()),
    climbing: allowMultipleValues(routeClimbingValues),
    highway: allowSingleValue("via_ferrata"),
    sac_scale: sacScaleTag,
  },
  area: {
    ...sharedProcessedTags,
    climbing: allowMultipleValues(areaClimbingValues),
    type: allowSingleValue("site"),
  },
  gym: {
    ...sharedProcessedTags,
    leisure: allowMultipleValues(gymLeisureValues),
    climbing: allowMultipleValues(gymClimbingValues),
    charge: allowAll,
  },
};

const tagPrefixes: [prefix: string, targetKey: Key][] = [
  ["ele:", "ele"],
  ["description:", "description"],
];

/** Prefix families that are recognized for every key they qualify (localized names, external links, hazards, ...) */
const tagPrefixRules: [prefix: string, rule: TagRule][] = [
  ["name:", allowAll],
  ["alt_name:", allowAll],
  ["addr:", allowAll],
  ["climbing:url:", urlTag],
  ["climbing:hazard:", yesNoTag],
  ["climbing:inclination:", yesNoOrNumericTag],
];

export function getTagRule(
  featureType: OSMClimbingFeatureType | undefined,
  key: Key | (string & {}),
): TagRule | undefined {
  if (!featureType) return undefined;
  const rules = processedTags[featureType];
  if (rules[key]) return rules[key];
  const alias = tagPrefixes.find(([prefix]) => key.startsWith(prefix))?.[1];
  if (alias) return rules[alias];
  return tagPrefixRules.find(([prefix]) => key.startsWith(prefix))?.[1];
}

export function getGradeReference(tags: Tags): number | undefined {
  const grade = getGrade(tags)?.v;
  if (!grade || grade.scale === "unknown") return;

  const scale = getScale(grade.scale);
  if (!scale) return;

  const reference = getReference(grade.v, scale);
  return reference;
}
