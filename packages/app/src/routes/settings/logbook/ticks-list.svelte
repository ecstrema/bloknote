<script lang="ts">
  import { goto } from "$app/navigation";
  import { resolve } from "$app/paths";
  import { Button } from "#components/ui/button/index.js";
  import { Input } from "#components/ui/input/index.js";
  import { Select } from "#components/ui/select/index.js";
  import { atproto, type LocalTickEntry } from "#lib/data/network/atproto.svelte.js";
  import { localDb } from "#lib/data/db/local-db.svelte.js";
  import { getGrade } from "#lib/data/parse/osm-tags.js";
  import type { AscentStyle } from "@bloknote/common";
  import type { OsmFeature } from "osm-api";

  /** Route candidates found again in the OSM data for subject-less ticks, by local tick id */
  interface TickMatches {
    candidates: { slug: string; name: string; grade?: string; feature: OsmFeature }[];
  }
  let rematch = $state<Record<string, TickMatches>>({});

  /** Resolved route names for tick subjects, by `type-id` ref */
  let resolvedNames = $state<Record<string, string>>({});

  let editingLocalId = $state<string>();
  let editStyle = $state<AscentStyle>("redpoint");
  let editDate = $state("");
  let editComment = $state("");
  let busy = $state(false);
  let error = $state<string>();

  const sortedTicks = $derived(
    [...atproto.ticks].sort((a, b) => (b.climbedAt ?? "").localeCompare(a.climbedAt ?? "")),
  );

  $effect(() => {
    // Resolve the name of every tick subject from the offline data (tick.label is the fallback)
    const refs = [...new Set(atproto.ticks.filter((t) => t.subject).map((t) => `${t.subject!.type}-${t.subject!.id}`))];
    const missing = refs.filter((ref) => resolvedNames[ref] === undefined);
    if (missing.length === 0 || !localDb.ready) return;
    localDb.getByOsmRefs(missing).then((found) => {
      resolvedNames = { ...resolvedNames };
      for (const ref of refs) {
        resolvedNames[ref] = (found[ref]?.data as OsmFeature | undefined)?.tags?.name ?? "";
      }
    });
  });

  $effect(() => {
    // Re-check subject-less ticks against the OSM data: routes may have been added since (issue #154)
    const unmatched = atproto.ticks.filter((t) => !t.subject && t.name && t.localId);
    const toCheck = unmatched.filter((t) => rematch[t.localId!] === undefined);
    if (toCheck.length === 0 || !localDb.ready) return;
    let cancelled = false;
    (async () => {
      for (let start = 0; start < toCheck.length; start += 20) {
        const batch = toCheck.slice(start, start + 20);
        const matches = await localDb.matchTicks(batch.map((t) => ({ name: t.name!, area: t.crag })));
        if (cancelled) return;
        rematch = { ...rematch };
        matches.forEach((found, index) => {
          const entry = batch[index]!;
          rematch[entry.localId!] = {
            candidates: found.map((m) => ({
              slug: m.slug,
              name: (m.data as OsmFeature).tags?.name ?? "Unnamed",
              grade: getGrade((m.data as OsmFeature).tags ?? {})?.v.v,
              feature: m.data as OsmFeature,
            })),
          };
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  });

  function labelFor(tick: LocalTickEntry): string {
    if (tick.subject) {
      return (
        tick.label ||
        resolvedNames[`${tick.subject.type}-${tick.subject.id}`] ||
        `${tick.subject.type}/${tick.subject.id}`
      );
    }
    return tick.name ?? "Unnamed route";
  }

  function startEdit(tick: LocalTickEntry) {
    editingLocalId = tick.localId;
    editStyle = tick.style;
    editDate = tick.climbedAt ? tick.climbedAt.slice(0, 10) : "";
    editComment = tick.comment ?? "";
    error = undefined;
  }

  async function saveEdit(tick: LocalTickEntry) {
    busy = true;
    error = undefined;
    try {
      await atproto.updateTick(tick, {
        style: editStyle,
        climbedAt: editDate ? new Date(`${editDate}T12:00:00Z`).toISOString() : undefined,
        comment: editComment,
      });
      editingLocalId = undefined;
    } catch (err) {
      error = err instanceof Error ? err.message : "Could not save the tick.";
    } finally {
      busy = false;
    }
  }

  async function onDelete(tick: LocalTickEntry) {
    busy = true;
    error = undefined;
    try {
      await atproto.deleteTick(tick);
    } catch (err) {
      error = err instanceof Error ? err.message : "Could not delete the tick.";
    } finally {
      busy = false;
    }
  }

  async function onLink(tick: LocalTickEntry, slug: string) {
    const candidate = rematch[tick.localId!]?.candidates.find((c) => c.slug === slug);
    if (!candidate) return;
    busy = true;
    error = undefined;
    try {
      await atproto.linkTick(tick, { type: candidate.feature.type, id: candidate.feature.id });
      const { [tick.localId!]: _removed, ...rest } = rematch;
      rematch = rest;
    } catch (err) {
      error = err instanceof Error ? err.message : "Could not link the tick.";
    } finally {
      busy = false;
    }
  }

  /** Parent area candidates for the "add to OSM" flow, by local tick id */
  let areaChoices = $state<Record<string, { slug: string; name: string }[]>>({});
  let chosenArea = $state<Record<string, string>>({});

  async function onAddToOsm(tick: LocalTickEntry) {
    const id = tick.localId!;
    error = undefined;
    if (!tick.crag) {
      error = `No crag known for "${tick.name}": open its crag page and use "Add route" on the map instead.`;
      return;
    }
    if (areaChoices[id]) return;
    const matches = await localDb.matchAreas([tick.crag]);
    areaChoices = {
      ...areaChoices,
      [id]: matches[0]!.map((m) => ({ slug: m.slug, name: (m.data as OsmFeature).tags?.name ?? m.slug })),
    };
    const first = areaChoices[id]![0];
    if (first) chosenArea = { ...chosenArea, [id]: first.slug };
  }

  function gotoPlacement(tick: LocalTickEntry) {
    const parentSlug = chosenArea[tick.localId!];
    if (!parentSlug) return;
    void goto(`${resolve("/world/[...slug]", { slug: parentSlug })}?addRouteTick=${tick.localId}`);
  }
</script>

<section class="flex flex-col gap-3 rounded-md border p-3.5" aria-label="Your ticks">
  <div class="flex flex-wrap items-center justify-between gap-2">
    <h2 class="text-sm font-semibold">Your ticks ({sortedTicks.length})</h2>
  </div>

  {#if error}
    <p class="text-xs text-destructive">{error}</p>
  {/if}

  {#if sortedTicks.length === 0}
    <p class="text-xs text-muted-foreground">No ticks yet. Log them on a route page, or import a logbook above.</p>
  {:else}
    <ul class="flex max-h-[32rem] flex-col gap-2 overflow-y-auto text-sm">
      {#each sortedTicks as tick (tick.localId)}
        {@const linked = rematch[tick.localId!]?.candidates ?? []}
        <li class="flex flex-col gap-1 rounded border p-2">
          <div class="flex flex-wrap items-center gap-2">
            {#if tick.subject}
              <a
                href={`https://www.openstreetmap.org/${tick.subject.type}/${tick.subject.id}`}
                target="_blank"
                rel="noreferrer"
                class="font-medium underline underline-offset-2"
              >
                {labelFor(tick)}
              </a>
            {:else}
              <span class="font-medium">{labelFor(tick)}</span>
            {/if}
            <span class="rounded bg-muted px-1.5 py-0.5 text-[11px] capitalize text-muted-foreground"
              >{tick.style}</span
            >
            <span class="text-xs text-muted-foreground">{new Date(tick.climbedAt).toLocaleDateString()}</span>
            {#if !tick.uri}
              <span class="rounded border px-1.5 py-0.5 text-[11px] text-muted-foreground">Pending sync</span>
            {/if}
            <div class="ms-auto flex items-center gap-1">
              <Button size="icon-xs" variant="ghost" title="Edit tick" aria-label="Edit tick" onclick={() => startEdit(tick)}>
                <span aria-hidden="true" class="icon-[lucide--pencil] size-3.5"></span>
              </Button>
              <Button
                size="icon-xs"
                variant="ghost"
                title="Delete tick"
                aria-label="Delete tick"
                disabled={busy}
                onclick={() => onDelete(tick)}
              >
                <span aria-hidden="true" class="icon-[lucide--trash-2] size-3.5"></span>
              </Button>
            </div>
          </div>

          {#if !tick.subject}
            <p class="text-xs text-muted-foreground">
              Not on OpenStreetMap{tick.grade ? ` · ${tick.grade}` : ""}{tick.crag ? ` · ${tick.crag}` : ""}
            </p>

            {#if linked.length > 0}
              <div class="flex flex-wrap items-center gap-2 text-xs">
                <span class="text-muted-foreground">Found in the OSM data:</span>
                <Select
                  aria-label="Matching OSM route for {labelFor(tick)}"
                  class="w-auto max-w-56"
                  value={linked[0]!.slug}
                  onchange={(e) => onLink(tick, (e.target as HTMLSelectElement).value)}
                >
                  {#each linked as candidate (candidate.slug)}
                    <option value={candidate.slug}>
                      {candidate.name}{candidate.grade ? ` (${candidate.grade})` : ""}
                    </option>
                  {/each}
                </Select>
                <span class="text-muted-foreground">Changing the route links the tick to it.</span>
              </div>
            {:else}
              <div class="flex flex-wrap items-center gap-2">
                {#if areaChoices[tick.localId!]}
                  <Select
                    aria-label="Parent crag for {labelFor(tick)}"
                    class="w-auto max-w-56"
                    value={chosenArea[tick.localId!] ?? ""}
                    onchange={(e) =>
                      (chosenArea = { ...chosenArea, [tick.localId!]: (e.target as HTMLSelectElement).value })}
                  >
                    {#each areaChoices[tick.localId!] as area (area.slug)}
                      <option value={area.slug}>{area.name}</option>
                    {/each}
                  </Select>
                  <Button size="xs" variant="outline" onclick={() => gotoPlacement(tick)}>
                    <span class="icon-[lucide--map-pin-plus] shrink-0 size-4"></span>
                    Add to OSM
                  </Button>
                  <span class="text-xs text-muted-foreground">You will place the route on the crag's map.</span>
                {:else}
                  <Button size="xs" variant="outline" disabled={busy} onclick={() => onAddToOsm(tick)}>
                    <span class="icon-[lucide--map-pin-plus] shrink-0 size-4"></span>
                    Add to OSM
                  </Button>
                {/if}
              </div>
            {/if}
          {/if}

          {#if editingLocalId === tick.localId}
            <form
              class="flex flex-wrap items-center gap-2 rounded bg-muted/40 p-2"
              onsubmit={(e) => {
                e.preventDefault();
                void saveEdit(tick);
              }}
            >
              <Select aria-label="Ascent style" class="w-auto" bind:value={editStyle}>
                <option value="onsight">Onsight</option>
                <option value="flash">Flash</option>
                <option value="redpoint">Redpoint</option>
                <option value="attempt">Attempt</option>
              </Select>
              <Input type="date" class="w-auto" bind:value={editDate} aria-label="Ascent date" />
              <Input class="min-w-40 flex-1" bind:value={editComment} placeholder="Comment (optional)" />
              <Button size="xs" type="submit" disabled={busy}>Save</Button>
              <Button size="xs" type="button" variant="outline" onclick={() => (editingLocalId = undefined)}>
                Cancel
              </Button>
            </form>
          {:else if tick.comment}
            <p class="text-xs">{tick.comment}</p>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
</section>
