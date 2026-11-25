import type { BasicOsmType } from "../helpers.ts";

export interface GeoPoint {
  latitude: number;
  longitude: number;
}

export type GradeScaleId =
  | "French"
  | "YDS"
  | "UIAA"
  | "Saxon"
  | "UKTech"
  | "Scandinavian"
  | "Ewbank"
  | "Polish"
  | "FB"
  | "Hueco"
  | "WI"
  | "Mixed"
  | "DryTooling"
  | "Aid"
  | "UKAdj"
  | "YDSDanger"
  | "Huesler"
  | "Schall";

export interface ClimbingGradeRef {
  scale: GradeScaleId;
  value: string;
}

/** Whether an ascent was sent or only attempted */
export type AscentOutcome = "send" | "attempt";

/** Style of a sent climb: redpoint by default, or strictly onsight, flash, or pinkpoint */
export type SendStyle = "redpoint" | "onsight" | "flash" | "pinkpoint";

/** Style of an attempted climb: hangdog (working the route with hangs) by default, or bailed */
export type AttemptStyle = "hangdog" | "bailed";

/** The ascent style of a tick, either a send style or an attempt style */
export type TickStyle = SendStyle | AttemptStyle;

/** Additional climbing style / ascent qualifiers (tags). Lead is implied when unspecified. */
export type AscentInfo = "toprope" | "solo" | "second" | "aid";

/** The ascent fields of a tick: an outcome plus the style matching it, so a bailed "onsight" cannot exist */
export interface TickAscent {
  outcome: AscentOutcome;
  /** Send style (default redpoint). Only valid when outcome is "send" */
  sendStyle?: SendStyle;
  /** Attempt style (default hangdog). Only valid when outcome is "attempt" */
  attemptStyle?: AttemptStyle;
  /** Number of hangs, when the attempt style is hangdog */
  hangs?: number;
}

const ATTEMPT_STYLES: ReadonlySet<TickStyle> = new Set(["hangdog", "bailed"]);

/** Builds the tick ascent fields from a single style picked in a UI, plus an optional hang count */
export function ascentFromStyle(style: TickStyle, hangs?: number): TickAscent {
  return ATTEMPT_STYLES.has(style)
    ? { outcome: "attempt", attemptStyle: style as AttemptStyle, ...(hangs && hangs > 0 ? { hangs } : {}) }
    : { outcome: "send", sendStyle: style as SendStyle };
}

/**
 * Reference to an OpenStreetMap element (node, way, or relation).
 * Corresponds to org.bloknote.osm.defs#elementRef.
 * No snapshot metadata is stored in records: deleted OSM elements remain queryable
 * via the OSM API history endpoint.
 */
export interface OsmElementRef {
  type: BasicOsmType;
  id: number;
  /** Element version the record refers to, when known: pins the exact state in the OSM API history */
  version?: number;
}

/** Backward-compatibility alias for OsmElementRef */
export type OsmSubjectRef = OsmElementRef;

/**
 * Record corresponding to org.bloknote.logbook.tick
 * Personal logbook tick recording an ascent or attempt on an OSM route.
 * Minimal ticks are valid: only subject and createdAt are required. When present, the record
 * contains the outcome (send/attempt) with the matching style, optional ascent qualifiers
 * (ascentInfo), climbedAt timestamp, and comment.
 * A tick without an outcome is treated as a send.
 * Grade opinions are separate org.bloknote.osm.opinion records, not part of the tick.
 * Private ticks are stored in private ATProto Spaces.
 * The subject is optional: ticks for routes that are not on OpenStreetMap (yet) carry the route
 * name (and optionally grade and location hint) instead, and can be linked to an element later (issue #154).
 */
