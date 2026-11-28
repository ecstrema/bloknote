<script lang="ts">
  import { resolve } from "$app/paths";
  import { ascentFromStyle, type TickStyle } from "@bloknote/common";
  import type { OsmFeature } from "osm-api";
  import { Button } from "#components/ui/button/index.js";
  import { Input } from "#components/ui/input/index.js";
  import { Select } from "#components/ui/select/index.js";
  import * as Popover from "#components/ui/popover/index.js";
  import { atproto, sameElementRef, type LocalTickEntry } from "#lib/data/network/atproto.svelte.js";
  import PendingSyncBadge from "#lib/components/pending-sync-badge.svelte";
  import AtprotoLogin from "#lib/components/atproto-login.svelte";
  import { cn } from "#lib/utils.js";

  let {
    feature,
    class: className,
  }: {
    feature: OsmFeature;
    class?: string;
  } = $props();

  let open = $state(false);
  let busy = $state(false);
  let error = $state<string>();
  /** Style picked in the popup: empty until a style is set (ticks do not need one, issue #274) */
  let style = $state<TickStyle | undefined>(undefined);
  let comment = $state("");

  const ref = $derived({ type: feature.type, id: feature.id });
  const routeTicks = $derived(atproto.ticks.filter((t) => sameElementRef(t.subject, ref)));
  const tick = $derived(routeTicks[0]);

  $effect(() => {
    // Reset the popup fields to the tick's values each time it opens
    if (!open) return;
    error = undefined;
    comment = tick?.comment ?? "";
    style = tick?.sendStyle ?? (tick?.attemptStyle as TickStyle | undefined);
  });

  async function onTriggerClick() {
    // Always open the popup, even when the climb is already ticked or the user is not
    // connected (the popup then shows the Atmosphere login form, issues #253 and #263)
    open = true;
    if (!atproto.configured || routeTicks.length > 0) return;
    // Quick tick (issue #253): tick it right away with no data, then let the popup add details
    busy = true;
    error = undefined;
    try {
      await atproto.addQuickTick(feature);
    } catch (e) {
      error = e instanceof Error ? e.message : "Could not log tick";
    } finally {
      busy = false;
    }
  }

  /** Adds another tick of the same climb (e.g. a toprope first, then a lead, issue #253) */
  async function onAddTick() {
    busy = true;
    error = undefined;
    try {
      await atproto.addQuickTick(feature);
    } catch (e) {
      error = e instanceof Error ? e.message : "Could not log tick";
    } finally {
      busy = false;
    }
  }

  async function update(patch: Parameters<typeof atproto.updateTick>[1]) {
    if (!tick) return;
    error = undefined;
    busy = true;
    try {
      await atproto.updateTick(tick, patch);
    } catch (e) {
      error = e instanceof Error ? e.message : "Could not update tick";
    } finally {
      busy = false;
    }
  }

  async function onDeleteTicks() {
    error = undefined;
    busy = true;
    try {
      for (const entry of routeTicks) await atproto.deleteTick(entry);
      open = false;
    } catch (e) {
      error = e instanceof Error ? e.message : "Could not delete tick";
    } finally {
      busy = false;
    }
  }
</script>

