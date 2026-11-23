<script lang="ts">
  import { resolve } from "$app/paths";
  import { Button } from "#components/ui/button/index.js";
  import { Input } from "#components/ui/input/index.js";
  import { Select } from "#components/ui/select/index.js";
  import { Textarea } from "#components/ui/textarea/index.js";
  import { atproto, sameElementRef } from "#lib/data/network/atproto.svelte.js";
  import PendingSyncBadge from "#lib/components/pending-sync-badge.svelte";
  import { normalizedRatingToStars, starsToNormalizedRating, type AscentStyle } from "@bloknote/common";
        import type { OsmFeature } from "osm-api";

  const {
    feature,
    allowTicks = false,
  }: {
    feature: OsmFeature;
    allowTicks?: boolean;
  } = $props();

  let tickStyle = $state<AscentStyle>("redpoint");
  let tickComment = $state("");
  let reviewText = $state("");
  let reviewStars = $state(0);
  let busy = $state(false);
  let error = $state<string>();

  const ref = $derived({ type: feature.type, id: feature.id });
  const starred = $derived(atproto.isStarred(feature));
  const routeTicks = $derived(atproto.ticks.filter((t) => sameElementRef(t.subject, ref)));
  const routeReviews = $derived(atproto.reviews.filter((r) => sameElementRef(r.subject, ref)));

  async function onToggleStar() {
    error = undefined;
    busy = true;
    try {
      await atproto.toggleStar(feature);
    } catch (e) {
      error = e instanceof Error ? e.message : "Could not update bookmark";
    } finally {
      busy = false;
    }
  }

  async function onAddTick(event: SubmitEvent) {
    event.preventDefault();
    error = undefined;
    busy = true;
    try {
      await atproto.addTick(feature, tickStyle, tickComment);
      tickComment = "";
    } catch (e) {
      error = e instanceof Error ? e.message : "Could not log tick";
    } finally {
      busy = false;
    }
  }

  async function onAddReview(event: SubmitEvent) {
    event.preventDefault();
    error = undefined;
    busy = true;
    try {
      const rating = reviewStars > 0 ? starsToNormalizedRating(reviewStars, 5) : undefined;
      await atproto.addReview(feature, reviewText, rating);
      reviewText = "";
      reviewStars = 0;
    } catch (e) {
      error = e instanceof Error ? e.message : "Could not post comment";
    } finally {
      busy = false;
    }
  }
</script>

<section class="flex flex-col gap-3 rounded-md border p-3.5" aria-label="Logbook and comments">
  <div class="flex flex-wrap items-center justify-between gap-2">
    <h2 class="text-sm font-semibold">Activity &amp; Comments</h2>
    {#if atproto.configured}
      <Button size="xs" variant={starred ? "secondary" : "outline"} disabled={busy} onclick={onToggleStar}>
        <span class="icon-[lucide--star] shrink-0 size-4" class:text-amber-500={starred}></span>
        {starred ? "Bookmarked" : "Bookmark"}
      </Button>
    {:else}
      <a href={resolve("/settings/account")} class="text-xs text-primary hover:underline">
        Connect Atmosphere to log ticks &amp; comments
      </a>
    {/if}
  </div>

  <p class="text-xs text-muted-foreground">
    Ticks, comments and bookmarks are currently private: only you can see them. Follow
    <a
      class="underline underline-offset-2"
      href="https://github.com/ecstrema/bloknote/issues/172"
      target="_blank"
      rel="noreferrer">issue #172</a
    >
    for shared, live comments across apps.
  </p>

  {#if error}
    <p class="text-xs text-destructive">{error}</p>
  {/if}

  {#if atproto.configured}
    {#if allowTicks}
      <form class="flex flex-wrap items-center gap-2" onsubmit={onAddTick}>
        <Select aria-label="Ascent style" class="w-auto" bind:value={tickStyle}>
          <option value="onsight">Onsight</option>
          <option value="flash">Flash</option>
          <option value="redpoint">Redpoint</option>
          <option value="attempt">Attempt</option>
        </Select>
        <Input class="min-w-40 flex-1" bind:value={tickComment} placeholder="Ascent note (optional)" />
        <Button size="sm" type="submit" disabled={busy}>
          <span class="icon-[lucide--check] shrink-0 size-4"></span>
          Log tick
        </Button>
      </form>
    {/if}

    <form class="flex flex-col gap-2 border-t pt-3" onsubmit={onAddReview}>
      <div class="flex items-center gap-1 text-xs text-muted-foreground">
        <span>Rating:</span>
        {#each [1, 2, 3, 4, 5] as star (star)}
          <button
            type="button"
            class="p-0.5 hover:scale-110"
            aria-label="{star} star{star === 1 ? '' : 's'}"
            onclick={() => (reviewStars = reviewStars === star ? 0 : star)}
          >
            <span
              class="icon-[lucide--star] shrink-0 size-4"
              class:text-amber-500={star <= reviewStars}
              class:text-muted-foreground={star > reviewStars}
            ></span>
          </button>
        {/each}
      </div>
      <Textarea rows={2} bind:value={reviewText} placeholder="Write a comment or route beta..." />
      <Button
        size="sm"
        type="submit"
        variant="outline"
        class="self-start"
        disabled={busy || (!reviewText.trim() && reviewStars === 0)}
      >
        <span class="icon-[lucide--message-square] shrink-0 size-4"></span>
        Post comment
      </Button>
    </form>
  {/if}

  {#if routeTicks.length > 0}
    <div class="border-t pt-2.5">
      <p class="mb-1.5 text-xs font-medium text-muted-foreground">Your ticks ({routeTicks.length})</p>
      <ul class="space-y-1 text-xs">
        {#each routeTicks as tick (tick)}
          <li class="flex flex-wrap items-baseline gap-2">
            <span class="rounded bg-muted px-1.5 py-0.5 font-medium capitalize">{tick.style}</span>
            <span class="text-muted-foreground">{new Date(tick.climbedAt).toLocaleDateString()}</span>
            {#if tick.comment}
              <span>{tick.comment}</span>
            {/if}
            {#if !tick.uri}
              <PendingSyncBadge />
            {/if}
          </li>
        {/each}
      </ul>
    </div>
  {/if}

  {#if routeReviews.length > 0}
    <div class="border-t pt-2.5">
      <p class="mb-1.5 text-xs font-medium text-muted-foreground">Comments ({routeReviews.length})</p>
      <ul class="space-y-2 text-sm">
        {#each routeReviews as review (review)}
          <li class="rounded bg-muted/40 p-2">
            <div class="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span class="font-medium text-foreground">{review.author ?? "Climber"}</span>
              {#if review.rating !== undefined}
                <span class="text-amber-500">{"★".repeat(normalizedRatingToStars(review.rating, 5))}</span>
              {/if}
              <span>{new Date(review.createdAt).toLocaleDateString()}</span>
              {#if !review.uri}
                <PendingSyncBadge />
              {/if}
            </div>
            {#if review.text}
              <p class="mt-1 text-sm">{review.text}</p>
            {/if}
          </li>
        {/each}
      </ul>
    </div>
  {/if}
</section>
