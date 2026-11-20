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
  import { restoreSidebarOrders, setSearchFilter, type SearchFilter } from "./utils";
  import { getAppState } from "#lib/data/app-state.js";
  import { localDb, type FilterSearch } from "#lib/data/db/local-db.svelte.js";
  import { settings } from "#lib/data/settings.svelte.js";
  import type { SearchFilters } from "#lib/data/db/types.js";
  import { getParentSlugs } from "#lib/helpers/slug.js";
  import { Button } from "#components/ui/button/index.js";
  import * as ContextMenu from "#components/ui/context-menu/index.js";
  import * as DropdownMenu from "#components/ui/dropdown-menu/index.js";
  import { atproto } from "#lib/data/network/atproto.svelte.js";
  import { scaleIdToTag } from "#lib/data/parse/osm-tags.js";
  import { ROUTE_STYLE_LABELS } from "#lib/data/parse/route-styles.js";
  import { allScales } from "@bloknote/holy-grade";
  import SidebarBulkDialogs, { type BulkDialogKind } from "./sidebar-bulk-dialogs.svelte";
  import { SidebarSelection, setSidebarSelection } from "./selection.svelte";
  import XIcon from "@lucide/svelte/icons/x";
  import ListFilterIcon from "@lucide/svelte/icons/list-filter";
  import ChevronsDownUpIcon from "@lucide/svelte/icons/chevrons-down-up";
  import FolderInputIcon from "@lucide/svelte/icons/folder-input";
  import FolderPlusIcon from "@lucide/svelte/icons/folder-plus";
  import MoreHorizontalIcon from "@lucide/svelte/icons/more-horizontal";
  import Trash2Icon from "@lucide/svelte/icons/trash-2";

  /** Above this many matches, the tree isn't opened automatically to reveal them */
  const EXPAND_LIMIT = 1000;
  const STORAGE_KEY = "bloknote:search-filters";

  let { ref = $bindable(null), ...restProps }: ComponentProps<typeof Sidebar.Root> & {} = $props();

  const appState = getAppState();
  const sidebar = Sidebar.useSidebar();

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

  let bulkDialog = $state<BulkDialogKind>(null);
  const convertibleScales = allScales.filter((s) => !!scaleIdToTag(s.id));
  const styleOptions = Object.entries(ROUTE_STYLE_LABELS).filter(([k]) => k !== "other" && k !== "viaferrata");

  const INDENT_STEP_PX = 15;
  let contentRef = $state<HTMLElement | null>(null);
  let unindentPx = $state(0);
  let unindentRaf: number | undefined;

  function computeUnindent() {
    unindentRaf = undefined;
    if (!contentRef) return;
    const containerRect = contentRef.getBoundingClientRect();
    if (containerRect.height <= 0) return;

    let minDepth = Infinity;
    for (const el of contentRef.querySelectorAll<HTMLElement>("[data-tree-depth]")) {
      const rect = el.getBoundingClientRect();
      if (rect.height <= 0) continue;
      if (rect.bottom > containerRect.top && rect.top < containerRect.bottom) {
        const depth = Number(el.dataset.treeDepth);
        if (Number.isFinite(depth) && depth < minDepth) minDepth = depth;
      }
    }
    unindentPx = Number.isFinite(minDepth) && minDepth > 0 ? minDepth * INDENT_STEP_PX : 0;
  }

  function scheduleUnindent() {
    if (unindentRaf !== undefined) return;
    unindentRaf = requestAnimationFrame(computeUnindent);
  }

  $effect(() => {
    const el = contentRef;
    if (!el) return;
    scheduleUnindent();
    const ro = new ResizeObserver(scheduleUnindent);
    ro.observe(el);
    const mo = new MutationObserver(scheduleUnindent);
    mo.observe(el, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-tree-open"] });
    return () => {
      ro.disconnect();
      mo.disconnect();
      if (unindentRaf !== undefined) {
        cancelAnimationFrame(unindentRaf);
        unindentRaf = undefined;
      }
    };
  });

  function handleTreeKeydown(event: KeyboardEvent) {
    if (!contentRef) return;
    const current = (event.target as HTMLElement | null)?.closest<HTMLElement>("[data-tree-depth]");
    if (!current) return;

    const items = Array.from(contentRef.querySelectorAll<HTMLElement>("[data-tree-depth]")).filter(
      (el) => el.offsetParent !== null,
    );
    const index = items.indexOf(current);
    if (index === -1) return;

    const currentDepth = Number(current.dataset.treeDepth ?? 0);
    const focusItem = (el: HTMLElement | undefined) => {
      if (!el) return;
      el.focus();
      el.scrollIntoView({ block: "nearest" });
    };

    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        focusItem(items[Math.min(index + 1, items.length - 1)]);
        break;
      case "ArrowUp":
        event.preventDefault();
        focusItem(items[Math.max(index - 1, 0)]);
        break;
      case "Home":
        event.preventDefault();
        focusItem(items[0]);
        break;
      case "End":
        event.preventDefault();
        focusItem(items.at(-1));
        break;
      case "ArrowRight":
        if (current.dataset.treeOpen === "false") {
          event.preventDefault();
          current.dispatchEvent(new CustomEvent("bloknote:tree-toggle", { detail: { open: true } }));
        } else if (current.dataset.treeOpen === "true") {
          const next = items[index + 1];
          if (next && Number(next.dataset.treeDepth ?? 0) > currentDepth) {
            event.preventDefault();
            focusItem(next);
          }
        }
        break;
      case "ArrowLeft":
        if (current.dataset.treeOpen === "true") {
          event.preventDefault();
          current.dispatchEvent(new CustomEvent("bloknote:tree-toggle", { detail: { open: false } }));
        } else {
          for (let i = index - 1; i >= 0; i--) {
            const candidate = items[i]!;
            if (Number(candidate.dataset.treeDepth ?? 0) < currentDepth) {
              event.preventDefault();
              focusItem(candidate);
              break;
            }
          }
        }
        break;
    }
  }

  function handleTreeContextMenu(event: MouseEvent, triggerHandler?: (e: MouseEvent) => void) {
    const target = (event.target as HTMLElement | null)?.closest<HTMLElement>("[data-sidebar-slug]");
    const targetSlug = target?.dataset.sidebarSlug;
    if (!targetSlug) {
      if (selection.size === 0) return;
    } else if (!selection.has(targetSlug)) {
      selection.clear();
      selection.toggle(targetSlug);
    }
    triggerHandler?.(event);
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
      {#if sidebar.isMobile}
        <Button variant="ghost" size="icon" aria-label="Close sidebar" onclick={() => sidebar.setOpenMobile(false)}>
          <XIcon />
        </Button>
      {/if}
    </div>
    {#if showFilters}
      <SearchFiltersPanel bind:filters bind:gradeText />
    {/if}
  </Sidebar.Header>
  <Sidebar.Content bind:ref={contentRef} onscroll={scheduleUnindent} class="overflow-x-hidden">
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
        <Sidebar.GroupContent>
          <ContextMenu.Root>
            <ContextMenu.Trigger>
              {#snippet child({ props })}
                <div
                  {...props}
                  role="tree"
                  tabindex="-1"
                  style:margin-left="-{unindentPx}px"
                  class="transition-[margin-left] duration-200 ease-out"
                  onkeydown={handleTreeKeydown}
                  oncontextmenu={(e) =>
                    handleTreeContextMenu(e, props.oncontextmenu as ((ev: MouseEvent) => void) | undefined)}
                >
                  <Sidebar.Menu><AppSidebarChildren bind:item={appState.tree.root} slug={""} /></Sidebar.Menu>
                </div>
              {/snippet}
            </ContextMenu.Trigger>
            <ContextMenu.Content>
              <ContextMenu.Label>{selection.size} selected</ContextMenu.Label>
              <ContextMenu.Separator />
              {#if appState.osmUser.loggedIn}
                <ContextMenu.Item onclick={() => (bulkDialog = "move-folder")}>
                  <FolderInputIcon />
                  Move to folder...
                </ContextMenu.Item>
                <ContextMenu.Item onclick={() => (bulkDialog = "new-sector")}>
                  <FolderPlusIcon />
                  Move to new sector...
                </ContextMenu.Item>
                <ContextMenu.Separator />
                <ContextMenu.Sub>
                  <ContextMenu.SubTrigger>Change grading system</ContextMenu.SubTrigger>
                  <ContextMenu.SubContent>
                    {#each convertibleScales as scale (scale.id)}
                      <ContextMenu.Item onclick={() => appState.bulkChangeGradingScale(selection.slugs, scale.id)}>
                        {scale.name} ({scale.id})
                      </ContextMenu.Item>
                    {/each}
                  </ContextMenu.SubContent>
                </ContextMenu.Sub>
                <ContextMenu.Sub>
                  <ContextMenu.SubTrigger>Change climbing type</ContextMenu.SubTrigger>
                  <ContextMenu.SubContent>
                    {#each styleOptions as [key, label] (key)}
                      <ContextMenu.Item onclick={() => appState.bulkSetClimbingType(selection.slugs, key)}>
                        {label}
                      </ContextMenu.Item>
                    {/each}
                  </ContextMenu.SubContent>
                </ContextMenu.Sub>
                <ContextMenu.Separator />
                <ContextMenu.Item variant="destructive" onclick={() => (bulkDialog = "delete")}>
                  <Trash2Icon />
                  Delete selected...
                </ContextMenu.Item>
              {/if}
              {#if atproto.configured}
                <ContextMenu.Item onclick={() => (bulkDialog = "add-ticks")}>Add ticks...</ContextMenu.Item>
              {/if}
              {#if !appState.osmUser.loggedIn && !atproto.configured}
                <ContextMenu.Item disabled>Log in to edit selected items</ContextMenu.Item>
              {/if}
              <ContextMenu.Separator />
              <ContextMenu.Item onclick={() => selection.clear()}>Clear selection</ContextMenu.Item>
            </ContextMenu.Content>
          </ContextMenu.Root>
        </Sidebar.GroupContent>
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
        <div class="flex gap-1">
          <Button size="sm" class="flex-1" onclick={() => (bulkDialog = "new-sector")}>
            <FolderPlusIcon />
            Move to new sector
          </Button>
          <DropdownMenu.Root>
            <DropdownMenu.Trigger>
              {#snippet child({ props })}
                <Button {...props} size="sm" variant="outline" aria-label="Bulk actions">
                  <MoreHorizontalIcon />
                </Button>
              {/snippet}
            </DropdownMenu.Trigger>
            <DropdownMenu.Content align="end">
              <DropdownMenu.Item onclick={() => (bulkDialog = "move-folder")}>Move to folder...</DropdownMenu.Item>
              <DropdownMenu.Item onclick={() => (bulkDialog = "change-scale")}
                >Change grading system...</DropdownMenu.Item
              >
              <DropdownMenu.Item onclick={() => (bulkDialog = "change-type")}>Change climbing type...</DropdownMenu.Item
              >
              {#if atproto.configured}
                <DropdownMenu.Item onclick={() => (bulkDialog = "add-ticks")}>Add ticks...</DropdownMenu.Item>
              {/if}
              <DropdownMenu.Separator />
              <DropdownMenu.Item variant="destructive" onclick={() => (bulkDialog = "delete")}>
                Delete selected...
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Root>
        </div>
      {:else if atproto.configured}
        <Button size="sm" class="w-full" onclick={() => (bulkDialog = "add-ticks")}>Add ticks...</Button>
      {:else}
        <p class="text-xs text-muted-foreground">Log in to OpenStreetMap for bulk actions.</p>
      {/if}
    </Sidebar.Footer>
  {/if}
  <Sidebar.Rail class="translate-x-0" />
</Sidebar.Root>

<SidebarBulkDialogs bind:dialog={bulkDialog} {selection} />
