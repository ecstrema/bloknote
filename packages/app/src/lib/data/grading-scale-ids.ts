import type { BoulderScaleId, GradeType, RouteScaleId, ViaFerrataScaleId } from "@bloknote/holy-grade";

/**
 * Grading scale identifiers and their defaults. Plain .ts on purpose: it is exported into UI
 * modules, and a `.svelte.ts` module would be processed by wuchale, which wraps values holding
 * translatable-looking literals ("French"...) in $derived — and exporting derived state from a
 * module fails to compile. Scale ids are identifiers, not user-facing text (issue #229).
 */

export type GradingScaleType = Extract<GradeType, "route" | "boulder" | "viaFerrata">;
export type PreferredScaleId = RouteScaleId | BoulderScaleId | ViaFerrataScaleId;

/** The fallback when no preferred scale is set and the location is unknown */
export const DEFAULT_SCALES: Record<GradingScaleType, PreferredScaleId> = {
  route: "French",
  boulder: "FB",
  viaFerrata: "Huesler",
};