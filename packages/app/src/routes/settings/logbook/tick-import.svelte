<script lang="ts">
  import { resolve } from "$app/paths";
  import { Button } from "#components/ui/button/index.js";
  import { Select } from "#components/ui/select/index.js";
  import { Input } from "#components/ui/input/index.js";
  import * as Collapsible from "#components/ui/collapsible/index.js";
  import { ascentFromStyle } from "@bloknote/common";
  import { atproto, sameElementRef } from "#lib/data/network/atproto.svelte.js";
  import { localDb } from "#lib/data/db/local-db.svelte.js";
  import { getGrade } from "@bloknote/osm-climbing";
  import { extractRouteStyle, ROUTE_STYLE_LABELS } from "@bloknote/osm-climbing";
  import {
    parseTickCsv,
    locationSegments,
    type ImportedTick,
    type TickImportFormat,
  } from "#lib/data/parse/tick-import.js";
  import type { TickRouteMatch } from "#lib/data/db/types.js";
  import type { OsmFeature } from "osm-api";

  /** Safety cap: very large exports are truncated instead of freezing the page */
  const MAX_ROWS = 1000;
  /** One tick at a time: the matching is fast enough and the counter advances on every tick (issue #239) */
  const MATCH_BATCH = 1;

  interface ImportCandidate {
    slug: string;
    /** Slug of the area (crag/sector) the candidate belongs to */
    parentSlug: string;
    name: string;
    grade?: string;
    /** Climbing style of the OSM route (sport, trad, boulder...) */
    style?: string;
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
  let open = $state(false);
  let rows = $state<ImportRow[]>([]);
  let truncated = $state(false);
  let format = $state<TickImportFormat>("mountainproject");
  let phase = $state<"pick" | "matching" | "review" | "importing">("pick");
  /** Ticks whose OSM lookup has been processed so far, shown while matching */
  let matchingProgress = $state(0);
  let matchingTotal = $state(0);
  let parseError = $state<string>();
  let result = $state<{
    imported: number;
    unmatched: number;
    alreadyLogged: number;
  }>();
  let progress = $state(0);

  const formatters: Record<TickImportFormat, string> = {
    mountainproject: "MountainProject",
    thecrag: "TheCrag",
  };

  function toCandidate(match: TickRouteMatch): ImportCandidate {
    const tags = (match.data as OsmFeature).tags ?? {};
    const style = extractRouteStyle(tags);
    return {
      slug: match.slug,
      parentSlug: match.parentSlug,
      name: tags.name ?? "Unnamed",
      grade: getGrade(tags)?.v.v,
      style: style ? (ROUTE_STYLE_LABELS[style] ?? style) : undefined,
      feature: match.data as OsmFeature,
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

    const importRows: ImportRow[] = parsed.ticks.slice(0, MAX_ROWS).map((tick, id) => ({
      id,
      tick,
      candidates: [],
      selectedSlug: "",
      alreadyLogged: false,
    }));
    phase = "matching";
    matchingTotal = importRows.length;
    matchingProgress = 0;
    // The import can run before the dataset was ever downloaded (settings pages do not trigger
    // it): start the download, the matching below waits for it instead of finding nothing (issue #225)
    void localDb.download();
    // Routes are only searched inside the area given by the export: the location from the CSV
    // locates the crag(s), then route names are matched inside them (issue #154)
    const queries = importRows.map((row) => ({
      name: row.tick.routeName,
      area: row.tick.area,
    }));
    for (let start = 0; start < queries.length; start += MATCH_BATCH) {
      const matches = await localDb.matchTicks(queries.slice(start, start + MATCH_BATCH));
      matchingProgress = Math.min(start + MATCH_BATCH, queries.length);
      matches.forEach((found, index) => {
        const row = importRows[start + index];
        if (!row) return;
        row.candidates = found.map(toCandidate);
        // Single match: preselect it
        if (row.candidates.length === 1) row.selectedSlug = row.candidates[0]!.slug;
      });
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
      if (row.candidates.length === 0) unmatched++;
      else if (row.selectedSlug && row.alreadyLogged) alreadyLogged++;
      else matched++;
    }
    return { matched, unmatched, alreadyLogged };
  });

  /** Rows with at least one area-scoped candidate, shown in the review list */
  const matchedRows = $derived(rows.filter((row) => row.candidates.length > 0));

  function gradesDiffer(row: ImportRow, candidate: ImportCandidate): boolean {
    return !!row.tick.grade && !!candidate.grade && row.tick.grade.toLowerCase() !== candidate.grade.toLowerCase();
  }

  function typesDiffer(row: ImportRow, candidate: ImportCandidate): boolean {
    return (
      !!row.tick.routeType && !!candidate.style && row.tick.routeType.toLowerCase() !== candidate.style.toLowerCase()
    );
  }

  async function importTicks() {
    phase = "importing";
    progress = 0;
    let imported = 0;
    let alreadyLogged = 0;
    let unmatched = 0;
    try {
      for (const row of rows) {
        const candidate = row.candidates.find((c) => c.slug === row.selectedSlug);
        if (candidate && row.alreadyLogged) {
          alreadyLogged++;
          continue;
        }
        if (candidate) {
          await atproto.addTick(candidate.feature, ascentFromStyle(row.tick.style), row.tick.notes, row.tick.date);
        } else {
          // Route not on OSM (yet): the tick is stored without a subject and can be linked later
          await atproto.addNameTick(
            {
              name: row.tick.routeName,
              grade: row.tick.grade,
              locationHint: locationSegments(row.tick.location ?? row.tick.area ?? row.tick.cragName),
            },
            ascentFromStyle(row.tick.style),
            row.tick.notes,
            row.tick.date,
          );
          unmatched++;
        }
        imported++;
        progress++;
      }
      result = { imported, unmatched, alreadyLogged };
      rows = [];
      phase = "pick";
    } catch (err) {
      parseError = err instanceof Error ? err.message : "Import failed.";
      phase = "review";
    }
  }
</script>

<Collapsible.Root class="flex flex-col gap-3 rounded-md border p-3.5" aria-label="Import ticks from other platforms">
  <Collapsible.Trigger
    class="flex w-fit items-center gap-1.5 rounded text-sm font-semibold hover:text-foreground"
    aria-expanded={open}
  >
    <span
      aria-hidden="true"
      class="icon-[lucide--chevron-right] size-4 shrink-0 transition-transform"
      class:rotate-90={open}
    ></span>
    Import ticks
  </Collapsible.Trigger>

  <Collapsible.Content class="flex flex-col gap-3">
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
      (dashboard, actions, logbook CSV), then import it here. Routes are searched inside the crag given by the export; routes
      that are not on OpenStreetMap yet are imported anyway and can be added to OSM later from your ticks list.
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
        Imported {result.imported} tick{result.imported === 1 ? "" : "s"} ({result.alreadyLogged}
        already logged,
        {result.unmatched} without an OSM route).
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
        Matching routes in their crags... {matchingProgress}/{matchingTotal}
        {#if localDb.status === "downloading"}
          (downloading the offline dataset first, {localDb.phase === "download" ? "download" : "parsing"}{" "}
          {Math.min(100, Math.round((localDb.loaded / (localDb.total ?? 1)) * 100))}%)
        {/if}
      </p>
    {:else if phase === "importing"}
      <p class="flex items-center gap-2 text-xs text-muted-foreground">
        <span aria-hidden="true" class="icon-[lucide--loader-circle] size-4 animate-spin"></span>
        Importing {progress}/{counts.matched + counts.unmatched} ticks...
      </p>
    {:else if phase === "review" && rows.length > 0}
      <div class="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span>
          {rows.length} tick{rows.length === 1 ? "" : "s"} from {formatters[format]}
          {#if truncated}(truncated to {MAX_ROWS}){/if}: {counts.matched} matched,
          {counts.alreadyLogged} already logged.
        </span>
        <Button size="xs" onclick={importTicks} disabled={rows.length === counts.alreadyLogged}>
          <span class="icon-[lucide--download] shrink-0 size-4"></span>
          Import {rows.length - counts.alreadyLogged} tick{rows.length - counts.alreadyLogged === 1 ? "" : "s"}
        </Button>
      </div>

      <ul class="flex max-h-96 flex-col gap-2 overflow-y-auto rounded-md border p-2 text-sm">
        {#each matchedRows as row (row.id)}
          {@const selected = row.candidates.find((c) => c.slug === row.selectedSlug)}
          <li class="flex flex-col gap-1 border-b pb-2 last:border-b-0">
            <div class="flex flex-wrap items-center gap-2">
              <span class="min-w-40 flex-1 font-medium">{row.tick.routeName}</span>
              {#if row.tick.date}
                <span class="text-xs text-muted-foreground">{new Date(row.tick.date).toLocaleDateString()}</span>
              {/if}
              <span class="rounded bg-muted px-1.5 py-0.5 text-[11px] capitalize text-muted-foreground"
                >{row.tick.style}</span
              >
              <Select
                aria-label="Matching OSM route for {row.tick.routeName}"
                class="w-auto max-w-56"
                value={row.selectedSlug}
                onchange={(e) => onSelect(row, (e.target as HTMLSelectElement).value)}
              >
                <option value="">Pick a route...</option>
                {#each row.candidates as candidate (candidate.slug)}
                  <option value={candidate.slug}>{candidate.name}</option>
                {/each}
              </Select>
              {#if row.alreadyLogged}
                <span class="text-xs text-muted-foreground">Already logged</span>
              {/if}
            </div>
            {#if selected}
              {@const mismatch = gradesDiffer(row, selected) || typesDiffer(row, selected)}
              <div
                class="flex flex-wrap items-center gap-x-3 gap-y-0.5 rounded bg-muted/40 px-2 py-1 text-xs text-muted-foreground"
              >
                <span>
                  <span class="font-medium text-foreground">OSM:</span>
                  <span class:font-semibold={selected.name !== row.tick.routeName}>{selected.name}</span>
                </span>
                <span>
                  <span class="font-medium text-foreground">Location:</span>
                  {selected.parentSlug || selected.slug}
                </span>
                <span>
                  <span class="font-medium text-foreground">Grade:</span>
                  <span class:font-semibold={gradesDiffer(row, selected)}>{selected.grade ?? "—"}</span>
                  {#if gradesDiffer(row, selected)}
                    <span class="text-amber-600 dark:text-amber-400">(logbook: {row.tick.grade})</span>
                  {/if}
                </span>
                <span>
                  <span class="font-medium text-foreground">Style:</span>
                  <span class:font-semibold={typesDiffer(row, selected)}>{selected.style ?? "—"}</span>
                  {#if typesDiffer(row, selected)}
                    <span class="text-amber-600 dark:text-amber-400">(logbook: {row.tick.routeType})</span>
                  {/if}
                </span>
                <a
                  href={`https://www.openstreetmap.org/${selected.feature.type}/${selected.feature.id}`}
                  target="_blank"
                  rel="noreferrer"
                  class="underline underline-offset-2 hover:text-foreground"
                >
                  {selected.feature.type}/{selected.feature.id}
                </a>
              </div>
              {#if mismatch}
                <p class="text-[11px] text-amber-600 dark:text-amber-400">
                  Some details differ from the logbook: check the preview before importing.
                </p>
              {/if}
            {/if}
          </li>
        {/each}
        {#if counts.unmatched > 0}
          <li class="flex flex-wrap items-center gap-2 pt-1 text-sm">
            <span aria-hidden="true" class="icon-[lucide--map-pin-question-mark] size-4 shrink-0 text-muted-foreground"
            ></span>
            and {counts.unmatched} route{counts.unmatched === 1 ? "" : "s"} not found on OSM. You can add them still, and
            link them with OSM later from your ticks list.
          </li>
        {/if}
      </ul>
    {/if}
  </Collapsible.Content>
</Collapsible.Root>