export interface TickRecord {
  /** OSM element ref. Absent for routes that are not on OpenStreetMap (yet). */
  subject?: OsmElementRef;
  /** Send/attempt outcome. Optional for minimal ticks: absent means send */
  outcome?: AscentOutcome;
  /** Send style (default redpoint). Only valid when outcome is "send" */
  sendStyle?: SendStyle;
  /** Attempt style (default hangdog). Only valid when outcome is "attempt" */
  attemptStyle?: AttemptStyle;
  /** Number of hangs, when the attempt style is hangdog */
  hangs?: number;
  ascentInfo?: AscentInfo[];
  /** When the climb occurred. Optional for minimal ticks */
  climbedAt?: string;
  createdAt: string;
  comment?: string;
  /** Route name, set for ticks without a subject */
  name?: string;
  /** Route grade as written in the source logbook, for ticks without a subject */
  grade?: string;
  /**
   * Full hierarchical location of the crag (e.g. "France > Vercors > La Balme"), for ticks
   * without a subject. The whole path helps locating and adding the places on OSM later.
   */
  locationHint?: string;
}

/**
 * Standalone comment on an OpenStreetMap element (node, way, or relation).
 * Corresponds to org.bloknote.osm.comment.
 * Deliberately minimal: only the element reference, the text, and timestamps. Ratings, ticks,
 * and bookmarks are separate record types so each piece of personal data can be created and
 * deleted independently (see issue #163).
 */
export interface CommentRecord {
  subject: OsmElementRef;
  text: string;
  createdAt: string;
}

/**
 * Standalone star rating of an OpenStreetMap element (node, way, or relation).
 * Corresponds to org.bloknote.osm.rating.
 * Integer rating from 0 (no stars) to {@link MAX_RATING} (full rating). 120 is divisible by 3, 4,
 * 5, 6, 8, and 10, so it adapts to those star systems without rounding. Comments live in their
 * own org.bloknote.osm.comment records.
 */
export interface RatingRecord {
  subject: OsmElementRef;
  rating: number; // integer, 0 to MAX_RATING
  createdAt: string;
}

/**
 * General-purpose starred or bookmarked OpenStreetMap element.
 * Corresponds to org.bloknote.osm.bookmark.
 * Kept strictly minimal: only subject (OSM element ref) and createdAt timestamp.
 * Private star lists are stored in private ATProto Spaces.
 */
export interface StarRecord {
  subject: OsmElementRef;
  createdAt: string;
}

/**
 * Record corresponding to org.bloknote.actor.profile.
 * User preferred grading scales. Unset/undefined to use the default notation for each place.
 */
export interface ProfileRecord {
  /** User's preferred route grading scale. Unset to use default notation for the place. */
  preferredRouteScale?: GradeScaleId;
  /** User's preferred boulder grading scale. Unset to use default notation for the place. */
  preferredBoulderScale?: "FB" | "Hueco";
  createdAt: string;
}

/**
 * Wrapper for records stored in or retrieved from an ATProto repository or Space.
 * Used when managing public vs private data via ATProto spaces.
 */
export interface SpaceRecordEntry<T> {
  uri: string;
  cid: string;
  value: T;
  /** Space DID or identifier when stored in an ATProto space */
  space?: string;
  /** True if stored in a private permissioned space rather than the public repo */
  isPrivate?: boolean;
}

/** Upper bound of {@link RatingRecord.rating}: 120 is divisible by 3, 4, 5, 6, 8, and 10 */
export const MAX_RATING = 120;

const clampRating = (rating: number) => Math.max(0, Math.min(MAX_RATING, Math.round(rating)));

/** Converts a rating (0 - {@link MAX_RATING}) to a star rating in an N-star system (e.g. 1-5 or 1-3). */
export function normalizedRatingToStars(rating: number, maxStars: number = 5): number {
  return Math.round((clampRating(rating) / MAX_RATING) * maxStars);
}

/** Converts a star rating in an N-star system to an integer rating (0 - {@link MAX_RATING}). */
export function starsToNormalizedRating(stars: number, maxStars: number = 5): number {
  return clampRating((stars / maxStars) * MAX_RATING);
}
