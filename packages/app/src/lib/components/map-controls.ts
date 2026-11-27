import type { IControl, Map as MapLibreMap, TerrainSpecification } from "#lib/maplibre.js";

/**
 * Free global elevation data (terrarium-encoded PNG tiles), used by the TerrainControl.
 * Only downloaded when the user enables terrain on the map. Enabling terrain also turns on
 * hillshading, since the elevation tiles are not visible without it.
 */
export function addTerrainSource(map: MapLibreMap): void {
  if (map.getSource("terrain")) return;
  map.addSource("terrain", {
    type: "raster-dem",
    tiles: ["https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"],
    encoding: "terrarium",
    tileSize: 256,
    maxzoom: 15,
    attribution: "Elevation: Mapzen / AWS Terrain Tiles",
  });
  // Hillshading uses its own DEM source: MapLibre warns that sharing one raster-dem source
  // between a hillshade layer and 3D terrain hurts rendering quality (issue #209)
  map.addSource("hillshade", {
    type: "raster-dem",
    tiles: ["https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"],
    encoding: "terrarium",
    tileSize: 256,
    maxzoom: 15,
    attribution: "Elevation: Mapzen / AWS Terrain Tiles",
  });
  // Hidden until terrain is enabled, so tiles are not downloaded before
  map.addLayer({
    id: "hillshade",
    type: "hillshade",
    source: "hillshade",
    layout: { visibility: "none" },
    paint: { "hillshade-exaggeration": 0.45 },
  });
  // The native TerrainControl only toggles the 3D terrain: toggle the hillshade layer with it,
  // and mark the map container so 3D-only controls (the compass) can show up.
  const setTerrain = map.setTerrain.bind(map);
  map.setTerrain = (terrain: TerrainSpecification | null) => {
    const result = setTerrain(terrain);
    if (map.getLayer("hillshade")) {
      map.setLayoutProperty("hillshade", "visibility", terrain ? "visible" : "none");
    }
    map.getContainer().classList.toggle("map-3d", terrain !== null);
    return result;
  };
}
