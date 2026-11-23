import type { Scale } from "../types";
import { buildReverseTable, normalizeFromGradeMappings } from "../builder";

/**
 * The Schall scale, the French via ferrata difficulty scale (also used in Italy), from F
 * (facile) to ED (extrêmement difficile).
 *
 * Ranks are shared with the Hüsler (K) scale — F..ED correspond to K1..K6 — so the two
 * interconvert exactly.
 */
const gradeMapping: Scale["gradeMapping"] = new Map([
  ["F", 1],
  ["PD", 2],
  ["AD", 3],
  ["D", 4],
  ["TD", 5],
  ["ED", 6],
]);

const alternateNames = new Map<string, string>([
  ["FACILE", "F"],
  ["PEU DIFFICILE", "PD"],
  ["ASSEZ DIFFICILE", "AD"],
  ["DIFFICILE", "D"],
  ["TRES DIFFICILE", "TD"],
  ["TRÈS DIFFICILE", "TD"],
  ["EXTRÊMEMENT DIFFICILE", "ED"],
  ["EXTREMEMENT DIFFICILE", "ED"],
]);

const normalizer = normalizeFromGradeMappings(gradeMapping, alternateNames);

export const schall: Scale<"Schall"> = {
  id: "Schall",
  name: "Schall",
  nameAlt: "French via ferrata",
  description:
    "The French via ferrata scale by Roger Schall, from F (facile) to ED (extrêmement difficile), used in France and Italy.",
  gradeType: "viaFerrata",
  gradeMapping,
  numberToGradeTable: buildReverseTable(gradeMapping),
  alternateNames,
  normalize: (grade) => normalizer(grade.trim().toUpperCase()),
  flags: "🇫🇷🇮🇹",
  usageCount: 0,
};