<Popover.Root bind:open>
  <Popover.Trigger>
    {#snippet child({ props })}
      <Button
        {...props}
        size="icon-sm"
        variant={tick ? "secondary" : "outline"}
        disabled={busy}
        onclick={onTriggerClick}
        class={cn(className)}
        title={atproto.configured ? (tick ? "Edit your ticks" : "Tick this climb") : "Connect Atmosphere to log ticks"}
        aria-label={atproto.configured
          ? tick
            ? "Edit your ticks"
            : "Tick this climb"
          : "Connect Atmosphere to log ticks"}
      >
        <span
          class={cn(
            "icon-[lucide--check] shrink-0 size-4",
            tick ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground",
          )}
        ></span>
      </Button>
    {/snippet}
  </Popover.Trigger>

  <Popover.Content class="w-72" side="bottom" align="end">
    {#if !atproto.configured}
      <!-- Not connected (issue #253): the same Atmosphere login form as the account page -->
      <div class="flex flex-col gap-2.5">
        <p class="text-sm font-semibold">Connect Atmosphere</p>
        <p class="text-xs text-muted-foreground">
          Log in to keep your ticks, bookmarks, and comments in your own ATProto repository.
        </p>
        <AtprotoLogin />
      </div>
    {:else}
      <div class="flex flex-col gap-2.5">
        <!-- No need for a (1) when there is just one tick (issue #253) -->
        <p class="text-sm font-semibold">
          {routeTicks.length > 1 ? `Your ticks (${routeTicks.length})` : "Your ticks"}
        </p>

        {#if error}
          <p class="text-xs text-destructive">{error}</p>
        {/if}

        {#if tick}
          <div class="flex flex-wrap items-center gap-2">
            <Select
              aria-label="Ascent style"
              class="h-7 w-auto py-0 text-xs"
              bind:value={style}
              onchange={() => void update({ ascent: style ? ascentFromStyle(style) : null })}
            >
              <option value="">Style...</option>
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

            <Button
              size="xs"
              variant="outline"
              disabled={busy}
              title={tick.climbedAt ? "Change the date" : "Set the date to today"}
              onclick={() => void update({ climbedAt: new Date().toISOString() })}
            >
              <span aria-hidden="true" class="icon-[lucide--calendar] shrink-0 size-3.5"></span>
              {tick.climbedAt ? new Date(tick.climbedAt).toLocaleDateString() : "Date"}
            </Button>
            {#if tick.climbedAt}
              <Button
                size="icon-sm"
                variant="ghost"
                disabled={busy}
                title="Remove the date"
                aria-label="Remove the date"
                onclick={() => void update({ climbedAt: null })}
              >
                <span aria-hidden="true" class="icon-[lucide--x] shrink-0 size-3.5"></span>
              </Button>
            {/if}
          </div>

          <Input
            aria-label="Ascent note"
            placeholder="Ascent note (optional)"
            value={comment}
            onchange={(e) => void update({ comment: e.currentTarget.value })}
          />

          {#if !tick.uri}
            <PendingSyncBadge />
          {/if}
        {/if}

        {#if routeTicks.length > 1}
          <ul class="flex flex-col gap-1 border-t pt-2 text-xs">
            {#each routeTicks.slice(1) as entry (entry.localId)}
              <li class="flex flex-wrap items-center gap-2">
                <span class="rounded bg-muted px-1.5 py-0.5 font-medium capitalize">
                  {entry.sendStyle ?? entry.attemptStyle ?? entry.outcome ?? "tick"}
                </span>
                {#if entry.climbedAt}
                  <span class="text-muted-foreground">{new Date(entry.climbedAt).toLocaleDateString()}</span>
                {/if}
                {#if entry.comment}
                  <span class="min-w-0 truncate">{entry.comment}</span>
                {/if}
                {#if !entry.uri}
                  <PendingSyncBadge />
                {/if}
                <button
                  type="button"
                  class="ms-auto self-center text-muted-foreground hover:text-destructive"
                  title="Delete tick"
                  aria-label="Delete tick"
                  disabled={busy}
                  onclick={() => void atproto.deleteTick(entry)}
                >
                  <span aria-hidden="true" class="icon-[lucide--trash-2] shrink-0 size-3.5"></span>
                </button>
              </li>
            {/each}
          </ul>
        {/if}

        <div class="flex items-center justify-between gap-2 border-t pt-2">
          <a href={resolve("/settings/logbook")} class="text-xs text-primary hover:underline">See all ticks</a>
          <div class="flex items-center gap-1.5">
            <Button size="xs" variant="outline" disabled={busy} onclick={onAddTick}>
              <span aria-hidden="true" class="icon-[lucide--plus] shrink-0 size-3.5"></span>
              Add tick
            </Button>
            <Button size="xs" variant="outline" disabled={busy} onclick={onDeleteTicks}>
              <span aria-hidden="true" class="icon-[lucide--trash-2] shrink-0 size-3.5"></span>
              Delete {routeTicks.length === 1 ? "tick" : `all ${routeTicks.length} ticks`}
            </Button>
          </div>
        </div>
      </div>
    {/if}
  </Popover.Content>
</Popover.Root>
