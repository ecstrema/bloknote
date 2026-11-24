<script lang="ts">
  import type { DataTree } from "#lib/types.js";

  import AppSidebarNode from "./app-sidebar-node.svelte";
  import { addRouteFromSidebar, getItemUrl, getSearchFilter, getSidebarChildren } from "./utils";
  import type { OsmRelation, OsmWay } from "osm-api";
  import { featureToType } from "#lib/data/parse/data.js";
  import { getAppState } from "#lib/data/app-state.js";
  import { goto } from "$app/navigation";
  import { page } from "$app/state";

  let {
    item = $bindable(),
    slug,
  }: {
    item: DataTree;
    slug: string;
  } = $props();

  const orderedChildren = $derived.by(() => getSidebarChildren(item, slug));

  const itemType = $derived(featureToType(item.feature));
  const isCrag = $derived(item.feature.type !== "geographic" && item.feature.tags?.climbing === "crag");

  const appState = getAppState();

  // The add buttons are only useful on the item being viewed and on its ancestors: showing them
  // everywhere takes too much space in the sidebar.
  const isActivePath = $derived(
    appState.breadcrumbs.slugs.some((s) => s === slug) ||
      (item.feature.type !== "geographic" &&
        page.url.searchParams.get("id") === `${item.feature.type}-${item.feature.id}`),
  );

  const searchFilter = getSearchFilter();

  function addRoute() {
    addRouteFromSidebar(appState, item as DataTree<OsmWay | OsmRelation>, slug);
  }

  async function addSector() {
    const newSlug = appState.createArea(item as DataTree<OsmWay | OsmRelation>, slug);
    const feature = item.children?.[newSlug]?.feature;
    if (feature && feature.type !== "geographic") {
      void goto(getItemUrl(slug, feature), { state: page.state, shallow: true, replace: true });
    }
  }
</script>

{#each orderedChildren?.geographic as slug (slug)}
  {@render showItem(slug)}
{/each}

{#each orderedChildren?.area as slug (slug)}
  {@render showItem(slug)}
{/each}

{#each orderedChildren?.gym as slug (slug)}
  {@render showItem(slug)}
{/each}

{#each orderedChildren?.route as slug (slug)}
  {@render showItem(slug)}
{/each}

{#each orderedChildren?.other as slug (slug)}
  {@render showItem(slug)}
{/each}

{#if appState.osmUser.loggedIn && itemType === "area" && isActivePath}
  <div class="flex items-center gap-1 px-7 py-1">
    <button
      type="button"
      class="inline-flex h-6 cursor-pointer items-center gap-1 rounded-md border border-dashed border-border px-2 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
      onclick={addRoute}
    >
      <span aria-hidden="true" class="icon-[lucide--plus] shrink-0 size-3"></span>
      Route
    </button>
    {#if !isCrag}
      <button
        type="button"
        class="inline-flex h-6 cursor-pointer items-center gap-1 rounded-md border border-dashed border-border px-2 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
        onclick={addSector}
      >
        <span aria-hidden="true" class="icon-[lucide--plus] shrink-0 size-3"></span>
        Sector
      </button>
    {/if}
  </div>
{:else if Object.keys(item.children ?? {}).length === 0}
  <span class="px-4 py-2 text-muted-foreground">No children</span>
{/if}

{#snippet showItem(slug: string)}
  {let child = item.children?.[slug]}
  {#if child && searchFilter.current.matches(slug, child)}
    <AppSidebarNode bind:item={child} {slug} />
  {/if}
{/snippet}
