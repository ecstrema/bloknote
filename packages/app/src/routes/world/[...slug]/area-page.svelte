<script lang="ts">
  import EditableDescription from "#components/editable/editable-description.svelte";
  import ChildrenTable from "./children-table.svelte";
  import ClimbingStyles from "#components/climbing-styles.svelte";
  import CommonsTopo from "#lib/components/commons-topo.svelte";
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
</script>

<ClimbingStyles {feature} />
<EditableDescription {feature} featureSlug={slug} />

{#if item.stats?.totalRoutes}
  <p>{item.stats.totalRoutes} routes in total</p>
{/if}

<ChildrenTable bind:item />
<CommonsTopo {feature} featureSlug={slug} />
