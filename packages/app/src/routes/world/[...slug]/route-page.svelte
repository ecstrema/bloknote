<script lang="ts">
  import EditableDescription from "#lib/components/editable/editable-description.svelte";
  import EditableGrade from "#components/editable/editable-grade.svelte";
  import EditableLength from "#components/editable/editable-length.svelte";
  import ClimbingStyles from "#components/climbing-styles.svelte";
  import CommonsTopo from "#lib/components/commons-topo.svelte";
  import type { DataTree } from "#lib/types.js";
  import type { OsmFeature } from "osm-api";
  import { getCoordinates, getGrade, isProjectRoute } from "#lib/data/parse/osm-tags.js";
  import { isTradRoute } from "#lib/data/parse/route-styles.js";
  import TradCamIcon from "#components/trad-cam-icon.svelte";
  import * as Alert from "#components/ui/alert/index.js";
  import TriangleAlertIcon from "@lucide/svelte/icons/triangle-alert";

  let {
    item = $bindable(),
    slug,
  }: {
    item: DataTree<OsmFeature>;
    slug: string;
  } = $props();

  const feature = $derived(item.feature);

  let coordinates = $derived(getCoordinates(item.feature));
  let grade = $derived(feature.tags ? getGrade(feature.tags) : undefined);
  const isProject = $derived(isProjectRoute(feature.tags));
</script>

<div class="flex flex-wrap gap-3 items-baseline">
  <EditableGrade {feature} {grade} featureSlug={slug} />
  {#if isTradRoute(feature.tags)}
    <TradCamIcon class="self-center" />
  {/if}
  <EditableLength {feature} featureSlug={slug} />
</div>

{#if isProject && grade}
  <Alert.Root class="border-amber-500/50 bg-amber-500/10 text-amber-900 dark:text-amber-200">
    <TriangleAlertIcon class="size-4 text-amber-600 dark:text-amber-400" />
    <Alert.Title>Graded project warning</Alert.Title>
    <Alert.Description>
      This route is named "{feature.tags?.name}" but has a grade assigned ({grade.v.v}). Projects are typically
      unclimbed and ungraded.
    </Alert.Description>
  </Alert.Root>
{/if}

<ClimbingStyles {feature} />

{#if coordinates}
  <p class="text-sm text-muted-foreground">{coordinates.lat}, {coordinates.lon}</p>
{/if}

<EditableDescription {feature} featureSlug={slug} />

<CommonsTopo {feature} featureSlug={slug} />
