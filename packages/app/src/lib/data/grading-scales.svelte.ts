import { browser } from "$app/env";
import { getScale, type BoulderScaleId, type GradeType, type RouteScaleId, type ViaFerrataScaleId } from "@bloknote/holy-grade";

/**
 * Grading comprehension preferences (issue #188): the scales the user understands stay as-is in
 * the UI, everything else is translated to the preferred scale. Preferences are stored locally
 * and mirrored in the org.bloknote.actor.settings lexicon shape (known and preferred scale fields).
 */

export type GradingScaleType = Extract<GradeType, "route" | "boulder" | "viaFerrata">;
export type PreferredScaleId = RouteScaleId | BoulderScaleId | ViaFerrataScaleId;

/** The fallback when no preferred scale is set and the location is unknown */
export const DEFAULT_SCALES: Record<GradingScaleType, PreferredScaleId> = {
  route: "French",
  boulder: "FB",
  viaFerrata: "Huesler",
};

const STORAGE_KEY = "bloknote:grading-scales";

interface StoredScales {
  known: { route: RouteScaleId[]; boulder: BoulderScaleId[]; viaFerrata: ViaFerrataScaleId[] };
  preferred: { route?: RouteScaleId; boulder?: BoulderScaleId; viaFerrata?: ViaFerrataScaleId };
}

const EMPTY_KNOWN = { route: [], boulder: [], viaFerrata: [] };

function scaleType(scaleId: PreferredScaleId): GradingScaleType {
  if (scaleId === "FB" || scaleId === "Hueco") return "boulder";
  if (scaleId === "Huesler" || scaleId === "Schall") return "viaFerrata";
  return "route";
}

/** Whether the id actually resolves to a known scale of this type (issue #229: stale/legacy storage must not crash) */
export function isValidScaleId(scaleId: PreferredScaleId, type: GradingScaleType): boolean {
  return getScale(scaleId)?.gradeType === (type as GradeType);
}

/** Drops unknown or mistyped scale ids coming from storage (e.g. legacy `"local"` values, issue #229) */
export function storedScales(raw: unknown): Partial<StoredScales> | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const { known, preferred } = raw as StoredScales;
  const validKnown =
    known &&
    ({
      route: (known.route ?? []).filter((id) => isValidScaleId(id, "route")),
      boulder: (known.boulder ?? []).filter((id) => isValidScaleId(id, "boulder")),
      viaFerrata: (known.viaFerrata ?? []).filter((id) => isValidScaleId(id, "viaFerrata")),
    } as StoredScales["known"]);
  const validPreferred = preferred
    ? (Object.fromEntries(
        Object.entries(preferred).filter(([type, id]) => id !== undefined && isValidScaleId(id, type as GradingScaleType)),
      ) as StoredScales["preferred"])
    : undefined;
  return { known: validKnown, preferred: validPreferred };
}

/** Seeds the new storage from the pre-#188 single-select keys, then removes them */
function migrateLegacyKeys(): Partial<StoredScales> {
  if (!browser) return {};
  const route = localStorage.getItem("bloknote:preferred-route-grading-scale");
  const boulder = localStorage.getItem("bloknote:preferred-boulder-grading-scale");
  if (route === null && boulder === null) return {};
  localStorage.removeItem("bloknote:preferred-route-grading-scale");
  localStorage.removeItem("bloknote:preferred-boulder-grading-scale");
  const migrated: Partial<StoredScales> = {};
  if (route && route !== "local" && isValidScaleId(route as RouteScaleId, "route")) {
    migrated.preferred = { route: route as RouteScaleId };
    migrated.known = { ...EMPTY_KNOWN, route: [route as RouteScaleId] };
  }
  if (boulder && boulder !== "local" && isValidScaleId(boulder as BoulderScaleId, "boulder")) {
    migrated.preferred = { ...migrated.preferred, boulder: boulder as BoulderScaleId };
    migrated.known = { ...EMPTY_KNOWN, ...migrated.known, boulder: [boulder as BoulderScaleId] };
  }
  return migrated;
}

