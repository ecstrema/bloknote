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

/** Strictly the core ascent style */
export type AscentStyle = "onsight" | "flash" | "redpoint" | "attempt";

/** Additional climbing style / ascent qualifiers (tags) */
export type AscentInfo = "clean" | "toprope" | "lead" | "solo" | "second" | "aid" | "pinkpoint" | "hangdog";

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
 * Contains: subject (OSM element ref), core style, optional ascent qualifiers (ascentInfo),
 * the climber's own grade opinion, climbedAt timestamp, creation timestamp, and comment.
 * Private ticks are stored in private ATProto Spaces.
 */
export interface TickRecord {
  subject: OsmElementRef;
  style: AscentStyle;
  ascentInfo?: AscentInfo[];
  /** The climber's own grade opinion, which may differ from the grade tagged in OSM */
  grade?: ClimbingGradeRef;
  climbedAt: string;
  createdAt: string;
  comment?: string;
}

/**
 * Standalone comment on an OpenStreetMap element (node, way, or relation).
 * Corresponds to org.bloknote.comment.
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
 * Corresponds to org.bloknote.rating.
 * Integer rating from 0 (no stars) to {@link MAX_RATING} (full rating), easily adaptable to 3, 4,
 * or 5 star systems. Integer because the AT Protocol data model has no floats: a 0.0-1.0 value
 * like 0.6 is rejected by the PDS. Comments live in their own org.bloknote.comment records.
 */
export interface RatingRecord {
  subject: OsmElementRef;
  rating: number; // integer, 0 to MAX_RATING
  createdAt: string;
}

/**
 * General-purpose starred or bookmarked OpenStreetMap element.
 * Corresponds to org.bloknote.bookmark (formerly org.openstreetmap.star).
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

/** Upper bound of {@link RatingRecord.rating} */
export const MAX_RATING = 100;

const clampRating = (rating: number) => Math.max(0, Math.min(MAX_RATING, Math.round(rating)));

/** Converts a rating (0 - {@link MAX_RATING}) to a star rating in an N-star system (e.g. 1-5 or 1-3). */
export function normalizedRatingToStars(rating: number, maxStars: number = 5): number {
  return Math.round((clampRating(rating) / MAX_RATING) * maxStars);
}

/** Converts a star rating in an N-star system to an integer rating (0 - {@link MAX_RATING}). */
export function starsToNormalizedRating(stars: number, maxStars: number = 5): number {
  return clampRating((stars / maxStars) * MAX_RATING);
}

/**
 * Reads a rating written before ratings became integers: values up to 1 are 0.0-1.0 fractions
 * (no N-star system produces 1 out of {@link MAX_RATING}), larger ones are already integers.
 */
export function ratingFromStored(rating: number): number {
  return clampRating(rating <= 1 ? rating * MAX_RATING : rating);
}
