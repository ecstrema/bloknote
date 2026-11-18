<script lang="ts">
  import { getAppState } from "#lib/data/app-state.js";
  import { canEditOpeningHoursGraph, parseOpeningHours } from "#lib/data/parse/opening-hours.js";
  import { getCoordinates } from "#lib/data/parse/osm-tags.js";
  import type { OsmFeature } from "osm-api";
  import OpeningHours from "#components/opening-hours.svelte";
  import EditableTextarea from "./editable-textarea.svelte";
  import EditableTooltip from "./editable-tooltip.svelte";
  import ClockIcon from "@lucide/svelte/icons/clock";

  const { feature, featureSlug }: { feature: OsmFeature; featureSlug: string } = $props();

  const appState = getAppState();
  const value = $derived(feature.tags?.opening_hours?.trim() ?? "");
  const coordinates = $derived(getCoordinates(feature));
  const parsed = $derived(value ? parseOpeningHours(value, coordinates) : undefined);
  const unparsable = $derived(value !== "" && !parsed);
  const graphEditable = $derived(!!appState.osmUser.loggedIn && canEditOpeningHoursGraph(value, coordinates));
</script>

{#if value || appState.osmUser.loggedIn}
  <div class="flex flex-col gap-1">
    <p class="flex items-center gap-2 text-sm">
      <ClockIcon class="size-4 text-muted-foreground" aria-hidden="true" />
      <span class="text-muted-foreground">Opening hours</span>
    </p>
    {#if !unparsable}
      {#if graphEditable}
        <EditableTooltip>
          {#snippet children(tooltipProps)}
            <div {...tooltipProps} class="self-start w-full max-w-md">
              <OpeningHours
                {value}
                {coordinates}
                editable={true}
                onchangestart={() => appState.undoStack.beginGroup()}
                onchange={(next) => appState.setTag(featureSlug, "opening_hours", next)}
                onchangeend={() => appState.undoStack.endGroup()}
              />
            </div>
          {/snippet}
        </EditableTooltip>
      {:else}
        <div class="self-start w-full max-w-md">
          <OpeningHours {value} {coordinates} />
        </div>
      {/if}
    {:else}
      <OpeningHours {value} {coordinates} />
    {/if}
    <EditableTextarea
      singleLine
      class="text-sm"
      placeholder="Mo-Fr 10:00-22:00; Sa-Su 10:00-18:00"
      bind:value={() => value, (v) => appState.setTag(featureSlug, "opening_hours", v.trim() || undefined)}
    />
    {#if unparsable}
      <p class="text-xs text-muted-foreground">This opening_hours syntax could not be parsed.</p>
    {:else if appState.osmUser.loggedIn && !graphEditable}
      <p class="text-xs text-muted-foreground">Complex rules can be edited in the text field above.</p>
    {/if}
  </div>
{/if}
