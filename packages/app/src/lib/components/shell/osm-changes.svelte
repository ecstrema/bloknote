<script lang="ts">
  import UploadIcon from "@lucide/svelte/icons/upload";
  import DeleteIcon from "@lucide/svelte/icons/delete";
  import { Button } from "#components/ui/button/index.js";
  import * as Dialog from "#components/ui/dialog/index.js";
  import { Textarea } from "#components/ui/textarea/index.js";
  import { getNameOSM } from "#lib/data/parse/osm-tags.js";

  import { Progress } from "#components/ui/progress/index.js";
  import { getAppState } from "#lib/data/app-state.js";

  const appState = getAppState();
  let open = $state(false);
  let comment = $state("");
  let error = $state<string>();

  const detailedChanges = $derived(appState.osmUser.getDetailedChanges());

  $effect(() => {
    if (open) {
      // Compute an intelligent default comment
      if (detailedChanges.size === 1) {
        const [slug, diff] = detailedChanges.entries().next().value!;

        if (diff === "created") {
          comment = `created ${slug}`;
        } else if (diff === "deleted") {
          comment = `Deleted ${slug}`;
        } else {
          comment = `Edited ${slug}`;
        }
      } else {
        comment = `${appState.osmUser.changes.size} features modified`;
      }
    }
  });

  async function submit() {
    error = undefined;
    try {
      await appState.osmUser.submitChanges(comment);
      comment = "";
      open = false;
    } catch (reason) {
      error = reason instanceof Error ? reason.message : "Could not submit changes";
    }
  }

  $effect(() => {
    if (appState.osmUser.changes.size === 0) open = false;
  });
</script>

