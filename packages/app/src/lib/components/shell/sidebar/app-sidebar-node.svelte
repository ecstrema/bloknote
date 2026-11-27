<script lang="ts">
  import { resolve } from "$app/paths";
  import * as Collapsible from "#components/ui/collapsible/index.js";
  import * as Sidebar from "#components/ui/sidebar/index.js";
  import * as DropdownMenu from "#components/ui/dropdown-menu/index.js";
  import type { DataTree } from "#lib/types.js";

  import { featureToType } from "#lib/data/parse/data.js";
  import { getLocalizedName } from "#lib/data/parse/localized-name.js";
  import AppSidebarChildren from "./app-sidebar-children.svelte";
  import HolyGrade from "#components/grade/holy-grade.svelte";
  import { onMount, untrack } from "svelte";
  import { getGrade, isProjectRoute } from "@bloknote/osm-climbing";
  import { isIceRoute, isTradRoute } from "@bloknote/osm-climbing";
  import TradCamIcon from "#components/trad-cam-icon.svelte";
  import type { OsmFeature } from "osm-api";
  import { navigating, page } from "$app/state";
  import clsx from "clsx";
  import { getAppState } from "#lib/data/app-state.js";
  import {
    addRouteFromSidebar,
    canDropSidebarInto,
    canDropSidebarOrder,
    clearSidebarDropPosition,
    dropSidebarChild,
    endSidebarDrag,
    getItemUrl,
    getBrowserUrl,
    getSidebarDraggedSlugs,
    getSidebarDropPosition,
    getSearchFilter,
    setSidebarDropPosition,
    startSidebarDrag,
    type ReorderableType,
    type SidebarDropPosition,
  } from "./utils";
  import { getParentSlug } from "#lib/helpers/slug.js";
  import { afterNavigate, goto } from "$app/navigation";
  import { getSidebarSelection } from "./selection.svelte";
  import { useSidebar } from "#components/ui/sidebar/index.js";

  let {
    slug,
    item = $bindable(),
  }: {
    slug: string;
    item: DataTree;
  } = $props();

  const appState = getAppState();
  const searchFilter = getSearchFilter();
  const selection = getSidebarSelection();
  const sidebar = useSidebar();

  const breadcrumbSlugs = $derived(appState.breadcrumbs.slugs);
  const tree = $derived(appState.tree);

  const isCurrentPage = $derived(
    (page.params.slug ?? "") === slug ||
      (item.feature.type !== "geographic" &&
        getBrowserUrl().searchParams.get("id") === `${item.feature.type}-${item.feature.id}`),
  );
  // Check if this specific node is part of the active path being viewed
  const isActivePath = $derived(isCurrentPage || breadcrumbSlugs.some((s) => s === slug));

  let open = $state(false);
  $effect(() => {
    if (isActivePath || isCurrentPage) open = true;
  });

  // Nodes opened by the search are closed again when it ends, so the full tree isn't rendered at once.
  let openedBySearch = false;
  $effect(() => {
    const expand = searchFilter.current.shouldExpand(slug);
    untrack(() => {
      if (expand) {
        if (!open) {
          open = true;
          openedBySearch = true;
        }
      } else if (openedBySearch) {
        openedBySearch = false;
        if (!isActivePath) open = false;
      }
    });
  });

  $effect(() => {
    if (open) appState.fetchChildren(slug);
  });

  let seenCollapseVersion = searchFilter.current.collapseVersion;
  $effect(() => {
    const version = searchFilter.current.collapseVersion;
    if (version === seenCollapseVersion) return;
    seenCollapseVersion = version;
    open = false;
  });

  onMount(() => appState.fetchStats(slug));

  const link = $derived.by(() => {
    return resolve("/world/[...slug]", { slug });
  });
  const name = $derived(getLocalizedName(item.feature));

  const itemType = $derived(featureToType(item.feature));
  const isLeafRegion = $derived(
    itemType === "geographic" &&
      !Object.values(item.children ?? {}).some((child) => child.feature.type === "geographic"),
  );
  const reorderType = $derived<ReorderableType | undefined>(
    itemType === "route" ? "route" : itemType === "area" ? "area" : undefined,
  );
  const treeDepth = $derived(slug ? slug.split("/").length - 1 : 0);
  // HTML5 drag & drop does not work with touch: on mobile it only hijacks the scroll gesture
  // and long-press, so reordering stays a desktop affordance
  const canDrag = $derived(
    !sidebar.isMobile && itemType !== "geographic" && (!!reorderType || !!appState.osmUser.loggedIn),
  );
  const parentSlug = $derived(getParentSlug(slug) ?? "");
  const dropPosition = $derived(getSidebarDropPosition(slug));

  let ref = $state<HTMLElement | null>(null);

  // The action menu is costly to mount for every node, so it only exists once the node is hovered or focused.
  let interacted = $state(false);
  let expandTimer: ReturnType<typeof setTimeout> | undefined;

  function clearExpandTimer() {
    if (expandTimer) {
      clearTimeout(expandTimer);
      expandTimer = undefined;
    }
  }

  function onDragStart(event: DragEvent) {
    if (!canDrag) {
      event.preventDefault();
      return;
    }
    const draggedSlugs = selection?.has(slug) && selection.size > 1 ? selection.slugs : [slug];
    startSidebarDrag(parentSlug, reorderType, draggedSlugs);
    event.dataTransfer?.setData("text/plain", draggedSlugs.join("\n"));
    if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
  }

  function onDragOver(event: DragEvent) {
    const canOrder = !!reorderType && canDropSidebarOrder(parentSlug, reorderType, slug);
    const canInto = canDropSidebarInto(slug, itemType, !!appState.osmUser.loggedIn);
    if (!canOrder && !canInto) return;

    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";

    const target = event.currentTarget as HTMLElement;
    const bounds = target.getBoundingClientRect();
    const ratio = bounds.height > 0 ? (event.clientY - bounds.top) / bounds.height : 0.5;

    let position: SidebarDropPosition;
    if (canOrder && canInto) {
      position = ratio < 0.25 ? "before" : ratio > 0.75 ? "after" : "into";
    } else if (canInto) {
      position = "into";
    } else {
      position = ratio >= 0.5 ? "after" : "before";
    }
    setSidebarDropPosition(slug, position);

    if (position === "into" && itemType === "area" && !open && !expandTimer) {
      expandTimer = setTimeout(() => {
        expandTimer = undefined;
        open = true;
      }, 500);
    } else if (position !== "into") {
      clearExpandTimer();
    }
  }

  function onDragLeave(event: DragEvent) {
    const target = event.currentTarget as HTMLElement;
    const relatedTarget = event.relatedTarget as Node | null;
    if (relatedTarget && target.contains(relatedTarget)) return;
    clearExpandTimer();
    clearSidebarDropPosition(slug);
  }

  async function onDrop(event: DragEvent) {
    clearExpandTimer();
    const position = getSidebarDropPosition(slug);
    const draggedSlugs = getSidebarDraggedSlugs();
    if (!position || draggedSlugs.length === 0) {
      endSidebarDrag();
      return;
    }

    if (position === "into" && canDropSidebarInto(slug, itemType, !!appState.osmUser.loggedIn)) {
      event.preventDefault();
      endSidebarDrag();
      const wasCurrentMoved = draggedSlugs.includes(page.params.slug ?? "");
      await appState.fetchChildren(slug);
      const movedSlugs = appState.moveItemsToParent(draggedSlugs, slug);
      if (movedSlugs.length > 0) {
        open = true;
        if (draggedSlugs.some((s) => selection?.has(s))) {
          selection?.clear();
        }
        if (wasCurrentMoved) {
          const movedNode = appState.tree.getReactiveNode(movedSlugs[0]!);
          if (movedNode && movedNode.feature.type !== "geographic") {
            void goto(getItemUrl(slug, movedNode.feature), { state: page.state, shallow: true, replace: true });
          }
        }
      }
      return;
    }

    if (
      reorderType &&
      (position === "before" || position === "after") &&
      canDropSidebarOrder(parentSlug, reorderType, slug)
    ) {
      event.preventDefault();
      const parent = appState.tree.getReactiveNode(parentSlug);
      if (parent) {
        const orderedSlugs = dropSidebarChild(parent, parentSlug, reorderType, slug, position === "after");
        if (orderedSlugs && parent.feature.type === "relation") {
          appState.reorderRelationChildren(parentSlug, reorderType, orderedSlugs);
        }
      }
    }
    endSidebarDrag();
  }

  function onDragEnd() {
    clearExpandTimer();
    endSidebarDrag();
  }

  function addRoute() {
    addRouteFromSidebar(appState, item, slug);
  }

  async function addArea(climbing: "area" | "crag" = "area") {
    const newSlug = appState.createArea(item, slug, undefined, climbing);
    const feature = item.children?.[newSlug]?.feature;
    if (feature && feature.type !== "geographic") {
      void goto(getItemUrl(slug, feature), { state: page.state, shallow: true, replace: true });
    }
  }

  function handleItemClick(event: MouseEvent) {
    if (!selection) return;
    if (itemType === "geographic") {
      if (!event.ctrlKey && !event.metaKey && !event.shiftKey) {
        selection.clear();
        selection.setAnchor(undefined);
        // Geographic nodes render inside a Collapsible.Trigger, which swallows the anchor's default
        // navigation on touch devices: navigate explicitly (issue #81).
        event.preventDefault();
        void goto(link, { state: page.state });
      }
      return;
    }

    if (event.ctrlKey || event.metaKey) {
      event.preventDefault();
      event.stopPropagation();
      selection.toggle(slug);
    } else if (event.shiftKey) {
      event.preventDefault();
      event.stopPropagation();
      selection.selectRange(slug);
    } else {
      selection.clear();
      selection.setAnchor(slug);
      if (itemType === "route" || itemType === "gym") {
        if (sidebar.isMobile) sidebar.setOpenMobile(false);
      } else {
        // Folder nodes render inside a Collapsible.Trigger, which swallows the anchor's default
        // navigation on touch devices: navigate explicitly (issue #81).
        event.preventDefault();
        void goto(link, { state: page.state });
      }
    }
  }

  const isSelected = $derived(itemType !== "geographic" && (selection?.has(slug) ?? false));

  function onTreeToggle(event: Event) {
    const detail = (event as CustomEvent<{ open?: boolean }>).detail;
    open = detail?.open ?? !open;
  }

  $effect(() => {
    if (!ref || (itemType !== "geographic" && itemType !== "area")) return;
    const el = ref;
    el.addEventListener("bloknote:tree-toggle", onTreeToggle);
    return () => el.removeEventListener("bloknote:tree-toggle", onTreeToggle);
  });

  $effect(() => {
    if (isCurrentPage && ref) {
      ref.scrollIntoView({ block: "nearest", inline: "nearest" });
      // Collapsible ancestors animate open, so scroll again once they have settled
      const timeout = setTimeout(
        () => ref?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" }),
        300,
      );
      return () => clearTimeout(timeout);
    }
  });

  let renaming = $state(false);
  let renameValue = $state("");
  let renameInput = $state<HTMLInputElement | null>(null);
  let blurTimer: ReturnType<typeof setTimeout> | undefined;
  let refocusAfterNavigation = false;

  function startRename() {
    // A dblclick inside the rename input bubbles up here; don't reset the value being edited
    if (renaming) return;
    if (item.feature.type === "geographic" || !appState.osmUser.loggedIn) return;
    renameValue = item.feature.tags?.name ?? "";
    renaming = true;
  }

  function commitRename() {
    if (!renaming) return;
    renaming = false;
    appState.setTag(slug, "name", renameValue.trim() || undefined);
  }

  function handleRenameBlur() {
    // The first click of the double click navigates, and SvelteKit resets focus once that
    // navigation settles, blurring the input right after it appeared. Keep editing and
    // refocus after the navigation instead of committing.
    if (navigating.to) {
      refocusAfterNavigation = true;
      return;
    }
    clearTimeout(blurTimer);
    blurTimer = setTimeout(commitRename, 150);
  }

  afterNavigate(() => {
    if (renaming && refocusAfterNavigation) {
      refocusAfterNavigation = false;
      renameInput?.focus({ preventScroll: true });
    }
  });

  function focusRenameInput(el: HTMLInputElement) {
    renameInput = el;
    el.focus({ preventScroll: true });
    el.select();
  }

  function stopInputClick(event: Event) {
    event.preventDefault();
    event.stopPropagation();
  }

  function stopInputMouseDown(event: Event) {
    // Only stop the node's own handlers: preventDefault would block selecting the text
    event.stopPropagation();
  }
