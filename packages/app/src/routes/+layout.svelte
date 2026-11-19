<script lang="ts">
  import { navigating, updated } from "$app/state";
  import { localDb, DATA_STALE_AFTER_DAYS } from "#lib/data/db/local-db.svelte.js";
  import { apiUrl } from "#lib/data/network/api-url.js";
  import { Button } from "#components/ui/button/index.js";

  const downloading = $derived(localDb.status === "downloading");
  const downloadPercent = $derived(localDb.total ? Math.min(100, (localDb.loaded / localDb.total) * 100) : undefined);

  // Sveltekit checks for updates on navigation. We need this for idle pages.
  $effect(() => {
    const interval = setInterval(
      async () => {
        if (await updated.check()) {
          console.log("New version found");
        }
      },
      15 * 60 * 1000,
    ); // 15 minutes

    return () => clearInterval(interval);
  });

  import "./layout.css";

  import { ModeWatcher } from "mode-watcher";
  import { onMount, untrack } from "svelte";
  import { initLocale } from "#lib/i18n.svelte.js";
  const { children } = $props();

  const DATA_REFRESH_INTERVAL = 6 * 60 * 60 * 1000;

  type DataUpdate = { version: string; date?: string };

  /** Set when the published dataset differs from the one stored locally */
  let dataUpdate = $state<DataUpdate>();
  let dismissedVersion = $state<string>();

  /** Whether the user dismissed the app update banner */
  let dismissed = $state(false);

  /** How old the locally stored dataset is, in a human-readable form */
  function dataAgeLabel(): string {
    const days = localDb.dataAgeDays;
    if (days === undefined) return "an unknown date";
    if (days <= 0) return "today";
    if (days === 1) return "yesterday";
    if (days <= DATA_STALE_AFTER_DAYS) return `${days} days ago`;
    return `${days} days ago (over a week old)`;
  }

  async function checkForDataUpdate(): Promise<void> {
    if (localDb.status === "unknown" && localDb.hasMarker) await localDb.init();
    if (!localDb.ready || !localDb.persistent) return;

    try {
      const response = await fetch(apiUrl("", "data-version.json"), { cache: "no-store" });
      if (!response.ok) return;
      const { version, date } = (await response.json()) as { version: number; date?: string };
      if (!version) return;
      const published = String(version);
      if (published === localDb.dataVersion) return;
      dataUpdate = { version: published, date };
    } catch (error) {
      console.error("Failed to check for updated climbing data:", error);
    }
  }

  function updateData(): void {
    if (!dataUpdate) return;
    const { version } = dataUpdate;
    dataUpdate = undefined;
    void localDb.refresh(version);
  }

  // When a visited page turns out to have newer data on OSM, check whether a newer dataset is published.
  $effect(() => {
    if (localDb.upstreamChanged) untrack(() => void checkForDataUpdate());
  });

  onMount(() => {
    initLocale();
    void checkForDataUpdate();
    const interval = setInterval(checkForDataUpdate, DATA_REFRESH_INTERVAL);
    return () => clearInterval(interval);
  });
</script>

<ModeWatcher />

{#if downloading && downloadPercent !== undefined}
  <div class="fixed top-0 inset-x-0 h-0.5 z-50 bg-primary/20" role="progressbar" aria-label="Downloading data">
    <div class="h-full bg-primary transition-[width]" style:width="{downloadPercent}%"></div>
  </div>
{:else if downloading || navigating.to}
  <div class="fixed top-0 inset-x-0 h-0.5 z-50 overflow-hidden bg-primary/20" role="progressbar" aria-label="Loading">
    <div class="loader-bar h-full w-1/3 bg-primary"></div>
  </div>
{/if}

{@render children()}

{#snippet updateBanner(text: string, detail: string | undefined, onUpdate: () => void, onDismiss: () => void)}
  <div
    class="fixed bottom-5 right-5 z-10 flex flex-col gap-2 rounded-2xl bg-popover p-4 text-popover-foreground shadow"
  >
    <p>{text}</p>
    {#if detail}
      <p class="text-xs text-muted-foreground">{detail}</p>
    {/if}
    <div class="flex gap-2">
      <Button onclick={onUpdate}>Update</Button>
      <Button variant="outline" onclick={onDismiss}>Dismiss</Button>
    </div>
  </div>
{/snippet}

{#if dataUpdate && dataUpdate.version !== dismissedVersion}
  {@render updateBanner(
    "New climbing data is available",
    `Your offline data is from ${dataAgeLabel()}`,
    updateData,
    () => (dismissedVersion = dataUpdate?.version),
  )}
{/if}

{#if updated.current && !dismissed}
  {@render updateBanner(
    "A new version of Bloknote is available",
    undefined,
    () => window.location.reload(),
    () => (dismissed = true),
  )}
{/if}

<style>
  .loader-bar {
    animation: loader-slide 1.1s ease-in-out infinite;
  }
  @keyframes loader-slide {
    from {
      transform: translateX(-100%);
    }
    to {
      transform: translateX(300%);
    }
  }
</style>
