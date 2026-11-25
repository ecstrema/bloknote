<script lang="ts">
  import { resolve } from "$app/paths";
  import { Button } from "#components/ui/button/index.js";
  import { Input } from "#components/ui/input/index.js";
  import { Select } from "#components/ui/select/index.js";
  import { Textarea } from "#components/ui/textarea/index.js";
  import { atproto, sameElementRef } from "#lib/data/network/atproto.svelte.js";
  import PendingSyncBadge from "#lib/components/pending-sync-badge.svelte";
  import { ascentFromStyle, normalizedRatingToStars, starsToNormalizedRating, type TickStyle } from "@bloknote/common";
        import type { OsmFeature } from "osm-api";

  const {
    feature,
    allowTicks = false,
  }: {
    feature: OsmFeature;
    allowTicks?: boolean;
  } = $props();

  let tickStyle = $state<TickStyle>("redpoint");
  let tickHangs = $state(1);
  let tickComment = $state("");
  let commentText = $state("");
  let busy = $state(false);
  let error = $state<string>();

  const ref = $derived({ type: feature.type, id: feature.id });
  const routeTicks = $derived(atproto.ticks.filter((t) => sameElementRef(t.subject, ref)));
  const routeComments = $derived(atproto.comments.filter((c) => sameElementRef(c.subject, ref)));
  const routeRatings = $derived(atproto.ratings.filter((r) => sameElementRef(r.subject, ref)));

  async function onAddTick(event: SubmitEvent) {
    event.preventDefault();
    error = undefined;
    busy = true;
    try {
      await atproto.addTick(feature, ascentFromStyle(tickStyle, tickHangs), tickComment);
      tickComment = "";
    } catch (e) {
      error = e instanceof Error ? e.message : "Could not log tick";
    } finally {
      busy = false;
    }
  }

  async function onAddComment(event: SubmitEvent) {
    event.preventDefault();
    error = undefined;
    busy = true;
    try {
      await atproto.addComment(feature, commentText);
      commentText = "";
    } catch (e) {
      error = e instanceof Error ? e.message : "Could not post comment";
    } finally {
      busy = false;
    }
  }

  async function onSetRating(stars: number) {
    error = undefined;
    busy = true;
    try {
      await atproto.addRating(feature, starsToNormalizedRating(stars, 5));
    } catch (e) {
      error = e instanceof Error ? e.message : "Could not save rating";
    } finally {
      busy = false;
    }
  }

  async function onDeleteTick(tick: (typeof routeTicks)[number]) {
    error = undefined;
    busy = true;
    try {
      await atproto.deleteTick(tick);
    } catch (e) {
      error = e instanceof Error ? e.message : "Could not delete tick";
    } finally {
      busy = false;
    }
  }

  async function onDeleteComment(comment: (typeof routeComments)[number]) {
    error = undefined;
    busy = true;
    try {
      await atproto.deleteComment(comment);
    } catch (e) {
      error = e instanceof Error ? e.message : "Could not delete comment";
    } finally {
      busy = false;
    }
  }

  async function onDeleteRating(rating: (typeof routeRatings)[number]) {
    error = undefined;
    busy = true;
    try {
      await atproto.deleteRating(rating);
    } catch (e) {
      error = e instanceof Error ? e.message : "Could not delete rating";
    } finally {
      busy = false;
    }
  }
</script>

