<script lang="ts">
  import { building } from "$app/env";
  import { Chart, Layer, Axis, Rect, Text } from "layerchart/svg";
  import { scaleBand, scaleLinear } from "d3-scale";
  import type { DataJSON } from "@bloknote/climbing-data-gen";
  import type { OsmFeature } from "osm-api";
  import { getAppState } from "#lib/data/app-state.js";
  import { localDb } from "#lib/data/db/local-db.svelte.js";
  import { collectLoadedOsmNodes } from "#lib/data/parse/diagnostics.js";
  import { computePulseStats, formatAge, type RecencyBucket } from "#lib/data/parse/pulse.js";
  import { getLocalizedName } from "#lib/data/parse/localized-name.js";
  import { getParentSlug } from "#lib/helpers/slug.js";
  import { getItemUrl } from "#components/shell/sidebar/utils.js";
  import type { DataTree } from "#lib/types.js";
    
  let { item, slug }: { item: DataTree; slug: string } = $props();

  const appState = getAppState();

  let dbElements = $state.raw<Record<string, DataJSON>>({});
  let loadingSubtree = $state(false);
  let now = $state(Date.now());

  $effect(() => {
    const targetSlug = slug;
    if (building || !localDb.ready) {
      dbElements = {};
      loadingSubtree = false;
      return;
    }
    let cancelled = false;
    loadingSubtree = true;
    localDb
      .getSubtreeElements(targetSlug, 5000)
      .then((res) => {
        if (cancelled) return;
        dbElements = res.data;
      })
      .finally(() => {
        if (!cancelled) loadingSubtree = false;
      });
    return () => {
      cancelled = true;
    };
  });

  // Keep the relative "X ago" labels fresh
  $effect(() => {
    const timer = setInterval(() => (now = Date.now()), 60_000);
    return () => clearInterval(timer);
  });

  const entries = $derived.by(() => {
    const merged = new Map<string, OsmFeature>();
    for (const [entrySlug, data] of Object.entries(dbElements)) {
      if (data.type !== "geographic") merged.set(entrySlug, data);
    }
    for (const [entrySlug, feature] of collectLoadedOsmNodes(item, slug)) merged.set(entrySlug, feature);
    return [...merged.entries()].map(([entrySlug, feature]) => {
      const reactive = appState.tree.getReactiveNode(entrySlug)?.feature;
      return { slug: entrySlug, feature: reactive && reactive.type !== "geographic" ? reactive : feature };
    });
  });

  const stats = $derived(
    computePulseStats(
      entries.map((e) => e.feature),
      now,
    ),
  );

  const recentEntries = $derived.by(() =>
    entries
      .map((entry) => ({ ...entry, ts: entry.feature.timestamp ? Date.parse(entry.feature.timestamp) : NaN }))
      .filter((entry) => Number.isFinite(entry.ts))
      .sort((a, b) => b.ts - a.ts)
      .slice(0, 6),
  );

  const maxYearCount = $derived(Math.max(1, ...stats.editsPerYear.map((e) => e.count)));
  const maxBucketCount = $derived(Math.max(1, ...stats.recencyDistribution.map((b) => b.count)));

  function bucketColor(bucket: RecencyBucket): string {
    const index = stats.recencyDistribution.indexOf(bucket);
    return `var(--chart-${Math.max(1, 5 - index)})`;
  }

  function formatDate(ts: number): string {
    return new Date(ts).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  }

  function entryHref(entrySlug: string, feature: OsmFeature): string {
    return getItemUrl(getParentSlug(entrySlug) ?? "", feature);
  }

  const chartHeight = 190;
  const padding = { top: 14, right: 10, bottom: 28, left: 30 };
</script>

