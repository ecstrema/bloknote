# reverse geocoding

The climbing places are grouped by region. A region is a path such as
`world/americas/north/canada/quebec/laurentides`, and the boundaries of the regions are committed
in `data/`.

## Structure of `data/`

`data/` only contains directories and GeoJSON files:

- Every leaf region is a `<slug>.geojson` file: a `FeatureCollection` of `Polygon` or
  `MultiPolygon`. For example `data/world/americas/north/canada/quebec/laurentides.geojson`.
- Every other region is a directory, without a boundary: its extent is the union of its children.
  A region cannot be both a directory and a file.
- Names are slugs (see `slugify` in `src/shared.ts`).

A climbing place is geolocated by walking the tree: the first sibling (by slug) whose boundary
contains it wins. Places outside of every leaf are dropped.

Keep the files small: a pull request cannot add or modify a file larger than 50 KB (checked by
`.github/workflows/check-boundaries.yml`, with `bun run check-size <files>`), and the build warns
for the existing ones. Simplify them in the editor first.

## Editing the boundaries

Use the boundary editor of the app, `/edit-map`:

- With `bun run dev`, it reads `data/` directly, can run Overpass queries to get boundaries, and
  saves the changes to `data/`. Commit them as usual.
- On the deployed site, it reads `data/` from GitHub. Changes can be downloaded as a zip of the
  whole `data/` directory, or proposed directly as a pull request.

## Build

```bash
bun install
bun run build
```

This validates `data/` and writes `output/hierarchy-index.json`, the bounding boxes of every
region, used for a fast prefilter by `packages/climbing-data-gen`. It only reads `data/`, and runs in CI.