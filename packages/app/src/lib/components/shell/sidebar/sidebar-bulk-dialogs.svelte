<script lang="ts">
  import { goto } from "$app/navigation";
  import { Button } from "#components/ui/button/index.js";
  import * as Dialog from "#components/ui/dialog/index.js";
  import { Input } from "#components/ui/input/index.js";
  import { Select } from "#components/ui/select/index.js";
  import { commonParentSlug, getAppState } from "#lib/data/app-state.js";
  import { atproto } from "#lib/data/network/atproto.svelte.js";
  import { getLocalizedName } from "#lib/data/parse/localized-name.js";
  import { scaleIdToTag } from "#lib/data/parse/osm-tags.js";
  import { ROUTE_STYLE_LABELS } from "#lib/data/parse/route-styles.js";
  import { collectRegionParentOptions, type ParentOption } from "#lib/data/region-locator.js";
  import { getParentSlug } from "#lib/helpers/slug.js";
  import type { AscentStyle } from "@bloknote/common";
  import { allScales, type ScaleId } from "@bloknote/holy-grade";
  import type { OsmFeature } from "osm-api";
  import type { SidebarSelection } from "./selection.svelte.js";
  import { getItemUrl } from "./utils.js";

  export type BulkDialogKind =
    | "new-sector"
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
  let targetScaleId = $state<ScaleId>("French");
  // @wc-ignore
  let targetStyleKey = $state("sport");
  let replaceStyles = $state(true);
  // @wc-ignore
  let tickStyle = $state<AscentStyle>("redpoint");
  let tickComment = $state("");

  const convertibleScales = allScales.filter((s) => !!scaleIdToTag(s.id));
  const styleOptions = Object.entries(ROUTE_STYLE_LABELS).filter(([k]) => k !== "other");
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
        folderOptions = raw.filter(
          (opt) => !selectedSet.has(opt.slug) && !selection.slugs.some((s) => opt.slug.startsWith(`${s}/`)),
        );
        if (folderOptions.length > 0 && !folderOptions.some((o) => o.slug === targetParentSlug)) {
          targetParentSlug = folderOptions[0]!.slug;
        }
      } finally {
        loadingFolders = false;
      }
    })();
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
    await atproto.addBulkTicks(features, tickStyle, tickComment);
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
          <option value="onsight">Onsight</option>
          <option value="flash">Flash</option>
          <option value="redpoint">Redpoint</option>
          <option value="attempt">Attempt</option>
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
