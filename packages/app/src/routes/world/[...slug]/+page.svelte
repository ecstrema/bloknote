<script lang="ts">
  import ComponentParseFailed from "./component-parse-failed.svelte";
  import GeographicPage from "./geographic-page.svelte";
  import AreaPage from "./area-page.svelte";
  import GymPage from "./gym-page.svelte";
  import RoutePage from "./route-page.svelte";
  import type { GeographicFolderElement } from "@bloknote/climbing-data-gen";
  import type { DataTree } from "#lib/types.js";
  import { featureToType } from "#lib/data/parse/data.js";
  import type { OsmFeature } from "osm-api";
  import type { PageProps } from "./$types";
  import OsmMissingFeature from "#components/shell/osm-missing-feature.svelte";
  import { getStaticIdentifier } from "@bloknote/common";
  import { getAppState } from "#lib/data/app-state.js";
  import { afterNavigate, goto } from "$app/navigation";
  import { building } from "$app/env";
  import { page } from "$app/state";
  import { untrack } from "svelte";
  import LocationMap from "#lib/components/location-map.svelte";
  import MapAddDialog from "#lib/components/map-add-dialog.svelte";
  import DiagnosticsPanel from "#lib/components/diagnostics-panel.svelte";
  import { collectSubtreeDiagnostics } from "#lib/data/parse/diagnostics.js";
  import { localDb } from "#lib/data/db/local-db.svelte.js";
  import type { DataJSON } from "@bloknote/climbing-data-gen";
  import { Button } from "#components/ui/button/index.js";
  import { getFallbackCoordinates } from "#lib/data/route-location.js";
  import EditableName from "#components/editable/editable-name.svelte";
  import EditableTags from "#components/editable/editable-tags.svelte";
  import * as Tabs from "#components/ui/tabs/index.js";
  import { getLocalizedName } from "#lib/data/parse/localized-name.js";
  import { getCoordinates } from "#lib/data/parse/osm-tags.js";
  import { getNearbyDots } from "#lib/data/nearby-dots.js";
  import BuildingIcon from "@lucide/svelte/icons/building";
  import DatabaseIcon from "@lucide/svelte/icons/database";
  import ExternalLinkIcon from "@lucide/svelte/icons/external-link";
  import FileTextIcon from "@lucide/svelte/icons/file-text";
  import FolderPlusIcon from "@lucide/svelte/icons/folder-plus";
  import MapIcon from "@lucide/svelte/icons/map";
  import MapPinPlusIcon from "@lucide/svelte/icons/map-pin-plus";
  import StethoscopeIcon from "@lucide/svelte/icons/stethoscope";
  import CheckCircle2Icon from "@lucide/svelte/icons/check-circle-2";

  type PageTab = "overview" | "map" | "osm" | "diagnostics";
  function parseTab(value: string | null): PageTab | undefined {
    return value === "overview" || value === "map" || value === "osm" || value === "diagnostics" ? value : undefined;
  }

  let { params }: PageProps = $props();

  const slug = $derived(params.slug);

  const appState = getAppState();

  let queriedItem = $state<{ item: DataTree<OsmFeature>; slug: string }>();
  let lastQueryId: string | null | undefined;
  $effect(() => {
    const id = page.url.searchParams.get("id");
    // The tree walk must not subscribe this effect to every node
    const found = untrack(() => {
      if (!id) return undefined;
      const feature = appState.currentNode.current.feature;
      if (feature.type !== "geographic" && `${feature.type}-${feature.id}` === id) return undefined;
      return appState.findOsmItemById(id);
    });
    if (found) queriedItem = found;
    else if (id !== lastQueryId) queriedItem = undefined;
    lastQueryId = id;
  });
  let item = $derived(queriedItem?.item ?? appState.currentNode.current);
  const itemSlug = $derived(queriedItem?.slug ?? slug);
  const itemType = $derived(featureToType(item.feature));
  const hasOsmData = $derived(item.feature.type !== "geographic");

  let activeTab = $state<PageTab>(building ? "overview" : (parseTab(page.url.searchParams.get("tab")) ?? "overview"));
  const effectiveTab = $derived<PageTab>(activeTab === "osm" && !hasOsmData ? "overview" : activeTab);

  $effect(() => {
    if (!hasOsmData && activeTab === "osm") {
      activeTab = "overview";
    }
  });

  function onTabChange(value: string) {
    const next = parseTab(value) ?? "overview";
    activeTab = next;
    const url = new URL(page.url.href);
    if (next === "overview") url.searchParams.delete("tab");
    else url.searchParams.set("tab", next);
    void goto(url, { state: page.state, shallow: true, replace: true });
  }

  // Shared links carry the OSM id so the item can be found if its path changes.
  // Not an effect: shallow goto updates page.url, which would re-trigger an effect.
  afterNavigate((navigation) => {
    untrack(() => {
      const urlTab = parseTab(page.url.searchParams.get("tab"));
      const existingId = page.url.searchParams.get("id");
      const targetFeature =
        (existingId ? appState.findOsmItemById(existingId)?.item.feature : undefined) ?? item.feature;

      if (navigation.type === "popstate") {
        activeTab = urlTab ?? "overview";
      } else if (urlTab) {
        activeTab = urlTab;
      } else if (activeTab === "osm" && targetFeature.type === "geographic") {
        activeTab = "overview";
      }

      const tabForUrl = activeTab === "osm" && targetFeature.type === "geographic" ? "overview" : activeTab;
      const url = new URL(page.url.href);
      let changed = false;

      if (targetFeature.type !== "geographic") {
        const id = `${targetFeature.type}-${targetFeature.id}`;
        if (url.searchParams.get("id") !== id) {
          url.searchParams.set("id", id);
          changed = true;
        }
        if (url.searchParams.has("osm")) {
          url.searchParams.delete("osm");
          changed = true;
        }
      }

      if (tabForUrl === "overview") {
        if (url.searchParams.has("tab")) {
          url.searchParams.delete("tab");
          changed = true;
        }
      } else if (url.searchParams.get("tab") !== tabForUrl) {
        url.searchParams.set("tab", tabForUrl);
        changed = true;
      }

      if (changed) void goto(url, { state: page.state, shallow: true, replace: true });
    });
  });

  const isFeatureDeletedUpstream = $derived.by(() => {
    if (item.feature.type === "geographic") return false;

    const identifier = getStaticIdentifier(item.feature.type, item.feature.id);
    const refreshedFeatureState = appState.osmUser.refreshedFeatureStates[identifier];
    if (refreshedFeatureState === "pending") return false;

    if (!refreshedFeatureState) return false;

    return refreshedFeatureState.refreshedFeature === undefined;
  });

  const nearby = $derived(getNearbyDots((s) => appState.tree.getReactiveNode(s), itemSlug));

  const coordinates = $derived.by(() => {
    if (item.feature.type === "geographic") return undefined;
    const own = getCoordinates(item.feature);
    if (own) return own;
    // Areas mapped without a position are placed at the center of what they contain
    const inside = nearby.filter((d) => d.slug.startsWith(`${itemSlug}/`));
    if (inside.length === 0) return undefined;
    return {
      lat: inside.reduce((sum, d) => sum + d.lat, 0) / inside.length,
      lon: inside.reduce((sum, d) => sum + d.lon, 0) / inside.length,
    };
  });

  const bounds = $derived.by(() => {
    if (item.feature.type === "geographic" && item.feature.bbox) {
      return item.feature.bbox;
    }
    return undefined;
  });

  const isRoute = $derived(itemType === "route");
  const editable = $derived(appState.osmUser.loggedIn && item.feature.type === "node" && isRoute);
  const fallbackCoordinates = $derived(coordinates ? undefined : getFallbackCoordinates(itemSlug));
  const isAreaLike = $derived(item.feature.type === "geographic" || itemType === "area");
  let diagDbElements = $state.raw<Record<string, DataJSON>>({});
  let diagDbTruncated = $state(false);
  let loadingDiagnostics = $state(false);

  $effect(() => {
    const targetSlug = itemSlug;
    if (building || !isAreaLike || !localDb.ready) {
      diagDbElements = {};
      diagDbTruncated = false;
      loadingDiagnostics = false;
      return;
    }

    let cancelled = false;
    loadingDiagnostics = true;
    localDb
      .getSubtreeElements(targetSlug, 2000)
      .then((res) => {
        if (cancelled) return;
        diagDbElements = res.data;
        diagDbTruncated = res.truncated;
      })
      .finally(() => {
        if (!cancelled) loadingDiagnostics = false;
      });
    return () => {
      cancelled = true;
    };
  });

  const diagnosticsCount = $derived.by(() => {
    const entries = collectSubtreeDiagnostics(item, itemSlug, diagDbElements, (s) => appState.tree.getReactiveNode(s));
    return entries.reduce((sum, entry) => sum + entry.diagnostics.length, 0);
  });
  const diagnosticsKnownClean = $derived(
    !loadingDiagnostics && diagnosticsCount === 0 && (!isAreaLike || localDb.ready),
  );

  let placementMode = $state<"route" | "sector" | null>(null);
  let addDialogOpen = $state(false);
  let addDialogKind = $state<"route" | "sector">("route");
  let clickedCoordinates = $state<{ lat: number; lon: number } | undefined>(undefined);

  $effect(() => {
    if (effectiveTab !== "map") placementMode = null;
  });

  function togglePlacement(mode: "route" | "sector") {
    placementMode = placementMode === mode ? null : mode;
  }

  function onMapPlacementClick(coords: { lat: number; lon: number }) {
    if (!placementMode) return;
    addDialogKind = placementMode;
    clickedCoordinates = coords;
    placementMode = null;
    addDialogOpen = true;
  }
