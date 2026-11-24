<script lang="ts">
  import { resolve } from "$app/paths";
  import { Button } from "#components/ui/button/index.js";
  import { Select } from "#components/ui/select/index.js";
  import { Input } from "#components/ui/input/index.js";
  import { atproto, sameElementRef } from "#lib/data/network/atproto.svelte.js";
  import { localDb } from "#lib/data/db/local-db.svelte.js";
  import { getGrade } from "#lib/data/parse/osm-tags.js";
  import { parseTickCsv, type ImportedTick, type TickImportFormat } from "#lib/data/parse/tick-import.js";
  import type { OsmFeature } from "osm-api";

  /** Safety cap: very large exports are truncated instead of freezing the page */
  const MAX_ROWS = 1000;
  const MATCH_BATCH = 100;

  interface ImportCandidate {
    slug: string;
    name: string;
    grade?: string;
    feature: OsmFeature;
  }

  interface ImportRow {
    /** Unique row id, used as the review-list key (exports may contain identical rows) */
    id: number;
    tick: ImportedTick;
    candidates: ImportCandidate[];
    selectedSlug: string;
    /** The selected candidate already has a tick in the logbook */
    alreadyLogged: boolean;
  }

  let fileName = $state("");
  let rows = $state<ImportRow[]>([]);
  let truncated = $state(false);
  let format = $state<TickImportFormat>("mountainproject");
  let phase = $state<"pick" | "matching" | "review" | "importing">("pick");
  let parseError = $state<string>();
  let result = $state<{ imported: number; unmatched: number; alreadyLogged: number }>();
  let progress = $state(0);

  const formatters: Record<TickImportFormat, string> = {
    mountainproject: "MountainProject",
    thecrag: "TheCrag",
  };

  function chunk(items: string[], size: number): string[][] {
    const chunks: string[][] = [];
    for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
    return chunks;
  }

  function toCandidate(slug: string, data: OsmFeature): ImportCandidate {
    return {
      slug,
      name: data.tags?.name ?? "Unnamed",
      grade: getGrade(data.tags ?? {})?.v.v,
      feature: data,
    };
  }

  function isLogged(feature: OsmFeature): boolean {
    return atproto.ticks.some((t) => sameElementRef(t.subject, { type: feature.type, id: feature.id }));
  }

  async function onFile(event: Event) {
    parseError = undefined;
    result = undefined;
    rows = [];
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    fileName = file.name;

    let parsed: ReturnType<typeof parseTickCsv>;
    try {
      parsed = parseTickCsv(await file.text());
    } catch (err) {
      parseError = err instanceof Error ? err.message : "Could not read the file.";
      return;
    }
    if (!parsed) {
      parseError = "Unrecognized format: expected a MountainProject tick export or a TheCrag logbook CSV.";
      return;
    }
    format = parsed.format;
    truncated = parsed.ticks.length > MAX_ROWS;

    phase = "matching";
    const importRows: ImportRow[] = parsed.ticks
      .slice(0, MAX_ROWS)
      .map((tick, id) => ({ id, tick, candidates: [], selectedSlug: "", alreadyLogged: false }));
    const names = [...new Set(importRows.map((r) => r.tick.routeName))];
    for (const batch of chunk(names, MATCH_BATCH)) {
      const matches = await localDb.matchPlaceNames(batch);
      for (const [name, found] of Object.entries(matches)) {
        const candidates = found.map((entry) => toCandidate(entry.slug, entry.data as OsmFeature));
        for (const row of importRows) {
          if (row.tick.routeName !== name) continue;
          row.candidates = candidates;
          // Single match: preselect it
          if (candidates.length === 1) row.selectedSlug = candidates[0]!.slug;
        }
      }
    }
    for (const row of importRows) {
      const selected = row.candidates.find((c) => c.slug === row.selectedSlug);
      row.alreadyLogged = selected ? isLogged(selected.feature) : false;
    }
    rows = importRows;
    phase = "review";
  }

  function onSelect(row: ImportRow, slug: string) {
    row.selectedSlug = slug;
    const selected = row.candidates.find((c) => c.slug === slug);
    row.alreadyLogged = selected ? isLogged(selected.feature) : false;
  }
  const counts = $derived.by(() => {
    let matched = 0;
    let unmatched = 0;
    let alreadyLogged = 0;
    for (const row of rows) {
      if (!row.selectedSlug) unmatched++;
      else if (row.alreadyLogged) alreadyLogged++;
      else matched++;
    }
    return { matched, unmatched, alreadyLogged };
  });

  async function importTicks() {
    phase = "importing";
    progress = 0;
    let imported = 0;
    try {
      for (const row of rows) {
        const candidate = row.candidates.find((c) => c.slug === row.selectedSlug);
        if (!candidate || row.alreadyLogged) continue;
        await atproto.addTick(candidate.feature, row.tick.style, row.tick.notes, row.tick.date);
        imported++;
        progress++;
      }
      result = { imported, unmatched: counts.unmatched, alreadyLogged: counts.alreadyLogged };
      rows = [];
      phase = "pick";
    } catch (err) {
      parseError = err instanceof Error ? err.message : "Import failed.";
      phase = "review";
    }
  }
