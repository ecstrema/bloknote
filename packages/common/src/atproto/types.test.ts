import { expect, test } from "bun:test";
import { normalizedRatingToStars, starsToNormalizedRating } from "./types.ts";

test("star ratings round-trip through integer ratings", () => {
  for (const max of [3, 4, 5])
    for (let stars = 0; stars <= max; stars++) {
      const rating = starsToNormalizedRating(stars, max);
      expect(Number.isInteger(rating)).toBe(true);
      expect(normalizedRatingToStars(rating, max)).toBe(stars);
    }
});