</script>

<svelte:window
  onkeydown={(e) => {
    if (e.key === "Escape" && placementMode) placementMode = null;
  }}
/>

{#if item.feature.type !== "geographic" && isFeatureDeletedUpstream}
  <OsmMissingFeature feature={item.feature} />
{/if}

<div class="flex items-center gap-2">
  {#if item.feature.type === "geographic"}
    <h1 class="text-2xl font-semibold">
      {getLocalizedName(item.feature) || "No Name"}
    </h1>
  {:else if itemType === "gym"}
    <BuildingIcon class="size-6 shrink-0" aria-hidden="true" />
    <EditableName feature={item.feature} featureSlug={itemSlug} />
  {:else}
    <EditableName feature={item.feature} featureSlug={itemSlug} />
  {/if}
</div>

<Tabs.Root value={effectiveTab} onValueChange={onTabChange} class="gap-4">
  <div class="border-b">
    <Tabs.List variant="line">
      <Tabs.Trigger value="overview">
        <FileTextIcon />
        Overview
      </Tabs.Trigger>
      <Tabs.Trigger value="map">
        <MapIcon />
        Map
      </Tabs.Trigger>
      {#if hasOsmData}
        <Tabs.Trigger value="osm">
          <DatabaseIcon />
          OSM Data
        </Tabs.Trigger>
      {/if}
      <Tabs.Trigger value="diagnostics">
        <StethoscopeIcon />
        Diagnostics
        {#if diagnosticsCount > 0}
          <span class="rounded-full bg-amber-500/20 px-1.5 text-[11px] font-semibold text-amber-700 dark:text-amber-300">
            {diagnosticsCount}{diagDbTruncated ? "+" : ""}
          </span>
        {:else if diagnosticsKnownClean}
          <CheckCircle2Icon class="size-3.5 text-emerald-600 dark:text-emerald-400" aria-label="No issues" />
        {/if}
      </Tabs.Trigger>
    </Tabs.List>
  </div>

  <Tabs.Content value="overview" class="flex flex-col gap-4">
    {#if !itemType}
      <ComponentParseFailed />
    {:else if itemType === "geographic"}
      <GeographicPage bind:item={item as DataTree<GeographicFolderElement>} />
    {:else if itemType === "area"}
      <AreaPage bind:item={item as DataTree<OsmFeature>} slug={itemSlug} />
    {:else if itemType === "route"}
      <RoutePage bind:item={item as DataTree<OsmFeature>} slug={itemSlug} />
    {:else if itemType === "gym"}
      <GymPage bind:item={item as DataTree<OsmFeature>} slug={itemSlug} />
    {:else}
      <ComponentParseFailed />
    {/if}
  </Tabs.Content>

  <Tabs.Content value="map" class="flex flex-col gap-2">
    {#if effectiveTab === "map"}
      {#if appState.osmUser.loggedIn}
        <div class="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant={placementMode === "route" ? "default" : "outline"}
            onclick={() => togglePlacement("route")}
          >
            <MapPinPlusIcon />
            Add route
          </Button>
          <Button
            size="sm"
            variant={placementMode === "sector" ? "default" : "outline"}
            onclick={() => togglePlacement("sector")}
          >
            <FolderPlusIcon />
            Add sector
          </Button>
          {#if placementMode}
            <span class="text-xs text-muted-foreground">
              Click on the map to place the new {placementMode}.
            </span>
            <Button size="xs" variant="ghost" onclick={() => (placementMode = null)}>Cancel</Button>
          {/if}
        </div>
      {/if}
      <LocationMap
        currentSlug={itemSlug}
        currentFeature={item.feature}
        {coordinates}
        {fallbackCoordinates}
        {bounds}
        {placementMode}
        onmapclick={onMapPlacementClick}
        draggable={editable}
        onmove={editable ? (pos) => appState.setCoordinates(itemSlug, pos) : undefined}
      />
      {#if editable && coordinates}
        <p class="text-xs text-muted-foreground">Drag the marker on the map to move the route.</p>
      {/if}
      <MapAddDialog
        bind:open={addDialogOpen}
        kind={addDialogKind}
        coordinates={clickedCoordinates}
        currentSlug={itemSlug}
      />
    {/if}
  </Tabs.Content>

  {#if item.feature.type !== "geographic"}
    <Tabs.Content value="osm" class="flex flex-col gap-4">
      <div class="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
        <span>{item.feature.type}/{item.feature.id}</span>
        {#if coordinates}
          <span>{coordinates.lat}, {coordinates.lon}</span>
        {/if}
        {#if item.feature.id > 0}
          <a
            href={`https://www.openstreetmap.org/${item.feature.type}/${item.feature.id}`}
            target="_blank"
            rel="noopener noreferrer"
            class="inline-flex items-center gap-1 underline underline-offset-2 hover:text-foreground"
          >
            View on OpenStreetMap
            <ExternalLinkIcon class="size-3.5" aria-hidden="true" />
          </a>
        {/if}
      </div>
      <EditableTags feature={item.feature} featureSlug={itemSlug} />
    </Tabs.Content>
  {/if}

  <Tabs.Content value="diagnostics" class="flex flex-col gap-4">
    {#if effectiveTab === "diagnostics"}
      <DiagnosticsPanel {item} slug={itemSlug} />
    {/if}
  </Tabs.Content>
</Tabs.Root>
