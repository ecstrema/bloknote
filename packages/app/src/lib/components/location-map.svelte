<script module lang="ts">
  import "maplibre-gl/dist/maplibre-gl.css";
  import { mount, unmount } from "svelte";
  import {
    Map as MapLibreMap,
    Marker,
    Popup,
    NavigationControl,
    GeolocateControl,
    TerrainControl,
    ScaleControl,
    type GeoJSONSource,
    type IControl,
  } from "#lib/maplibre.js";
  import { goto } from "$app/navigation";
  import { resolve } from "$app/paths";
  import { dataClient } from "#lib/data/network/data-client.js";
  import { localDb } from "#lib/data/db/local-db.svelte.js";
  import type { MapElementFeature, MapElementFeatureCollection } from "#lib/data/db/types.js";
  import { FEATURE_COLORS } from "#lib/data/parse/route-styles.js";
  import type { OsmFeature } from "osm-api";
  import { setMapCenterProvider } from "./map-center.js";
  import { addTerrainSource } from "./map-controls.js";
  import { searchState } from "./shell/sidebar/search-state.svelte.js";
  import { CLIMBING_LAYERS, applyElementTypeVisibility, featureToMapElement, formatPopupHtml, VECTOR_STYLE } from "./location-map-helper.js";
  import MapLegend from "./map-legend.svelte";

  // One map (and WebGL context) for the whole app: kept across page navigation.
  let shared: { map: MapLibreMap; element: HTMLDivElement } | undefined;
  let dragMarker: Marker | undefined;
  let currentOnmove: ((position: { lat: number; lon: number }) => void) | undefined;
  let currentOnmapclick: ((position: { lat: number; lon: number }) => void) | undefined;
  let activePlacementMode: "route" | "sector" | null = null;
  /** False until the view was first set to a place */
  let positioned = false;
  /** True once the user moved the map themselves: later target moves then re-center gently instead of flying */
  let userPositioned = false;
  /**
   * Key of the target the camera currently flies to or sits on. Repeated moveToTarget calls for the
   * same target (the reactive data updates several times while a page loads) must not restart the
   * move: a restart cancels the running animation mid-way and leaves the map at an intermediate
   * zoom after a page reload on the map tab (issue #192).
   */
  let cameraTargetKey: string | undefined;

  let activeHighlightSlug = "";
  /** Companion lookup (slug -> bottom/top slug) for the routes of the current page */
  let companionLookup: Record<string, string> = {};
  /** Set while a lasso drag just finished, so the click that follows does not navigate */
  let suppressNextClick = false;
  let allElementsLoaded = $state(false);
  let cachedCollection: MapElementFeatureCollection = { type: "FeatureCollection", features: [] };
  const loadedSlugs = new Set<string>();
  let sharedColorMode: "grade" | "type" | "both" = "both";
  /** Slugs currently selected through the sidebar (or a map lasso), highlighted on the map */
  let activeSelectionSlugs: string[] = [];
  /**
   * Slugs matching the active search filters: features outside of this set are faded on the map
   * (issue #215). Undefined when no search is active: nothing is dimmed.
   */
  let dimMatches: ReadonlySet<string> | undefined;
  /** Set by the LocationMap instance, which has access to the sidebar selection context */
  let lassoSelect: ((slugs: string[]) => void) | undefined;
  /** Set by the LocationMap instance, which has access to the sidebar selection context */
  let clearSidebarSelection: (() => void) | undefined;

  function setSharedColorMode(mode: "grade" | "type" | "both") {
    sharedColorMode = mode;
    if (shared?.map) applyColorMode(shared.map, mode);
  }

  setMapCenterProvider(() => {
    if (!shared || !shared.element.isConnected || !positioned) return undefined;
    const center = shared.map.getCenter();
    return { lat: center.lat, lon: center.lng };
  });

  function setMarkerPosition(coords: { lat: number; lon: number }, draggable = false) {
    if (!shared) return;
    const map = shared.map;
    if (dragMarker) {
      dragMarker.setLngLat([coords.lon, coords.lat]);
      dragMarker.setDraggable(draggable);
    } else {
      dragMarker = new Marker({ color: "#2563eb", draggable }).setLngLat([coords.lon, coords.lat]).addTo(map);

      // MapLibre only starts a marker drag once the pointer moves past the click tolerance, and
      // keeps the drag-pan handler active until then: the first pixels of the drag still pan the
      // map (issues #210 and #212). Freeze the camera as soon as the pointer goes down on the
      // marker instead, and restore it on release. `dragend` also restores it, covering releases
      // that happen outside of the marker element.
      const element = dragMarker.getElement();
      element.addEventListener("pointerdown", () => {
        if (dragMarker?.isDraggable()) map.dragPan.disable();
      });
      element.addEventListener("pointerup", () => map.dragPan.enable());
      dragMarker.on("dragend", () => {
        map.dragPan.enable();
        if (currentOnmove) {
          const lngLat = dragMarker!.getLngLat();
          currentOnmove({ lat: lngLat.lat, lon: lngLat.lng });
        }
      });
    }
  }

  function applyColorMode(map: MapLibreMap, mode: "grade" | "type" | "both") {
    if (!map.isStyleLoaded() || !map.getLayer("routes")) return;
    if (mode === "grade") {
      map.setPaintProperty("routes", "circle-color", ["get", "fillColor"]);
      map.setPaintProperty("routes", "circle-stroke-color", "#ffffff");
      map.setPaintProperty("routes", "circle-stroke-width", 1.5);
    } else if (mode === "type") {
      map.setPaintProperty("routes", "circle-color", ["get", "strokeColor"]);
      map.setPaintProperty("routes", "circle-stroke-color", "#ffffff");
      map.setPaintProperty("routes", "circle-stroke-width", 1.5);
    } else {
      map.setPaintProperty("routes", "circle-color", ["get", "fillColor"]);
      map.setPaintProperty("routes", "circle-stroke-color", ["get", "strokeColor"]);
      map.setPaintProperty("routes", "circle-stroke-width", [
        "interpolate",
        ["linear"],
        ["zoom"],
        8,
        1,
        14,
        1.5,
        17,
        2,
      ]);
    }
  }

  function setElementsSourceData(map: MapLibreMap, collection: MapElementFeatureCollection) {
    const source = map.getSource<GeoJSONSource>("climbing-elements");
    if (!source) return;
    source.setData(collection);
  }

  /**
   * Flags the cached features excluded by the active search filters, so the map layers fade them
   * out while keeping colors for matching elements (issue #215). Only the features whose flag
   * changed are rewritten, and the source is updated once.
   */
  function applySearchDimming(map: MapLibreMap) {
    const matches = dimMatches;
    let changed = false;
    for (const f of cachedCollection.features) {
      const dimmed = matches !== undefined && !matches.has(f.properties.slug);
      if (Boolean(f.properties.dimmed) !== dimmed) {
        f.properties.dimmed = dimmed;
        changed = true;
      }
    }
    if (changed) setElementsSourceData(map, cachedCollection);
  }

  /** Adds the climbing source and layers to the current style. Safe to call again after a style switch. */
  function setupStyleLayers(map: MapLibreMap) {
    addTerrainSource(map);
    // Hide basemap climbing POIs so vector tiles do not duplicate or conflict with our data
    for (const layer of map.getStyle().layers || []) {
      const l = layer as { id: string; "source-layer"?: string; filter?: any[] };
      if (l["source-layer"] === "poi") {
        const filter = Array.isArray(l.filter) ? l.filter : ["all"];
        map.setFilter(l.id, [
          "all",
          filter,
          ["!=", ["get", "class"], "sport"],
          ["!=", ["get", "subclass"], "climbing"],
        ] as any);
      }
    }

    if (!map.getSource("climbing-elements")) {
      map.addSource("climbing-elements", {
        type: "geojson",
        data: cachedCollection,
        tolerance: 0.5,
      });
    }
    if (!map.getSource("route-line")) {
      map.addSource("route-line", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
    }

    for (const layer of CLIMBING_LAYERS) {
      if (!map.getLayer(layer.id)) {
        map.addLayer(layer);
      }
    }

    applyColorMode(map, sharedColorMode);
    applyHighlightFilters(map, activeHighlightSlug);
  }

  /** Current "Add route" state, synced from the LocationMap instance to the control */
  let addRouteState: { active: boolean; toggle: () => void } | undefined;

  /** "Add route" toggle, grouped with the other map commands in the top-right control cluster */
  class AddRouteControl implements IControl {
    private container: HTMLDivElement | undefined;
    private button: HTMLButtonElement | undefined;

    onAdd() {
      const container = document.createElement("div");
      container.className = "maplibregl-ctrl";
      const button = document.createElement("button");
      button.type = "button";
      button.title = "Add route";
      button.setAttribute("aria-label", "Add route");
      // Styled after the MapLibre controls, which stay white in every color mode
      button.className =
        "flex h-[29px] w-[29px] cursor-pointer items-center justify-center overflow-hidden rounded-md border border-black/10 bg-white text-slate-800 shadow-[0_0_0_2px_rgba(0,0,0,0.1)] transition-colors hover:bg-slate-100 sm:w-auto sm:px-2 aria-checked:border-primary aria-checked:bg-primary aria-checked:text-primary-foreground";
      button.innerHTML =
        '<span class="icon-[lucide--map-pin-plus] size-5 shrink-0 sm:hidden" aria-hidden="true"></span>' +
        '<span class="hidden text-[13px] font-medium sm:inline">Add route</span>';
      button.onclick = () => addRouteState?.toggle();
      container.appendChild(button);
      this.container = container;
      this.button = button;
      return container;
    }

    onRemove() {
      this.container?.remove();
      this.container = undefined;
      this.button = undefined;
    }

    /** Shows the button only while adding a route is possible, and highlights it while placing */
    update() {
      if (!this.container) return;
      this.container.hidden = !addRouteState;
      this.button?.setAttribute("aria-checked", String(addRouteState?.active === true));
    }
  }

  let addRouteControl = new AddRouteControl();

  function syncAddRouteControl() {
    addRouteControl.update();
  }

  /** Collapsible legend, grouped with the other map commands in the top-right control cluster */
  class LegendControl implements IControl {
    private container: HTMLDivElement | undefined;
    private instance: ReturnType<typeof mount> | undefined;

    onAdd() {
      const container = document.createElement("div");
      container.className = "maplibregl-ctrl map-legend-ctrl";
      this.instance = mount(MapLegend, {
        target: container,
        props: { onColorMode: setSharedColorMode, onElementTypeVisibility: setSharedElementTypeVisibility },
      });
      this.container = container;
      return container;
    }

    onRemove() {
      if (this.instance) unmount(this.instance as never);
      this.instance = undefined;
      this.container?.remove();
      this.container = undefined;
    }
  }

  let legendControl = new LegendControl();

  /** Applies the legend element-type visibility toggles to the shared map (issue #173) */
  function setSharedElementTypeVisibility(hiddenTypes: string[]) {
    if (!shared?.map) return;
    applyElementTypeVisibility(shared.map, new Set(hiddenTypes));
  }

  function applyHighlightFilters(map: MapLibreMap, slug: string) {
    const cleanSlug = slug.replace(/^world\//, "");
    const companion = companionLookup[cleanSlug] ?? companionLookup[slug] ?? "";
    const slugLiterals = [slug, cleanSlug, `world/${cleanSlug}`];
    if (companion) slugLiterals.push(companion);
    const selectionLiterals = activeSelectionSlugs.flatMap((s) => {
      const parts = [s, companionLookup[s]];
      return parts.filter((p): p is string => !!p);
    });
    if (map.getLayer("selected-ring")) {
      map.setFilter("selected-ring", [
        "all",
        ["==", ["geometry-type"], "Point"],
        ["!=", ["get", "elementType"], "sector"],
        [
          "any",
          ["in", ["get", "slug"], ["literal", slugLiterals]],
          ["in", ["get", "slug"], ["literal", selectionLiterals]],
        ],
      ]);
    }
    if (map.getLayer("selected-sector")) {
      map.setFilter("selected-sector", [
        "all",
        ["==", ["get", "elementType"], "sector"],
        ["in", ["get", "slug"], ["literal", [slug, cleanSlug, `world/${cleanSlug}`]]],
      ]);
    }
    if (map.getLayer("selected-cliff")) {
      map.setFilter("selected-cliff", [
        "all",
        ["==", ["get", "elementType"], "cliff"],
        ["in", ["get", "slug"], ["literal", [slug, cleanSlug, `world/${cleanSlug}`]]],
      ]);
    }
    if (map.getLayer("selected-cliff-label")) {
      map.setFilter("selected-cliff-label", [
        "all",
        ["==", ["get", "elementType"], "cliff"],
        ["in", ["get", "slug"], ["literal", [slug, cleanSlug, `world/${cleanSlug}`]]],
      ]);
    }
    if (map.getLayer("selected-sector-label")) {
      map.setFilter("selected-sector-label", [
        "all",
        ["==", ["get", "elementType"], "sector"],
        ["in", ["get", "slug"], ["literal", [slug, cleanSlug, `world/${cleanSlug}`]]],
      ]);
    }
  }

  function updateActiveHighlight(slug: string) {
    activeHighlightSlug = slug;
    if (shared?.map) applyHighlightFilters(shared.map, slug);
  }

  async function loadMapElements(map: MapLibreMap) {
    if (allElementsLoaded) return;

    if (localDb.ready) {
      const data = await localDb.getAllMapElements();
      if (data && data.features.length > 0) {
        for (const f of data.features) {
          f.properties.href = resolve("/world/[...slug]", { slug: f.properties.slug });
          loadedSlugs.add(f.properties.slug);
        }
        cachedCollection = data;
        allElementsLoaded = true;
        setElementsSourceData(map, cachedCollection);
        // The collection was replaced: reapply the search dimming flags (issue #215)
        applySearchDimming(map);
        return;
      }
    }

    const points = await dataClient.getTopLevelPoints();
    if (points.length > 0 && cachedCollection.features.length === 0) {
      cachedCollection = {
        type: "FeatureCollection",
        features: points.map((p) => {
          loadedSlugs.add(p.slug);
          return {
            type: "Feature",
            geometry: { type: "Point", coordinates: [p.lon, p.lat] },
            properties: {
              slug: p.slug,
              name: p.name ?? "Unnamed",
              elementType: "area",
              fillColor: FEATURE_COLORS.area.fill,
              strokeColor: FEATURE_COLORS.area.stroke,
              href: resolve("/world/[...slug]", { slug: p.slug }),
            },
          };
        }),
      };
      setElementsSourceData(map, cachedCollection);
      applySearchDimming(map);
    }
  }

  function updateOrAddElement(
    map: MapLibreMap,
    slug: string,
    feature: OsmFeature,
    fallbackCoords?: { lat: number; lon: number },
  ) {
    const existingIndex = cachedCollection.features.findIndex((f) => f.properties.slug === slug);
    const existingFeature = existingIndex >= 0 ? cachedCollection.features[existingIndex] : undefined;
    if (existingFeature && existingFeature.properties.elementType === "sector") {
      // Do not overwrite an existing sector contour with an area point!
      if (feature.tags?.name) {
        existingFeature.properties.name = feature.tags.name;
        setElementsSourceData(map, cachedCollection);
      }
      return;
    }
    const element = featureToMapElement(slug, feature, fallbackCoords);
    if (!element) return;
    // Keep the dimming state consistent when an element is downloaded or updated mid-search
    element.properties.dimmed = dimMatches !== undefined && !dimMatches.has(slug);
    if (existingIndex >= 0) {
      cachedCollection.features[existingIndex] = element;
    } else {
      loadedSlugs.add(slug);
      cachedCollection.features.push(element);
    }
    setElementsSourceData(map, cachedCollection);
  }

  function updateElementCoordinates(map: MapLibreMap, slug: string, coords: { lat: number; lon: number }) {
    const existing = cachedCollection.features.find((f) => f.properties.slug === slug);
    if (existing && existing.geometry.type === "Point") {
      const [curLon, curLat] = existing.geometry.coordinates;
      if (curLon !== coords.lon || curLat !== coords.lat) {
        existing.geometry.coordinates = [coords.lon, coords.lat];
        setElementsSourceData(map, cachedCollection);
      }
    }
  }

  type LassoPoint = { x: number; y: number };

  /** Coordinates of every vertex of a rendered feature line, for the lasso hit test */
  function featureLineCoordinates(geometry: GeoJSON.Geometry): [number, number][] {
    if (geometry.type === "LineString") return geometry.coordinates as [number, number][];
    if (geometry.type === "MultiLineString") return geometry.coordinates.flat() as [number, number][];
    if (geometry.type === "Point") return [geometry.coordinates as [number, number]];
    return [];
  }

  /** Even-odd ray casting against the closed freehand lasso */
  function pointInPolygon(point: LassoPoint, polygon: LassoPoint[]) {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const a = polygon[i]!;
      const b = polygon[j]!;
      if (a.y > point.y !== b.y > point.y && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
    }
    return inside;
  }

  /** True when any route segment crosses a lasso edge, so routes poking through the shape are caught too */
  function lineCrossesPolygon(points: LassoPoint[], polygon: LassoPoint[]) {
    const cross = (o: LassoPoint, p: LassoPoint, q: LassoPoint) => (p.x - o.x) * (q.y - o.y) - (p.y - o.y) * (q.x - o.x);
    for (let i = 1; i < points.length; i++) {
      for (let j = 1; j < polygon.length; j++) {
        const a = points[i - 1]!;
        const b = points[i]!;
        const c = polygon[j - 1]!;
        const d = polygon[j]!;
        if (cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0) return true;
      }
    }
    return false;
  }


  /** Shift+drag draws a freehand lasso and selects every route inside or crossing it, like the sidebar selection */
  function setupLasso(map: MapLibreMap) {
    let overlay: SVGSVGElement | undefined;
    let path: SVGPathElement | undefined;
    let trace: LassoPoint[] | undefined;

    function endLasso() {
      overlay?.remove();
      overlay = path = undefined;
      trace = undefined;
      map.getCanvas().style.cursor = "";
    }

    function updateTrace(point: LassoPoint) {
      if (!trace || !path) return;
      const last = trace.at(-1);
      // Skip points closer than 2px: keeps the SVG path and the hit-test polygon small
      if (last && Math.hypot(point.x - last.x, point.y - last.y) < 2) return;
      trace.push(point);
      path.setAttribute("d", `M${trace.map((p) => `${Math.round(p.x)} ${Math.round(p.y)}`).join("L")}`);
    }

    map.on("mousedown", (e) => {
      if (activePlacementMode || !e.originalEvent.shiftKey || e.originalEvent.button !== 0 || trace) return;
      // Without the default box zoom, shift+drag would pan the map: freeze it while selecting
      e.preventDefault();
      suppressNextClick = true;
      trace = [e.point];
      overlay = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      overlay.classList.add("map-lasso-overlay");
      path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.classList.add("map-lasso");
      overlay.appendChild(path);
      map.getContainer().appendChild(overlay);
    });

    map.on("mousemove", (e) => {
      if (trace) updateTrace(e.point);
    });

    map.on("mouseup", (e) => {
      if (!trace) return;
      updateTrace(e.point);
      const polygon = trace;
      endLasso();
      const slugs = new Set<string>();
      for (const feature of map.queryRenderedFeatures({ layers: ["routes"] })) {
        const points = featureLineCoordinates(feature.geometry).map((c) => map.project(c));
        if (points.some((p) => pointInPolygon(p, polygon)) || lineCrossesPolygon(points, polygon)) {
          const slug = feature.properties?.slug;
          if (typeof slug === "string") slugs.add(slug);
        }
      }
      // The click event fires right after mouseup: swallow it so it does not navigate
      setTimeout(() => (suppressNextClick = false), 0);
      if (slugs.size > 0) lassoSelect?.([...slugs]);
    });

    // Right-clicking a selected route opens the same bulk context menu as the sidebar selection.
    // Right-drag rotates the 3D view: the menu only opens for a click without movement
    // and only when the click lands on one of the selected routes.
    let contextMenuStart: { x: number; y: number } | undefined;

    map.on("mousedown", (e) => {
      if (e.originalEvent.button === 2) contextMenuStart = { x: e.point.x, y: e.point.y };
    });

    // The map never shows the browser menu: the bulk menu is dispatched on mouseup below
    map.getCanvas().addEventListener("contextmenu", (e) => e.preventDefault());

    map.on("mouseup", (e) => {
      if (e.originalEvent.button !== 2 || !contextMenuStart) return;
      const moved = Math.hypot(e.point.x - contextMenuStart.x, e.point.y - contextMenuStart.y);
      contextMenuStart = undefined;
      if (moved > 3 || activeSelectionSlugs.length === 0) return;
      const onSelected = map
        .queryRenderedFeatures(e.point, { layers: ["routes", "selected-ring", "route-labels"] })
        .some((f) => typeof f.properties?.slug === "string" && activeSelectionSlugs.includes(f.properties.slug));
      if (!onSelected) return;
      const tree = document.querySelector<HTMLDivElement>('[role="tree"]');
      if (!tree) return;
      tree.dispatchEvent(
        new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          button: 2,
          clientX: e.originalEvent.clientX,
          clientY: e.originalEvent.clientY,
        }),
      );
    });
  }

  function getSharedMap() {
    if (shared) return shared;
    const element = document.createElement("div");
    element.className = "size-full location-map-host";
    const map = new MapLibreMap({
      container: element,
      style: VECTOR_STYLE,
      center: [0, 30],
      zoom: 1.5,
      maxZoom: 22,
      maxTileCacheSize: 200,
      attributionControl: { compact: true },
    });
    if (typeof window !== "undefined") (window as any).__maplibre = map;
    // The compass doubles as a north arrow (issue #213): always visible in 3D, and whenever the
    // map is rotated so north is not up. `map-3d` is toggled by the terrain control above.
    const syncRotated = () => element.classList.toggle("map-rotated", map.getBearing() !== 0);
    map.on("rotate", syncRotated);
    syncRotated();
    map.addControl(new NavigationControl({ visualizePitch: true }), "top-right");
    map.addControl(new GeolocateControl({ positionOptions: { enableHighAccuracy: true } }), "top-right");
    map.addControl(new TerrainControl({ source: "terrain" }), "top-right");
    // The relief button toggles 3D terrain: explain how to rotate the view once it is on (issue #213)
    const terrainButton = element.querySelector<HTMLButtonElement>(".maplibregl-ctrl-terrain");
    if (terrainButton) {
      terrainButton.title =
        "Toggle 3D terrain. With terrain on, drag with the right mouse button (or two fingers on a trackpad) to rotate the view.";
    }
    map.addControl(addRouteControl, "top-right");
    map.addControl(legendControl, "top-right");
    map.addControl(new ScaleControl({ unit: "metric" }), "bottom-left");
    // Shift+drag draws a selection lasso instead of the default box zoom
    map.boxZoom.disable();

    map.on("load", () => {
      setupStyleLayers(map);
      setupLasso(map);

      const popup = new Popup({
        closeButton: false,
        closeOnClick: false,
        offset: 8,
        className: "location-map-popup",
      });

      const interactiveLayers = [
        "route-labels",
        "routes",
        "selected-ring",
        "cliffs",
        "areas",
        "gyms",
        "selected-sector-label",
        "selected-sector",
        "sectors-label",
        "sectors-contour",
      ];

      map.on("mousemove", (e) => {
        if (activePlacementMode) {
          map.getCanvas().style.cursor = "crosshair";
          popup.remove();
          return;
        }
        const features = map.queryRenderedFeatures(e.point, { layers: interactiveLayers });
        const feature = features[0];
        if (!feature) {
          map.getCanvas().style.cursor = "";
          popup.remove();
          return;
        }
        map.getCanvas().style.cursor = "pointer";
        const props = feature.properties as MapElementFeature["properties"];
        popup.setLngLat(e.lngLat).setHTML(formatPopupHtml(props)).addTo(map);
      });

      map.getCanvas().addEventListener("mouseleave", () => {
        map.getCanvas().style.cursor = "";
        popup.remove();
      });

      map.on("click", (e) => {
        if (suppressNextClick) {
          suppressNextClick = false;
          return;
        }
        if (activePlacementMode && currentOnmapclick) {
          currentOnmapclick({ lat: e.lngLat.lat, lon: e.lngLat.lng });
          return;
        }
        // A plain click on the map dismisses the active selection
        if (activeSelectionSlugs.length > 0) clearSidebarSelection?.();
        const features = map.queryRenderedFeatures(e.point, { layers: interactiveLayers });
        const feature = features[0];
        if (!feature) return;

        if (feature.geometry.type === "Point") {
          const [lon, lat] = feature.geometry.coordinates as [number, number];
          setMarkerPosition({ lon, lat });
        }

        const href = feature.properties?.href;
        if (href) goto(href);
      });

      map.on("moveend", (e) => {
        if ((e as { originalEvent?: unknown }).originalEvent) {
          userPositioned = true;
          positioned = true;
          // The user took control of the camera: the next target move may re-position it
          cameraTargetKey = undefined;
        }
      });

      void loadMapElements(map);
    });

    return (shared = { map, element });
  }
