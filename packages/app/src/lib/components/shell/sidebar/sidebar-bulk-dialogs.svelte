<script lang="ts">
  import { goto } from "$app/navigation";
  import { untrack } from "svelte";
  import { Button } from "#components/ui/button/index.js";
  import * as Dialog from "#components/ui/dialog/index.js";
  import { Input } from "#components/ui/input/index.js";
  import { Select } from "#components/ui/select/index.js";
  import { commonParentSlug, getAppState } from "#lib/data/app-state.js";
  // Scale ids are identifiers: the default comes from a plain module that wuchale never
  // processes, so the "French" literal cannot be rewritten to a translation (issue #229).
  import { DEFAULT_SCALES } from "#lib/data/grading-scale-ids.js";
  import { atproto } from "#lib/data/network/atproto.svelte.js";
  import { getLocalizedName } from "#lib/data/parse/localized-name.js";
  import { scaleIdToTag } from "@bloknote/osm-climbing";
  import { ROUTE_STYLE_LABELS } from "@bloknote/osm-climbing";
  import {
    collectOrphanRoutes,
    clusterRoutes,
    describeClusterSize,
    type OrphanRoute,
  } from "#lib/data/parse/sector-clustering.js";
  import { collectRegionParentOptions, type ParentOption } from "#lib/data/region-locator.js";
  import { getParentSlug } from "#lib/helpers/slug.js";
  import { ascentFromStyle, type TickStyle } from "@bloknote/common";
  import { allScales, type ScaleId } from "@bloknote/holy-grade";
  import type { OsmFeature } from "osm-api";
  import type { SidebarSelection } from "./selection.svelte.js";
  import { getItemUrl } from "./utils.js";

  export type BulkDialogKind =
    | "new-sector"
    | "suggest-sectors"
    | "move-folder"
    | "change-scale"
    | "change-type"
    | "add-ticks"
    | "delete"
    | null;

  let { dialog = $bindable<BulkDialogKind>(null), selection }: { dialog: BulkDialogKind; selection: SidebarSelection } =
    $props();

  const appState = getAppState();

  let newSectorName = $state("");
  let targetParentSlug = $state("");
  let folderFilter = $state("");
  let folderOptions = $state<ParentOption[]>([]);
  let loadingFolders = $state(false);
  // @wc-ignore
  let targetScaleId = $state<ScaleId>(DEFAULT_SCALES.route);
  // @wc-ignore
  let targetStyleKey = $state("sport");
  let replaceStyles = $state(true);
  // @wc-ignore
  let tickStyle = $state<TickStyle>("redpoint");
  let tickComment = $state("");

  // Suggested sectors from route clustering (issue #157)
  let orphanRoutes = $state<OrphanRoute[]>([]);
  let orphanUnplaced = $state(0);
  // @wc-ignore
  let clusterThreshold = $state(100);
  let clusterChecks = $state<boolean[]>([]);
  let clusterNames = $state<string[]>([]);

  const suggestedClusters = $derived(clusterRoutes(orphanRoutes, Number(clusterThreshold)));

  const convertibleScales = allScales.filter((s) => !!scaleIdToTag(s.id));
  const styleOptions = Object.entries(ROUTE_STYLE_LABELS).filter(([k]) => k !== "other" && k !== "viaferrata");
  const moveTargetParentSlug = $derived(commonParentSlug(selection.slugs));
  const moveTargetParent = $derived(
    moveTargetParentSlug !== undefined ? appState.tree.getReactiveNode(moveTargetParentSlug) : undefined,
  );

  function findRegionRootSlug(slug: string): string | undefined {
    let cur: string | undefined = getParentSlug(slug);
    while (cur !== undefined) {
      if (appState.tree.getReactiveNode(cur)?.feature.type === "geographic") return cur;
      cur = getParentSlug(cur);
    }
    return undefined;
  }

  $effect(() => {
    if (dialog !== "move-folder") return;
    folderFilter = "";
    targetParentSlug = moveTargetParentSlug ?? "";
    loadingFolders = true;
    const regionSlug = selection.slugs[0] ? findRegionRootSlug(selection.slugs[0]) : undefined;
    const selectedSet = new Set(selection.slugs);
    (async () => {
      try {
        const raw = regionSlug ? await collectRegionParentOptions(appState, regionSlug) : [];
        folderOptions = raw.filter((opt) => {
          if (selectedSet.has(opt.slug)) return false;
          if (selection.slugs.some((s) => opt.slug.startsWith(`${s}/`))) return false;
          // Geographic regions are automatically derived from boundaries: moving items there would not persist.
          return appState.tree.getReactiveNode(opt.slug)?.feature.type !== "geographic";
        });
        if (folderOptions.length > 0 && !folderOptions.some((o) => o.slug === targetParentSlug)) {
          targetParentSlug = folderOptions[0]!.slug;
        }
      } finally {
        loadingFolders = false;
      }
    })();
  });

  $effect(() => {
    if (dialog !== "suggest-sectors") return;
    // Everything below is untracked: the first automatic selection clears and refills the
    // selection, which the parent slug derives from — tracking it would re-run this effect and
    // close the dialog right away (issue #157).
    untrack(() => {
      const parent =
        moveTargetParentSlug !== undefined ? appState.tree.getReactiveNode(moveTargetParentSlug) : undefined;
      if (!parent) {
        dialog = null;
        return;
      }
      const collected = collectOrphanRoutes(parent);
      orphanRoutes = collected.routes;
      orphanUnplaced = collected.unplaced;
      clusterThreshold = 100;
      // First automatic selection: highlight the routes of the biggest cluster (issue #157)
      selection.clear();
      for (const slug of clusterRoutes(collected.routes, 100)[0]?.slugs ?? []) selection.selected.add(slug);
    });
  });

  // Reset the per-cluster form state whenever the clustering changes (threshold, new routes)
  $effect(() => {
    clusterChecks = suggestedClusters.map((cluster) => cluster.slugs.length >= 2);
    clusterNames = suggestedClusters.map(() => "");
  });

  const filteredFolders = $derived.by(() => {
    const q = folderFilter.trim().toLowerCase();
    return q
      ? folderOptions.filter((o) => o.label.toLowerCase().includes(q) || o.slug.toLowerCase().includes(q))
      : folderOptions;
  });

  function confirmNewSector(event: SubmitEvent) {
    event.preventDefault();
    const sectorSlug = appState.createSectorWithItems(selection.slugs, newSectorName, moveTargetParentSlug);
    selection.clear();
    dialog = null;
    if (sectorSlug) {
      const feature = appState.tree.getReactiveNode(sectorSlug)?.feature;
      if (feature && feature.type !== "geographic" && moveTargetParentSlug !== undefined) {
        void goto(getItemUrl(moveTargetParentSlug, feature));
      }
    }
  }

  function confirmSuggestSectors(event: SubmitEvent) {
    event.preventDefault();
    let created = 0;
    suggestedClusters.forEach((cluster, index) => {
      if (!clusterChecks[index]) return;
      if (
        appState.createSectorWithItems(cluster.slugs, clusterNames[index]?.trim() || undefined, moveTargetParentSlug)
      ) {
        created++;
      }
    });
    selection.clear();
    dialog = null;
  }

  function confirmMoveFolder(event: SubmitEvent) {
    event.preventDefault();
    if (!targetParentSlug) return;
    appState.moveItemsToParent(selection.slugs, targetParentSlug);
    selection.clear();
    dialog = null;
  }

  function confirmChangeScale(event: SubmitEvent) {
    event.preventDefault();
    appState.bulkChangeGradingScale(selection.slugs, targetScaleId);
    dialog = null;
  }

  function confirmChangeType(event: SubmitEvent) {
    event.preventDefault();
    appState.bulkSetClimbingType(selection.slugs, targetStyleKey, replaceStyles);
    dialog = null;
  }

  async function confirmAddTicks(event: SubmitEvent) {
    event.preventDefault();
    const features = selection.slugs
      .map((s) => appState.tree.getReactiveNode(s)?.feature)
      .filter((f): f is OsmFeature => !!f && f.type !== "geographic");
    await atproto.addBulkTicks(features, ascentFromStyle(tickStyle), tickComment);
    tickComment = "";
    dialog = null;
  }

  function confirmDelete(event: SubmitEvent) {
    event.preventDefault();
    appState.deleteNodes(selection.slugs);
    selection.clear();
    dialog = null;
  }
