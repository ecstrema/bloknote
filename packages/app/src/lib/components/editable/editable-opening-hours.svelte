<script lang="ts">
  import { getAppState } from "#lib/data/app-state.js";
  import { canEditOpeningHoursGraph, parseOpeningHours } from "@bloknote/osm-climbing";
  import { ensureOpeningHoursLoaded, openingHoursReady } from "#lib/data/parse/opening-hours-ready.svelte.js";
  import { getCoordinates } from "@bloknote/osm-climbing";
  import type { OsmFeature } from "osm-api";
  import EditableTooltip from "./editable-tooltip.svelte";
  import Loader from "#components/ui/loader.svelte";

  const { feature, featureSlug }: { feature: OsmFeature; featureSlug: string } = $props();

  const appState = getAppState();
  const value = $derived(feature.tags?.opening_hours?.trim() ?? "");
  const coordinates = $derived(getCoordinates(feature));
  const parsed = $derived(openingHoursReady.value && value ? parseOpeningHours(value, coordinates) : undefined);
  const unparsable = $derived(openingHoursReady.value && value !== "" && !parsed);
  const graphEditable = $derived(
    openingHoursReady.value && !!appState.osmUser.loggedIn && canEditOpeningHoursGraph(value, coordinates),
  );

  $effect(() => {
    if (value || appState.osmUser.loggedIn) ensureOpeningHoursLoaded();
  });
</script>

{#if value || appState.osmUser.loggedIn}
  <div class="flex flex-col gap-1">
    {#if openingHoursReady.value}
      {#if !unparsable}
        {#await import("#components/opening-hours.svelte")}
          <Loader class="h-[190px] max-w-md" />
        {:then { default: OpeningHours }}
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
        {/await}
      {:else}
        {#await import("#components/opening-hours.svelte")}
          <Loader class="h-[190px] max-w-md" />
        {:then { default: OpeningHours }}
          <OpeningHours {value} {coordinates} />
        {/await}
      {/if}
    {/if}
    {#if unparsable}
      <p class="text-xs text-muted-foreground">This opening_hours syntax could not be parsed.</p>
    {/if}
  </div>
{/if}
