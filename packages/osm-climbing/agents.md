# @bloknote/osm-climbing

Shared OpenStreetMap climbing logic used by **both** the app (`packages/app`) and the data
generation pipeline (`packages/climbing-data-gen`). It has no dependency on SvelteKit, the DOM,
or any other package except `@bloknote/holy-grade` and `osm-api`.

## Modules

- `src/osm-tags.ts`: OSM climbing tag parsing — feature type classification (`featureToTypeOSM`),
  grade extraction (`getGrade`), per-key tag validation rules (`getTagRule`, `processedTags`),
  lengths, phones, coordinates, and the `Grade` type.
- `src/route-styles.ts`: route style extraction (`extractRouteStyle`, `isTradRoute`), style
  colors/labels, and sector contour geometry.
- `src/sector-stats.ts`: grade and style distribution statistics (`computeSectorStats`,
  `mergeSectorStats`).
- `src/opening-hours.ts`: `opening_hours` parsing, validation, formatting and week-grid editing.

## Conventions

- Keep this package pure TypeScript: no Svelte, no `$app/*` imports, no browser APIs. Code that
  needs reactivity or app state stays in `packages/app/src/lib/data/parse/`.
- Tests use vitest (`bun run test`).
