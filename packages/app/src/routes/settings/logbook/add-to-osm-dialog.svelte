<script lang="ts">
  import { goto } from "$app/navigation";
  import { resolve } from "$app/paths";
  import { Button } from "#components/ui/button/index.js";
  import * as Dialog from "#components/ui/dialog/index.js";
  import { dataClient } from "#lib/data/network/data-client.js";
  import { localDb } from "#lib/data/db/local-db.svelte.js";
  import type { LocalTickEntry } from "#lib/data/network/atproto.svelte.js";
  import { getLocalizedName } from "#lib/data/parse/localized-name.js";
  import type { DataJSON } from "@bloknote/climbing-data-gen";

  let {
    tick,
    onClose,
  }: {
    tick: LocalTickEntry;
    onClose: () => void;
  } = $props();

  interface ChainEntry {
    slug: string;
    data: DataJSON;
  }

  let open = $state(true);
  let loading = $state(false);
  let error = $state<string>();
  let segments = $state<string[]>([]);
  /** For each hint segment, the resolved region/area, or null when it is not in the dataset */
  let chain = $state<(ChainEntry | null)[]>([]);
  /** Index in the chain of the level chosen as the parent: the deepest match by default */
  let selectedIndex = $state<number>();

  const parent = $derived(selectedIndex !== undefined ? (chain[selectedIndex] as ChainEntry | null) : undefined);
  /** True when the deepest hint segment (the crag itself) resolved: the route can be placed there */
  const cragFound = $derived(chain.length > 0 && chain.at(-1) !== null);
  /** The crag from the logbook, when it did not resolve: it can be added under the selected level */
  const missingCrag = $derived(segments.at(-1));
  const parentName = $derived(parent ? (getLocalizedName(parent.data) ?? parent.slug) : "");

  $effect(() => {
    let cancelled = false;
    loading = true;
    error = undefined;
    segments = [];
    chain = [];
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
      selectedIndex = chain.reduce((last, entry, i) => (entry ? i : last), -1);
      if (selectedIndex < 0) selectedIndex = undefined;
      loading = false;
    })();
    return () => {
      cancelled = true;
    };
  });

  /** Opens the placement flow on the parent page, optionally asking for the missing crag first */
  function place(addSectorName?: string) {
    if (!parent || !tick.localId) return;
    const params = new URLSearchParams({ addRouteTick: tick.localId });
    if (addSectorName) params.set("addSector", addSectorName);
    open = false;
    void goto(`${resolve("/world/[...slug]", { slug: parent.slug })}?${params}`);
  }
</script>

<Dialog.Root
  open={open}
  onOpenChange={(next) => {
    open = next;
    if (!next) onClose();
  }}
>
  <Dialog.Content class="max-w-md">
    <Dialog.Header>
      <Dialog.Title class="flex items-center gap-2">
        <span aria-hidden="true" class="icon-[lucide--map-pin-plus] size-4 shrink-0"></span>
        Add "{tick.name}" to OpenStreetMap
      </Dialog.Title>
      <Dialog.Description>
        The location from the logbook is matched against the map data, level by level. Click a
        level to choose the parent of the new route; the deepest match is selected by default.
      </Dialog.Description>
    </Dialog.Header>

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

      {#if parent && cragFound}
        <p class="text-xs text-muted-foreground">
          The crag exists in the map data: place the route on the map of {parentName}.
        </p>
        <Dialog.Footer>
          <Button onclick={() => place()}>Place the route on the map</Button>
        </Dialog.Footer>
      {:else if parent}
        <p class="text-xs text-muted-foreground">
          The crag "{missingCrag}" is not in the map data. It can be added under {parentName},
          then the route placed inside it.
        </p>
        <Dialog.Footer class="flex-wrap">
          <Button onclick={() => place(missingCrag)}>Add "{missingCrag}" to OSM</Button>
          {#if parent.data.type !== "geographic"}
            <Button variant="outline" onclick={() => place()}>
              Place the route directly under {parentName}
            </Button>
          {/if}
        </Dialog.Footer>
      {:else}
        <p class="text-sm text-muted-foreground">
          None of the locations were found in the map data. Open the place that should hold the
          route and use "Add route" on the map instead.
        </p>
      {/if}
    {/if}

    <Dialog.Footer>
      <Dialog.Close>
        {#snippet child({ props })}
          <Button {...props} type="button" variant="outline">Cancel</Button>
        {/snippet}
      </Dialog.Close>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>

