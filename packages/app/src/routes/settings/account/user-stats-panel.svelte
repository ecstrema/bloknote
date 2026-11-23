<script lang="ts">
  import { resolve } from "$app/paths";
  import { atproto } from "#lib/data/network/atproto.svelte.js";
  import { computeUserStats } from "@bloknote/common";
  import PendingSyncBadge from "#lib/components/pending-sync-badge.svelte";
  import { Chart, Layer, Axis, Rect, Text } from "layerchart/svg";
  import { scaleBand, scaleLinear } from "d3-scale";
  import { localDb } from "#lib/data/db/local-db.svelte.js";
  import { getGrade } from "#lib/data/parse/osm-tags.js";
  import HolyGrade from "#components/grade/holy-grade.svelte";
  import type { Grade } from "#lib/types.js";

  const stats = $derived(computeUserStats(atproto.ticks));

  /** Ticks and stars resolved against the local database: the route's slug, name, and grade */
  type ResolvedRef = { slug: string; name?: string; grade?: Grade };
  let resolvedRefs = $state<Record<string, ResolvedRef>>({});

  const osmRefs = $derived([
    ...new Set(
      [...atproto.ticks, ...atproto.stars].map((entry) => `${entry.subject.type}-${entry.subject.id}`),
    ),
  ]);

  $effect(() => {
    const refs = osmRefs;
    if (!localDb.ready || refs.length === 0) return;
    void localDb.getByOsmRefs(refs).then((entries) => {
      resolvedRefs = Object.fromEntries(
        Object.entries(entries).map(([ref, entry]) => {
          const tags = "tags" in entry.data ? (entry.data.tags ?? {}) : {};
          return [ref, { slug: entry.slug, name: tags.name, grade: getGrade(tags)?.v }];
        }),
      );
    });
  });

  function refHref(type: string, id: number): string {
    const resolved = resolvedRefs[`${type}-${id}`];
    return resolved
      ? resolve("/world/[...slug]", { slug: resolved.slug })
      : `${resolve("/world/[...slug]", { slug: "" })}?id=${type}-${id}`;
  }

  const styleBars = $derived([
    { label: "Onsight", count: stats.byStyle.onsight ?? 0, color: "#10b981" },
    { label: "Flash", count: stats.byStyle.flash ?? 0, color: "#06b6d4" },
    { label: "Redpoint", count: stats.byStyle.redpoint ?? 0, color: "#3b82f6" },
    { label: "Attempt", count: stats.byStyle.attempt ?? 0, color: "#f59e0b" },
  ]);

  const maxStyleCount = $derived(Math.max(1, ...styleBars.map((b) => b.count)));
  const padding = { top: 14, right: 10, bottom: 24, left: 28 };
</script>

{#if atproto.configured || atproto.ticks.length > 0 || atproto.stars.length > 0 || atproto.reviews.length > 0}
  <section class="flex flex-col gap-4 border-t py-6">
    <div>
      <h2 class="font-medium">Your climbing stats</h2>
      <p class="mt-1 text-sm text-muted-foreground">
        {stats.totalTicks} ticks ({stats.totalSends} sends, {stats.totalAttempts} attempts) · {atproto.stars.length}
        bookmarked · {atproto.reviews.length} comments
      </p>
    </div>

    {#if stats.totalTicks > 0}
      <div class="h-[160px] w-full max-w-md">
        <Chart
          data={styleBars}
          height={160}
          x="label"
          y="count"
          xScale={scaleBand().padding(0.28)}
          yScale={scaleLinear()}
          yDomain={[0, maxStyleCount]}
          {padding}
        >
          {#snippet children({ context })}
            <Layer>
              <Axis placement="left" ticks={Math.min(4, maxStyleCount)} grid rule />
              <Axis placement="bottom" rule />
              {#each styleBars as bar (bar.label)}
                {@const x = context.xScale(bar.label) ?? 0}
                {@const bw = context.xScale.bandwidth?.() ?? 20}
                {@const yTop = context.yScale(bar.count)}
                {@const yBot = context.yScale(0)}
                <Rect {x} y={yTop} width={bw} height={Math.max(1, yBot - yTop)} fill={bar.color} rx={2} />
                <Text
                  x={x + bw / 2}
                  y={yTop - 4}
                  textAnchor="middle"
                  fontSize={10}
                  value={String(bar.count)}
                  class="fill-muted-foreground"
                />
              {/each}
            </Layer>
          {/snippet}
        </Chart>
      </div>
    {/if}

    {#if atproto.stars.length > 0}
      <div>
        <h3 class="text-xs font-semibold uppercase text-muted-foreground">Bookmarked climbs</h3>
        <ul class="mt-1.5 flex flex-wrap gap-2 text-sm">
          {#each atproto.stars as star (star)}
            <li>
              <a
                href={refHref(star.subject.type, star.subject.id)}
                class="inline-flex rounded border px-2 py-0.5 text-xs hover:bg-muted"
              >
                {resolvedRefs[`${star.subject.type}-${star.subject.id}`]?.name
                  ?? star.label
                  ?? `${star.subject.type}/${star.subject.id}`}
              </a>
              {#if !star.uri}
                <PendingSyncBadge />
              {/if}
            </li>
          {/each}
        </ul>
      </div>
    {/if}

    {#if atproto.ticks.length > 0}
      <div>
        <h3 class="text-xs font-semibold uppercase text-muted-foreground">Recent ticks</h3>
        <ul class="mt-1.5 space-y-1 text-xs">
          {#each atproto.ticks.slice(0, 10) as tick (tick)}
            <li class="flex flex-wrap items-baseline gap-2">
              <a
                href={refHref(tick.subject.type, tick.subject.id)}
                class="font-medium underline underline-offset-2"
              >
                {resolvedRefs[`${tick.subject.type}-${tick.subject.id}`]?.name
                  ?? tick.label
                  ?? `${tick.subject.type}/${tick.subject.id}`}
              </a>
              {#if resolvedRefs[`${tick.subject.type}-${tick.subject.id}`]?.grade}
                <HolyGrade
                  class="text-xs font-semibold"
                  grade={resolvedRefs[`${tick.subject.type}-${tick.subject.id}`]!.grade}
                />
              {/if}
              <span class="rounded bg-muted px-1.5 py-0.5 capitalize">{tick.style}</span>
              <span class="text-muted-foreground">{new Date(tick.climbedAt).toLocaleDateString()}</span>
              {#if tick.comment}
                <span class="text-muted-foreground">— {tick.comment}</span>
              {/if}
              {#if !tick.uri}
                <PendingSyncBadge />
              {/if}
            </li>
          {/each}
        </ul>
      </div>
    {/if}
  </section>
{/if}
