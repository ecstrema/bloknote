<script lang="ts">
  import { browser, building } from "$app/env";
  import { Chart, Layer, Axis, Rect, Text } from "layerchart/svg";
  import { scaleBand, scaleLinear } from "d3-scale";
  import type { DataJSON } from "@bloknote/climbing-data-gen";
  import type { OsmFeature } from "osm-api";
  import { Button } from "#components/ui/button/index.js";
  import { getAppState } from "#lib/data/app-state.js";
  import { localDb } from "#lib/data/db/local-db.svelte.js";
  import { collectLoadedOsmNodes } from "#lib/data/parse/diagnostics.js";
  import {
    computeSectorStats,
    STAT_STYLE_COLORS,
    STAT_STYLE_LABELS,
    STAT_STYLE_ORDER,
    type GradeDistributionBucket,
  } from "#lib/data/parse/sector-stats.js";
  import {
    getPreferredBoulderGradingScale,
    getPreferredRouteGradingScale,
  } from "#components/shell/providers/settings.svelte.js";
  import type { DataTree } from "#lib/types.js";
  import Columns2Icon from "@lucide/svelte/icons/columns-2";
  import LayersIcon from "@lucide/svelte/icons/layers";

  const LAYOUT_KEY = "bloknote:sector-stats-layout";

  let { item, slug }: { item: DataTree; slug: string } = $props();

  const appState = getAppState();
  const preferredRouteScale = getPreferredRouteGradingScale();
  const preferredBoulderScale = getPreferredBoulderGradingScale();

  let layout = $state<"stacked" | "double">("stacked");
  let hoveredGrade = $state<GradeDistributionBucket>();
  let dbElements = $state.raw<Record<string, DataJSON>>({});

  $effect(() => {
    if (!browser) return;
    const saved = localStorage.getItem(LAYOUT_KEY);
    if (saved === "stacked" || saved === "double") layout = saved;
  });

  function setLayout(next: "stacked" | "double") {
    layout = next;
    if (browser) localStorage.setItem(LAYOUT_KEY, next);
  }

  $effect(() => {
    const targetSlug = slug;
    if (building || !localDb.ready) {
      dbElements = {};
      return;
    }
    let cancelled = false;
    localDb.getSubtreeElements(targetSlug, 5000).then((res) => {
      if (!cancelled) dbElements = res.data;
    });
    return () => {
      cancelled = true;
    };
  });

  const features = $derived.by(() => {
    const merged = new Map<string, OsmFeature>();
    for (const [entrySlug, data] of Object.entries(dbElements)) {
      if (data.type !== "geographic") merged.set(entrySlug, data);
    }
    for (const [entrySlug, feature] of collectLoadedOsmNodes(item, slug)) merged.set(entrySlug, feature);
    return [...merged.entries()].map(([entrySlug, feature]) => {
      const reactive = appState.tree.getReactiveNode(entrySlug)?.feature;
      return reactive && reactive.type !== "geographic" ? reactive : feature;
    });
  });

  const stats = $derived(
    computeSectorStats(features, {
      preferredRouteScale: preferredRouteScale.current,
      preferredBoulderScale: preferredBoulderScale.current,
    }),
  );

  const maxGradeCount = $derived(Math.max(1, ...stats.gradeDistribution.map((b) => b.total)));
  const maxTypeCount = $derived(Math.max(1, ...stats.typeDistribution.map((t) => t.count)));

  const stackedSegments = $derived.by(() =>
    stats.gradeDistribution.map((bucket) => {
      let y0 = 0;
      const segments = STAT_STYLE_ORDER.flatMap((style) => {
        const count = bucket.byStyle[style] ?? 0;
        if (count === 0) return [];
        const seg = { style, count, y0, y1: y0 + count, color: STAT_STYLE_COLORS[style] };
        y0 += count;
        return [seg];
      });
      return { ...bucket, segments };
    }),
  );

  const chartHeight = 190;
  const padding = { top: 14, right: 10, bottom: 28, left: 30 };
</script>

