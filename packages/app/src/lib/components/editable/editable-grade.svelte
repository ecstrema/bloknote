<script lang="ts">
  import EditableGradeValue from "./editable-grade-value.svelte";
  import type { OsmFeature } from "osm-api";
  import EditableTooltip from "./editable-tooltip.svelte";
  import type { WithSourceTag } from "#lib/data/parse/osm-tags.js";
  import type { Grade } from "#lib/types.js";

  const {
    grade,
    feature,
    featureSlug,
  }: {
    grade: WithSourceTag<Grade> | undefined;
    feature: OsmFeature;
    featureSlug: string;
  } = $props();
</script>

<EditableTooltip>
  {#snippet children(props)}
    <div class="inline-flex items-center" {...props}>
      <EditableGradeValue {feature} {grade} {featureSlug} />
    </div>
  {/snippet}
</EditableTooltip>
