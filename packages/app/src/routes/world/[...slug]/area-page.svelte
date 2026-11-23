<script lang="ts">
  import EditableDescription from "#components/editable/editable-description.svelte";
  import ChildrenTable from "./children-table.svelte";
  import ClimbingStyles from "#components/climbing-styles.svelte";
  import CommonsTopo from "#lib/components/commons-topo.svelte";
  import { getAreaKindLabel } from "#lib/data/parse/diagnostics.js";
  import { Button } from "#components/ui/button/index.js";
  import Loader from "#components/ui/loader.svelte";
  import ClimbingProviderLinks from "#lib/components/climbing-provider-links.svelte";
  import type { OsmFeature } from "osm-api";
  import type { DataTree } from "#lib/types.js";
  import MapLinks from "#lib/components/map-links.svelte";

  let {
    item = $bindable(),
    slug,
    coordinates,
  }: {
    item: DataTree<OsmFeature>;
    slug: string;
    coordinates?: { lat: number; lon: number };
  } = $props();

  const feature = $derived(item.feature);
  const kindLabel = $derived(getAreaKindLabel(feature));
</script>

<CommonsTopo {feature} featureSlug={slug} />

<div class="flex flex-wrap items-center justify-between gap-2">
  <div class="flex flex-wrap items-center gap-2">
    <span class="rounded bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">{kindLabel}</span>
    <ClimbingStyles {feature} />
  </div>
  <Button size="xs" variant="outline" onclick={() => window.print()}>
    <span class="icon-[lucide--printer] shrink-0 size-4"></span>
    Print
  </Button>
</div>

<ClimbingProviderLinks {feature} />

<EditableDescription {feature} featureSlug={slug} />

{#if coordinates}
  <MapLinks {coordinates} name={feature.tags?.name} />
{/if}

{#if item.stats?.totalRoutes}
  <p class="text-sm text-muted-foreground">{item.stats.totalRoutes} routes in total</p>
{/if}

{#await import("#lib/components/sector-stats.svelte")}
  <Loader class="h-24" />
{:then { default: SectorStats }}
  <SectorStats {item} {slug} />
{/await}

<ChildrenTable bind:item />
