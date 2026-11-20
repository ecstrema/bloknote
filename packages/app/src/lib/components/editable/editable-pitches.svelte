<script lang="ts">
  import { getAppState } from "#lib/data/app-state.js";
  import { isMultipitchRoute } from "#lib/data/parse/osm-tags.js";
  import { cn } from "#lib/utils.js";
  import type { OsmFeature } from "osm-api";
  import EditableTextarea from "./editable-textarea.svelte";

  const { feature, featureSlug }: { feature: OsmFeature; featureSlug: string } = $props();
  const appState = getAppState();

  const rawPitches = $derived(feature.tags?.["climbing:pitches"]?.trim() ?? "");
  const isMultipitch = $derived(isMultipitchRoute(feature.tags));
  let draft = $state("");
  let focused = $state(false);
  let invalid = $state(false);
  const inputValue = $derived(focused ? draft : rawPitches);

  function setPitches(input: string) {
    const value = input.trim();
    invalid = !!value && !/^[1-9]\d*$/.test(value);
    if (invalid) return;

    const count = value ? Number(value) : undefined;
    appState.undoStack.beginGroup();
    appState.setTag(featureSlug, "climbing:pitches", value || undefined);
    if (count && count > 1) {
      appState.setTag(featureSlug, "climbing:multipitch", "yes");
    }
    appState.undoStack.endGroup();
  }
</script>

{#if rawPitches || isMultipitch || appState.osmUser.loggedIn}
  <span class="flex items-baseline gap-1 text-muted-foreground" title="Number of pitches">
    <EditableTextarea
      singleLine
      class={cn(invalid && "text-destructive")}
      value={inputValue}
      placeholder="Pitches"
      oninput={(e) => {
        draft = e.currentTarget.value;
        setPitches(draft);
      }}
      onfocus={() => {
        draft = rawPitches;
        focused = true;
      }}
      onblur={() => {
        focused = false;
        invalid = false;
      }}
    />
    {#if rawPitches && !invalid}
      <span>{rawPitches === "1" ? "pitch" : "pitches"}</span>
    {/if}
  </span>
{/if}
