<script lang="ts">
  import EditableGradeValue from "./editable-grade-value.svelte";
  import type { OsmFeature } from "osm-api";
  import EditableTooltip from "./editable-tooltip.svelte";
  import { Button } from "#components/ui/button/index.js";
  import type { WithSourceTag } from "#lib/data/parse/osm-tags.js";
  import type { Grade } from "#lib/types.js";
  import { getAppState } from "#lib/data/app-state.js";
  import Trash2Icon from "@lucide/svelte/icons/trash-2";

  const {
    grade,
    feature,
    featureSlug,
  }: {
    grade: WithSourceTag<Grade> | undefined;
    feature: OsmFeature;
    featureSlug: string;
  } = $props();

  const appState = getAppState();

  function addGrade() {
    // TODO: use current grade scale from the local area's settings.
    appState.setTag(featureSlug, "climbing:grade:yds_class", "5.10a");
  }

  function deleteGrade() {
    if (!grade) return;
    appState.deleteTag(featureSlug, grade.source);
    if (grade.source !== "climbing:grade" && feature.tags?.["climbing:grade"]) {
      appState.deleteTag(featureSlug, "climbing:grade");
    }
  }
</script>

<EditableTooltip>
  {#snippet children(props)}
    {#if grade}
      <div class="flex gap-1 items-center" {...props}>
        <EditableGradeValue {feature} {grade} {featureSlug} />
        {#if appState.osmUser.loggedIn}
          <Button
            size="icon-xs"
            variant="ghost"
            class="text-muted-foreground hover:text-destructive"
            title="Delete grade"
            onclick={deleteGrade}
          >
            <Trash2Icon class="size-3.5" />
          </Button>
        {/if}
      </div>
    {:else}
      <Button class="text-muted-foreground" onclick={addGrade} variant="outline" {...props}>Add Grade</Button>
    {/if}
  {/snippet}
</EditableTooltip>
