<script lang="ts">
  import { getAppState } from "#lib/data/app-state.js";
  import type { OsmFeature } from "osm-api";
  import AddImageDialog from "./topo/add-image-dialog.svelte";
  import {
    commonsImageKey,
    directCommonsImage,
    findMatchingImageTag,
    findNextImageTagKey,
    getImagesFromTags,
    getRelatedTreeRoutes,
    getReusableTreeImages,
    parsePath,
    resolveCommonsCategoryImage,
    type CommonsImage,
    type ResolvedImage,
    type RouteOverlayPath,
  } from "./topo/topo-helpers.js";
  import TopoOverlay from "./topo/topo-overlay.svelte";
  import TopoViewer from "./topo/topo-viewer.svelte";

  const { feature, featureSlug }: { feature: OsmFeature; featureSlug: string } = $props();
  const appState = getAppState();
  const tags = $derived(feature.tags ?? {});

  const ownImages = $derived(getImagesFromTags(tags));
  const treeRoutes = $derived(getRelatedTreeRoutes(appState.tree, featureSlug));
  const reusableImages = $derived(getReusableTreeImages(appState.tree, featureSlug, ownImages));

  const carouselImages = $derived.by(() => {
    const result: CommonsImage[] = [...ownImages];
    const seen = new Set(ownImages.map((img) => commonsImageKey(img.title)));
    if (treeRoutes.some((r) => r.slug !== featureSlug)) {
      for (const route of treeRoutes) {
        for (const img of getImagesFromTags(route.feature.tags)) {
          const k = commonsImageKey(img.title);
          if (seen.has(k)) continue;
          seen.add(k);
          result.push(img);
        }
      }
    }
    return result;
  });

  let resolvedCategories = $state<Record<string, ResolvedImage | undefined>>({});
  let loadingCategories = $state<Record<string, boolean>>({});
  let ratios = $state<Record<string, number | undefined>>({});
  let failedImages = $state<Record<string, boolean>>({});

  let expandedImage = $state<CommonsImage>();
  let addOpen = $state(false);

  $effect(() => {
    let cancelled = false;
    for (const image of [...carouselImages, ...reusableImages]) {
      if (!/^category:/i.test(image.normalizedTitle)) continue;
      if (resolvedCategories[image.key] || loadingCategories[image.key]) continue;
      loadingCategories[image.key] = true;
      void resolveCommonsCategoryImage(image.title)
        .then((resolved) => {
          if (!cancelled) resolvedCategories[image.key] = resolved;
        })
        .catch(() => {
          if (!cancelled) resolvedCategories[image.key] = undefined;
        })
        .finally(() => {
          if (!cancelled) loadingCategories[image.key] = false;
        });
    }
    return () => {
      cancelled = true;
    };
  });

  function overlayPathsFor(image: CommonsImage): RouteOverlayPath[] {
    const paths: RouteOverlayPath[] = [];
    const seenSlugs = new Set<string>();

    const ownPoints = parsePath(tags[image.pathKey]);
    if (ownPoints.length > 0) {
      seenSlugs.add(featureSlug);
      paths.push({
        slug: featureSlug,
        label: feature.tags?.name ?? "",
        points: ownPoints,
        active: true,
      });
    }

    for (const route of treeRoutes) {
      if (seenSlugs.has(route.slug)) continue;
      const match = findMatchingImageTag(route.feature.tags, image.title);
      if (!match) continue;
      const points = parsePath(route.feature.tags?.[match.pathKey]);
      if (points.length === 0) continue;
      seenSlugs.add(route.slug);
      paths.push({
        slug: route.slug,
        label: route.name,
        points,
        active: route.slug === featureSlug,
      });
    }

    return paths;
  }

  function attachImageToFeature(title: string) {
    if (!appState.osmUser.loggedIn) return;
    if (findMatchingImageTag(tags, title)) return;
    const tagKey = findNextImageTagKey(tags);
    appState.setTag(featureSlug, tagKey, title);
  }
</script>

<section class="flex flex-col gap-2" aria-label="Images">
  <h2 class="text-sm font-semibold">Images</h2>

  <div class="flex snap-x snap-mandatory gap-3 overflow-x-auto pb-2">
    {#each carouselImages as image (image.normalizedTitle)}
      {@const imageData = directCommonsImage(image, resolvedCategories)}
      {@const ratio = ratios[image.normalizedTitle]}
      {@const paths = ratio ? overlayPathsFor(image) : []}
      <button
        type="button"
        class="group relative flex h-40 w-52 shrink-0 snap-start items-center justify-center overflow-hidden rounded-md border bg-muted text-left transition hover:ring-2 hover:ring-ring sm:h-44 sm:w-56"
        aria-label="Expand image"
        onclick={() => (expandedImage = image)}
      >
        {#if imageData && !failedImages[image.normalizedTitle]}
          <div class="relative inline-flex max-h-full max-w-full" style:aspect-ratio={ratio}>
            <img
              src={imageData.src}
              alt={feature.tags?.name ?? "Climbing image"}
              class="block h-auto max-h-40 w-auto max-w-52 select-none sm:max-h-44 sm:max-w-56"
              onload={(event) => {
                const { naturalWidth, naturalHeight } = event.currentTarget as HTMLImageElement;
                if (naturalWidth && naturalHeight) {
                  ratios[image.normalizedTitle] = naturalWidth / naturalHeight;
                }
              }}
              onerror={() => (failedImages[image.normalizedTitle] = true)}
            />
            {#if ratio}
              <TopoOverlay {ratio} {paths} compact />
            {/if}
          </div>
        {:else if loadingCategories[image.key]}
          <span class="px-3 text-xs text-muted-foreground">Loading…</span>
        {:else}
          <span class="px-3 text-xs text-muted-foreground">Image unavailable</span>
        {/if}
      </button>
    {/each}

    <button
      type="button"
      class="flex h-40 w-40 shrink-0 cursor-pointer snap-start flex-col items-center justify-center gap-2 rounded-md border border-dashed text-muted-foreground transition hover:border-foreground/40 hover:text-foreground sm:h-44 sm:w-44"
      onclick={() => (addOpen = true)}
    >
      <span aria-hidden="true"  class="icon-[lucide--image-plus] shrink-0 size-7"></span>
      <span class="text-xs font-medium">Add image...</span>
    </button>
  </div>
</section>

<TopoViewer
  bind:image={expandedImage}
  imageData={expandedImage ? directCommonsImage(expandedImage, resolvedCategories) : undefined}
  bind:ratio={
    () => (expandedImage ? ratios[expandedImage.normalizedTitle] : undefined),
    (v) => {
      if (expandedImage && v) ratios[expandedImage.normalizedTitle] = v;
    }
  }
  {featureSlug}
  featureName={feature.tags?.name ?? ""}
  canRemoveOwnImage={expandedImage ? ownImages.some((img) => img.key === expandedImage?.key) : false}
  {treeRoutes}
  overlayPaths={expandedImage ? overlayPathsFor(expandedImage) : []}
/>

<AddImageDialog bind:open={addOpen} {reusableImages} {resolvedCategories} onadd={attachImageToFeature} />
