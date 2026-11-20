<script lang="ts">
  import type { DataTree } from "#lib/types.js";
  import { Button } from "#components/ui/button/index.js";

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

{#if Object.keys(item.children ?? {}).length === 0}
  <span class="px-4 py-2 text-muted-foreground">No children</span>
{/if}

{#if appState.osmUser.loggedIn && itemType === "area" && isActivePath}
  <div class="flex gap-2 self-end">
    <Button variant="outline" size="xs" class="font-normal" onclick={addRoute}>Add Route</Button>
    {#if !isCrag}
      <Button variant="outline" size="xs" class="font-normal" onclick={addSector}>Add Sector</Button>
    {/if}
  </div>
{/if}

{#snippet showItem(slug: string)}
  {let child = item.children?.[slug]}
  {#if child && searchFilter.current.matches(slug, child)}
    <AppSidebarNode bind:item={child} {slug} />
  {/if}
{/snippet}