</script>

<script lang="ts">
  import { onMount } from "svelte";
  import type { GeographicFolderElement } from "@bloknote/climbing-data-gen";
  import { getSidebarSelection } from "./shell/sidebar/selection.svelte";

  let {
    currentSlug = "",
    currentFeature,
    coordinates,
    fallbackCoordinates,
    bounds,
    draggable = false,
    placementMode = null,
    addRoute,
    zoom = 15,
    class: className = "",
    onmove,
    onmapclick,
    companionSlugs = {},
  }: {
    currentSlug?: string;
    currentFeature?: OsmFeature | GeographicFolderElement | undefined;
    coordinates?: { lat: number; lon: number } | undefined;
    fallbackCoordinates?: { lat: number; lon: number } | undefined;
    bounds?: { x0: number; x1: number; y0: number; y1: number } | undefined;
    draggable?: boolean;
    placementMode?: "route" | "sector" | null;
    /** When set, an "Add route" button is shown with the other map commands to toggle placement */
    addRoute?: { active: boolean; toggle: () => void };
    zoom?: number;
    class?: string;
    onmove?: (position: { lat: number; lon: number }) => void;
    onmapclick?: (position: { lat: number; lon: number }) => void;
    /** Map of route slug -> companion (bottom/top of the same route) slug, highlighted together (issue #135) */
    companionSlugs?: Record<string, string>;
  } = $props();

  let host: HTMLDivElement;
  let attached = $state(false);

  /** True while the map has no climbing data to display yet, either downloading or reading the local database */
  const elementsLoading = $derived(
    localDb.status === "unknown" ||
      localDb.status === "downloading" ||
      (localDb.status === "ready" && !allElementsLoaded),
  );

  const selection = getSidebarSelection();

  // The lasso and the sidebar share the same selection: both highlight on the map and the tree
  $effect(() => {
    lassoSelect = (slugs) => {
      for (const slug of slugs) selection?.selected.add(slug);
    };
    clearSidebarSelection = () => {
      selection?.clear();
      selection?.setAnchor(undefined);
    };
  });

  // Reflect the "Add route" placement state in the map control
  $effect(() => {
    addRouteState = addRoute;
    syncAddRouteControl();
  });

  function moveToTarget() {
    if (!attached || !shared) return;
    const map = shared.map;

    const key = bounds
      ? `b:${bounds.x0},${bounds.y0},${bounds.x1},${bounds.y1}`
      : coordinates
        ? `c:${coordinates.lat},${coordinates.lon}`
        : undefined;
    // Nothing to move to, or the camera already flies to / sits on this exact target
    if (!key || cameraTargetKey === key) return;
    cameraTargetKey = key;
    positioned = true;

    if (bounds) {
      map.fitBounds(
        [
          [bounds.x0, bounds.y0],
          [bounds.x1, bounds.y1],
        ],
        { padding: 40, maxZoom: 16, duration: 600 },
      );
      return;
    }

    if (!coordinates) return;

    // The user placed the camera themselves: a target that is already visible is only
    // highlighted and selected, the map is not moved at all (issue #200)
    if (userPositioned && map.getBounds().contains([coordinates.lon, coordinates.lat])) {
      return;
    }

    map.flyTo({
      center: [coordinates.lon, coordinates.lat],
      zoom: Math.max(map.getZoom(), zoom),
      duration: 700,
    });
  }

  function getEffectiveCoordinates(): { lat: number; lon: number } | undefined {
    const cleanSlug = currentSlug.replace(/^world\//, "");
    const feat = cachedCollection.features.find(
      (f) =>
        f.properties.slug === currentSlug ||
        f.properties.slug === cleanSlug ||
        f.properties.slug === `world/${cleanSlug}`,
    );
    const isSector = feat?.properties.elementType === "sector";
    if (isSector && (shared?.map?.getZoom() ?? 15) >= 13) {
      return undefined;
    }

    if (coordinates) return coordinates;
    if (fallbackCoordinates) return fallbackCoordinates;
    if (!currentSlug) return undefined;
    if (!feat) return undefined;
    if (feat.geometry.type === "Point") {
      const [lon, lat] = feat.geometry.coordinates as [number, number];
      return { lat, lon };
    }
    if (feat.geometry.type === "LineString" && feat.geometry.coordinates.length > 0) {
      const coords = feat.geometry.coordinates as [number, number][];
      const lon = coords.reduce((sum, c) => sum + c[0], 0) / coords.length;
      const lat = coords.reduce((sum, c) => sum + c[1], 0) / coords.length;
      return { lat, lon };
    }
    return undefined;
  }

  /** Whether the currently displayed feature is a cliff: those are highlighted as a line, not a center marker */
  function isCurrentCliff(): boolean {
    if (currentFeature && (currentFeature as OsmFeature).tags?.natural === "cliff") return true;
    const cleanSlug = currentSlug.replace(/^world\//, "");
    return cachedCollection.features.some(
      (f) =>
        f.properties.elementType === "cliff" &&
        (f.properties.slug === currentSlug ||
          f.properties.slug === cleanSlug ||
          f.properties.slug === `world/${cleanSlug}`),
    );
  }

  function updateDraggableMarker() {
    if (!attached || !shared) return;
    currentOnmove = onmove;
    // Cliffs are mapped as ways: highlighting their individual points through the selected-cliff
    // line layer replaces the center marker (see issue #153)
    if (isCurrentCliff()) {
      if (dragMarker) {
        dragMarker.remove();
        dragMarker = undefined;
      }
      return;
    }
    const coords = getEffectiveCoordinates();

    if (!coords) {
      if (dragMarker) {
        dragMarker.remove();
        dragMarker = undefined;
      }
      return;
    }

    setMarkerPosition(coords, Boolean(draggable && onmove));
  }

  onMount(() => {
    const { map, element } = getSharedMap();
    if (typeof window !== "undefined") (window as any).__maplibre = map;
    host.appendChild(element);
    map.resize();
    attached = true;

    const onMapReady = () => {
      void loadMapElements(map);
      moveToTarget();
      updateActiveHighlight(currentSlug);
      updateDraggableMarker();
      applyColorMode(map, sharedColorMode);
    };

    if (map.getLayer("routes")) {
      onMapReady();
    } else {
      map.once("load", () => {
        onMapReady();
      });
    }

    map.on("zoom", updateDraggableMarker);

    const ro = new ResizeObserver(() => {
      if (attached && host.clientWidth > 0 && host.clientHeight > 0) {
        map.resize();
      }
    });
    ro.observe(host);

    return () => {
      attached = false;
      ro.disconnect();
      map.off("zoom", updateDraggableMarker);
      if (element.parentElement === host) element.remove();
    };
  });

  // Watch for localDb becoming ready to load all elements
  $effect(() => {
    if (localDb.ready && shared?.map && !allElementsLoaded) {
      void loadMapElements(shared.map);
    }
  });

  // Add or update current feature if downloaded or updated upstream
  $effect(() => {
    if (currentSlug && currentFeature && currentFeature.type !== "geographic" && shared?.map) {
      updateOrAddElement(shared.map, currentSlug, currentFeature as OsmFeature, fallbackCoordinates);
    }
  });

  // Sync placement mode cursor and click handler
  $effect(() => {
    activePlacementMode = placementMode;
    currentOnmapclick = onmapclick;
    if (attached && shared?.map) {
      shared.map.getCanvas().style.cursor = placementMode ? "crosshair" : "";
    }
  });

  // Ensure dot position synchronizes with updated coordinates (e.g. after redownload upstream)
  $effect(() => {
    if (currentSlug && coordinates && shared?.map) {
      updateElementCoordinates(shared.map, currentSlug, coordinates);
    }
  });

  // React to target position / bounds / slug change
  $effect(() => {
    coordinates;
    bounds;
    currentSlug;
    if (attached && shared?.map) {
      moveToTarget();
      updateDraggableMarker();
      updateActiveHighlight(currentSlug);
    }
  });

  // On a fresh visit the database is still downloading when the map loads, so loadMapElements
  // found nothing (issue #150). Retry as soon as the database becomes ready.
  $effect(() => {
    if (localDb.ready && !allElementsLoaded && shared?.map) void loadMapElements(shared.map);
  });

  // Bottom/top companions of the current page's routes are highlighted and joined together (issue #135)
  $effect(() => {
    companionLookup = companionSlugs ?? {};
    if (attached && shared?.map) applyHighlightFilters(shared.map, currentSlug);
  });

  // Draws a line between the bottom and top points of the currently open route (issue #135)
  $effect(() => {
    const map = shared?.map;
    const source = map?.getSource<GeoJSONSource>("route-line");
    if (!attached || !map || !source) return;
    const cleanSlug = currentSlug.replace(/^world\//, "");
    const companion = companionLookup[cleanSlug] ?? companionLookup[currentSlug];
    const other = companion ? cachedCollection.features.find((f) => f.properties.slug === companion) : undefined;
    const otherCoords =
      other && other.geometry.type === "Point" ? (other.geometry.coordinates as [number, number]) : undefined;
    if (!coordinates || !otherCoords) {
      source.setData({ type: "FeatureCollection", features: [] });
      return;
    }
    source.setData({
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: { type: "LineString", coordinates: [[coordinates.lon, coordinates.lat], otherCoords] },
          properties: { slug: currentSlug, elementType: "route-line" },
        },
      ],
    });
  });

  // Highlight lasso/selected routes on the map when the sidebar selection changes
  $effect(() => {
    activeSelectionSlugs = selection ? [...selection.selected] : [];
    if (attached && shared?.map) applyHighlightFilters(shared.map, currentSlug);
  });

  // Fade the elements excluded by the active search filters on the map (issue #215). The dimming
  // is only applied once a search batch has settled (paused or done): re-pushing the whole source
  // on every streamed batch would stall the map while searching.
  $effect(() => {
    const active = searchState.active;
    const result = searchState.result;
    if (!attached || !shared?.map) return;
    dimMatches = active && result ? result.matches : undefined;
    if (result === undefined || result.status !== "searching") applySearchDimming(shared.map);
  });
</script>

<div class={`relative ${className}`}>
  <div bind:this={host} class="relative h-full w-full overflow-hidden rounded-md border border-border">
    {#if elementsLoading}
      <!-- Non-blocking: the user must still be able to pan/zoom the map while data loads (issue #141) -->
      <div
        class="pointer-events-none absolute top-2 right-2 z-10 flex items-center gap-2 rounded-md bg-background/80 px-3 py-2 shadow-sm backdrop-blur-sm"
      >
        <span class="icon-[lucide--loader-circle] shrink-0 size-4 animate-spin text-muted-foreground"></span>
        {#if localDb.status === "downloading" && localDb.total}
          <span class="text-xs text-muted-foreground">
            {localDb.phase === "parsing" ? "Parsing" : "Downloading"} climbing data
            {Math.min(100, Math.round((localDb.loaded / localDb.total) * 100))}%
          </span>
        {:else}
          <span class="text-xs text-muted-foreground">Loading climbing data...</span>
        {/if}
      </div>
    {/if}
  </div>
</div>

<style>
  /* The compass (pitch indicator) doubles as a north arrow: visible in 3D, and whenever the
     map is rotated so north is not up (issue #213) */
  :global(.location-map-host .maplibregl-ctrl-compass) {
    display: none;
  }
  :global(.location-map-host.map-3d .maplibregl-ctrl-compass),
  :global(.location-map-host.map-rotated .maplibregl-ctrl-compass) {
    display: block;
  }
  /* MapLibre popups are white, whatever the theme */
  :global(.location-map-popup .maplibregl-popup-content) {
    background: var(--popover);
    color: var(--popover-foreground);
    padding: 4px 8px;
    font-size: 0.75rem;
  }
  :global(.location-map-popup.maplibregl-popup-anchor-top .maplibregl-popup-tip),
  :global(.location-map-popup.maplibregl-popup-anchor-top-left .maplibregl-popup-tip),
  :global(.location-map-popup.maplibregl-popup-anchor-top-right .maplibregl-popup-tip) {
    border-bottom-color: var(--popover);
  }
  :global(.location-map-popup.maplibregl-popup-anchor-bottom .maplibregl-popup-tip),
  :global(.location-map-popup.maplibregl-popup-anchor-bottom-left .maplibregl-popup-tip),
  :global(.location-map-popup.maplibregl-popup-anchor-bottom-right .maplibregl-popup-tip) {
    border-top-color: var(--popover);
  }
  :global(.location-map-popup.maplibregl-popup-anchor-left .maplibregl-popup-tip) {
    border-right-color: var(--popover);
  }
  :global(.location-map-popup.maplibregl-popup-anchor-right .maplibregl-popup-tip) {
    border-left-color: var(--popover);
  }
  /* Freehand selection lasso drawn with shift+drag */
  :global(.map-lasso-overlay) {
    position: absolute;
    inset: 0;
    z-index: 5;
    width: 100%;
    height: 100%;
    pointer-events: none;
  }
  :global(.map-lasso-overlay .map-lasso) {
    fill: rgba(37, 99, 235, 0.1);
    stroke: #2563eb;
    stroke-width: 1.5;
    stroke-linejoin: round;
    stroke-linecap: round;
  }
</style>
