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
  import MapAddDialog from "#lib/components/map-add-dialog.svelte";
  import DiagnosticsPanel from "#lib/components/diagnostics-panel.svelte";
  import { collectSubtreeDiagnostics } from "#lib/data/parse/diagnostics.js";
  import { localDb } from "#lib/data/db/local-db.svelte.js";
  import type { DataJSON } from "@bloknote/climbing-data-gen";
  import { Button } from "#components/ui/button/index.js";
  import Loader from "#components/ui/loader.svelte";
  import { getFallbackCoordinates } from "#lib/data/route-location.js";
  import { getBrowserUrl } from "#lib/helpers/url.js";
  import EditableName from "#components/editable/editable-name.svelte";
  import EditableTags from "#components/editable/editable-tags.svelte";
  import * as Tabs from "#components/ui/tabs/index.js";
  import { getLocalizedName } from "#lib/data/parse/localized-name.js";
  import { getCoordinates, getGrade, isProjectRoute } from "@bloknote/osm-climbing";
  import { isIceRoute, isTradRoute } from "@bloknote/osm-climbing";
  import TradCamIcon from "#components/trad-cam-icon.svelte";
  import ClimbingStyles from "#components/climbing-styles.svelte";
  import EditableGrade from "#components/editable/editable-grade.svelte";
  import EditableLength from "#components/editable/editable-length.svelte";
  import EditablePitches from "#components/editable/editable-pitches.svelte";
  import BookmarkButton from "#components/bookmark-button.svelte";
  import TickButton from "#components/tick-button.svelte";
  import RssFeedButton from "#components/rss-feed-button.svelte";
  import ProdLinkButton from "#components/prod-link-button.svelte";
  import ShareBskyButton from "#components/share-bsky-button.svelte";
  import WayOsmData from "#components/way-osm-data.svelte";
  import { getNearbyDots } from "#lib/data/nearby-dots.js";
  import { dataClient } from "#lib/data/network/data-client.js";
  import { getParentSlug } from "#lib/helpers/slug.js";
  import { findRoutePartPairs, isRouteBottom, isRouteTop, routeCompanionsBySlug } from "#lib/data/parse/route-parts.js";
  import { moveCliffNode } from "#lib/data/cliffs.svelte.js";

  type PageTab = "overview" | "map" | "osm" | "diagnostics" | "pulse";
  function parseTab(value: string | null): PageTab | undefined {
    return value === "overview" || value === "map" || value === "osm" || value === "diagnostics" || value === "pulse"
      ? value
      : undefined;
  }

  let { params, data }: PageProps = $props();

  const slug = $derived(params.slug);
  // The layout resolves the slug from the `?id=` param, which can differ from the URL
  // path (e.g. a route opened from its crag): the page item lives at that slug.
  const resolvedSlug = $derived(data.slug);

  const appState = getAppState();

  let queriedItem = $state<{ item: DataTree<OsmFeature>; slug: string }>();
  let lastQueryId: string | null | undefined;
  $effect(() => {
    // Shallow gotos don't update `page.url`, so read the browser URL (issue #212)
    const id = getBrowserUrl().searchParams.get("id");
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
  const itemSlug = $derived(queriedItem?.slug ?? resolvedSlug);
  const itemType = $derived(featureToType(item.feature));
  const hasOsmData = $derived(item.feature.type !== "geographic");

  let activeTab = $state<PageTab>(
    building ? "overview" : (parseTab(getBrowserUrl().searchParams.get("tab")) ?? "overview"),
  );
  const effectiveTab = $derived<PageTab>(activeTab === "osm" && !hasOsmData ? "overview" : activeTab);

  $effect(() => {
    if (!hasOsmData && activeTab === "osm") {
      activeTab = "overview";
    }
  });

  function onTabChange(value: string) {
    const next = parseTab(value) ?? "overview";
    activeTab = next;
    // Shallow gotos don't update `page.url`, so build from the browser URL (issue #212)
    const url = new URL(getBrowserUrl().href);
    if (next === "overview") url.searchParams.delete("tab");
    else url.searchParams.set("tab", next);
    void goto(url, { state: page.state, shallow: true, replace: true });
  }

  // Shared links carry the OSM id so the item can be found if its path changes.
  // Not an effect: a shallow goto would re-trigger it. IMPORTANT: reconcile against the
  // browser URL (`getBrowserUrl()`, i.e. `page.shallow.url`), not `page.url`: shallow gotos
  // never update `page.url`, so every shallow goto looked unfinished here and re-triggered
  // goto in an infinite loop (runaway memory + CPU).
  afterNavigate((navigation) => {
    untrack(() => {
      const url = new URL(getBrowserUrl().href);
      const urlTab = parseTab(url.searchParams.get("tab"));
      const existingId = url.searchParams.get("id");
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

    // Locally created features have a negative temporary id: they do not exist on OSM yet
    if (item.feature.id < 0) return false;

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

  // A multipitch route can be mapped with a bottom and a top point (issue #135)
  const isNodeRoutePart = $derived(
    isRoute &&
      item.feature.type === "node" &&
      (isRouteBottom(item.feature as OsmFeature) || isRouteTop(item.feature as OsmFeature)),
  );

  // Siblings of the parent sector, fetched to find the bottom/top companion of the current route
  let parentChildren = $state<Record<string, DataJSON>>({});
  $effect(() => {
    if (building || !isNodeRoutePart) {
      parentChildren = {};
      return;
    }
    const parentSlug = getParentSlug(itemSlug);
    if (!parentSlug) {
      parentChildren = {};
      return;
    }
    let cancelled = false;
    dataClient
      .getChildren(parentSlug)
      .then((children) => {
        if (!cancelled) parentChildren = children ?? {};
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  });

  const companionSlugs = $derived.by(() => {
    const children = isNodeRoutePart
      ? parentChildren
      : Object.fromEntries(Object.entries(item.children ?? {}).map(([slug, child]) => [slug, child.feature]));
    return Object.fromEntries(routeCompanionsBySlug(findRoutePartPairs(children)));
  });

  const routeCompanion = $derived.by(() => {
    if (!isNodeRoutePart) return undefined;
    const companionSlug = companionSlugs[itemSlug];
    const feature = companionSlug ? parentChildren[companionSlug] : undefined;
    if (!feature || feature.type === "geographic") return undefined;
    return { slug: companionSlug!, feature };
  });
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
  let coordinatesCopied = $state(false);

  function copyCoordinates() {
    if (!coordinates) return;
    void navigator.clipboard.writeText(`${coordinates.lat}, ${coordinates.lon}`);
    coordinatesCopied = true;
    setTimeout(() => (coordinatesCopied = false), 1500);
  }

  $effect(() => {
    if (effectiveTab !== "map") placementMode = null;
  });

  function togglePlacement() {
    placementMode = placementMode ? null : "route";
  }

  function onMapPlacementClick(coords: { lat: number; lon: number }) {
    if (!placementMode) return;
    addDialogKind = placementMode;
    clickedCoordinates = coords;
    placementMode = null;
    addDialogOpen = true;
  }

  // Cliffs of the region, shown on the map at high zoom while a crag is selected (issue #55)
  const showCliffs = $derived(itemType === "area");
  const cliffsEditable = $derived(showCliffs && appState.osmUser.loggedIn === true);

  function onCliffMove(ref: string, position: { lat: number; lon: number }) {
    void moveCliffNode(appState.osmUser, ref, position);
  }

  function onCliffCreate(position: { lat: number; lon: number }) {
    // When the selected crag is a relation, the new cliff becomes one of its members
    appState.createCliff(position, item.feature.type === "relation" ? itemSlug : undefined);
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

<div class="flex flex-wrap items-center gap-x-3 gap-y-1">
  <!-- Dev-only link to the same page on the production instance (issue #270) -->
  <ProdLinkButton />
  {#if item.feature.type === "geographic"}
    <h1 class="text-2xl font-semibold">
      {getLocalizedName(item.feature) || "No Name"}
    </h1>
    <RssFeedButton class="ms-auto" slug={itemSlug} />
  {:else if itemType === "gym"}
    <span aria-hidden="true" class="icon-[lucide--building] shrink-0 size-6 shrink-0"></span>
    <EditableName feature={item.feature} featureSlug={itemSlug} />
    <BookmarkButton class="ms-auto" feature={item.feature} />
  {:else}
    <EditableName feature={item.feature} featureSlug={itemSlug} />
    {#if itemType === "route"}
      {@const routeTags = (item.feature as OsmFeature).tags ?? {}}
      {@const isProject = isProjectRoute(routeTags)}
      <EditableGrade
        feature={item.feature}
        grade={getGrade(routeTags)}
        featureSlug={itemSlug}
        gradedProject={isProject}
      />
      {#if isTradRoute(routeTags)}
        <TradCamIcon class="self-center" />
      {/if}
      {#if isIceRoute(routeTags)}
        <span
          aria-label="Ice / dry-tooling route"
          class="icon-[lucide--snowflake] shrink-0 size-3.5 self-center text-cyan-500"
        ></span>
      {/if}
      <EditableLength feature={item.feature} featureSlug={itemSlug} />
      <EditablePitches feature={item.feature} featureSlug={itemSlug} />
      <ClimbingStyles feature={item.feature} featureSlug={itemSlug} editable />
    {/if}
    {#if itemType === "route"}
      <!-- Quick tick button (issue #253), just to the left of the to-do list button -->
      <div class="ms-auto flex items-center gap-1">
        <TickButton feature={item.feature} />
        <BookmarkButton feature={item.feature} />
      </div>
    {:else}
      <BookmarkButton class="ms-auto" feature={item.feature} />
    {/if}
  {/if}
  <!-- Share the page on Bluesky, next to the tick / bookmark / RSS buttons (issue #273) -->
  <ShareBskyButton />
</div>

<Tabs.Root value={effectiveTab} onValueChange={onTabChange} class="gap-4">
  <div class="border-b">
    <!-- On phones the five tabs overflow one row: wrap onto several rows instead (issue #81) -->
    <Tabs.List variant="line" class="max-md:h-fit max-md:w-full max-md:flex-wrap max-md:justify-start">
      <Tabs.Trigger value="overview">
        <span class="icon-[lucide--file-text] shrink-0 size-4"></span>
        <!-- @wc-context: Tab label: overview of the climbing item (route, crag, area or gym) -->
        Overview
      </Tabs.Trigger>
      <Tabs.Trigger value="map">
        <span class="icon-[lucide--map] shrink-0 size-4"></span>
        <!-- @wc-context: Tab label: interactive map showing the location of the climbing item -->
        Map
      </Tabs.Trigger>
      {#if hasOsmData}
        <Tabs.Trigger value="osm">
          <span class="icon-[lucide--database] shrink-0 size-4"></span>
          <!-- @wc-context: Tab label: raw OpenStreetMap tags of the climbing item -->
          OSM Data
        </Tabs.Trigger>
      {/if}
      <Tabs.Trigger value="diagnostics">
        <span class="icon-[lucide--stethoscope] shrink-0 size-4"></span>
        <span>
          <!-- @wc-context: Tab label: problems found in the OpenStreetMap data of the climbing item -->
          Diagnostics
        </span>
        {#if diagnosticsCount > 0}
          <span
            class="rounded-full bg-amber-500/20 px-1.5 text-[11px] font-semibold text-amber-700 dark:text-amber-300"
          >
            {diagnosticsCount}{diagDbTruncated ? "+" : ""}
          </span>
        {:else if diagnosticsKnownClean}
          <span
            aria-label="No issues"
            class="icon-[lucide--check-circle-2] shrink-0 size-3.5 text-emerald-600 dark:text-emerald-400"
          ></span>
        {/if}
      </Tabs.Trigger>
      <Tabs.Trigger value="pulse">
        <span class="icon-[lucide--activity] shrink-0 size-4"></span>
        <span>
          <!-- @wc-context: Tab label: Pulse, the activity panel with stars, comments and ticks from the community -->
          Pulse
        </span>
      </Tabs.Trigger>
    </Tabs.List>
  </div>

  <Tabs.Content value="overview" class="flex flex-col gap-4">
    {#if !itemType}
      <ComponentParseFailed />
    {:else if itemType === "geographic"}
      <GeographicPage bind:item={item as DataTree<GeographicFolderElement>} />
    {:else if itemType === "area"}
      <AreaPage bind:item={item as DataTree<OsmFeature>} slug={itemSlug} {coordinates} />
    {:else if itemType === "route"}
      <RoutePage
        bind:item={item as DataTree<OsmFeature>}
        slug={itemSlug}
        // Routes without their own position (mapped as ways) fall back to the parent crag's position
        coordinates={coordinates ?? fallbackCoordinates}
        companion={routeCompanion}
      />
    {:else if itemType === "gym"}
      <GymPage bind:item={item as DataTree<OsmFeature>} slug={itemSlug} />
    {:else}
      <ComponentParseFailed />
    {/if}
  </Tabs.Content>

  <Tabs.Content value="map" class="flex flex-col gap-2">
    {#if effectiveTab === "map"}
      {#if appState.osmUser.loggedIn && placementMode}
        <div class="flex flex-wrap items-center gap-2">
          <span class="text-xs text-muted-foreground">Click on the map to place the new route.</span>
          <Button size="xs" variant="ghost" onclick={() => (placementMode = null)}>Cancel</Button>
        </div>
      {/if}
      {#await import("#lib/components/location-map.svelte")}
        <Loader class="h-[calc(100dvh-13rem)] min-h-80 shrink-0" />
      {:then { default: LocationMap }}
        <LocationMap
          class="h-[calc(100dvh-13rem)] min-h-80 shrink-0"
          currentSlug={itemSlug}
          currentFeature={item.feature}
          {coordinates}
          {fallbackCoordinates}
          {bounds}
          {placementMode}
          addRoute={appState.osmUser.loggedIn
            ? { active: placementMode === "route", toggle: togglePlacement }
            : undefined}
          onmapclick={onMapPlacementClick}
          draggable={editable}
          onmove={editable ? (pos) => appState.setCoordinates(itemSlug, pos) : undefined}
          {companionSlugs}
          cliffsEnabled={showCliffs}
          {cliffsEditable}
          oncliffmove={cliffsEditable ? onCliffMove : undefined}
          oncliffcreate={cliffsEditable ? onCliffCreate : undefined}
        />
      {/await}
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
          <Button type="button" variant="ghost" size="icon-xs" title="Copy coordinates" onclick={copyCoordinates}>
            {#if coordinatesCopied}
              <span aria-hidden="true" class="icon-[lucide--check] shrink-0 size-3.5"></span>
            {:else}
              <span aria-hidden="true" class="icon-[lucide--copy] shrink-0 size-3.5"></span>
            {/if}
            <span class="sr-only">Copy coordinates</span>
          </Button>
        {/if}
        {#if item.feature.id > 0}
          <a
            href={`https://www.openstreetmap.org/${item.feature.type}/${item.feature.id}`}
            target="_blank"
            rel="noopener noreferrer"
            class="inline-flex items-center gap-1 underline underline-offset-2 hover:text-foreground"
          >
            View on OpenStreetMap
            <span aria-hidden="true" class="icon-[lucide--external-link] shrink-0 size-3.5"></span>
          </a>
        {/if}
      </div>
      <EditableTags feature={item.feature} featureSlug={itemSlug} />
      {#if item.feature.type === "way"}
        <!-- A way mapped as a route shows the data of all its nodes too (issue #280) -->
        <WayOsmData way={item.feature} />
      {/if}
    </Tabs.Content>
  {/if}

  <Tabs.Content value="diagnostics" class="flex flex-col gap-4">
    {#if effectiveTab === "diagnostics"}
      <DiagnosticsPanel {item} slug={itemSlug} />
    {/if}
  </Tabs.Content>

  <Tabs.Content value="pulse" class="flex flex-col gap-4">
    {#if effectiveTab === "pulse"}
      {#await import("#lib/components/pulse-panel.svelte")}
        <Loader class="h-32" />
      {:then { default: PulsePanel }}
        <PulsePanel {item} slug={itemSlug} />
      {/await}
    {/if}
  </Tabs.Content>
</Tabs.Root>
