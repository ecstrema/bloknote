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
 * Corresponds to org.openstreetmap.core.defs#elementRef.
 * No snapshot metadata is stored in records: deleted OSM elements remain queryable
 * via the OSM API history endpoint.
 */
export interface OsmElementRef {
  type: BasicOsmType;
  id: number;
}

/** Backward-compatibility alias for OsmElementRef */
export type OsmSubjectRef = OsmElementRef;

/**
 * Record corresponding to org.bloknote.logbook.tick
 * Personal logbook tick recording an ascent or attempt on an OSM route.
 * Contains: subject (OSM element ref), core style, optional ascent qualifiers (ascentInfo),
 * climbedAt timestamp, creation timestamp, and comment.
 * Private ticks are stored in private ATProto Spaces.
 */
export interface TickRecord {
  subject: OsmElementRef;
  style: AscentStyle;
  ascentInfo?: AscentInfo[];
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
 * Normalized rating from 0.0 (no stars) to 1.0 (full rating), easily adaptable to 3, 4, or 5
 * star systems. Comments live in their own org.bloknote.comment records.
 */
export interface RatingRecord {
  subject: OsmElementRef;
  rating: number; // 0.0 to 1.0
  createdAt: string;
}

/**
 * General-purpose starred or bookmarked OpenStreetMap element.
 * Corresponds to org.openstreetmap.star.
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

/** Converts normalized rating (0.0 - 1.0) to a star rating in an N-star system (e.g. 1-5 or 1-3). */
export function normalizedRatingToStars(rating: number, maxStars: number = 5): number {
  return Math.round(Math.max(0, Math.min(1, rating)) * maxStars);
}

/** Converts a star rating in an N-star system to normalized rating (0.0 - 1.0). */
export function starsToNormalizedRating(stars: number, maxStars: number = 5): number {
  return Math.max(0, Math.min(1, stars / maxStars));
}
