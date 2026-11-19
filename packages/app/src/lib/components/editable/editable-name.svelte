<script lang="ts">
  import type { OsmFeature } from "osm-api";
  import { goto } from "$app/navigation";
  import { resolve } from "$app/paths";
  import { page } from "$app/state";
  import { slugify } from "@bloknote/reverse-geocoding-data/shared";
  import { getParentSlug } from "#lib/helpers/slug.js";
  import EditableTag from "./editable-tag.svelte";

  let {
    feature,
    featureSlug,
  }: {
    feature: OsmFeature;
    featureSlug: string;
  } = $props();

  function syncUrlSlug() {
    const id = `${feature.type}-${feature.id}`;
    if (page.params.slug !== featureSlug && page.url.searchParams.get("id") !== id) return;

    const segment = slugify(feature.tags?.name?.trim() ?? "");
    if (!segment) return;

    const parentSlug = getParentSlug(featureSlug);
    const nextSlug = parentSlug ? `${parentSlug}/${segment}` : segment;
    const url = new URL(page.url.href);
    url.pathname = resolve("/world/[...slug]", { slug: nextSlug });
    url.searchParams.set("id", id);
    if (url.href !== page.url.href) {
      void goto(url, { state: page.state, shallow: true, replace: true });
    }
  }
</script>

<EditableTag
  tagKey="name"
  {feature}
  {featureSlug}
  placeholder="Enter Name..."
  class="text-2xl font-semibold"
  onblur={syncUrlSlug}
/>
