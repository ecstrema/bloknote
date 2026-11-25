<script lang="ts">
  import { goto } from "$app/navigation";
  import { Button } from "#components/ui/button/index.js";
  import * as Dialog from "#components/ui/dialog/index.js";
  import { Input } from "#components/ui/input/index.js";
  import Loader from "#components/ui/loader.svelte";
  import { getItemUrl } from "#components/shell/sidebar/utils.js";
  import { getAppState } from "#lib/data/app-state.js";
  import { dataClient } from "#lib/data/network/data-client.js";
  import { localDb } from "#lib/data/db/local-db.svelte.js";
  import { atproto, type LocalTickEntry } from "#lib/data/network/atproto.svelte.js";
  import { getLocalizedName } from "#lib/data/parse/localized-name.js";
  import { getCoordinates } from "#lib/data/parse/osm-tags.js";
  import { setFallbackCoordinates } from "#lib/data/route-location.js";
  import type { DataJSON } from "@bloknote/climbing-data-gen";
  import type { DataTree } from "#lib/types.js";
  import type { OsmFeature } from "osm-api";

  /**
   * "Add to OSM" flow for a logbook tick (issues #154 and #201), rendered on a world page so the
   * app state (undo stack, pending OSM changes) is available. Two steps:
   * 1. the location hint is matched level by level against the map data; any level can be chosen
   *    as the parent, and missing levels can be created on the fly under the deepest match;
   * 2. the shared map is embedded in the dialog: the user picks the location and saves, which
   *    creates the missing parents and the route through the undoable app state actions, links the
   *    tick to it, and opens the route page where the pending changes can be pushed to OSM.
   */
  let {
    tick,
    onClose,
  }: {
    tick: LocalTickEntry;
    onClose: () => void;
  } = $props();

  const appState = getAppState();

  interface ChainEntry {
    slug: string;
    data: DataJSON;
  }

  let open = $state(true);
  let step = $state<1 | 2>(1);
  let loading = $state(false);
  let saving = $state(false);
  let error = $state<string>();
  let segments = $state<string[]>([]);
  /** For each hint segment, the resolved region/area, or null when it is not in the dataset */
  let chain = $state<(ChainEntry | null)[]>([]);
  /** Index in the chain of the level chosen as the route parent: the deepest match by default */
  let selectedIndex = $state<number>();
  let pickedCoordinates = $state<{ lat: number; lon: number }>();
  // svelte-ignore state_referenced_locally: the component instance is created per open dialog
  let routeName = $state(tick.name ?? "");

  const parent = $derived(selectedIndex !== undefined ? (chain[selectedIndex] as ChainEntry | null) : undefined);
  /** Deepest resolved level at or before the selection: the missing levels below it get created under it */
  const foundIndex = $derived.by(() => {
    for (let i = selectedIndex ?? -1; i >= 0; i--) {
      if (chain[i]) return i;
    }
    return -1;
  });
  const foundParent = $derived(foundIndex >= 0 ? (chain[foundIndex] as ChainEntry) : undefined);
  /** Missing level names between the deepest match and the selection, shallowest first */
  const createNames = $derived(
    foundParent && selectedIndex !== undefined ? segments.slice(foundIndex + 1, selectedIndex + 1) : [],
  );
  const trimmedName = $derived(routeName.trim());
  const foundParentName = $derived(foundParent ? (getLocalizedName(foundParent.data) ?? foundParent.slug) : "");
  const mapCoordinates = $derived(
    foundParent && foundParent.data.type !== "geographic" ? getCoordinates(foundParent.data as OsmFeature) : undefined,
  );
  const mapBounds = $derived(foundParent?.data.type === "geographic" ? foundParent.data.bbox : undefined);

  $effect(() => {
    let cancelled = false;
    loading = true;
    error = undefined;
    segments = [];
    chain = [];
    selectedIndex = undefined;
    (async () => {
      // Right after a reload the database may still be opening, or an in-memory copy is still
      // re-downloading (another tab holds the OPFS pool): wait instead of failing right away
      if (!(await dataClient.waitUntilLocalReady())) {
        if (!cancelled) {
          error = "The offline map data is not available: open the map once to download it, then try again.";
          loading = false;
        }
        return;
      }
      const parts = (tick.locationHint ?? "")
        .split(">")
        .map((part) => part.trim())
        .filter(Boolean);
      if (parts.length === 0) {
        if (!cancelled) {
          error = `No location is known for "${tick.name}". Open the place that should hold it and use "Add route" on the map instead.`;
          loading = false;
        }
        return;
      }
      if (!cancelled) segments = parts;
      const result = await localDb.matchAreaChain(parts);
      if (cancelled) return;
      chain = result;
      // The deepest resolved level is the parent by default; the others stay clickable
      const deepest = chain.reduce((last, entry, i) => (entry ? i : last), -1);
      selectedIndex = deepest >= 0 ? deepest : undefined;
      loading = false;
    })();
    return () => {
      cancelled = true;
    };
  });

  /** An unfound level can only be picked when something resolved above it, to create it under */
  function canCreate(i: number): boolean {
    return chain.slice(0, i).some((entry) => entry !== null);
  }

  /** Integrates the whole ancestor chain of `slug` into the app tree, reading the local dataset */
  async function ensureNodeInTree(slug: string): Promise<DataTree | undefined> {
    const parts = slug.split("/");
    for (let i = 0; i < parts.length; i++) {
      const ancestorSlug = parts.slice(0, i + 1).join("/");
      if (appState.tree.getReactiveNode(ancestorSlug)) continue;
      const data = await dataClient.getNode(ancestorSlug);
      if (!data) return undefined;
      appState.tree.integrateNodeIntoTree(
        { feature: data, children: {} },
        ancestorSlug,
        i === 0 ? "" : parts.slice(0, i).join("/"),
      );
      if (!appState.tree.getReactiveNode(ancestorSlug)) return undefined;
    }
    return appState.tree.getReactiveNode(slug);
  }

  async function save() {
    if (!pickedCoordinates || !foundParent || saving) return;
    saving = true;
    error = undefined;
    try {
      const base = await ensureNodeInTree(foundParent.slug);
      if (!base) throw new Error(`Could not load "${foundParentName}" from the map data.`);

      let routeParent = base;
      let routeParentSlug = foundParent.slug;
      // Missing parents and the route form a single undo step, like the other multi-part edits
      appState.undoStack.beginGroup();
      try {
        for (const name of createNames) {
          const slug = appState.createArea(routeParent, routeParentSlug, name);
          setFallbackCoordinates(slug, pickedCoordinates);
          routeParent = appState.tree.getReactiveNode(slug)!;
          routeParentSlug = slug;
        }
        const routeSlug = appState.createRoute(
          routeParent,
          routeParentSlug,
          pickedCoordinates,
          trimmedName || undefined,
        );
        const routeFeature = routeParent.children?.[routeSlug]?.feature;
        if (!routeFeature || routeFeature.type === "geographic") throw new Error("The route could not be created.");

        // The subject points at the temporary id until the changeset is pushed (see remapTickSubjects)
        void atproto
          .linkTick(tick, { type: routeFeature.type, id: routeFeature.id }, trimmedName || tick.name)
          .catch((err) => console.error("Could not link the tick to the new route", err));

        open = false;
        // Stay in the world section: the route page shows the pending changes (Save button) and
        // the undo controls, and navigating away from the world layout would drop them (issue #177)
        void goto(getItemUrl(routeParentSlug, routeFeature as OsmFeature));
      } finally {
        appState.undoStack.endGroup();
      }
    } catch (err) {
      error = err instanceof Error ? err.message : "Could not create the route.";
      saving = false;
    }
  }