{#if appState.osmUser.changes.size}
  <Dialog.Root bind:open>
    <Dialog.DialogTrigger>
      <Button
        class="fixed bottom-5 right-5 z-20 shadow-lg"
        aria-label="Review pending OpenStreetMap changes to submit them"
      >
        <UploadIcon />
        <span class="text-xs">{appState.osmUser.changes.size}</span>
      </Button>
    </Dialog.DialogTrigger>
    <Dialog.Content>
      <Dialog.Header>
        <Dialog.Title>OpenStreetMap changes</Dialog.Title>
        <Dialog.Description>
          <!-- TODO: use an actual translation library for handling plurals: wuchale -->
          {appState.osmUser.changes.size} feature{appState.osmUser.changes.size === 1 ? "" : "s"} modified
        </Dialog.Description>
      </Dialog.Header>
      <ul class="my-3 max-h-[45vh] space-y-2.5 overflow-y-auto pr-1 text-sm">
        {#each appState.osmUser.changes as [slug, changedFeature] (slug)}
          {@const diff = detailedChanges.get(slug)}
          {@const displayName =
            getNameOSM(changedFeature.final?.tags ?? changedFeature.initial?.tags ?? {}) || "Unnamed feature"}
          {@const featureMeta = changedFeature.final ?? changedFeature.initial}
          <li class="rounded-md border p-2.5">
            <div class="flex items-start justify-between gap-2">
              <div class="min-w-0">
                <div class="flex flex-wrap items-center gap-1.5">
                  <span
                    class={diff === "created"
                      ? "rounded bg-emerald-500/15 px-1.5 py-0.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-300"
                      : diff === "deleted"
                        ? "rounded bg-destructive/15 px-1.5 py-0.5 text-[11px] font-medium text-destructive"
                        : "rounded bg-amber-500/15 px-1.5 py-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-300"}
                  >
                    {diff === "created" ? "Created" : diff === "deleted" ? "Deleted" : "Modified"}
                  </span>
                  <strong class="truncate">{displayName}</strong>
                  {#if featureMeta}
                    <span class="text-xs text-muted-foreground">{featureMeta.type}/{featureMeta.id}</span>
                  {/if}
                </div>
                <p class="truncate text-xs text-muted-foreground">{slug}</p>
              </div>
              {#if appState.tree.getReactiveNode(slug)}
                <Button
                  variant="ghost"
                  size="icon-xs"
                  title="Revert changes to {displayName}"
                  aria-label="Revert changes to {displayName}"
                  onclick={() => appState.resetFeature(slug)}
                >
                  <DeleteIcon />
                </Button>
              {/if}
            </div>

            {#if diff === "created" && changedFeature.final}
              <div class="mt-2 space-y-0.5 border-t pt-1.5 font-mono text-xs">
                {#each Object.entries(changedFeature.final.tags ?? {}) as [k, v] (k)}
                  <div class="text-emerald-700 dark:text-emerald-300">+ {k} = {v}</div>
                {/each}
                {#if changedFeature.final.type === "relation"}
                  <div class="text-muted-foreground">{changedFeature.final.members.length} members</div>
                {/if}
              </div>
            {:else if diff === "deleted" && changedFeature.initial}
              <div class="mt-2 space-y-0.5 border-t pt-1.5 font-mono text-xs">
                {#each Object.entries(changedFeature.initial.tags ?? {}) as [k, v] (k)}
                  <div class="text-destructive line-through">- {k} = {v}</div>
                {/each}
              </div>
            {:else if diff && typeof diff === "object"}
              {@const tagDiffs = Object.entries(diff.get("tags") ?? {})}
              {@const latDiff = diff.get("lat")}
              {@const lonDiff = diff.get("lon")}
              {@const membersDiff = diff.get("members")}
              <div class="mt-2 space-y-0.5 border-t pt-1.5 font-mono text-xs">
                {#each tagDiffs as [key, change] (key)}
                  {#if change}
                    <div class="flex flex-wrap items-baseline gap-1">
                      <span class="font-semibold">{key}:</span>
                      {#if change.initial !== undefined}
                        <span class="text-destructive line-through">{change.initial}</span>
                      {/if}
                      {#if change.initial !== undefined && change.final !== undefined}
                        <span class="text-muted-foreground">→</span>
                      {/if}
                      {#if change.final !== undefined}
                        <span class="text-emerald-700 dark:text-emerald-300">{change.final}</span>
                      {/if}
                    </div>
                  {/if}
                {/each}
                {#if latDiff || lonDiff}
                  {@const nextLat = latDiff?.final ?? (changedFeature.final?.type === "node" ? changedFeature.final.lat : undefined)}
                  {@const nextLon = lonDiff?.final ?? (changedFeature.final?.type === "node" ? changedFeature.final.lon : undefined)}
                  <div class="text-muted-foreground">
                    Coordinates moved ({nextLat?.toFixed(5) ?? ""}, {nextLon?.toFixed(5) ?? ""})
                  </div>
                {/if}
                {#if membersDiff}
                  <div class="text-muted-foreground">
                    Members: {membersDiff.initial.length} → {membersDiff.final.length}
                  </div>
                {/if}
              </div>
            {/if}
          </li>
        {/each}
      </ul>
      <label class="block text-sm font-medium" for="osm-comment">Comment (optional)</label>
      <Textarea id="osm-comment" bind:value={comment} placeholder="Leave a comment" class="mt-2" maxlength={255} />

      {#if error}<p class="mt-2 text-sm text-destructive">{error}</p>{/if}
      <Dialog.Footer>
        <Dialog.Close>
          {#snippet child({ props })}
            <Button {...props} variant="outline">Cancel</Button>
          {/snippet}
        </Dialog.Close>
        <Button onclick={submit} disabled={!!appState.osmUser.submitting || !appState.osmUser.loggedIn}>
          {appState.osmUser.submitting ? "Submitting..." : "Submit changes"}
        </Button>
      </Dialog.Footer>
      {#if appState.osmUser.submitting}
        <Progress class="mt-2" value={appState.osmUser.submitting.step} max={appState.osmUser.submitting.total} />
      {/if}
    </Dialog.Content>
  </Dialog.Root>
{/if}