{#if stats.total > 0}
  <section class="flex flex-col gap-3 rounded-md border p-3.5" aria-label="Climbing statistics">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span class="text-sm font-semibold text-foreground">{stats.total} climbs</span>
        {#if stats.categories.route > 0}
          <span>{stats.categories.route} routes</span>
        {/if}
        {#if stats.categories.boulder > 0}
          <span>{stats.categories.boulder} boulders</span>
        {/if}
        {#if stats.categories.ice > 0}
          <span>{stats.categories.ice} ice</span>
        {/if}
        {#if stats.ungraded > 0}
          <span>{stats.ungraded} ungraded</span>
        {/if}
      </div>

      <div class="inline-flex rounded-md border p-0.5">
        <Button
          size="xs"
          variant={layout === "stacked" ? "secondary" : "ghost"}
          onclick={() => setLayout("stacked")}
          title="Single stacked distribution chart"
        >
          <LayersIcon />
          Stacked
        </Button>
        <Button
          size="xs"
          variant={layout === "double" ? "secondary" : "ghost"}
          onclick={() => setLayout("double")}
          title="Separate grade and type charts"
        >
          <Columns2Icon />
          Double
        </Button>
      </div>
    </div>

    <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
      {#each stats.typeDistribution as entry (entry.style)}
        <span class="inline-flex items-center gap-1.5">
          <span class="size-2.5 rounded-xs" style:background-color={entry.color}></span>
          <span class="text-muted-foreground">{entry.label}:</span>
          <span class="font-medium">{entry.count}</span>
        </span>
      {/each}
    </div>

    {#if layout === "stacked"}
      {@render gradeChart(true)}
      {#if hoveredGrade}
        <p class="text-xs text-muted-foreground">
          <span class="font-medium text-foreground">{hoveredGrade.grade}</span> ({hoveredGrade.total}):
          {STAT_STYLE_ORDER.filter((s) => (hoveredGrade?.byStyle[s] ?? 0) > 0)
            .map((s) => `${STAT_STYLE_LABELS[s]} ${hoveredGrade?.byStyle[s]}`)
            .join(", ")}
        </p>
      {/if}
    {:else}
      <div class="grid gap-4 lg:grid-cols-2">
        {#if stats.gradeDistribution.length > 0}
          <div class="flex flex-col gap-1">
            <p class="text-xs font-medium text-muted-foreground">Grade distribution</p>
            {@render gradeChart(false)}
          </div>
        {/if}

        <div class="flex flex-col gap-1">
          <p class="text-xs font-medium text-muted-foreground">Type distribution</p>
          <div class="h-[190px] w-full">
            <Chart
              data={stats.typeDistribution}
              height={chartHeight}
              x="label"
              y="count"
              xScale={scaleBand().padding(0.28)}
              yScale={scaleLinear()}
              yDomain={[0, maxTypeCount]}
              {padding}
            >
              {#snippet children({ context })}
                <Layer>
                  <Axis placement="left" ticks={Math.min(4, maxTypeCount)} grid rule />
                  <Axis placement="bottom" rule />
                  {#each stats.typeDistribution as entry (entry.style)}
                    {@const x = context.xScale(entry.label) ?? 0}
                    {@const bw = context.xScale.bandwidth?.() ?? 20}
                    {@const yTop = context.yScale(entry.count)}
                    {@const yBot = context.yScale(0)}
                    <Rect {x} y={yTop} width={bw} height={Math.max(1, yBot - yTop)} fill={entry.color} rx={2} />
                    <Text
                      x={x + bw / 2}
                      y={yTop - 4}
                      textAnchor="middle"
                      fontSize={10}
                      value={String(entry.count)}
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
  </section>
{/if}

{#snippet gradeChart(stacked: boolean)}
  {#if stats.gradeDistribution.length > 0}
    <div class="h-[190px] w-full overflow-x-auto">
      <div class="h-full" style:min-width="{Math.max(260, stats.gradeDistribution.length * 28)}px">
        <Chart
          data={stackedSegments}
          height={chartHeight}
          x="grade"
          y="total"
          xScale={scaleBand().padding(0.22)}
          yScale={scaleLinear()}
          yDomain={[0, maxGradeCount]}
          {padding}
        >
          {#snippet children({ context })}
            <Layer>
              <Axis placement="left" ticks={Math.min(4, maxGradeCount)} grid rule />
              <Axis placement="bottom" rule />
              {#each stackedSegments as bucket (bucket.grade)}
                {@const x = context.xScale(bucket.grade) ?? 0}
                {@const bw = context.xScale.bandwidth?.() ?? 16}
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <g
                  onpointerenter={() => (hoveredGrade = bucket)}
                  onpointerleave={() => {
                    if (hoveredGrade?.grade === bucket.grade) hoveredGrade = undefined;
                  }}
                >
                  {#if stacked}
                    {#each bucket.segments as seg (seg.style)}
                      {@const yTop = context.yScale(seg.y1)}
                      {@const yBot = context.yScale(seg.y0)}
                      <Rect {x} y={yTop} width={bw} height={Math.max(1, yBot - yTop)} fill={seg.color} rx={1} />
                    {/each}
                  {:else}
                    {@const yTop = context.yScale(bucket.total)}
                    {@const yBot = context.yScale(0)}
                    <Rect {x} y={yTop} width={bw} height={Math.max(1, yBot - yTop)} fill="var(--primary)" rx={2} />
                  {/if}
                  <Text
                    x={x + bw / 2}
                    y={context.yScale(bucket.total) - 4}
                    textAnchor="middle"
                    fontSize={10}
                    value={String(bucket.total)}
                    class="fill-muted-foreground"
                  />
                </g>
              {/each}
            </Layer>
          {/snippet}
        </Chart>
      </div>
    </div>
  {/if}
{/snippet}
