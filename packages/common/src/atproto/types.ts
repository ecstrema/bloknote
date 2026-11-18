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
  | "YDSDanger";

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
 * Record corresponding to app.climbhub.logbook.tick
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
 * Proposed change or addition to an OpenStreetMap tag key-value pair.
 * Allows users to propose corrections or updates (e.g. name, grade) as part of a review.
 */
export interface ProposedTagChange {
  key: string;
  value: string;
}

/**
 * Review and rating for an OpenStreetMap element (node, way, or relation).
 * Corresponds to org.openstreetmap.review.
 * Contains element reference (subject), review text, normalized rating (0.0 to 1.0),
 * optional proposed OSM tag changes (e.g. for name or grade proposals), and submission timestamp.
 * Rating is a float from 0.0 (no stars) to 1.0 (full rating), easily adaptable to 3, 4, or 5 star systems.
 */
export interface ReviewRecord {
  subject: OsmElementRef;
  text?: string;
  rating?: number; // 0.0 to 1.0
  proposedTags?: ProposedTagChange[];
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
 * Record corresponding to app.climbhub.actor.profile.
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

/** Finds a proposed tag value by key from a review record. */
export function getProposedTag(review: ReviewRecord, key: string): string | undefined {
  return review.proposedTags?.find((t) => t.key === key)?.value;
}
