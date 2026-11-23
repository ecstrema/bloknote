import type { Scale } from "../types";
import { buildReverseTable, normalizeFromGradeMappings } from "../builder";

/**
 * The Hüsler scale (K1-K6), the de-facto international via ferrata difficulty scale named
 * after Eugen Hüsler, author of the standard German-language via ferrata guidebooks.
 * OSM's `via_ferrata_scale=1..6` tag encodes this scale numerically, so the numbers are
 * listed as alternate names.
 *
 * Ranks are shared with the Schall (French) via ferrata scale — K1..K6 correspond to
 * F, PD, AD, D, TD, ED — so the two interconvert exactly.
 */
const gradeMapping: Scale["gradeMapping"] = new Map([
  ["K1", 1],
  ["K2", 2],
  ["K3", 3],
  ["K4", 4],
  ["K5", 5],
  ["K6", 6],
]);

const alternateNames = new Map<string, string>([
  ["1", "K1"],
  ["2", "K2"],
  ["3", "K3"],
  ["4", "K4"],
  ["5", "K5"],
  ["6", "K6"],
]);

const normalizer = normalizeFromGradeMappings(gradeMapping, alternateNames);

export const husler: Scale<"Huesler"> = {
  id: "Huesler",
  name: "Hüsler",
  description:
    "The via ferrata difficulty scale by Eugen Hüsler (K1-K6), from K1 (very easy, sportive walking) to K6 (very hard, requiring real climbing technique).",
  gradeType: "viaFerrata",
  gradeMapping,
  numberToGradeTable: buildReverseTable(gradeMapping),
  alternateNames,
  normalize: (grade) => normalizer(grade.trim().toUpperCase()),
  flags: "🏔️",
  usageCount: 0,
};