</script>


<Dialog.Root
  open={open}
  onOpenChange={(next) => {
    open = next;
    if (!next) onClose();
  }}
>
  <Dialog.Content class="max-w-xl">
    <Dialog.Header>
      <Dialog.Title class="flex items-center gap-2">
        <span aria-hidden="true" class="icon-[lucide--map-pin-plus] size-4 shrink-0"></span>
        Add "{tick.name}" to OpenStreetMap
      </Dialog.Title>
      <Dialog.Description>
        {step === 1
          ? "The location from the logbook is matched against the map data, level by level. Click a level to place the route inside it; missing levels are created on the fly."
          : `Pick the location of the route on the map of ${foundParentName}, then save. The route is created as a pending change you can undo and push to OpenStreetMap.`}
      </Dialog.Description>
      <ol class="flex items-center gap-1.5 text-xs text-muted-foreground">
        <li class={step === 1 ? "font-medium text-foreground" : ""}>1 · Parent</li>
        <li aria-hidden="true">›</li>
        <li class={step === 2 ? "font-medium text-foreground" : ""}>2 · Location</li>
      </ol>
    </Dialog.Header>

    {#if step === 1}
      {#if loading}
        <p class="flex items-center gap-2 text-sm text-muted-foreground">
          <span aria-hidden="true" class="icon-[lucide--loader-circle] size-4 animate-spin"></span>
          Matching the location in the map data...
        </p>
      {:else if error}
        <p class="text-sm text-destructive">{error}</p>
      {:else}
        <ol class="flex flex-col gap-0.5 rounded-md border p-2 text-sm">
          {#each segments as segment, i (i)}
            {@const entry = chain[i]}
            <li>
              {#if entry}
                <button
                  type="button"
                  class="flex w-full items-center gap-2 rounded px-1 py-0.5 text-start hover:bg-accent"
                  onclick={() => (selectedIndex = i)}
                >
                  <span
                    aria-hidden="true"
                    class="icon-[lucide--check] size-3.5 shrink-0 {selectedIndex === i
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : 'text-muted-foreground/50'}"
                  ></span>
                  <span class:selected={selectedIndex === i} class:text-muted-foreground={selectedIndex !== i}>
                    {getLocalizedName(entry.data) ?? segment}
                  </span>
                  {#if selectedIndex === i}
                    <span class="ms-auto text-xs text-muted-foreground">parent</span>
                  {/if}
                </button>
              {:else if canCreate(i)}
                <button
                  type="button"
                  class="flex w-full items-center gap-2 rounded px-1 py-0.5 text-start hover:bg-accent"
                  onclick={() => (selectedIndex = i)}
                >
                  <span
                    aria-hidden="true"
                    class="icon-[lucide--circle-dashed] size-3.5 shrink-0 {selectedIndex === i
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : 'text-muted-foreground/50'}"
                  ></span>
                  <span class:selected={selectedIndex === i} class:text-muted-foreground={selectedIndex !== i}>
                    {segment}
                  </span>
                  <span
                    class="ms-auto text-xs {selectedIndex === i
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : 'text-muted-foreground'}"
                  >
                    {selectedIndex === i ? "will be created" : "not in the map data — click to create"}
                  </span>
                </button>
              {:else}
                <span class="flex items-center gap-2 px-1 py-0.5 text-muted-foreground/60">
                  <span aria-hidden="true" class="icon-[lucide--circle-dashed] size-3.5 shrink-0"></span>
                  <span>{segment}</span>
                  <span class="text-xs">not in the map data</span>
                </span>
              {/if}
            </li>
          {/each}
        </ol>
      {/if}

      <Dialog.Footer>
        <Dialog.Close>
          {#snippet child({ props })}
            <Button {...props} type="button" variant="outline">Cancel</Button>
          {/snippet}
        </Dialog.Close>
        <Button disabled={loading || !!error || !parent} onclick={() => (step = 2)}>Next: choose the location</Button>
      </Dialog.Footer>

    {:else}
      {#if !appState.osmUser.loggedIn}
        <div
          class="flex flex-wrap items-center justify-between gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs"
        >
          <span>Log in with OpenStreetMap to add "{tick.name}".</span>
          <Button size="xs" variant="outline" onclick={() => appState.osmUser.login()}>
            <span aria-hidden="true" class="icon-[lucide--log-in] size-3.5"></span>
            Log in
          </Button>
        </div>
      {/if}

      {#await import("#lib/components/location-map.svelte")}
        <Loader class="h-72 shrink-0" />
      {:then { default: LocationMap }}
        <LocationMap
          class="h-72 shrink-0"
          currentSlug={foundParent?.slug}
          currentFeature={foundParent?.data}
          coordinates={mapCoordinates}
          bounds={mapBounds}
          placementMode="route"
          onmapclick={(coords) => (pickedCoordinates = coords)}
        />
      {/await}

      <label class="flex flex-col gap-1 text-sm">
        <span class="font-medium">Route name</span>
        <Input bind:value={routeName} placeholder="Route name" />
      </label>

      <p class="text-xs text-muted-foreground">
        {#if pickedCoordinates}
          Location: {pickedCoordinates.lat.toFixed(5)}, {pickedCoordinates.lon.toFixed(5)} — click again to adjust.
          {#if createNames.length > 0}
            {createNames.join(" › ")} will be created under {foundParentName}.
          {/if}
        {:else}
          Click on the map to pick the location.
        {/if}
      </p>

      {#if error}
        <p class="text-sm text-destructive">{error}</p>
      {/if}

      <Dialog.Footer>
        <Button variant="outline" onclick={() => (step = 1)}>Back</Button>
        <Button onclick={save} disabled={!appState.osmUser.loggedIn || !pickedCoordinates || saving}>
          {saving ? "Creating..." : "Save"}
        </Button>
      </Dialog.Footer>
    {/if}
  </Dialog.Content>
</Dialog.Root>
