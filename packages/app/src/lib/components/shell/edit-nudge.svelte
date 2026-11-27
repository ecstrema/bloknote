<script lang="ts">
  import { onMount } from "svelte";
  import { isLoggedIn } from "osm-api";
  import { loginOsm } from "#lib/data/network/osm.svelte.js";
  import { Button } from "#components/ui/button/index.js";

  const DISMISS_KEY = "bloknote:edit-nudge-dismissed";
  /** Seconds of browsing before the nudge appears: it must not get in the way */
  const DELAY_MS = 12_000;

  let visible = $state(false);
  let loggedIn = $state(true);

  onMount(() => {
    loggedIn = isLoggedIn();
    if (loggedIn || localStorage.getItem(DISMISS_KEY)) return;
    const timeout = setTimeout(() => (visible = !isLoggedIn()), DELAY_MS);
    return () => clearTimeout(timeout);
  });

  function dismiss() {
    visible = false;
    localStorage.setItem(DISMISS_KEY, "true");
  }
</script>

{#if visible}
  <div
    class="fixed bottom-5 left-5 z-10 flex max-w-72 flex-col gap-2 rounded-2xl bg-popover p-4 text-popover-foreground shadow"
    role="status"
  >
    <div class="flex items-start justify-between gap-2">
      <p class="text-sm font-medium">Everything here is editable</p>
      <button type="button" class="text-muted-foreground hover:text-foreground" aria-label="Dismiss" onclick={dismiss}>
        <span class="icon-[lucide--x] size-4"></span>
      </button>
    </div>
    <p class="text-xs text-muted-foreground">
      Bloknote is built on OpenStreetMap: fix a name, add a grade, or map a missing route — every climber benefits.
    </p>
    <Button size="sm" class="self-start" onclick={() => loginOsm(() => (loggedIn = isLoggedIn()))}>
      <span class="icon-[lucide--pencil] shrink-0 size-4"></span>
      Log in with OpenStreetMap
    </Button>
  </div>
{/if}
