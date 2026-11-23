<script lang="ts">
  import EditableDescription from "#lib/components/editable/editable-description.svelte";
  import CommonsTopo from "#lib/components/commons-topo.svelte";
  import ClimbingStyles from "#components/climbing-styles.svelte";
  import { getCoordinates, getPhone } from "#lib/data/parse/osm-tags.js";
  import type { DataTree } from "#lib/types.js";
  import type { OsmFeature } from "osm-api";
        import MapLinks from "#lib/components/map-links.svelte";
import ClimbingProviderLinks from "#lib/components/climbing-provider-links.svelte";
  import EditableOpeningHours from "#lib/components/editable/editable-opening-hours.svelte";
  import { getFee, getFeeCharge, getWebsite } from "#lib/data/parse/gym-tags.js";

  let {
    item = $bindable(),
    slug,
  }: {
    item: DataTree<OsmFeature>;
    slug: string;
  } = $props();

  const feature = $derived(item.feature);
  const coordinates = $derived(getCoordinates(feature));
  const phone = $derived(getPhone(feature.tags ?? {}));
  const website = $derived(getWebsite(feature.tags ?? {}));
  const fee = $derived(getFee(feature.tags ?? {}));
  const charge = $derived(getFeeCharge(feature.tags ?? {}));
</script>

<ClimbingStyles {feature} />

<div class="flex flex-wrap items-center gap-3 text-sm">
  {#if phone}
    <p class="flex items-center gap-1.5">
      <span aria-hidden="true"  class="icon-[lucide--phone] shrink-0 size-4 text-muted-foreground"></span>
      <a class="underline underline-offset-2" href={`tel:${phone}`}>{phone}</a>
    </p>
  {/if}

  {#if website}
    <p class="flex items-center gap-1.5">
      <span aria-hidden="true"  class="icon-[lucide--globe] shrink-0 size-4 text-muted-foreground"></span>
      <a class="underline underline-offset-2" href={website} target="_blank" rel="noopener noreferrer">
        {website.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "")}
      </a>
    </p>
  {/if}

  {#if fee !== undefined}
    <span class="flex items-center" title={fee ? (charge ? `Fee: ${charge}` : "Fee") : "Free"}>
      <span
        class="icon-[lucide--circle-dollar-sign] shrink-0 size-4"
        class:text-foreground={fee}
        class:text-muted-foreground={!fee}
        aria-hidden="true"
      ></span>
    </span>
  {/if}

  {#if coordinates}
    <MapLinks {coordinates} name={feature.tags?.name} />
  {/if}
</div>

<ClimbingProviderLinks {feature} />

<EditableOpeningHours {feature} featureSlug={slug} />

<EditableDescription {feature} featureSlug={slug} />

<CommonsTopo {feature} featureSlug={slug} />
