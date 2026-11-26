<script lang="ts">
  import { Chart, Layer, Axis, Rect, Text } from "layerchart/svg";
  import { scaleBand, scaleLinear } from "d3-scale";
  import type { DataJSON } from "@bloknote/climbing-data-gen";
  import type { OsmFeature } from "osm-api";
  import { localDb } from "#lib/data/db/local-db.svelte.js";
  import { searchState } from "#lib/components/shell/sidebar/search-state.svelte.js";
  import { computeSectorStats, STAT_STYLE_COLORS, STAT_STYLE_ORDER } from "#lib/data/parse/sector-stats.js";
  import { gradingScales } from "#lib/data/grading-scales.svelte.js";
  import { pageTitle } from "#lib/page-title.js";
  import type { BoulderScaleId, RouteScaleId } from "@bloknote/holy-grade";

  /** How many matched elements are loaded for the overview charts (issue #214) */
  const OVERVIEW_LIMIT = 500;

  /** Matched elements loaded for the overview charts: refreshed while the search streams */
  let overview = $state.raw<Record<string, DataJSON>>({});
  $effect(() => {
    const matches = searchState.result?.matches;
    if (!localDb.ready || !matches || matches.size === 0) {
      overview = {};
      return;
    }
    const slugs = [...matches].slice(0, OVERVIEW_LIMIT);
    let cancelled = false;
    localDb
      .getElements(slugs)
      .then((res) => {
        if (!cancelled) overview = res;
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  });

  const stats = $derived(
    computeSectorStats(
      Object.values(overview).filter((f): f is OsmFeature => f.type !== "geographic"),
      {
        routeScale: gradingScales.effective("route") as RouteScaleId,
        boulderScale: gradingScales.effective("boulder") as BoulderScaleId,
      },
    ),
  );
  const maxGradeCount = $derived(Math.max(1, ...stats.gradeDistribution.map((b) => b.total)));
  const chartPadding = { top: 14, right: 10, bottom: 28, left: 30 };
</script>

<svelte:head>
  <title>{pageTitle("Explore search results")}</title>
  <meta name="description" content="Overview plots of the current search results." />
</svelte:head>

<div class="mx-auto flex w-full max-w-3xl flex-col gap-4 p-4 text-sm">
  <h1 class="text-lg font-medium">Explore search results</h1>

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

      {#if stats.gradeDistribution.length > 0}
        <div class="flex flex-col gap-1">
          <p class="text-xs font-medium text-muted-foreground">Difficulty distribution</p>
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
        </div>
      {/if}
      {#if searchState.result.matches.size > OVERVIEW_LIMIT}
        <p class="text-xs text-muted-foreground">Charts cover the first {OVERVIEW_LIMIT} matches.</p>
      {/if}
    {:else}
      <p class="text-muted-foreground">No climbing elements among the matches.</p>
    {/if}
  {/if}
</div>