function initialScales(): StoredScales {
  const migrated = migrateLegacyKeys();
  if (!browser) return { known: { ...EMPTY_KNOWN }, preferred: {} };
  let stored: Partial<StoredScales> | undefined;
  try {
    stored = storedScales(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null"));
  } catch {
    // Ignore invalid stored preferences
  }
  return {
    known: { ...EMPTY_KNOWN, ...migrated.known, ...stored?.known },
    preferred: { ...stored?.preferred, ...migrated.preferred },
  };
}

/**
 * Coarse regions where the "local" grading scale differs from the worldwide default, mirroring
 * region-grading.ts. Coordinates are only used to pick a scale, never stored.
 */
const REGION_SCALES: [
  bounds: { lat: [number, number]; lon: [number, number] },
  scales: Partial<StoredScales["preferred"]>,
][] = [
  [{ lat: [12, 75], lon: [-170, -50] }, { route: "YDS", boulder: "Hueco" }],
  [{ lat: [49.8, 61.5], lon: [-11, 2] }, { route: "UKTech", boulder: "FB" }],
  [{ lat: [48.9, 55.1], lon: [13.8, 24.5] }, { route: "Polish", boulder: "FB" }],
  [{ lat: [54.5, 71.5], lon: [4, 32] }, { route: "Scandinavian", boulder: "FB" }],
  [{ lat: [45.5, 55.5], lon: [5.5, 17.5] }, { route: "UIAA", boulder: "FB" }],
  [{ lat: [-48, -9], lon: [110, 180] }, { route: "Ewbank", boulder: "Hueco" }],
];

function scalesForPosition(lat: number, lon: number): Partial<StoredScales["preferred"]> {
  for (const [bounds, scales] of REGION_SCALES) {
    if (lat >= bounds.lat[0] && lat <= bounds.lat[1] && lon >= bounds.lon[0] && lon <= bounds.lon[1]) return scales;
  }
  return {};
}

/** The scales of the region the user is in, resolved once per session from the geolocation */
let locationScales = $state<Partial<StoredScales["preferred"]>>({});

/**
 * Resolves the location-based scale fallback. Only uses the geolocation when the permission was
 * already granted: the settings must never trigger a permission prompt (issue #188).
 */
function detectLocationScales() {
  if (!browser || !navigator.geolocation) return;
  navigator.permissions
    ?.query({ name: "geolocation" as PermissionName })
    .then((status) => {
      if (status.state !== "granted") return;
      navigator.geolocation.getCurrentPosition(
        (position) => {
          locationScales = scalesForPosition(position.coords.latitude, position.coords.longitude);
        },
        () => {},
        { timeout: 10_000, maximumAge: 3_600_000 },
      );
    })
    .catch(() => {});
}

class GradingScales {
  #scales = $state<StoredScales>(initialScales());

  constructor() {
    if (browser) detectLocationScales();
  }

  #persist() {
    if (!browser) return;
    const empty =
      Object.values(this.#scales.known).every((list) => list.length === 0) &&
      Object.values(this.#scales.preferred).every((scale) => !scale);
    if (empty) localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, JSON.stringify(this.#scales));
  }

  /** The scales of this type the user ticked as understood */
  known(type: GradingScaleType): PreferredScaleId[] {
    return this.#scales.known[type];
  }

  /**
   * Whether grades in this scale should be displayed as written. An empty tick list means the
   * user has not configured anything yet: every scale is then shown as-is.
   */
  isKnown(scaleId: PreferredScaleId): boolean {
    const known = this.#scales.known[scaleType(scaleId)];
    return known.length === 0 || known.includes(scaleId as never);
  }

  toggleKnown(scaleId: PreferredScaleId) {
    const type = scaleType(scaleId);
    const known = this.#scales.known[type];
    const next = known.includes(scaleId as never) ? known.filter((id) => id !== scaleId) : [...known, scaleId];
    this.#scales.known = { ...this.#scales.known, [type]: next };
    this.#persist();
  }

  /** The scale the user picked for this type, if any */
  preferred(type: GradingScaleType): PreferredScaleId | undefined {
    return this.#scales.preferred[type];
  }

  /** Sets or unsets (clicking the selected radio again) the preferred scale of this type */
  setPreferred(type: GradingScaleType, scaleId: PreferredScaleId | undefined) {
    this.#scales.preferred = { ...this.#scales.preferred, [type]: scaleId };
    this.#persist();
  }

  /**
   * The single scale to use for this type: preferred, then location-based, then the worldwide
   * default. Every candidate is checked against the actual scales: a stale id from storage or a
   * changed lexicon must never bubble up to callers doing `getScale(effective(type))` (issue #229).
   */
  effective(type: GradingScaleType): PreferredScaleId {
    const candidates = [this.#scales.preferred[type], locationScales[type], DEFAULT_SCALES[type]];
    for (const id of candidates) {
      if (id !== undefined && isValidScaleId(id, type)) return id;
    }
    return DEFAULT_SCALES[type];
  }
}

export const gradingScales = new GradingScales();
