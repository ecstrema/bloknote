<script lang="ts">
  import * as Sidebar from "#components/ui/sidebar/index.js";
  import type { ComponentProps } from "svelte";
  import { onMount } from "svelte";
  import { gradeTextToReference } from "#lib/data/db/grade-text.js";
  import { featureToType, getName } from "#lib/data/parse/data.js";
  import { getLocalizedName } from "#lib/data/parse/localized-name.js";
  import { resolve } from "$app/paths";
  import AppSidebarChildren from "./app-sidebar-children.svelte";
  import SearchFiltersPanel from "./search-filters.svelte";

  import Input from "#components/ui/input/input.svelte";
  import type { DataTree } from "#lib/types.js";
  import { getItemUrl, restoreSidebarOrders, setSearchFilter, type SearchFilter } from "./utils";
  import { getAppState } from "#lib/data/app-state.js";
  import { localDb, type FilterSearch } from "#lib/data/db/local-db.svelte.js";
  import { settings } from "#lib/data/settings.svelte.js";
  import type { SearchFilters } from "#lib/data/db/types.js";
  import { getParentSlugs } from "#lib/helpers/slug.js";
  import { Button } from "#components/ui/button/index.js";
  import * as Dialog from "#components/ui/dialog/index.js";
  import { goto } from "$app/navigation";
  import { commonParentSlug } from "#lib/data/app-state.js";
  import { SidebarSelection, setSidebarSelection } from "./selection.svelte";
  import XIcon from "@lucide/svelte/icons/x";
  import ListFilterIcon from "@lucide/svelte/icons/list-filter";
  import ChevronsDownUpIcon from "@lucide/svelte/icons/chevrons-down-up";
  import FolderPlusIcon from "@lucide/svelte/icons/folder-plus";

  /** Above this many matches, the tree isn't opened automatically to reveal them */
  const EXPAND_LIMIT = 1000;
  const STORAGE_KEY = "bloknote:search-filters";

  let { ref = $bindable(null), ...restProps }: ComponentProps<typeof Sidebar.Root> & {} = $props();

  const appState = getAppState();

  let filters = $state<SearchFilters>({ text: "", types: [], styles: [], tags: [] });
  let gradeText = $state({ min: "", max: "" });
  let showFilters = $state(false);
  let collapseVersion = $state(0);
  let restored = $state(false);

  onMount(() => {
    restoreSidebarOrders();
    try {
      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
      if (stored) {
        filters = { ...filters, ...stored.filters };
        gradeText = { ...gradeText, ...stored.gradeText };
        showFilters = stored.showFilters === true;
      }
    } catch {
      // Unreadable settings are ignored
    }
    restored = true;
  });

  $effect(() => {
    const data = $state.snapshot({ filters, gradeText, showFilters });
    if (restored) localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  });

  $effect(() => {
    filters.gradeMin = gradeTextToReference(gradeText.min);
    filters.gradeMax = gradeTextToReference(gradeText.max);
  });

  const hasFilters = $derived(
    filters.types.length > 0 ||
      filters.gradeMin !== undefined ||
      filters.gradeMax !== undefined ||
      filters.styles.length > 0 ||
      filters.tags.length > 0,
  );
  const active = $derived(filters.text.trim() !== "" || hasFilters);

  /** The places matching the filters, and their ancestors so that the tree leads to them */
  let result = $state.raw<{
    matches: Set<string>;
    visible: Set<string>;
    expand: Set<string>;
    status: "searching" | "paused" | "done";
  }>();
  let loadMore: (() => void) | undefined;

  $effect(() => {
    if (!active || !localDb.ready) {
      result = undefined;
      loadMore = undefined;
      return;
    }
    const snapshot = $state.snapshot(filters);
    const matches = new Set<string>();
    const expand = new Set<string>();
    let pending: string[] = [];
    let flushTimer: ReturnType<typeof setTimeout> | undefined;
    let stale = false;
    let search: FilterSearch | undefined;

    function flush(status: "searching" | "paused" | "done") {
      clearTimeout(flushTimer);
      flushTimer = undefined;
      for (const slug of pending) {
        matches.add(slug);
        for (const parent of getParentSlugs(slug)) expand.add(parent);
      }
      pending = [];
      result = {
        matches: new Set(matches),
        expand: new Set(expand),
        visible: new Set([...matches, ...expand]),
        status,
      };
    }

    async function run() {
      flush("searching");
      try {
        const exhausted = await search!.next();
        if (!stale) flush(exhausted ? "done" : "paused");
      } catch (err) {
        console.error("Search failed:", err);
        if (!stale) flush("done");
      }
    }

    const timer = setTimeout(() => {
      search = localDb.filter(snapshot, (slugs) => {
        pending.push(...slugs);
        // Batches are grouped so that the tree isn't rebuilt for each one
        flushTimer ??= setTimeout(() => flush("searching"), 150);
      });
      loadMore = run;
      run();
    }, 150);
    return () => {
      stale = true;
      clearTimeout(timer);
      clearTimeout(flushTimer);
      search?.cancel();
    };
  });

  // The root has no sidebar node, so nothing else loads its children (e.g. after a reload on a deep page).
  $effect(() => {
    appState.fetchChildren("");
  });

  /** Text-only fallback until the whole dataset is available locally: only covers nodes already loaded in this session. */
  function fallbackMatches(d: DataTree): boolean {
    const text = filters.text.trim().toLowerCase();
    const t = featureToType(d.feature);
    if (t === "route" || t === "gym") return getName(d.feature)?.toLowerCase().includes(text) ?? false;
    if (d.children) return Object.values(d.children).some((child) => fallbackMatches(child));
    return false;
  }

  const searchFilter: SearchFilter = {
    matches(slug, d) {
      if (!active) return true;
      if (localDb.ready) return result ? result.visible.has(slug) : true;
      return hasFilters ? true : fallbackMatches(d);
    },
    shouldExpand(slug) {
      if (!result || result.matches.size > EXPAND_LIMIT) return false;
      return result.expand.has(slug);
    },
    get collapseVersion() {
      return collapseVersion;
    },
  };

  setSearchFilter({
    get current() {
      return searchFilter;
    },
  });

  const selection = new SidebarSelection(() => {
    if (!ref) return [];
    return Array.from(ref.querySelectorAll<HTMLElement>("[data-sidebar-slug]"))
      .map((el) => el.dataset.sidebarSlug)
      .filter((s): s is string => !!s);
  });
  setSidebarSelection(selection);

  let moveDialogOpen = $state(false);
  let newSectorName = $state("");

  const moveTargetParentSlug = $derived(commonParentSlug(selection.slugs));
  const moveTargetParent = $derived(
    moveTargetParentSlug !== undefined ? appState.tree.getReactiveNode(moveTargetParentSlug) : undefined,
  );

  function openMoveDialog() {
    newSectorName = "";
    moveDialogOpen = true;
  }

  function confirmMoveToNewSector(event: SubmitEvent) {
    event.preventDefault();
    const sectorSlug = appState.createSectorWithItems(selection.slugs, newSectorName, moveTargetParentSlug);
    selection.clear();
    moveDialogOpen = false;
    if (sectorSlug) {
      const sectorFeature = appState.tree.getReactiveNode(sectorSlug)?.feature;
      if (sectorFeature && sectorFeature.type !== "geographic" && moveTargetParentSlug !== undefined) {
        void goto(getItemUrl(moveTargetParentSlug, sectorFeature));
      }
    }
  }
