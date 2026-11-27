<script lang="ts">
  import * as Sidebar from "#components/ui/sidebar/index.js";
  import type { ComponentProps } from "svelte";
  import { onMount } from "svelte";
  import { afterNavigate, goto } from "$app/navigation";
  import { gradeTextToReference } from "#lib/data/db/grade-text.js";
  import { featureToType, getName } from "#lib/data/parse/data.js";
  import { getLocalizedName } from "#lib/data/parse/localized-name.js";
  import { resolve } from "$app/paths";
  import AppSidebarChildren from "./app-sidebar-children.svelte";

  import Input from "#components/ui/input/input.svelte";
  import type { DataTree } from "#lib/types.js";
  import { restoreSidebarOrders, setSearchFilter, getBrowserUrl, type SearchFilter } from "./utils";
  import SearchDialog from "./search-dialog.svelte";
  import { searchState } from "./search-state.svelte.js";
  import { getAppState } from "#lib/data/app-state.js";
  import { localDb, type FilterSearch } from "#lib/data/db/local-db.svelte.js";
  import { settings } from "#lib/data/settings.svelte.js";
  import type { SearchFilters } from "#lib/data/db/types.js";
  import { getParentSlugs } from "#lib/helpers/slug.js";
  import { Button } from "#components/ui/button/index.js";
  import * as ContextMenu from "#components/ui/context-menu/index.js";
  import * as DropdownMenu from "#components/ui/dropdown-menu/index.js";
  import { atproto } from "#lib/data/network/atproto.svelte.js";
  import { scaleIdToTag } from "@bloknote/osm-climbing";
  import { ROUTE_STYLE_LABELS } from "@bloknote/osm-climbing";
  import { allScales } from "@bloknote/holy-grade";
  import SidebarBulkDialogs, { type BulkDialogKind } from "./sidebar-bulk-dialogs.svelte";
  import { SidebarSelection, setSidebarSelection } from "./selection.svelte";

  /** Above this many matches, the tree isn't opened automatically to reveal them */
  const EXPAND_LIMIT = 1000;

  let { ref = $bindable(null), ...restProps }: ComponentProps<typeof Sidebar.Root> & {} = $props();

  const appState = getAppState();
  const sidebar = Sidebar.useSidebar();

  // Reveal the current position when navigating: reopen the sidebar if it was collapsed.
  afterNavigate(() => {
    if (!sidebar.isMobile && !sidebar.open) sidebar.setOpen(true);
  });

  let collapseVersion = $state(0);

  /** Whether the search dialog with all the options is open (issue #166) */
  let searchDialogOpen = $state(false);

  /** Called by the search dialog: close it and show the results in the sidebar (also on mobile) */
  function showResults() {
    searchDialogOpen = false;
    if (sidebar.isMobile) sidebar.setOpenMobile(true);
    else sidebar.setOpen(true);
  }

  onMount(() => {
    restoreSidebarOrders();
    // The search query belongs to the tab: it is restored from the URL params instead of
    // localStorage, which restored it in every open tab (issue #268)
    searchState.restoreFromUrl(getBrowserUrl().searchParams);
  });

  // Keep the URL in sync with the complete search query so it can be copied and shared.
  // A replacing shallow goto avoids flooding the history on every keystroke.
  $effect(() => {
    if (!searchState.restored) return;
    const url = new URL(window.location.href);
    searchState.writeToUrl(url);
    void goto(url, { state: history.state, replace: true, shallow: true });
  });

  // Grade inputs accept text like "6b" or "7A": they are converted to reference numbers here.
  $effect(() => {
    searchState.filters.gradeMin = gradeTextToReference(searchState.gradeText.min);
    searchState.filters.gradeMax = gradeTextToReference(searchState.gradeText.max);
  });

  /** The places matching the filters, and their ancestors so that the tree leads to them */
  $effect(() => {
    if (!searchState.active || !localDb.ready) {
      searchState.result = undefined;
      searchState.loadMore = undefined;
      return;
    }
    // dbFilters() reads every search input (filters, premade refs, min length): the effect
    // restarts whenever any of them changes (issue #166).
    const dbFilters = searchState.dbFilters();
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
      searchState.result = {
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
      search = localDb.filter(dbFilters, (slugs) => {
        pending.push(...slugs);
        // Batches are grouped so that the tree isn't rebuilt for each one
        flushTimer ??= setTimeout(() => flush("searching"), 150);
      });
      searchState.loadMore = run;
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
    const text = searchState.filters.text.trim().toLowerCase();
    const t = featureToType(d.feature);
    if (t === "route" || t === "gym") return getName(d.feature)?.toLowerCase().includes(text) ?? false;
    if (d.children) return Object.values(d.children).some((child) => fallbackMatches(child));
    return false;
  }

  const searchFilter: SearchFilter = {
    matches(slug, d) {
      if (!searchState.active) return true;
      if (localDb.ready) return searchState.result ? searchState.result.visible.has(slug) : true;
      return searchState.hasFilters ? true : fallbackMatches(d);
    },
    shouldExpand(slug) {
      const result = searchState.result;
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
    const target = event.target as HTMLElement | null;
    // The rename input handles its own caret movement
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return;
    const current = target?.closest<HTMLElement>("[data-tree-depth]");
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
          bind:value={searchState.filters.text}
        />
        {#if searchState.filters.text}
          <button
            type="button"
            aria-label="Clear search"
            class="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            onclick={() => (searchState.filters.text = "")}
          >
            <span class="icon-[lucide--x] shrink-0 size-4"></span>
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
        <span class="icon-[lucide--chevrons-down-up] shrink-0 size-4"></span>
      </Button>
      <!-- Opens the search dialog with all the options (issue #166). Highlighted while a search is active. -->
      <Button
        variant={searchState.hasFilters ? "default" : "outline"}
        size="icon"
        aria-label="Search options"
        title="Search options"
        onclick={() => (searchDialogOpen = true)}
      >
        <span class="icon-[lucide--list-filter] shrink-0 size-4"></span>
      </Button>
      {#if sidebar.isMobile}
        <!-- Larger touch target and icon: the close button was hard to hit on phones (issue #81) -->
        <Button
          variant="ghost"
          size="icon"
          class="size-11"
          aria-label="Close sidebar"
          onclick={() => sidebar.setOpenMobile(false)}
        >
          <span class="icon-[lucide--x] shrink-0 size-6"></span>
        </Button>
      {/if}
    </div>
  </Sidebar.Header>
  <Sidebar.Content bind:ref={contentRef} onscroll={scheduleUnindent} class="overflow-x-hidden">
    {#if searchState.active && !localDb.ready && localDb.status !== "error"}
      <div class="flex flex-col gap-2 px-4 py-2 text-sm text-muted-foreground">
        <span>
          {searchState.hasFilters
            ? "Filters need all the data."
            : "Results only include areas you have already opened."}
        </span>
        {#if localDb.status === "downloading"}
          <span>Downloading all data...</span>
        {:else if settings.lowData || !localDb.persistent}
          <Button size="xs" variant="outline" onclick={() => localDb.download()}>
            Download all data to search everywhere
          </Button>
        {/if}
      </div>
    {:else if searchState.result?.status === "done" && searchState.result.matches.size === 0}
      <span class="px-4 py-2 text-sm text-muted-foreground">No results</span>
    {/if}
    {#if searchState.result && searchState.result.matches.size > EXPAND_LIMIT}
      <span class="px-4 py-2 text-sm text-muted-foreground">
        Too many results to open automatically. Open the areas you want to see.
      </span>
    {/if}
    {#if !(searchState.result?.status === "done" && searchState.result.matches.size === 0)}
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
                  <span class="icon-[lucide--folder-input] shrink-0 size-4"></span>
                  Move to folder...
                </ContextMenu.Item>
                <ContextMenu.Item onclick={() => (bulkDialog = "new-sector")}>
                  <span class="icon-[lucide--folder-plus] shrink-0 size-4"></span>
                  Move to new sector...
                </ContextMenu.Item>
                <ContextMenu.Item onclick={() => (bulkDialog = "suggest-sectors")}>
                  <span class="icon-[lucide--wand-sparkles] shrink-0 size-4"></span>
                  Suggest sectors...
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
                  <span class="icon-[lucide--trash-2] shrink-0 size-4"></span>
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
    {#if searchState.result?.status === "searching"}
      <span class="px-4 py-2 text-sm text-muted-foreground">
        Searching... {searchState.result.matches.size} matches
      </span>
    {:else if searchState.result?.status === "paused"}
      <div class="flex flex-col gap-2 px-4 py-2 text-sm text-muted-foreground">
        <span>{searchState.result.matches.size} matches so far</span>
        <Button size="xs" variant="outline" onclick={() => searchState.loadMore?.()}>Load more results</Button>
      </div>
    {/if}
  </Sidebar.Content>
  {#if selection.size > 0}
    <Sidebar.Footer class="border-t bg-sidebar p-2">
      <div class="flex items-center justify-between gap-2 text-xs">
        <span class="font-medium">{selection.size} selected</span>
        <Button size="xs" variant="ghost" onclick={() => selection.clear()}>
          <span class="icon-[lucide--x] shrink-0 size-4"></span>
          Clear
        </Button>
      </div>
      {#if appState.osmUser.loggedIn}
        <div class="flex gap-1">
          <Button size="sm" class="flex-1" onclick={() => (bulkDialog = "new-sector")}>
            <span class="icon-[lucide--folder-plus] shrink-0 size-4"></span>
            Move to new sector
          </Button>
          <DropdownMenu.Root>
            <DropdownMenu.Trigger>
              {#snippet child({ props })}
                <Button {...props} size="sm" variant="outline" aria-label="Bulk actions">
                  <span class="icon-[lucide--more-horizontal] shrink-0 size-4"></span>
                </Button>
              {/snippet}
            </DropdownMenu.Trigger>
            <DropdownMenu.Content align="end">
              <DropdownMenu.Item onclick={() => (bulkDialog = "move-folder")}>Move to folder...</DropdownMenu.Item>
              <DropdownMenu.Item onclick={() => (bulkDialog = "suggest-sectors")}>Suggest sectors...</DropdownMenu.Item>
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
<SearchDialog bind:open={searchDialogOpen} onShowResults={showResults} />
