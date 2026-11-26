<script lang="ts">
  import { version } from "$app/env";
  import { updated } from "$app/state";
  import { Button } from "#components/ui/button/index.js";
  import * as Dialog from "#components/ui/dialog/index.js";
  import { resolve } from "$app/paths";
  import { localDb } from "#lib/data/db/local-db.svelte.js";
  import { apiUrl } from "#lib/data/network/api-url.js";

  const REPOSITORY = "https://github.com/ecstrema/bloknote";

  let { open = $bindable(false) }: { open?: boolean } = $props();

  let checking = $state(false);
  /** Result of the last "Check for updates" (issue #230) */
  let appUpdate = $state(false);
  let dataUpdate = $state<{ version: string; bytes?: number }>();
  let checkedLabel = $state<string>();

  const buildId = $derived(version === "local" ? "local build" : version.slice(0, 7));

  /** How old the locally stored dataset is, in a human-readable form */
  function dataAgeLabel(): string {
    const days = localDb.dataAgeDays;
    if (days === undefined) return "an unknown date";
    if (days <= 0) return "today";
    if (days === 1) return "yesterday";
    return `${days} days ago`;
  }

  /** What is stored locally: the whole dataset, or only the pages visited so far */
  const downloadedLabel = $derived.by(() => {
    switch (localDb.status) {
      case "ready":
        return "Full dataset downloaded";
      case "downloading":
        return localDb.total
          ? `Downloading… ${Math.min(100, Math.round((localDb.loaded / localDb.total) * 100))}%`
          : "Downloading…";
      case "error":
        return "Local storage unavailable";
      default:
        return "Only the pages you visited are stored";
    }
  });

  // Opening the dialog reveals the real local database status
  $effect(() => {
    if (open && localDb.status === "unknown") void localDb.init();
  });

  async function checkForUpdates() {
    checking = true;
    appUpdate = false;
    dataUpdate = undefined;
    try {
      // The service worker checks for a newer deployment of the app itself
      appUpdate = await updated.check();
    } catch {
      // Offline or the browser denied the check: treated as "no update" below
    }
    // The climbing dataset is versioned separately from the app
    try {
      if (navigator.onLine) {
        if (localDb.status === "unknown" && localDb.hasMarker) await localDb.init();
        if (localDb.ready && localDb.persistent) {
          const response = await fetch(apiUrl("", "data-version.json"), { cache: "no-store" });
          if (response.ok) {
            const data = (await response.json()) as { version?: number; bytes?: number };
            if (data.version && String(data.version) !== localDb.dataVersion) {
              dataUpdate = { version: String(data.version), bytes: data.bytes };
            }
          }
        }
      }
    } catch {
      // Network error: no data update detected
    }
    checkedLabel = new Date().toLocaleTimeString();
    checking = false;
  }

  async function updateData() {
    if (!dataUpdate) return;
    const { version: dataVersion, bytes } = dataUpdate;
    dataUpdate = undefined;
    await localDb.refresh(dataVersion, bytes);
  }
</script>

<Dialog.Root bind:open>
  <Dialog.Content class="sm:max-w-lg">
    <Dialog.Header>
      <Dialog.Title>About Bloknote</Dialog.Title>
      <Dialog.Description>
        A free and open-source climbing directory built on OpenStreetMap: the places and their grades come straight from
        the map, your edits are changesets on OpenStreetMap, and your logbook lives on the AT Protocol. Read the
        <a class="text-primary hover:underline" href={resolve("/docs")}>documentation</a> for the details.
      </Dialog.Description>
    </Dialog.Header>

    <div class="grid gap-2 text-sm">
      <p>
        <span class="font-medium">Version</span>
        {#if version !== "local"}
          <a
            class="text-primary hover:underline"
            href={`${REPOSITORY}/commit/${version}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            {buildId}
          </a>
        {:else}
          {buildId}
        {/if}
      </p>
      <p>
        <span class="font-medium">Climbing data</span> from {dataAgeLabel()} (version {localDb.dataVersion ?? "none"})
      </p>
      <p class="text-muted-foreground">{downloadedLabel}</p>
    </div>

    <div class="flex flex-wrap items-center gap-2">
      {#if checking}
        <Button variant="outline" disabled>Checking…</Button>
      {:else}
        <Button variant="outline" onclick={checkForUpdates}>Check for updates</Button>
      {/if}
      {#if appUpdate}
        <Button onclick={() => window.location.reload()}>Reload to update</Button>
      {/if}
      {#if dataUpdate}
        <Button onclick={updateData}>Download new climbing data</Button>
      {/if}
    </div>
    {#if checkedLabel && !appUpdate && !dataUpdate}
      <p class="text-xs text-muted-foreground">Everything is up to date (checked at {checkedLabel}).</p>
    {/if}

    <Dialog.Footer class="flex-row items-center justify-between sm:justify-between">
      <div class="flex gap-4 text-sm">
        <a class="text-primary hover:underline" href={REPOSITORY} target="_blank" rel="noopener noreferrer">
          Star on GitHub
        </a>
        <a class="text-primary hover:underline" href={`${REPOSITORY}/issues`} target="_blank" rel="noopener noreferrer">
          Report an issue
        </a>
      </div>
      <Dialog.Close>
        {#snippet child({ props })}
          <Button {...props} type="button" variant="outline">Close</Button>
        {/snippet}
      </Dialog.Close>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