</script>

<Dialog.Root open={dialog !== null} onOpenChange={(o) => !o && (dialog = null)}>
  <Dialog.Content class="max-w-sm">
    {#if dialog === "new-sector"}
      <form onsubmit={confirmNewSector} class="flex flex-col gap-4">
        <Dialog.Header>
          <Dialog.Title>Move to new sector</Dialog.Title>
          <Dialog.Description>
            Create a new sector{moveTargetParent ? ` in ${getLocalizedName(moveTargetParent.feature)}` : ""} and move
            {selection.size} selected item{selection.size === 1 ? "" : "s"} into it.
          </Dialog.Description>
        </Dialog.Header>
        <Input bind:value={newSectorName} placeholder="Sector name (optional)" autofocus />
        {@render footer("Create & move")}
      </form>
    {:else if dialog === "suggest-sectors"}
      <form onsubmit={confirmSuggestSectors} class="flex flex-col gap-4">
        <Dialog.Header>
          <Dialog.Title>Suggest sectors</Dialog.Title>
          <Dialog.Description>
            {orphanRoutes.length === 0
              ? `No routes without a sector found in ${getLocalizedName(moveTargetParent?.feature) ?? "this place"}.`
              : `Group the ${orphanRoutes.length} route${orphanRoutes.length === 1 ? "" : "s"} of ${
                  getLocalizedName(moveTargetParent?.feature) ?? "this place"
                } that are not in a sector yet, by how close they are to each other. Create the suggested sectors you agree with.`}
          </Dialog.Description>
        </Dialog.Header>
        {#if orphanRoutes.length > 0}
          <label class="flex items-center justify-between gap-2 text-sm">
            Max distance between routes
            <Select aria-label="Max distance between routes" bind:value={clusterThreshold}>
              <option value={50}>50 m</option>
              <option value={100}>100 m</option>
              <option value={200}>200 m</option>
              <option value={500}>500 m</option>
            </Select>
          </label>
          <div class="flex max-h-64 flex-col gap-2 overflow-y-auto">
            {#each suggestedClusters as cluster, index (cluster.slugs[0])}
              <div class="flex flex-col gap-1">
                <div class="flex items-center gap-2 text-sm">
                  <input type="checkbox" class="size-4 accent-primary" bind:checked={clusterChecks[index]} />
                  <Input
                    bind:value={clusterNames[index]}
                    placeholder={`Sector ${index + 1} name (optional)`}
                    class="flex-1"
                  />
                  <span class="shrink-0 text-xs text-muted-foreground">{describeClusterSize(cluster)}</span>
                </div>
                {#if cluster.names.length > 0}
                  <p class="truncate pl-6 text-xs text-muted-foreground">
                    {cluster.names.slice(0, 4).join(", ")}{cluster.names.length > 4
                      ? `, +${cluster.names.length - 4}`
                      : ""}
                  </p>
                {/if}
              </div>
            {/each}
          </div>
          {#if orphanUnplaced > 0}
            <p class="text-xs text-muted-foreground">
              {orphanUnplaced} route{orphanUnplaced === 1 ? "" : "s"} without coordinates cannot be clustered.
            </p>
          {/if}
        {/if}
        {@render footer("Create sectors", false, !clusterChecks.some(Boolean))}
      </form>
    {:else if dialog === "move-folder"}
      <form onsubmit={confirmMoveFolder} class="flex flex-col gap-4">
        <Dialog.Header>
          <Dialog.Title>Move to folder</Dialog.Title>
          <Dialog.Description>
            Choose a destination folder or sector for {selection.size} selected item{selection.size === 1 ? "" : "s"}.
          </Dialog.Description>
        </Dialog.Header>
        <Input bind:value={folderFilter} placeholder="Filter folders..." autofocus />
        {#if loadingFolders}
          <p class="text-sm text-muted-foreground">Loading folders...</p>
        {:else}
          <div class="max-h-56 overflow-y-auto rounded-md border p-1 flex flex-col gap-0.5">
            {#each filteredFolders as opt (opt.slug)}
              <button
                type="button"
                class="flex items-center rounded px-2 py-1.5 text-left text-sm hover:bg-accent {targetParentSlug ===
                opt.slug
                  ? 'bg-accent font-medium'
                  : ''}"
                style:padding-left="{0.5 + opt.depth * 0.75}rem"
                onclick={() => (targetParentSlug = opt.slug)}
              >
                <span class="truncate">{opt.label}</span>
              </button>
            {:else}
              <p class="px-2 py-3 text-xs text-muted-foreground">No matching folders.</p>
            {/each}
          </div>
        {/if}
        {@render footer("Move", false, !targetParentSlug || loadingFolders)}
      </form>
    {:else if dialog === "change-scale"}
      <form onsubmit={confirmChangeScale} class="flex flex-col gap-4">
        <Dialog.Header>
          <Dialog.Title>Change grading system</Dialog.Title>
          <Dialog.Description>Convert existing grades on {selection.size} selected items.</Dialog.Description>
        </Dialog.Header>
        <Select aria-label="Target grading system" bind:value={targetScaleId}>
          {#each convertibleScales as scale (scale.id)}
            <option value={scale.id}>{scale.name} ({scale.id})</option>
          {/each}
        </Select>
        {@render footer("Convert grades")}
      </form>
    {:else if dialog === "change-type"}
      <form onsubmit={confirmChangeType} class="flex flex-col gap-4">
        <Dialog.Header>
          <Dialog.Title>Change climbing type</Dialog.Title>
          <Dialog.Description>Set the climbing type for {selection.size} selected items.</Dialog.Description>
        </Dialog.Header>
        <Select aria-label="Climbing type" bind:value={targetStyleKey}>
          {#each styleOptions as [key, label] (key)}
            <option value={key}>{label}</option>
          {/each}
        </Select>
        <label class="flex items-center gap-2 text-sm">
          <input type="checkbox" class="size-4 accent-primary" bind:checked={replaceStyles} />
          Replace existing climbing type tags
        </label>
        {@render footer("Apply")}
      </form>
    {:else if dialog === "add-ticks"}
      <form onsubmit={confirmAddTicks} class="flex flex-col gap-4">
        <Dialog.Header>
          <Dialog.Title>Add ticks</Dialog.Title>
          <Dialog.Description>Log a tick for {selection.size} selected items.</Dialog.Description>
        </Dialog.Header>
        <Select aria-label="Ascent style" bind:value={tickStyle}>
          <optgroup label="Send">
            <option value="redpoint">Redpoint</option>
            <option value="onsight">Onsight</option>
            <option value="flash">Flash</option>
            <option value="pinkpoint">Pinkpoint</option>
          </optgroup>
          <optgroup label="Attempt">
            <option value="hangdog">Hangdog</option>
            <option value="bailed">Bailed</option>
          </optgroup>
        </Select>
        <Input bind:value={tickComment} placeholder="Comment (optional)" />
        {@render footer("Add ticks")}
      </form>
    {:else if dialog === "delete"}
      <form onsubmit={confirmDelete} class="flex flex-col gap-4">
        <Dialog.Header>
          <Dialog.Title>Delete {selection.size} item{selection.size === 1 ? "" : "s"}?</Dialog.Title>
          <Dialog.Description>
            This removes the selected items from the tree and marks them for deletion in your pending OpenStreetMap
            changeset.
          </Dialog.Description>
        </Dialog.Header>
        {@render footer("Delete", true)}
      </form>
    {/if}
  </Dialog.Content>
</Dialog.Root>

{#snippet footer(submitLabel: string, destructive = false, disabled = false)}
  <Dialog.Footer>
    <Dialog.Close>
      {#snippet child({ props })}
        <Button {...props} type="button" variant="outline">Cancel</Button>
      {/snippet}
    </Dialog.Close>
    <Button type="submit" variant={destructive ? "destructive" : "default"} {disabled}>{submitLabel}</Button>
  </Dialog.Footer>
{/snippet}