</script>

<Sidebar.Root bind:ref {...restProps}>
  <Sidebar.Header>
    <div class="flex items-center gap-1">
      <div class="relative grow">
        <Input
          placeholder={localDb.status === "downloading" ? "Search (preparing all data...)" : "Search..."}
          class="w-full pr-8"
          bind:value={filters.text}
        />
        {#if filters.text}
          <button
            type="button"
            aria-label="Clear search"
            class="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            onclick={() => (filters.text = "")}
          >
            <XIcon class="size-4" />
          </button>
        {/if}
      </div>
      <Button
        variant="outline"
        size="icon"
        aria-label="Collapse all"
        title="Collapse all"
        onclick={() => collapseVersion++}
      >
        <ChevronsDownUpIcon />
      </Button>
      <Button
        variant={showFilters ? "default" : "outline"}
        size="icon"
        aria-label="Filters"
        aria-expanded={showFilters}
        onclick={() => (showFilters = !showFilters)}
      >
        <ListFilterIcon />
      </Button>
    </div>
    {#if showFilters}
      <SearchFiltersPanel bind:filters bind:gradeText />
    {/if}
  </Sidebar.Header>
  <Sidebar.Content>
    {#if active && !localDb.ready && localDb.status !== "error"}
      <div class="flex flex-col gap-2 px-4 py-2 text-sm text-muted-foreground">
        <span>
          {hasFilters ? "Filters need all the data." : "Results only include areas you have already opened."}
        </span>
        {#if localDb.status === "downloading"}
          <span>Downloading all data...</span>
        {:else if settings.lowData || !localDb.persistent}
          <Button size="xs" variant="outline" onclick={() => localDb.download()}>
            Download all data to search everywhere
          </Button>
        {/if}
      </div>
    {:else if result?.status === "done" && result.matches.size === 0}
      <span class="px-4 py-2 text-sm text-muted-foreground">No results</span>
    {/if}
    {#if result && result.matches.size > EXPAND_LIMIT}
      <span class="px-4 py-2 text-sm text-muted-foreground">
        Too many results to open automatically. Open the areas you want to see.
      </span>
    {/if}
    {#if !(result?.status === "done" && result.matches.size === 0)}
      <Sidebar.Group>
        <Sidebar.GroupLabel
          ><a href={resolve("world")}>{getLocalizedName(appState.tree.root.feature)}</a></Sidebar.GroupLabel
        >
        <Sidebar.GroupContent
          ><Sidebar.Menu><AppSidebarChildren bind:item={appState.tree.root} slug={""} /></Sidebar.Menu
          ></Sidebar.GroupContent
        >
      </Sidebar.Group>
    {/if}
    {#if result?.status === "searching"}
      <span class="px-4 py-2 text-sm text-muted-foreground">Searching... {result.matches.size} matches</span>
    {:else if result?.status === "paused"}
      <div class="flex flex-col gap-2 px-4 py-2 text-sm text-muted-foreground">
        <span>{result.matches.size} matches so far</span>
        <Button size="xs" variant="outline" onclick={() => loadMore?.()}>Load more results</Button>
      </div>
    {/if}
  </Sidebar.Content>
  {#if selection.size > 0}
    <Sidebar.Footer class="border-t bg-sidebar p-2">
      <div class="flex items-center justify-between gap-2 text-xs">
        <span class="font-medium">{selection.size} selected</span>
        <Button size="xs" variant="ghost" onclick={() => selection.clear()}>
          <XIcon />
          Clear
        </Button>
      </div>
      {#if appState.osmUser.loggedIn}
        <Button size="sm" class="w-full" onclick={openMoveDialog}>
          <FolderPlusIcon />
          Move to new sector
        </Button>
      {:else}
        <p class="text-xs text-muted-foreground">Log in to OpenStreetMap to move into a new sector.</p>
      {/if}
    </Sidebar.Footer>
  {/if}
  <Sidebar.Rail class="translate-x-0" />
</Sidebar.Root>

<Dialog.Root bind:open={moveDialogOpen}>
  <Dialog.Content class="max-w-sm">
    <form onsubmit={confirmMoveToNewSector} class="flex flex-col gap-4">
      <Dialog.Header>
        <Dialog.Title>Move to new sector</Dialog.Title>
        <Dialog.Description>
          Create a new sector{moveTargetParent ? ` in ${getLocalizedName(moveTargetParent.feature)}` : ""} and move
          {selection.size} selected item{selection.size === 1 ? "" : "s"} into it.
        </Dialog.Description>
      </Dialog.Header>
      <Input bind:value={newSectorName} placeholder="Sector name (optional)" autofocus />
      <Dialog.Footer>
        <Dialog.Close>
          {#snippet child({ props })}
            <Button {...props} type="button" variant="outline">Cancel</Button>
          {/snippet}
        </Dialog.Close>
        <Button type="submit">Create & move</Button>
      </Dialog.Footer>
    </form>
  </Dialog.Content>
</Dialog.Root>
