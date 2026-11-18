<script lang="ts">
  import { getAppState } from "#lib/data/app-state.js";
  import EditableTextarea from "./editable-textarea.svelte";
  import type { Key, OsmFeature } from "osm-api";
  import type { ComponentProps } from "svelte";

  const {
    tagKey,
    feature,
    featureSlug,
    ...props
  }: {
    tagKey: Key;
    feature: OsmFeature;
    featureSlug: string;
  } & ComponentProps<typeof EditableTextarea> = $props();

  const appState = getAppState();

  const tags = $derived(feature.tags ?? {});
</script>

<!-- max length of osm tag is 255 -->
<EditableTextarea
  bind:value={() => tags[tagKey], (v) => appState.setTag(featureSlug, tagKey, v === "" ? undefined : v)}
  maxlength={255}
  {...props}
/>
