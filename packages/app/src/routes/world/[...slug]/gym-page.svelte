<script lang="ts">
  import EditableDescription from "#lib/components/editable/editable-description.svelte";
  import CommonsTopo from "#lib/components/commons-topo.svelte";
  import ClimbingStyles from "#components/climbing-styles.svelte";
  import { getAppState } from "#lib/data/app-state.js";
  import { getCoordinates, getPhone } from "#lib/data/parse/osm-tags.js";
  import type { DataTree } from "#lib/types.js";
  import type { OsmFeature } from "osm-api";
  import PhoneIcon from "@lucide/svelte/icons/phone";
  import GlobeIcon from "@lucide/svelte/icons/globe";
  import CircleDollarSignIcon from "@lucide/svelte/icons/circle-dollar-sign";
  import ClockIcon from "@lucide/svelte/icons/clock";
  import MapLinks from "#lib/components/map-links.svelte";
  import EditableOpeningHours from "#lib/components/editable/editable-opening-hours.svelte";
  import { getFee, getFeeCharge, getWebsite } from "#lib/data/parse/gym-tags.js";

  let {
    item = $bindable(),
    slug,
  }: {
    item: DataTree<OsmFeature>;
    slug: string;
  } = $props();

  const appState = getAppState();
  let coordinates = $derived(getCoordinates(item.feature));
  const feature = $derived(item.feature);
  const phone = $derived(getPhone(feature.tags ?? {}));
  const website = $derived(getWebsite(feature.tags ?? {}));
  const fee = $derived(getFee(feature.tags ?? {}));
  const charge = $derived(getFeeCharge(feature.tags ?? {}));
  const hasOpeningHours = $derived(!!feature.tags?.opening_hours?.trim() || appState.osmUser.loggedIn);
</script>

<ClimbingStyles {feature} />

<div class="flex flex-wrap items-center gap-3 text-sm">
  {#if phone}
    <p class="flex items-center gap-1.5">
      <PhoneIcon class="size-4 text-muted-foreground" aria-hidden="true" />
      <a class="underline underline-offset-2" href={`tel:${phone}`}>{phone}</a>
    </p>
  {/if}

  {#if website}
    <p class="flex items-center gap-1.5">
      <GlobeIcon class="size-4 text-muted-foreground" aria-hidden="true" />
      <a class="underline underline-offset-2" href={website} target="_blank" rel="noopener noreferrer">
        {website.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "")}
      </a>
    </p>
  {/if}

  {#if fee !== undefined}
    <span class="flex items-center" title={fee ? (charge ? `Fee: ${charge}` : "Fee") : "Free"}>
      <CircleDollarSignIcon
        class={fee ? "size-4 text-foreground" : "size-4 text-muted-foreground"}
        aria-hidden="true"
      />
    </span>
  {/if}

  {#if hasOpeningHours}
    <ClockIcon class="size-4 text-muted-foreground" aria-hidden="true" title="Opening hours" />
  {/if}
</div>

<EditableOpeningHours {feature} featureSlug={slug} />

{#if coordinates}
  <MapLinks {coordinates} name={feature.tags?.name} />
{/if}

<EditableDescription {feature} featureSlug={slug} />

<CommonsTopo {feature} featureSlug={slug} />
