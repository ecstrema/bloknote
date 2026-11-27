<script lang="ts">
  import { afterNavigate, goto } from "$app/navigation";
  import { resolve } from "$app/paths";
  import { Chart, Layer, Axis, Rect, Text } from "layerchart/svg";
  import { scaleBand, scaleLinear } from "d3-scale";
  import type { DataJSON } from "@bloknote/climbing-data-gen";
  import type { OsmFeature } from "osm-api";
  import { localDb } from "#lib/data/db/local-db.svelte.js";
  import { searchState } from "#lib/components/shell/sidebar/search-state.svelte.js";
  import { getItemUrl } from "#components/shell/sidebar/utils.js";
  import { computeSectorStats, STAT_STYLE_COLORS, STAT_STYLE_ORDER } from "@bloknote/osm-climbing";
  import { gradingScales } from "#lib/data/grading-scales.svelte.js";
  import { getLocalizedName } from "#lib/data/parse/localized-name.js";
  import { featureToType } from "#lib/data/parse/data.js";
  import { getGrade, parseClimbingLength } from "@bloknote/osm-climbing";
  import { getParentSlug } from "#lib/helpers/slug.js";
  import { pageTitle } from "#lib/page-title.js";
  import { Button } from "#components/ui/button/index.js";
  import { Select } from "#components/ui/select/index.js";
  import type { BoulderScaleId, RouteScaleId } from "@bloknote/holy-grade";

  const RETURN_STORAGE_KEY = "bloknote:explore-return";
  const LENGTH_BUCKETS = [20, 30, 40, 60, 100] as const;
  const ROW_HEIGHT = 34;
  const LIST_VIEWPORT = 323;

  let selectedPlot = $state<"difficulty" | "styles" | "lengths">("difficulty");

  /** All the matched elements (issue #237): the plots and the route list cover the whole query */
  let matches = $state.raw<Record<string, DataJSON>>({});
  $effect(() => {
    const slugs = searchState.result?.matches;
    if (!localDb.ready || !slugs || slugs.size === 0) {
      matches = {};
      return;
    }
    let cancelled = false;
    localDb
      .getElements([...slugs])
      .then((res) => {
        if (!cancelled) matches = res;
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  });

  const entries = $derived(Object.entries(matches).filter(([, f]) => f.type !== "geographic"));
  const features = $derived(entries.map(([, f]) => f as OsmFeature));

  const stats = $derived(
    computeSectorStats(features, {
      routeScale: gradingScales.effective("route") as RouteScaleId,
      boulderScale: gradingScales.effective("boulder") as BoulderScaleId,
    }),
  );

  /** Climbing style distribution, as a simple bar chart */
  const stylePlot = $derived(stats.typeDistribution.map((e) => ({ label: e.label, total: e.count })));

  /** Route length distribution over fixed meter buckets (issue #237) */
  const lengthPlot = $derived.by(() => {
    const counts = new Map<string, number>();
    const bucketOf = (meters: number): string => {
      for (let i = 0; i < LENGTH_BUCKETS.length; i++) {
        if (meters < LENGTH_BUCKETS[i]!) return i === 0 ? "< 20 m" : `${LENGTH_BUCKETS[i - 1]}–${LENGTH_BUCKETS[i]} m`;
      }
      return "> 100 m";
    };
    for (const feature of features) {
      const length = parseClimbingLength(feature.tags?.["climbing:length"] ?? "");
      if (!length || length.meters <= 0) continue;
      const bucket = bucketOf(length.meters);
      counts.set(bucket, (counts.get(bucket) ?? 0) + 1);
    }
    return [...LENGTH_BUCKETS.map((m, i) => (i === 0 ? "< 20 m" : `${LENGTH_BUCKETS[i - 1]}–${m} m`)), "> 100 m"]
      .map((label) => ({ label, total: counts.get(label) ?? 0 }))
      .filter((b) => b.total > 0);
  });

  /** Every route (and graded boulder) matched by the query, in search order (issue #237) */
  const routeRows = $derived.by(() =>
    entries
      .map(([slug, data]) => {
        const feature = data as OsmFeature;
        const type = featureToType(feature);
        const isRoute = type === "route" || (type === "area" && feature.tags?.climbing === "boulder");
        if (!isRoute) return undefined;
        const parsed = getGrade(feature.tags ?? {});
        return {
          slug,
          name: getLocalizedName(feature) || "Unnamed",
          grade: parsed && parsed.v.scale !== "unknown" ? parsed.v.v : undefined,
          url: getItemUrl(getParentSlug(slug) ?? "", feature),
        };
      })
      .filter((row) => row !== undefined),
  );

  // Virtual list windowing: only the visible rows are rendered
  let scrollTop = $state(0);
  const visibleCount = $derived(Math.ceil(LIST_VIEWPORT / ROW_HEIGHT) + 2);
  const firstVisible = $derived(Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - 1));

  // Back button, like the settings page: return to the page the user came from
  afterNavigate((navigation) => {
    const from = navigation.from?.url;
    if (from && !from.pathname.startsWith(resolve("/explore"))) {
      try {
        sessionStorage.setItem(RETURN_STORAGE_KEY, from.pathname + from.search);
      } catch {
        // Session storage unavailable: the back button falls back to the map
      }
    }
  });

  function goBack() {
    let target: string | null = null;
    try {
      target = sessionStorage.getItem(RETURN_STORAGE_KEY);
    } catch {
      // Session storage unavailable: fall back to the map
    }
    void goto(target ?? resolve("world"));
  }

  const maxGradeCount = $derived(Math.max(1, ...stats.gradeDistribution.map((b) => b.total)));
  const maxSimpleCount = $derived(
    Math.max(1, ...(selectedPlot === "styles" ? stylePlot : lengthPlot).map((b) => b.total)),
  );
  const simplePlot = $derived(selectedPlot === "styles" ? stylePlot : lengthPlot);
  const chartPadding = { top: 14, right: 10, bottom: 28, left: 30 };
</script>

<svelte:head>
  <title>{pageTitle("Explore search results")}</title>
  <meta name="description" content="Overview plots of the current search results." />
</svelte:head>

<div class="mx-auto flex w-full max-w-3xl flex-col gap-4 p-4 text-sm">
  <div class="flex items-center justify-between gap-2">
    <h1 class="text-lg font-medium">Explore search results</h1>
    <Button variant="ghost" onclick={goBack}>
      <span class="icon-[lucide--arrow-left] shrink-0 size-4"></span>
      Back
    </Button>
  </div>

  {#if !searchState.active}
    <p class="text-muted-foreground">No search is active. Set a search or filters from the sidebar first.</p>
  {:else if searchState.result === undefined}
    <p class="text-muted-foreground">
      {localDb.ready
        ? "No results"
        : "Searching everywhere needs all the data. Open an area first, or download everything in the sidebar."}
    </p>
  {:else}
    <div class="flex flex-wrap items-center gap-x-3 gap-y-1">
      <span class="font-semibold">{searchState.result.matches.size} matches</span>
      {#if searchState.result.status === "searching"}
        <span class="text-xs text-muted-foreground">Searching...</span>
      {:else if searchState.result.status === "paused"}
        <span class="text-xs text-muted-foreground">Paused — continue from the sidebar to load more.</span>
      {/if}
    </div>

    {#if stats.total > 0}
      <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        {#each stats.typeDistribution as entry (entry.style)}
          <span class="inline-flex items-center gap-1.5">
            <span class="size-2.5 rounded-xs" style:background-color={entry.color}></span>
            <span class="text-muted-foreground">{entry.label}:</span>
            <span class="font-medium">{entry.count}</span>
          </span>
        {/each}
        {#if stats.ungraded > 0}
          <span class="text-muted-foreground">{stats.ungraded} ungraded</span>
        {/if}
      </div>

      <Select aria-label="Choose a plot" class="w-56" bind:value={selectedPlot}>
        <option value="difficulty">Difficulty distribution</option>
        <option value="styles">Climbing styles</option>
        <option value="lengths">Route lengths</option>
      </Select>

      {#if selectedPlot === "difficulty" && stats.gradeDistribution.length > 0}
        <div class="h-[240px] w-full overflow-x-auto">
          <div class="h-full" style:min-width="{Math.max(320, stats.gradeDistribution.length * 28)}px">
            <Chart
              data={stats.gradeDistribution}
              height={240}
              x="grade"
              y="total"
              xScale={scaleBand().padding(0.22)}
              yScale={scaleLinear()}
              yDomain={[0, maxGradeCount]}
              padding={chartPadding}
            >
              {#snippet children({ context })}
                <Layer>
                  <Axis placement="left" ticks={Math.min(4, maxGradeCount)} grid rule />
                  <Axis placement="bottom" rule />
                  {#each stats.gradeDistribution as bucket (bucket.grade)}
                    {@const x = context.xScale(bucket.grade) ?? 0}
                    {@const bw = context.xScale.bandwidth?.() ?? 16}
                    {#each STAT_STYLE_ORDER as style (style)}
                      {@const count = bucket.byStyle[style] ?? 0}
                      {#if count > 0}
                        {@const y1 = context.yScale(bucket.total)}
                        {@const y0 = context.yScale(bucket.total - count)}
                        <Rect
                          {x}
                          y={y0}
                          width={bw}
                          height={Math.max(1, y1 - y0)}
                          fill={STAT_STYLE_COLORS[style]}
                          rx={1}
                        />
                      {/if}
                    {/each}
                    <Text
                      x={x + bw / 2}
                      y={context.yScale(bucket.total) - 4}
                      textAnchor="middle"
                      fontSize={10}
                      value={String(bucket.total)}
                      class="fill-muted-foreground"
                    />
                  {/each}
                </Layer>
              {/snippet}
            </Chart>
          </div>
        </div>
      {:else if selectedPlot !== "difficulty" && simplePlot.length > 0}
        <div class="h-[240px] w-full">
          <Chart
            data={simplePlot}
            height={240}
            x="label"
            y="total"
            xScale={scaleBand().padding(0.22)}
            yScale={scaleLinear()}
            yDomain={[0, maxSimpleCount]}
            padding={chartPadding}
          >
            {#snippet children({ context })}
              <Layer>
                <Axis placement="left" ticks={Math.min(4, maxSimpleCount)} grid rule />
                <Axis placement="bottom" rule />
                {#each simplePlot as bucket (bucket.label)}
                  {@const x = context.xScale(bucket.label) ?? 0}
                  {@const bw = context.xScale.bandwidth?.() ?? 16}
                  <Rect
                    {x}
                    y={context.yScale(bucket.total)}
                    width={bw}
                    height={Math.max(1, context.yScale(0) - context.yScale(bucket.total))}
                    fill="var(--primary)"
                    rx={1}
                  />
                  <Text
                    x={x + bw / 2}
                    y={context.yScale(bucket.total) - 4}
                    textAnchor="middle"
                    fontSize={10}
                    value={String(bucket.total)}
                    class="fill-muted-foreground"
                  />
                {/each}
              </Layer>
            {/snippet}
          </Chart>
        </div>
      {:else if selectedPlot !== "difficulty"}
        <p class="text-muted-foreground">No data for this plot.</p>
      {/if}
    {:else}
      <p class="text-muted-foreground">No climbing elements among the matches.</p>
    {/if}

    {#if routeRows.length > 0}
      <div class="flex flex-col gap-1">
        <p class="text-xs font-medium text-muted-foreground">{routeRows.length} routes in the results</p>
        <div
          class="overflow-y-auto rounded-md border"
          style:height="{LIST_VIEWPORT}px"
          onscroll={(e) => (scrollTop = (e.currentTarget as HTMLElement).scrollTop)}
        >
          <div style:height="{routeRows.length * ROW_HEIGHT}px" style:position="relative">
            <div style:position="absolute" style:top="{firstVisible * ROW_HEIGHT}px" class="flex w-full flex-col">
              {#each routeRows.slice(firstVisible, firstVisible + visibleCount) as row (row.slug)}
                <a
                  href={row.url}
                  class="flex items-center justify-between gap-2 border-b px-3 text-sm hover:bg-muted"
                  style:height="{ROW_HEIGHT}px"
                >
                  <span class="truncate">{row.name}</span>
                  <span class="shrink-0 text-xs text-muted-foreground">{row.grade ?? ""}</span>
                </a>
              {/each}
            </div>
          </div>
        </div>
      </div>
    {/if}
  {/if}
</div>
