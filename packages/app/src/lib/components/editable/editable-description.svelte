<script lang="ts">
  import EditableTag from "./editable-tag.svelte";
  import type { Key, OsmFeature } from "osm-api";

  let {
    feature,
    featureSlug,
  }: {
    feature: OsmFeature;
    featureSlug: string;
  } = $props();

  let focusedKey = $state<Key>();

  const descriptionKeys = $derived.by(() => {
    const tags = feature.tags ?? {};
    const keys = Object.keys(tags)
      .filter((key) => (key === "description" || key.startsWith("description:")) && (tags[key] || key === focusedKey))
      .sort((a, b) => (a === "description" ? -1 : b === "description" ? 1 : a.localeCompare(b)));

    if (focusedKey && !keys.includes(focusedKey)) {
      keys.push(focusedKey);
    }

    return (keys.length > 0 ? keys : ["description"]) as Key[];
  });

  const showLabels = $derived(descriptionKeys.length > 1 || descriptionKeys[0] !== "description");
</script>

<div class="flex flex-col gap-2">
  {#each descriptionKeys as tagKey (tagKey)}
    <div class="flex flex-col gap-0.5">
      {#if showLabels}
        <span class="text-xs text-muted-foreground">{tagKey}</span>
      {/if}
      <EditableTag
        {tagKey}
        {feature}
        {featureSlug}
        placeholder="Enter description..."
        class="text-sm"
        onfocus={() => (focusedKey = tagKey)}
        onblur={() => {
          if (focusedKey === tagKey) focusedKey = undefined;
        }}
      />
    </div>
  {/each}
</div>