</script>

<section class="flex flex-col gap-3 rounded-md border p-3.5" aria-label="Import ticks from other platforms">
  <h2 class="text-sm font-semibold">Import ticks</h2>

  <p class="text-xs text-muted-foreground">
    Export your logbook from
    <a
      class="underline underline-offset-2"
      href="https://www.mountainproject.com/user/your-ticks"
      target="_blank"
      rel="noreferrer">MountainProject</a
    >
    (profile, "see all ticks", export as CSV) or
    <a
      class="underline underline-offset-2"
      href="https://www.thecrag.com/climber/logbook-csv"
      target="_blank"
      rel="noreferrer">TheCrag</a
    >
    (dashboard, actions, logbook CSV), then import it here. Routes are matched by name against the
    offline climbing data; routes that are not on OpenStreetMap yet cannot be imported.
  </p>

  {#if !atproto.configured}
    <p class="text-xs text-muted-foreground">
      Connect your Atmosphere account in the
      <a href={resolve("/settings/account")} class="text-primary underline underline-offset-2">Account</a>
      tab to import ticks.
    </p>
  {/if}

  {#if parseError}
    <p class="text-xs text-destructive">{parseError}</p>
  {/if}

  {#if result}
    <p class="text-xs text-emerald-600 dark:text-emerald-400">
      Imported {result.imported} tick{result.imported === 1 ? "" : "s"} ({result.alreadyLogged} already logged,
      {result.unmatched} without a matching OSM route).
    </p>
  {/if}

  <div class="flex flex-wrap items-center gap-2">
    <Input type="file" accept=".csv,text/csv" class="max-w-xs" onchange={onFile} disabled={!atproto.configured} />
    {#if fileName}
      <span class="text-xs text-muted-foreground">{fileName}</span>
    {/if}
  </div>

  {#if phase === "matching"}
    <p class="flex items-center gap-2 text-xs text-muted-foreground">
      <span aria-hidden="true" class="icon-[lucide--loader-circle] size-4 animate-spin"></span>
      Matching routes...
    </p>
  {:else if phase === "importing"}
    <p class="flex items-center gap-2 text-xs text-muted-foreground">
      <span aria-hidden="true" class="icon-[lucide--loader-circle] size-4 animate-spin"></span>
      Importing {progress}/{counts.matched} ticks...
    </p>
  {:else if phase === "review" && rows.length > 0}
    <div class="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
      <span>
        {rows.length} tick{rows.length === 1 ? "" : "s"} from {formatters[format]}
        {#if truncated}(truncated to {MAX_ROWS}){/if}: {counts.matched} ready, {counts.unmatched} unmatched,
        {counts.alreadyLogged} already logged.
      </span>
      <Button size="xs" onclick={importTicks} disabled={counts.matched === 0}>
        <span class="icon-[lucide--download] shrink-0 size-4"></span>
        Import {counts.matched} tick{counts.matched === 1 ? "" : "s"}
      </Button>
    </div>

    <ul class="flex max-h-96 flex-col gap-1.5 overflow-y-auto rounded-md border p-2 text-sm">
      {#each rows as row (row.id)}
        {@const selected = row.candidates.find((c) => c.slug === row.selectedSlug)}
        <li class="flex flex-wrap items-center gap-2 border-b pb-1.5 last:border-b-0">
          <span class="min-w-40 flex-1 font-medium">{row.tick.routeName}</span>
          {#if row.tick.grade}
            <span class="text-xs text-muted-foreground">{row.tick.grade}</span>
          {/if}
          {#if row.tick.date}
            <span class="text-xs text-muted-foreground">{new Date(row.tick.date).toLocaleDateString()}</span>
          {/if}
          <span class="rounded bg-muted px-1.5 py-0.5 text-[11px] capitalize text-muted-foreground"
            >{row.tick.style}</span
          >
          {#if row.candidates.length === 0}
            <span class="text-xs text-amber-600 dark:text-amber-400">Not found in OSM data</span>
          {:else}
            <Select
              aria-label="Matching OSM route for {row.tick.routeName}"
              class="w-auto max-w-56"
              value={row.selectedSlug}
              onchange={(e) => onSelect(row, (e.target as HTMLSelectElement).value)}
            >
              <option value="">Pick a route...</option>
              {#each row.candidates as candidate (candidate.slug)}
                <option value={candidate.slug}>
                  {candidate.name}{candidate.grade ? ` (${candidate.grade})` : ""}
                </option>
              {/each}
            </Select>
            {#if row.alreadyLogged}
              <span class="text-xs text-muted-foreground">Already logged</span>
            {/if}
          {/if}
          {#if selected && row.selectedSlug && !row.alreadyLogged}
            <a
              href={`https://www.openstreetmap.org/${selected.feature.type}/${selected.feature.id}`}
              target="_blank"
              rel="noreferrer"
              class="text-xs text-muted-foreground underline underline-offset-2"
            >
              {selected.feature.type}/{selected.feature.id}
            </a>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
</section>