<div class="flex flex-col gap-4">
  {#if loadingSubtree}
    <div class="flex items-center gap-2 rounded-md border p-4 text-sm text-muted-foreground">
      <span aria-hidden="true"  class="icon-[lucide--loader-circle] shrink-0 size-4 animate-spin"></span>
      <span>Loading edit history…</span>
    </div>
  {:else if stats.total === 0}
    <div class="flex items-center gap-2 rounded-md border p-4 text-sm text-muted-foreground">
      <span aria-hidden="true"  class="icon-[lucide--activity] shrink-0 size-4"></span>
      <span>
        {#if stats.untimed > 0}
          This item has no OSM edit timestamp yet (it has not been uploaded to OpenStreetMap).
        {:else}
          No OSM edit timestamps available.
        {/if}
      </span>
    </div>
  {:else}
    <section class="flex flex-col gap-3 rounded-md border p-3.5" aria-label="Edit statistics">
      <div class="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
        <span class="inline-flex items-center gap-1.5">
          <span class="size-2.5 rounded-full bg-emerald-600" aria-hidden="true"></span>
          <span class="text-muted-foreground">Last edit</span>
          <span class="font-medium">{formatAge(stats.lastEditAgeMs!)}</span>
        </span>
        <span class="inline-flex items-center gap-1.5">
          <span class="text-muted-foreground">Median edit age</span>
          <span class="font-medium">{formatAge(stats.medianAgeMs!)}</span>
        </span>
        <span class="inline-flex items-center gap-1.5">
          <span class="text-muted-foreground">Oldest edit</span>
          <span class="font-medium">{formatAge(stats.oldestEditAgeMs!)}</span>
        </span>
        <span class="text-xs text-muted-foreground">
          {stats.total} item{stats.total === 1 ? "" : "s"}{stats.untimed > 0
            ? ` (+${stats.untimed} without timestamp)`
            : ""}
        </span>
      </div>

      <div class="grid gap-4 xl:grid-cols-2">
        {#if stats.editsPerYear.length > 0}
          <div class="flex min-w-0 flex-col gap-1">
            <p class="text-xs font-medium text-muted-foreground">Last edits per year</p>
            <div class="h-[190px] w-full overflow-x-auto">
              <div class="h-full" style:min-width="{Math.max(240, stats.editsPerYear.length * 34)}px">
                <Chart
                  data={stats.editsPerYear}
                  height={chartHeight}
                  x="year"
                  y="count"
                  xScale={scaleBand().padding(0.22)}
                  yScale={scaleLinear()}
                  yDomain={[0, maxYearCount]}
                  {padding}
                >
                  {#snippet children({ context })}
                    <Layer>
                      <Axis placement="left" ticks={Math.min(4, maxYearCount)} grid rule />
                      <Axis placement="bottom" rule />
                      {#each stats.editsPerYear as entry (entry.year)}
                        {@const x = context.xScale(entry.year) ?? 0}
                        {@const bw = context.xScale.bandwidth?.() ?? 20}
                        {@const yTop = context.yScale(entry.count)}
                        {@const yBot = context.yScale(0)}
                        <Rect {x} y={yTop} width={bw} height={Math.max(1, yBot - yTop)} fill="var(--chart-2)" rx={2} />
                        {#if entry.count > 0}
                          <Text
                            x={x + bw / 2}
                            y={yTop - 4}
                            textAnchor="middle"
                            fontSize={10}
                            value={String(entry.count)}
                            class="fill-muted-foreground"
                          />
                        {/if}
                      {/each}
                    </Layer>
                  {/snippet}
                </Chart>
              </div>
            </div>
          </div>
        {/if}

        <div class="flex flex-col gap-1">
          <p class="text-xs font-medium text-muted-foreground">How stale is the mapping?</p>
          <div class="h-[190px] w-full">
            <Chart
              data={stats.recencyDistribution}
              height={chartHeight}
              x="label"
              y="count"
              xScale={scaleBand().padding(0.22)}
              yScale={scaleLinear()}
              yDomain={[0, maxBucketCount]}
              {padding}
            >
              {#snippet children({ context })}
                <Layer>
                  <Axis placement="left" ticks={Math.min(4, maxBucketCount)} grid rule />
                  <Axis placement="bottom" rule />
                  {#each stats.recencyDistribution as bucket (bucket.key)}
                    {@const x = context.xScale(bucket.label) ?? 0}
                    {@const bw = context.xScale.bandwidth?.() ?? 20}
                    {@const yTop = context.yScale(bucket.count)}
                    {@const yBot = context.yScale(0)}
                    <Rect {x} y={yTop} width={bw} height={Math.max(1, yBot - yTop)} fill={bucketColor(bucket)} rx={2} />
                    {#if bucket.count > 0}
                      <Text
                        x={x + bw / 2}
                        y={yTop - 4}
                        textAnchor="middle"
                        fontSize={10}
                        value={String(bucket.count)}
                        class="fill-muted-foreground"
                      />
                    {/if}
                  {/each}
                </Layer>
              {/snippet}
            </Chart>
          </div>
        </div>
      </div>
    </section>

    {#if recentEntries.length > 0}
      <section class="flex flex-col gap-2 rounded-md border p-3.5" aria-label="Recently edited items">
        <p class="text-xs font-medium text-muted-foreground">Recently edited</p>
        <ul class="flex flex-col gap-1.5">
          {#each recentEntries as entry (entry.slug)}
            {@const name = getLocalizedName(entry.feature) || "Unnamed"}
            <li class="flex flex-wrap items-center justify-between gap-2 text-sm">
              <a href={entryHref(entry.slug, entry.feature)} class="underline underline-offset-2 hover:text-foreground">
                {name}
              </a>
              <span class="text-xs text-muted-foreground">
                {formatDate(entry.ts)} · {formatAge(now - entry.ts)}
              </span>
            </li>
          {/each}
        </ul>
      </section>
    {/if}
  {/if}
</div>
