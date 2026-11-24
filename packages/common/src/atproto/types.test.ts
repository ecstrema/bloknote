import { expect, test } from "bun:test";
import { normalizedRatingToStars, ratingFromStored, starsToNormalizedRating } from "./types.ts";

test("star ratings round-trip through integer ratings", () => {
  for (const max of [3, 4, 5])
    for (let stars = 0; stars <= max; stars++) {
      const rating = starsToNormalizedRating(stars, max);
      expect(Number.isInteger(rating)).toBe(true);
      expect(normalizedRatingToStars(rating, max)).toBe(stars);
    }
});

test("pre-integer 0.0-1.0 ratings are read on the integer scale", () => {
  expect(ratingFromStored(0.6)).toBe(60);
  expect(ratingFromStored(1)).toBe(100);
  expect(ratingFromStored(0)).toBe(0);
  expect(ratingFromStored(80)).toBe(80);
});
