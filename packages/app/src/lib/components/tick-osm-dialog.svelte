<script lang="ts">
  import { SvelteSet } from "svelte/reactivity";
  import { parseGrade } from "@bloknote/holy-grade";
  import { Button } from "#components/ui/button/index.js";
  import * as Dialog from "#components/ui/dialog/index.js";
  import { Input } from "#components/ui/input/index.js";
  import Loader from "#components/ui/loader.svelte";
  import { getAppState } from "#lib/data/app-state.js";
  import { dataClient } from "#lib/data/network/data-client.js";
  import { localDb } from "#lib/data/db/local-db.svelte.js";
  import { getCoordinates, scaleIdToTag } from "#lib/data/parse/osm-tags.js";
  import {
    atproto,
    type LocalTickEntry,
  } from "#lib/data/network/atproto.svelte.js";
  import { getLocalizedName } from "#lib/data/parse/localized-name.js";
  import { setFallbackCoordinates } from "#lib/data/route-location.js";
  import type { DataJSON } from "@bloknote/climbing-data-gen";
  import type { DataTree } from "#lib/types.js";
  import type { Key, OsmFeature } from "osm-api";

  /**
   * "Add to OSM" flow for a logbook tick (issues #154 and #201), rendered over the ticks list, so
   * the user never leaves the page. Two steps:
   * 1. the location hint is matched level by level against the map data; an existing level is
   *    picked as the parent, and any missing level can be individually selected for creation
   *    under the deepest existing one — the lowest down selection becomes the route parent;
   * 2. the shared map is embedded in the dialog: the user picks the location and saves, which
   *    creates the missing levels and the route through the undoable app state actions (the
   *    tick's grade is imported onto the route), links the tick to it, and leaves the pending
   *    changes in the shared app state (upload button, undo).
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
  /** Index in the chain of the existing level picked as parent: the deepest match by default */
  let selectedIndex = $state<number>();
  /** Indices of the missing levels selected for creation, individually (issue #201) */
  let checkedCreate = $state(new SvelteSet<number>());
  let pickedCoordinates = $state<{ lat: number; lon: number }>();
  // svelte-ignore state_referenced_locally: the component instance is created per open dialog
  let routeName = $state(tick.name ?? "");

  const checkedIndices = $derived(
    [...checkedCreate].filter((i) => chain[i] === null).sort((a, b) => a - b),
  );
  const firstChecked = $derived(checkedIndices[0]);
  const lastChecked = $derived(checkedIndices.at(-1));
  /**
   * Deepest existing level the new areas (or the selection) hang under: the deepest match above
   * the first creation, or the picked existing level when nothing is created.
   */
  const baseIndex = $derived.by(() => {
    const limit =
      firstChecked ?? (selectedIndex !== undefined ? selectedIndex + 1 : 0);
    for (let i = limit - 1; i >= 0; i--) {
      if (chain[i]) return i;
    }
    return -1;
  });
  const base = $derived(
    baseIndex >= 0 ? (chain[baseIndex] as ChainEntry) : undefined,
  );
  const baseName = $derived(
    base ? (getLocalizedName(base.data) ?? base.slug) : "",
  );
  /** The route parent: the lowest down selection, created or existing (issue #201) */
  const parentIndex = $derived.by(() => {
    const lowest = lastChecked ?? -1;
    if (selectedIndex !== undefined && selectedIndex > lowest)
      return selectedIndex;
    return lowest;
  });
  const parentIsCreated = $derived(
    parentIndex >= 0 && chain[parentIndex] === null,
  );
  const parentName = $derived.by(() => {
    if (parentIndex < 0) return "";
    const entry = chain[parentIndex];
    if (entry) return getLocalizedName(entry.data) ?? entry.slug;
    return segments[parentIndex] ?? "";
  });
  const createNames = $derived(checkedIndices.map((i) => segments[i]!));
  const trimmedName = $derived(routeName.trim());
  /**
   * Grade tag(s) imported from the tick: the specific OSM grade tag(s) when the scale is
   * recognized (including danger ratings like "5.10a R" or "E1 5b"), the generic
   * `climbing:grade` tag with the raw value otherwise.
   */
  const tickGradeTags = $derived.by(() => {
    const grade = tick.grade?.trim();
    if (!grade) return [] as { key: Key; value: string }[];
    const parsed = parseGrade(grade);
    const tags = [parsed?.primary, parsed?.danger].flatMap((part) =>
      part
        ? [{ key: scaleIdToTag(part.scale) ?? ("climbing:grade" as Key), value: part.grade }]
        : [],
    );
    return tags.length > 0 ? tags : [{ key: "climbing:grade" as Key, value: grade }];
  });
  const mapCoordinates = $derived(
    base && base.data.type !== "geographic"
      ? getCoordinates(base.data as OsmFeature)
      : undefined,
  );
  const mapBounds = $derived(
    base?.data.type === "geographic" ? base.data.bbox : undefined,
  );

  $effect(() => {
    let cancelled = false;
    loading = true;
    error = undefined;
    segments = [];
    chain = [];
    selectedIndex = undefined;
    checkedCreate = new SvelteSet();
    (async () => {
      // Right after a reload the database may still be opening, or an in-memory copy is still
      // re-downloading (another tab holds the OPFS pool): wait instead of failing right away
      if (!(await dataClient.waitUntilLocalReady())) {
        if (!cancelled) {
          error =
            "The offline map data is not available: open the map once to download it, then try again.";
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
      // The deepest resolved level is picked as the parent by default; the others stay clickable
      const deepest = chain.reduce((last, entry, i) => (entry ? i : last), -1);
      selectedIndex = deepest >= 0 ? deepest : undefined;
      loading = false;
    })();
    return () => {
      cancelled = true;
    };
  });

  /** A missing level can only be selected for creation when an existing level sits above it */
  function canCreate(i: number): boolean {
    return chain.slice(0, i).some((entry) => entry !== null);
  }

  function toggleCreate(i: number) {
    if (checkedCreate.has(i)) checkedCreate.delete(i);
    else checkedCreate.add(i);
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
    if (!pickedCoordinates || baseIndex < 0 || parentIndex < 0 || saving)
      return;
    saving = true;
    error = undefined;
    try {
      const baseEntry = chain[baseIndex] as ChainEntry;
      let routeParent = await ensureNodeInTree(baseEntry.slug);
      if (!routeParent)
        throw new Error(`Could not load "${baseName}" from the map data.`);
      let routeParentSlug = baseEntry.slug;

      // The missing levels and the route form a single undo step, like the other multi-part edits
      appState.undoStack.beginGroup();
      try {
        for (const i of checkedIndices) {
          const slug = appState.createArea(
            routeParent,
            routeParentSlug,
            segments[i],
          );
          setFallbackCoordinates(slug, pickedCoordinates);
          routeParent = appState.tree.getReactiveNode(slug)!;
          routeParentSlug = slug;
        }
        // When the lowest down selection is an existing level deeper than the creations, load it
        if (!parentIsCreated) {
          const parentEntry = chain[parentIndex] as ChainEntry;
          if (parentEntry.slug !== routeParentSlug) {
            routeParent = await ensureNodeInTree(parentEntry.slug);
            if (!routeParent)
              throw new Error(
                `Could not load "${parentName}" from the map data.`,
              );
            routeParentSlug = parentEntry.slug;
          }
        }
        const routeSlug = appState.createRoute(
          routeParent,
          routeParentSlug,
          pickedCoordinates,
          trimmedName || undefined,
        );
        // The grade from the tick lands on the new route as part of the same undo step
        for (const { key, value } of tickGradeTags) {
          appState.setTag(routeSlug, key, value);
        }
        const routeFeature = routeParent.children?.[routeSlug]?.feature;
        if (!routeFeature || routeFeature.type === "geographic")
          throw new Error("The route could not be created.");

        // The subject points at the temporary id until the changeset is pushed (see remapTickSubjects)
        void atproto
          .linkTick(
            tick,
            { type: routeFeature.type, id: routeFeature.id },
            trimmedName || tick.name,
          )
          .catch((err) =>
            console.error("Could not link the tick to the new route", err),
          );

        // Stay on the ticks page: the tick row shows its route right away (resolved from memory),
        // and the pending changes are kept in the shared app state, ready to be pushed (issue #203)
        open = false;
        onClose();
      } finally {
        appState.undoStack.endGroup();
      }
    } catch (err) {
      error =
        err instanceof Error ? err.message : "Could not create the route.";
      saving = false;
    }
  }
</script>

<Dialog.Root
  {open}
  onOpenChange={(next) => {
    open = next;
    if (!next) onClose();
  }}
>
  <Dialog.Content
    class={step === 2
      ? // Map step: fill the page so the embedded map gets as much room as possible.
        // sm:max-w-[calc(100vw-2rem)] is required to beat the base sm:max-w-md (a plain
        // max-w-* loses against the sm: variant of the base styles on desktop)
        "flex h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] flex-col overflow-hidden sm:max-w-[calc(100vw-2rem)]"
      : ""}
  >
    <Dialog.Header class={step === 2 ? "shrink-0" : ""}>
      <Dialog.Title class="flex items-center gap-2">
        <span
          aria-hidden="true"
          class="icon-[lucide--map-pin-plus] size-4 shrink-0"
        ></span>
        Add "{tick.name}" to OpenStreetMap
      </Dialog.Title>
      <Dialog.Description>
        {step === 1
          ? "The location from the logbook is matched against the map data, level by level. Click an existing level to pick it as the parent, or click missing levels to create them — the lowest down selection becomes the parent of the route."
          : `Pick the location of the route on the map of ${baseName}, then save. The route is created as a pending change you can undo and push to OpenStreetMap.`}
      </Dialog.Description>
      <ol class="flex items-center gap-1.5 text-xs text-muted-foreground">
        <li class={step === 1 ? "font-medium text-foreground" : ""}>
          1 · Parent
        </li>
        <li aria-hidden="true">›</li>
        <li class={step === 2 ? "font-medium text-foreground" : ""}>
          2 · Location
        </li>
      </ol>
    </Dialog.Header>

    {#if step === 1}
      {#if loading}
        <p class="flex items-center gap-2 text-sm text-muted-foreground">
          <span
            aria-hidden="true"
            class="icon-[lucide--loader-circle] size-4 animate-spin"
          ></span>
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
                    class="icon-[lucide--check] size-3.5 shrink-0 {selectedIndex ===
                    i
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : 'text-muted-foreground/50'}"
                  ></span>
                  <span
                    class:selected={selectedIndex === i}
                    class:text-muted-foreground={selectedIndex !== i}
                  >
                    {getLocalizedName(entry.data) ?? segment}
                  </span>
                  {#if selectedIndex === i && !parentIsCreated}
                    <span class="ms-auto text-xs text-muted-foreground"
                      >parent</span
                    >
                  {/if}
                </button>
              {:else if canCreate(i)}
                <button
                  type="button"
                  class="flex w-full items-center gap-2 rounded px-1 py-0.5 text-start hover:bg-accent"
                  onclick={() => toggleCreate(i)}
                >
                  <span
                    aria-hidden="true"
                    class="size-3.5 shrink-0 {checkedCreate.has(i)
                      ? 'icon-[lucide--check] text-emerald-600 dark:text-emerald-400'
                      : 'icon-[lucide--circle-dashed] text-muted-foreground/50'}"
                  ></span>
                  <span
                    class:selected={checkedCreate.has(i)}
                    class:text-muted-foreground={!checkedCreate.has(i)}
                  >
                    {segment}
                  </span>
                  <span
                    class="ms-auto text-xs {checkedCreate.has(i)
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : 'text-muted-foreground'}"
                  >
                    {checkedCreate.has(i)
                      ? "will be created"
                      : "not in the map data — click to create"}
                  </span>
                </button>
              {:else}
                <span
                  class="flex items-center gap-2 px-1 py-0.5 text-muted-foreground/60"
                >
                  <span
                    aria-hidden="true"
                    class="icon-[lucide--circle-dashed] size-3.5 shrink-0"
                  ></span>
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
        <Button
          disabled={loading || !!error || parentIndex < 0}
          onclick={() => (step = 2)}>Next: choose the location</Button
        >
      </Dialog.Footer>
    {:else}
      <div class="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
        {#if !appState.osmUser.loggedIn}
          <div
            class="flex flex-wrap items-center justify-between gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs"
          >
            <span>Log in with OpenStreetMap to add "{tick.name}".</span>
            <Button
              size="xs"
              variant="outline"
              onclick={() => appState.osmUser.login()}
            >
              <span aria-hidden="true" class="icon-[lucide--log-in] size-3.5"
              ></span>
              Log in
            </Button>
          </div>
        {/if}

        {#await import("#lib/components/location-map.svelte")}
          <Loader class="h-96 shrink-0" />
        {:then { default: LocationMap }}
          <LocationMap
            class="min-h-96 flex-1 shrink-0"
            currentSlug={base?.slug}
            currentFeature={base?.data}
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
            Location: {pickedCoordinates.lat.toFixed(5)}, {pickedCoordinates.lon.toFixed(
              5,
            )} — click again to adjust.
          {:else}
            Click on the map to pick the location.
          {/if}
          {#if createNames.length > 0}
            {createNames.join(" › ")} will be created under {baseName}.
          {/if}
          The route will be added to {parentName}.
          {#if tickGradeTags.length > 0}
            The grade {tick.grade} is imported from the tick.
          {/if}
        </p>

        {#if error}
          <p class="text-sm text-destructive">{error}</p>
        {/if}
      </div>

      <Dialog.Footer class="shrink-0">
        <Button variant="outline" onclick={() => (step = 1)}>Back</Button>
        <Button
          onclick={save}
          disabled={!appState.osmUser.loggedIn || !pickedCoordinates || saving}
        >
          {saving ? "Creating..." : "Save"}
        </Button>
      </Dialog.Footer>
    {/if}
  </Dialog.Content>
</Dialog.Root>
