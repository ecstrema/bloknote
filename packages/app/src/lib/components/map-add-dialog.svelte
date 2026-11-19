<script lang="ts">
  import { goto } from "$app/navigation";
  import { Button } from "#components/ui/button/index.js";
  import * as Dialog from "#components/ui/dialog/index.js";
  import { Input } from "#components/ui/input/index.js";
  import { Select } from "#components/ui/select/index.js";
  import { getItemUrl } from "#components/shell/sidebar/utils.js";
  import { getAppState } from "#lib/data/app-state.js";
  import {
    collectRegionParentOptions,
    ensureRegionLoaded,
    findCandidateRegionSlugs,
    loadHierarchyIndex,
    pickBestRegionSlug,
    type ParentOption,
  } from "#lib/data/region-locator.js";
  import { setFallbackCoordinates } from "#lib/data/route-location.js";
  import { untrack } from "svelte";

  let {
    open = $bindable(false),
    kind,
    coordinates,
    currentSlug = "",
  }: {
    open?: boolean;
    kind: "route" | "sector";
    coordinates: { lat: number; lon: number } | undefined;
    currentSlug?: string;
  } = $props();

  const appState = getAppState();

  let loading = $state(false);
  let error = $state<string>();
  let regionSlug = $state<string>();
  let parentOptions = $state<ParentOption[]>([]);
  let selectedParentSlug = $state("");
  let name = $state("");

  $effect(() => {
    if (!open || !coordinates) return;
    const coords = coordinates;
    const preferred = untrack(() => currentSlug);

    loading = true;
    error = undefined;
    regionSlug = undefined;
    parentOptions = [];
    selectedParentSlug = "";
    name = "";

    let cancelled = false;
    (async () => {
      const index = await loadHierarchyIndex();
      if (cancelled) return;
      if (!index) {
        error = "Could not load the region hierarchy index.";
        loading = false;
        return;
      }

      const candidates = findCandidateRegionSlugs(index, coords.lon, coords.lat);
      const bestRegion = pickBestRegionSlug(candidates, index, preferred);
      if (!bestRegion) {
        error = `No region covers (${coords.lat.toFixed(4)}, ${coords.lon.toFixed(4)}). Click inside a mapped region.`;
        loading = false;
        return;
      }

      const loaded = await ensureRegionLoaded(appState, bestRegion, index);
      if (cancelled) return;
      if (!loaded) {
        error = `Could not load region ${bestRegion}.`;
        loading = false;
        return;
      }

      const options = await collectRegionParentOptions(appState, bestRegion);
      if (cancelled) return;

      regionSlug = bestRegion;
      parentOptions = options;
      selectedParentSlug = bestRegion;
      loading = false;
    })();

    return () => {
      cancelled = true;
    };
  });

  function formatOptionLabel(option: ParentOption): string {
    if (option.depth === 0) return option.label;
    return `${"\u00a0\u00a0".repeat(option.depth)}↳ ${option.label}`;
  }

  function submit(event: SubmitEvent) {
    event.preventDefault();
    if (!coordinates || !selectedParentSlug) return;
    const parent = appState.tree.getReactiveNode(selectedParentSlug);
    if (!parent) return;

    const trimmedName = name.trim() || undefined;
    const newSlug =
      kind === "route"
        ? appState.createRoute(parent, selectedParentSlug, coordinates, trimmedName)
        : appState.createArea(parent, selectedParentSlug, trimmedName);

    if (kind === "sector") {
      setFallbackCoordinates(newSlug, coordinates);
    }

    const feature = parent.children?.[newSlug]?.feature;
    open = false;
    if (feature && feature.type !== "geographic") {
      void goto(getItemUrl(selectedParentSlug, feature));
    }
  }
</script>

<Dialog.Root bind:open>
  <Dialog.Content class="max-w-md">
    <form onsubmit={submit} class="flex flex-col gap-4">
      <Dialog.Header>
        <Dialog.Title>{kind === "route" ? "Add route on map" : "Add sector on map"}</Dialog.Title>
        {#if coordinates}
          <Dialog.Description>
            Location: {coordinates.lat.toFixed(5)}, {coordinates.lon.toFixed(5)}
          </Dialog.Description>
        {/if}
      </Dialog.Header>

      {#if loading}
        <p class="text-sm text-muted-foreground">Detecting region and loading areas...</p>
      {:else if error}
        <p class="text-sm text-destructive">{error}</p>
      {:else if regionSlug}
        <div class="flex flex-col gap-3">
          <label class="flex flex-col gap-1 text-sm">
            <span class="font-medium">Name (optional)</span>
            <Input
              bind:value={name}
              placeholder={kind === "route" ? "Route name" : "Sector name"}
              autofocus
            />
          </label>

          <label class="flex flex-col gap-1 text-sm">
            <span class="font-medium">Parent</span>
            <Select bind:value={selectedParentSlug}>
              {#each parentOptions as option (option.slug)}
                <option value={option.slug}>{formatOptionLabel(option)}</option>
              {/each}
            </Select>
            <span class="text-xs text-muted-foreground">
              Automatically placed in the detected region. You can choose any child or sub-sector of this region.
            </span>
          </label>
        </div>
      {/if}

      <Dialog.Footer>
        <Dialog.Close>
          {#snippet child({ props })}
            <Button {...props} type="button" variant="outline">Cancel</Button>
          {/snippet}
        </Dialog.Close>
        <Button type="submit" disabled={loading || !!error || !selectedParentSlug}>
          {kind === "route" ? "Create route" : "Create sector"}
        </Button>
      </Dialog.Footer>
    </form>
  </Dialog.Content>
</Dialog.Root>