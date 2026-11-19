<script lang="ts">
  import EditableDescription from "#components/editable/editable-description.svelte";
  import ChildrenTable from "./children-table.svelte";
  import ClimbingStyles from "#components/climbing-styles.svelte";
  import CommonsTopo from "#lib/components/commons-topo.svelte";
  import SectorStats from "#lib/components/sector-stats.svelte";
  import { getAreaKindLabel } from "#lib/data/parse/diagnostics.js";
  import type { OsmFeature } from "osm-api";
  import type { DataTree } from "#lib/types.js";

  let {
    item = $bindable(),
    slug,
  }: {
    item: DataTree<OsmFeature>;
    slug: string;
  } = $props();

  const feature = $derived(item.feature);
  const kindLabel = $derived(getAreaKindLabel(feature));
</script>

<CommonsTopo {feature} featureSlug={slug} />

<div class="flex flex-wrap items-center gap-2">
  <span class="rounded bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">{kindLabel}</span>
  <ClimbingStyles {feature} />
</div>
<EditableDescription {feature} featureSlug={slug} />

{#if item.stats?.totalRoutes}
  <p class="text-sm text-muted-foreground">{item.stats.totalRoutes} routes in total</p>
{/if}

<SectorStats {item} {slug} />

<ChildrenTable bind:item />
