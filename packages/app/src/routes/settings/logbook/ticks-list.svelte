<script lang="ts">
  import { goto } from "$app/navigation";
  import { resolve } from "$app/paths";
  import { Button } from "#components/ui/button/index.js";
  import { Input } from "#components/ui/input/index.js";
  import { Select } from "#components/ui/select/index.js";
  import { atproto, type LocalTickEntry } from "#lib/data/network/atproto.svelte.js";
  import { localDb } from "#lib/data/db/local-db.svelte.js";
  import { getGrade, getGradeReference } from "#lib/data/parse/osm-tags.js";
  import { extractRouteStyle, ROUTE_STYLE_LABELS } from "#lib/data/parse/route-styles.js";
  import HolyGrade from "#components/grade/holy-grade.svelte";
  import type { Grade } from "#lib/types.js";
  import type { AscentStyle } from "@bloknote/common";
  import type { OsmFeature, Tags } from "osm-api";

  type SortMode = "recent" | "name" | "grade";
  const sortModes: { value: SortMode; label: string }[] = [
    { value: "recent", label: "Recent" },
    { value: "name", label: "Name" },
    { value: "grade", label: "Grade" },
  ];
  let sortMode = $state<SortMode>("recent");

  /** Distinct color per ascent style */
  const STYLE_BADGE_CLASSES: Record<AscentStyle, string> = {
    onsight: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
    flash: "bg-cyan-500/15 text-cyan-700 dark:text-cyan-300",
    redpoint: "bg-blue-500/15 text-blue-700 dark:text-blue-300",
    attempt: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  };

  /** Ticks pointing at an OSM element: subject-less ticks (routes not on OSM yet) are excluded */
  const osmTicks = $derived(atproto.ticks.filter((t) => t.subject));

  /** Ticks and stars resolved against the local database: the route's slug, name, grade, style */
  interface ResolvedRef {
    name?: string;
    grade?: Grade;
    gradeRef?: number;
    style?: string;
  }
  let resolved = $state<Record<string, ResolvedRef>>({});

  /** Route candidates found again in the OSM data for subject-less ticks, by local tick id */
  let rematch = $state<Record<string, { candidates: { slug: string; name: string; grade?: string; feature: OsmFeature }[] }>>({});

  let busy = $state(false);
  let error = $state<string>();

  $effect(() => {
    const refs = [
      ...new Set([
        ...osmTicks.map((t) => `${t.subject!.type}-${t.subject!.id}`),
        ...atproto.stars.map((s) => `${s.subject.type}-${s.subject.id}`),
      ]),
    ];
    const missing = refs.filter((ref) => resolved[ref] === undefined);
    if (missing.length === 0 || !localDb.ready) return;
    localDb.getByOsmRefs(missing).then((entries) => {
      const next = { ...resolved };
      for (const ref of missing) {
        const entry = entries[ref];
        const tags = (entry?.data as OsmFeature | undefined)?.tags ?? {};
        next[ref] = {
          name: tags.name,
          grade: getGrade(tags)?.v,
          gradeRef: getGradeReference(tags),
          style: extractRouteStyle(tags),
        };
      }
      resolved = next;
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
        resolved[`${tick.subject.type}-${tick.subject.id}`]?.name ||
        `${tick.subject.type}/${tick.subject.id}`
      );
    }
    return tick.name ?? "Unnamed route";
  }

  /** Grade reference used by the "Grade" sort: OSM data first, else the logbook grade string */
  function gradeRefFor(tick: LocalTickEntry): number {
    if (tick.subject) {
      return resolved[`${tick.subject.type}-${tick.subject.id}`]?.gradeRef ?? 0;
    }
    if (!tick.grade) return 0;
    return getGradeReference({ "climbing:grade": tick.grade } as Tags) ?? 0;
  }

  const sortedTicks = $derived.by(() => {
    const ticks = [...atproto.ticks];
    switch (sortMode) {
      case "name":
        return ticks.sort((a, b) => labelFor(a).localeCompare(labelFor(b)));
      case "grade":
        return ticks.sort((a, b) => gradeRefFor(b) - gradeRefFor(a));
      default:
        return ticks.sort((a, b) => (b.climbedAt ?? "").localeCompare(a.climbedAt ?? ""));
    }
  });

  /** Inline edits are pushed to the PDS after a short delay, so typing stays smooth */
  const SAVE_DELAY_MS = 2500;
  const saveTimers: Record<string, ReturnType<typeof setTimeout>> = {};
  let saving = $state<Record<string, boolean>>({});

  function scheduleSave(tick: LocalTickEntry) {
    const id = tick.localId!;
    clearTimeout(saveTimers[id]);
    saving = { ...saving, [id]: true };
    saveTimers[id] = setTimeout(() => {
      delete saveTimers[id];
      atproto
        .pushTick(tick)
        .catch((err) => (error = err instanceof Error ? err.message : "Could not save the tick."))
        .finally(() => {
          saving = { ...saving, [id]: false };
        });
    }, SAVE_DELAY_MS);
  }

  function setStyle(tick: LocalTickEntry, style: AscentStyle) {
    tick.style = style;
    scheduleSave(tick);
  }

  function setDate(tick: LocalTickEntry, value: string) {
    if (!value) return;
    tick.climbedAt = new Date(`${value}T12:00:00Z`).toISOString();
    scheduleSave(tick);
  }

  function setComment(tick: LocalTickEntry, value: string) {
    const trimmed = value.trim();
    if (trimmed) tick.comment = trimmed;
    else delete tick.comment;
    scheduleSave(tick);
  }

  async function onDelete(tick: LocalTickEntry) {
    clearTimeout(saveTimers[tick.localId!]);
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
    <Select aria-label="Sort ticks" class="w-auto" bind:value={sortMode}>
      {#each sortModes as mode (mode.value)}
        <option value={mode.value}>{mode.label}</option>
      {/each}
    </Select>
  </div>

  {#if error}
    <p class="text-xs text-destructive">{error}</p>
  {/if}

  {#if sortedTicks.length === 0}
    <p class="text-xs text-muted-foreground">No ticks yet. Log them on a route page, or import a logbook above.</p>
  {:else}
    <ul class="flex flex-col gap-2 text-sm">
      {#each sortedTicks as tick (tick.localId)}
        {@const linked = rematch[tick.localId!]?.candidates ?? []}
        {@const info = tick.subject ? resolved[`${tick.subject.type}-${tick.subject.id}`] : undefined}
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
            {#if info?.grade}
              <HolyGrade class="text-xs font-semibold" grade={info.grade} />
            {:else if tick.grade}
              <span class="text-xs text-muted-foreground">{tick.grade}</span>
            {/if}
            {#if info?.style}
              <span class="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                {ROUTE_STYLE_LABELS[info.style] ?? info.style}
              </span>
            {/if}
            <span class="ms-auto flex flex-wrap items-center gap-2">
              {#if saving[tick.localId!]}
                <span class="text-[11px] text-muted-foreground">Saving…</span>
              {:else if !tick.uri}
                <span class="rounded border px-1.5 py-0.5 text-[11px] text-muted-foreground">Pending sync</span>
              {/if}
              <Select
                aria-label="Ascent style of {labelFor(tick)}"
                class={`w-auto rounded px-1.5 py-0.5 text-[11px] font-medium capitalize ${STYLE_BADGE_CLASSES[tick.style]}`}
                value={tick.style}
                onchange={(e) => setStyle(tick, (e.target as HTMLSelectElement).value as AscentStyle)}
              >
                <option value="onsight">Onsight</option>
                <option value="flash">Flash</option>
                <option value="redpoint">Redpoint</option>
                <option value="attempt">Attempt</option>
              </Select>
              <Input
                type="date"
                class="w-auto text-xs"
                value={tick.climbedAt.slice(0, 10)}
                aria-label="Ascent date of {labelFor(tick)}"
                onchange={(e) => setDate(tick, (e.target as HTMLInputElement).value)}
              />
              <Input
                class="min-w-40 flex-1 text-xs"
                value={tick.comment ?? ""}
                placeholder="Comment"
                aria-label="Comment on {labelFor(tick)}"
                oninput={(e) => setComment(tick, (e.target as HTMLInputElement).value)}
              />
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
            </span>
          </div>

          {#if !tick.subject}
            <p class="text-xs text-muted-foreground">
              Not on OpenStreetMap{tick.crag ? ` · ${tick.crag}` : ""}
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
        </li>
      {/each}
    </ul>
  {/if}
</section>
