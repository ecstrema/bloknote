<script lang="ts">
  import type { OsmFeature } from "osm-api";
  import { goto } from "$app/navigation";
  import { resolve } from "$app/paths";
  import { page } from "$app/state";
  import { slugify } from "@bloknote/reverse-geocoding-data/shared";
  import { getParentSlug } from "#lib/helpers/slug.js";
  import { getBrowserUrl } from "#lib/helpers/url.js";
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
    // Shallow gotos don't update `page.url`, so compare against the browser URL (issue #212)
    const browserUrl = getBrowserUrl();
    if (page.params.slug !== featureSlug && browserUrl.searchParams.get("id") !== id) return;

    const segment = slugify(feature.tags?.name?.trim() ?? "");
    if (!segment) return;

    const parentSlug = getParentSlug(featureSlug);
    const nextSlug = parentSlug ? `${parentSlug}/${segment}` : segment;
    const url = new URL(browserUrl.href);
    url.pathname = resolve("/world/[...slug]", { slug: nextSlug });
    url.searchParams.set("id", id);
    if (url.href !== browserUrl.href) {
      void goto(url, { state: page.state, shallow: true, replace: true });
    }
  }
</script>

<EditableTag
  tagKey="name"
  {feature}
  {featureSlug}
  placeholder="Name"
  class="text-2xl font-semibold"
  onblur={syncUrlSlug}
/>