</script>

<!-- The rename input lives outside the link/button row: nesting it inside an <a> or <button>
     breaks focus, selection and caret movement in several browsers. -->
{#snippet renameField()}
  <input
    use:focusRenameInput
    bind:value={renameValue}
    onkeydown={(e) => {
      if (e.key === "Enter") commitRename();
      else if (e.key === "Escape") renaming = false;
    }}
    onblur={handleRenameBlur}
    onclick={stopInputClick}
    onmousedown={stopInputMouseDown}
    ondblclick={stopInputClick}
    class="min-w-0 flex-1 rounded-sm border border-input bg-background px-1 py-0.5 text-sm outline-none"
  />
{/snippet}

{#if itemType === "route" || itemType === "gym"}
  {#if renaming}
    <div
      bind:this={ref}
      data-tree-depth={treeDepth}
      class="flex h-6.5 w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-[13px]"
    >
      {@render renameField()}
    </div>
  {:else}
    <Sidebar.MenuButton
      bind:ref={ref as HTMLButtonElement}
      isActive={isCurrentPage}
      data-sidebar-slug={slug}
      data-tree-depth={treeDepth}
      data-selected={isSelected || undefined}
      href={link}
      draggable={canDrag}
      onclick={handleItemClick}
      ondblclick={startRename}
      ondragstart={onDragStart}
      ondragover={onDragOver}
      ondragleave={onDragLeave}
      ondrop={onDrop}
      ondragend={onDragEnd}
      class={clsx(
        "data-[active=true]:bg-accent truncate w-full",
        isSelected && "bg-primary/15 text-primary ring-1 ring-inset ring-primary/40",
        dropPosition && "relative",
      )}
    >
      {#if dropPosition === "before"}
        <span class="pointer-events-none absolute inset-x-1 top-0 z-10 h-0.5 bg-primary" aria-hidden="true"></span>
      {:else if dropPosition === "after"}
        <span class="pointer-events-none absolute inset-x-1 bottom-0 z-10 h-0.5 bg-primary" aria-hidden="true"></span>
      {/if}
      {#if itemType === "route"}
        {@const routeTags = (item.feature as OsmFeature).tags || {}}
        {@const grade = getGrade(routeTags)}
        {#if grade}
          <HolyGrade class="text-xs font-semibold" grade={grade.v} />
        {:else if !isProjectRoute(routeTags)}
          <span class="icon-[lucide--circle-question-mark] shrink-0 size-4 text-destructive"></span>
        {/if}
        {#if isTradRoute(routeTags)}
          <TradCamIcon />
        {/if}
        {#if isIceRoute(routeTags)}
          <span
            aria-label="Ice / dry-tooling route"
            class="icon-[lucide--snowflake] shrink-0 size-3.5 shrink-0 text-cyan-500"
          ></span>
        {/if}
      {:else if itemType === "gym"}
        <span class="icon-[lucide--building] shrink-0 size-4"></span>
      {/if}
      <span class="truncate">{name || "No name"}</span>
    </Sidebar.MenuButton>
  {/if}
{:else}
  <Collapsible.Root
    bind:open
    onmouseenter={() => {
      interacted = true;
      appState.fetchChildren(slug);
    }}
    onfocusin={() => (interacted = true)}
    class="w-full"
  >
    {#if renaming}
      <div
        bind:this={ref}
        data-tree-depth={treeDepth}
        data-tree-open={open}
        class="flex h-6.5 w-full items-center rounded-md px-1.5 py-1 text-left text-[13px]"
      >
        {@render renameField()}
      </div>
    {:else}
      <Collapsible.Trigger>
        {#snippet child({ props })}
          <Sidebar.MenuItem bind:ref={ref as HTMLLIElement} {...props} class="group/button">
            <Sidebar.MenuButton
              bind:ref={ref as HTMLButtonElement}
              data-sidebar-slug={itemType !== "geographic" ? slug : undefined}
              data-tree-depth={treeDepth}
              data-tree-open={open}
              data-selected={isSelected || undefined}
              href={link}
              draggable={canDrag}
              onclick={handleItemClick}
              ondblclick={startRename}
              ondragstart={onDragStart}
              ondragover={onDragOver}
              ondragleave={onDragLeave}
              ondrop={onDrop}
              ondragend={onDragEnd}
              class={clsx(
                // Always reserve the badge / "more" menu slot so the name truncates before the
                // route count right away, instead of only once the menu action mounts on hover
                "pr-7",
                isSelected && "bg-primary/15 text-primary ring-1 ring-inset ring-primary/40",
                dropPosition === "into" && "bg-primary/15 ring-2 ring-inset ring-primary",
                dropPosition && "relative",
              )}
            >
              {#if dropPosition === "before"}
                <span class="pointer-events-none absolute inset-x-1 top-0 z-10 h-0.5 bg-primary" aria-hidden="true"
                ></span>
              {:else if dropPosition === "after"}
                <span class="pointer-events-none absolute inset-x-1 bottom-0 z-10 h-0.5 bg-primary" aria-hidden="true"
                ></span>
              {/if}
              <span
                class={clsx("icon-[lucide--chevron-right] shrink-0 size-4 transition-transform", open && "rotate-90")}
              ></span>
              {#if itemType === "geographic"}
                <span class="icon-[lucide--earth] shrink-0 size-4"></span>
              {/if}

              <span class="truncate grow">{name || "No name"}</span>
            </Sidebar.MenuButton>

            {#if item.stats}
              <Sidebar.MenuBadge class="group-hover/button:hidden">
                {item.stats.totalRoutes}
              </Sidebar.MenuBadge>
            {/if}

            {#if interacted}
              <DropdownMenu.Root>
                <DropdownMenu.Trigger
                  onclick={(e) => {
                    // The action menu lives inside the Collapsible.Trigger; stop the event so
                    // opening the menu doesn't also collapse or expand the node (issue #174).
                    e.stopPropagation();
                  }}
                >
                  {#snippet child({ props })}
                    <Sidebar.MenuAction showOnHover {...props}>
                      <span class="icon-[lucide--ellipsis] shrink-0 size-4"></span>
                    </Sidebar.MenuAction>
                  {/snippet}
                </DropdownMenu.Trigger>
                <DropdownMenu.Content side="right" align="start">
                  {#if appState.osmUser.loggedIn && (itemType === "area" || isLeafRegion)}
                    {#if item.feature.type !== "geographic" && item.feature.tags?.climbing !== "crag"}
                      <DropdownMenu.Item onclick={() => addArea()}>Add sector</DropdownMenu.Item>
                    {/if}
                    {#if isLeafRegion}
                      <DropdownMenu.Item onclick={() => addArea("crag")}>Add crag</DropdownMenu.Item>
                    {/if}
                    {#if itemType === "area"}
                      <DropdownMenu.Item onclick={addRoute}>Add route</DropdownMenu.Item>
                    {/if}
                    <DropdownMenu.Separator />
                  {/if}
                  <DropdownMenu.Item>Download images</DropdownMenu.Item>
                  <DropdownMenu.Separator />
                  <DropdownMenu.Item onclick={() => appState.deleteNodes([slug])}>
                    Delete {item.feature.type !== "geographic" && item.feature.tags?.climbing === "crag"
                      ? "crag"
                      : "area"}
                  </DropdownMenu.Item>
                </DropdownMenu.Content>
              </DropdownMenu.Root>
            {/if}
          </Sidebar.MenuItem>
        {/snippet}
      </Collapsible.Trigger>
    {/if}

    <Collapsible.Content>
      {#if open}
        <Sidebar.MenuSub>
          <AppSidebarChildren bind:item {slug} />
        </Sidebar.MenuSub>
      {/if}
    </Collapsible.Content>
  </Collapsible.Root>
{/if}