<section class="flex flex-col gap-3 rounded-md border p-3.5" aria-label="Logbook and comments">
  <div class="flex flex-wrap items-center justify-between gap-2">
    <h2 class="text-sm font-semibold">Activity &amp; Comments</h2>
    {#if !atproto.configured}
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
          <optgroup label="Send">
            <option value="redpoint">Redpoint</option>
            <option value="onsight">Onsight</option>
            <option value="flash">Flash</option>
            <option value="pinkpoint">Pinkpoint</option>
          </optgroup>
          <optgroup label="Attempt">
            <option value="hangdog">Hangdog</option>
            <option value="bailed">Bailed</option>
          </optgroup>
        </Select>
        {#if tickStyle === "hangdog"}
          <Input type="number" min="1" class="w-24" bind:value={tickHangs} aria-label="Number of hangs" />
        {/if}
        <Input class="min-w-40 flex-1" bind:value={tickComment} placeholder="Ascent note (optional)" />
        <Button size="sm" type="submit" disabled={busy}>
          <span class="icon-[lucide--check] shrink-0 size-4"></span>
          Log tick
        </Button>
      </form>
    {/if}

    <div class="flex flex-col gap-2 border-t pt-3">
      <div class="flex items-center gap-1 text-xs text-muted-foreground" role="group" aria-label="Star rating">
        <span>Rating:</span>
        {#each [1, 2, 3, 4, 5] as star (star)}
          <button
            type="button"
            class="p-0.5 hover:scale-110 disabled:opacity-50"
            aria-label="Rate {star} star{star === 1 ? '' : 's'}"
            disabled={busy || !atproto.configured}
            onclick={() => onSetRating(star)}
          >
            <span
              class="icon-[lucide--star] shrink-0 size-4"
              class:text-amber-500={star <= (routeRatings[0] ? normalizedRatingToStars(routeRatings[0].rating, 5) : 0)}
              class:text-muted-foreground={star > (routeRatings[0] ? normalizedRatingToStars(routeRatings[0].rating, 5) : 0)}
            ></span>
          </button>
        {/each}
        {#if routeRatings[0]}
          {#if routeRatings[0].createdAt}
            <span class="ml-1">{new Date(routeRatings[0].createdAt).toLocaleDateString()}</span>
          {/if}
          {#if atproto.configured}
            <button
              type="button"
              class="ml-1 text-muted-foreground hover:text-destructive"
              title="Remove your rating"
              aria-label="Remove your rating"
              disabled={busy}
              onclick={() => onDeleteRating(routeRatings[0]!)}
            >
              <span aria-hidden="true" class="icon-[lucide--trash-2] shrink-0 size-3.5"></span>
            </button>
          {/if}
        {/if}
      </div>
      <form class="flex flex-col gap-2" onsubmit={onAddComment}>
        <Textarea rows={2} bind:value={commentText} placeholder="Write a comment or route beta..." />
        <Button
          size="sm"
          type="submit"
          variant="outline"
          class="self-start"
          disabled={busy || !commentText.trim()}
        >
          <span class="icon-[lucide--message-square] shrink-0 size-4"></span>
          Post comment
        </Button>
      </form>
    </div>
  {/if}

  {#if routeTicks.length > 0}
    <div class="border-t pt-2.5">
      <p class="mb-1.5 text-xs font-medium text-muted-foreground">Your ticks ({routeTicks.length})</p>
      <ul class="space-y-1 text-xs">
        {#each routeTicks as tick (tick)}
          <li class="flex flex-wrap items-baseline gap-2">
            <span class="rounded bg-muted px-1.5 py-0.5 font-medium capitalize">{tick.sendStyle ?? tick.attemptStyle ?? tick.outcome}</span>
            {#if tick.climbedAt}
              <span class="text-muted-foreground">{new Date(tick.climbedAt).toLocaleDateString()}</span>
            {/if}
            {#if tick.comment}
              <span>{tick.comment}</span>
            {/if}
            {#if !tick.uri}
              <PendingSyncBadge />
            {/if}
            {#if atproto.configured}
              <button
                type="button"
                class="ms-auto self-center text-muted-foreground hover:text-destructive"
                title="Delete tick"
                aria-label="Delete tick"
                disabled={busy}
                onclick={() => onDeleteTick(tick)}
              >
                <span aria-hidden="true" class="icon-[lucide--trash-2] shrink-0 size-3.5"></span>
              </button>
            {/if}
          </li>
        {/each}
      </ul>
    </div>
  {/if}

  {#if routeComments.length > 0}
    <div class="border-t pt-2.5">
      <p class="mb-1.5 text-xs font-medium text-muted-foreground">Comments ({routeComments.length})</p>
      <ul class="space-y-2 text-sm">
        {#each routeComments as comment (comment)}
          <li class="rounded bg-muted/40 p-2">
            <div class="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span class="font-medium text-foreground">{comment.author ?? "Climber"}</span>
              <span>{new Date(comment.createdAt).toLocaleDateString()}</span>
              {#if !comment.uri}
                <PendingSyncBadge />
              {/if}
              {#if atproto.configured}
                <button
                  type="button"
                  class="ms-auto self-center text-muted-foreground hover:text-destructive"
                  title="Delete comment"
                  aria-label="Delete comment"
                  disabled={busy}
                  onclick={() => onDeleteComment(comment)}
                >
                  <span aria-hidden="true" class="icon-[lucide--trash-2] shrink-0 size-3.5"></span>
                </button>
              {/if}
            </div>
            <p class="mt-1 text-sm">{comment.text}</p>
          </li>
        {/each}
      </ul>
    </div>
  {/if}
</section>
