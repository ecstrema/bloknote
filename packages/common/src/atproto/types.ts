/**
 * Record types for the app's AT Protocol lexicons.
 *
 * The lexicon-derived types are GENERATED from ../../lexicons with @atproto/lex
 * (`bun run generate` in this package): edit the JSON lexicon files, then regenerate —
 * do not edit src/lexicons by hand.
 * This module only re-exports the generated types under the app's historical names,
 * and keeps the few helpers that are not part of the lexicon schemas.
 */
import type * as ActorProfile from "../lexicons/org/bloknote/actor/profile.defs.ts";
import type {
  AscentInfo,
  AscentOutcome,
  AttemptStyle,
  SendStyle,
} from "../lexicons/org/bloknote/logbook/tick.defs.ts";
import type * as TickLex from "../lexicons/org/bloknote/logbook/tick.defs.ts";
import type * as BookmarkLex from "../lexicons/org/bloknote/osm/bookmark.defs.ts";
import type * as CommentLex from "../lexicons/org/bloknote/osm/comment.defs.ts";
import type * as OsmDefs from "../lexicons/org/bloknote/osm/defs.defs.ts";
import type * as OpinionLex from "../lexicons/org/bloknote/osm/opinion.defs.ts";
import type * as RatingLex from "../lexicons/org/bloknote/osm/rating.defs.ts";

/** Makes the generated record's $type optional (it is only stamped on the PDS record) and its
 * datetime fields plain strings: the app builds them with `new Date(...).toISOString()`, and the
 * generated `l.DatetimeString` template-literal type rejects plain strings. */
type AppRecord<T extends { $type: string }, DateTimes extends keyof T = never> = Omit<T, "$type" | DateTimes> & {
  $type?: T["$type"];
} & { [K in DateTimes]: undefined extends T[K] ? string | undefined : string };

/** Reference to an OpenStreetMap element (node, way, or relation) — org.bloknote.osm.defs#elementRef */
export type OsmElementRef = OsmDefs.ElementRef;

/** Backward-compatibility alias for OsmElementRef */
export type OsmSubjectRef = OsmElementRef;

/**
 * Record corresponding to org.bloknote.logbook.tick.
 * Minimal ticks are valid: every field is optional. The subject is absent for routes that are
 * not on OpenStreetMap (yet), which then carry name/grade/locationHint. A tick without an
 * outcome is treated as a send. Grade opinions are separate org.bloknote.osm.opinion records.
 * Private ticks are stored in private ATProto Spaces.
 */
export type TickRecord = AppRecord<TickLex.Main, "climbedAt" | "createdAt">;

export type CommentRecord = AppRecord<CommentLex.Main, "createdAt">;

export type RatingRecord = AppRecord<RatingLex.Main, "createdAt">;

export type StarRecord = AppRecord<BookmarkLex.Main, "createdAt">;

/** An opinion about the value of a specific OSM field (org.bloknote.osm.opinion) */
export type OpinionRecord = AppRecord<OpinionLex.Main, "createdAt">;

/** Record corresponding to org.bloknote.actor.profile: the user's preferred grading scales */
export type ProfileRecord = AppRecord<ActorProfile.Main>;

export type { AscentOutcome, SendStyle, AttemptStyle, AscentInfo };

/** The ascent style of a tick, either a send style or an attempt style */
export type TickStyle = SendStyle | AttemptStyle;

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

export interface GeoPoint {
  latitude: number;
  longitude: number;
}

export interface ClimbingGradeRef {
  scale: GradeScaleId;
  value: string;
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