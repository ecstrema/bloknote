<script lang="ts">
  import { resolve } from "$app/paths";
  import { atproto } from "#lib/data/network/atproto.svelte.js";
  import { computeUserStats, type ClimbingGradeRef, type OsmElementRef } from "@bloknote/common";
  import type { OsmFeature } from "osm-api";
  import PendingSyncBadge from "#lib/components/pending-sync-badge.svelte";
  import { Chart, Layer, Axis, Rect, Text } from "layerchart/svg";
  import { scaleBand, scaleLinear } from "d3-scale";
  import { localDb } from "#lib/data/db/local-db.svelte.js";
  import { getGrade, getGradeReference } from "@bloknote/osm-climbing";
  import { extractRouteStyle } from "@bloknote/osm-climbing";
  import { Button } from "#components/ui/button/index.js";
  import { gradingScales } from "#lib/data/grading-scales.svelte.js";
  import { convertGrade, getReference, getScale, type ScaleId } from "@bloknote/holy-grade";
  import type { Grade } from "#lib/types.js";

  type ResolvedRef = { slug: string; name?: string; grade?: Grade; gradeRef?: number; style?: string };

  /**
   * Converts a grade to the single display scale of its discipline: the preferred scale, falling
   * back to the location-based and worldwide defaults (issue #188). Grades of disciplines without
   * a preference (ice, aid, danger) are kept as written.
   */
  function displayGrade(grade: Grade): Grade {
    if (grade.scale === "unknown") return grade;
    const scale = getScale(grade.scale);
    if (!scale || (scale.gradeType !== "route" && scale.gradeType !== "boulder" && scale.gradeType !== "viaFerrata")) {
      return grade;
    }
    const targetId = gradingScales.effective(scale.gradeType);
    if (targetId === grade.scale) return grade;
    const target = getScale(targetId);
    const converted = target ? convertGrade(grade.v, scale, target) : undefined;
    return converted && target ? { v: converted, scale: target.id } : grade;
  }

  /** Ticks and stars resolved against the local database: the route's slug, name, and grade */
  let resolvedRefs = $state<Record<string, ResolvedRef>>({});

  /** Ticks pointing at an OSM element: subject-less ticks (routes not on OSM yet) are excluded */
  const osmTicks = $derived(atproto.ticks.filter((t) => t.subject));

  const osmRefs = $derived([
    ...new Set([...osmTicks, ...atproto.stars].map((entry) => `${entry.subject!.type}-${entry.subject!.id}`)),
  ]);

  $effect(() => {
    const refs = osmRefs;
    if (!localDb.ready || refs.length === 0) return;
    void localDb.getByOsmRefs(refs).then((entries) => {
      resolvedRefs = Object.fromEntries(
        Object.entries(entries).map(([ref, entry]) => {
          const tags = "tags" in entry.data ? (entry.data.tags ?? {}) : {};
          return [
            ref,
            {
              slug: entry.slug,
              name: tags.name,
              grade: getGrade(tags)?.v,
              gradeRef: getGradeReference(tags),
              style: extractRouteStyle(tags),
            },
          ];
        }),
      );
    });
  });

  const refKey = (subject: OsmElementRef) => `${subject.type}-${subject.id}`;

  /** Grade of a tick's route in the display scale, resolved against the local database */
  function gradeLookup(subject: OsmElementRef): ClimbingGradeRef | undefined {
    const grade = resolvedRefs[refKey(subject)]?.grade;
    if (!grade || grade.scale === "unknown") return undefined;
    const displayed = displayGrade(grade);
    if (displayed.scale === "unknown") return undefined;
    return { scale: displayed.scale, value: displayed.v };
  }

  const stats = $derived(computeUserStats(atproto.ticks, gradeLookup));

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
    { label: "Pinkpoint", count: stats.byStyle.pinkpoint ?? 0, color: "#6366f1" },
    { label: "Hangdog", count: stats.byStyle.hangdog ?? 0, color: "#f59e0b" },
    { label: "Bailed", count: stats.byStyle.bailed ?? 0, color: "#ef4444" },
  ]);

  const maxStyleCount = $derived(Math.max(1, ...styleBars.map((b) => b.count)));
  const padding = { top: 14, right: 10, bottom: 24, left: 28 };

  /** Distinct climbing days grouped per month */
  const sessionMonths = $derived.by(() => {
    const months = new Map<string, Set<string>>();
    for (const tick of atproto.ticks) {
      if (!tick.climbedAt) continue;
      const day = tick.climbedAt.slice(0, 10);
      const days = months.get(day.slice(0, 7)) ?? months.set(day.slice(0, 7), new Set()).get(day.slice(0, 7))!;
      days.add(day);
    }
    return [...months.entries()]
      .map(([month, days]) => ({ month, sessions: days.size }))
      .sort((a, b) => a.month.localeCompare(b.month));
  });
  const sessionCount = $derived(sessionMonths.reduce((total, m) => total + m.sessions, 0));
  const routeCount = $derived(new Set(osmTicks.map((t) => refKey(t.subject!))).size);
  const maxSessions = $derived(Math.max(1, ...sessionMonths.map((m) => m.sessions)));

  /** Best clean send grade for each month, as a reference number for comparison */
  const maxGradePerMonth = $derived.by(() => {
    const months = new Map<string, { ref: number; grade: Grade }>();
    for (const tick of atproto.ticks) {
      if (tick.outcome === "attempt" || !tick.climbedAt || !tick.subject) continue;
      const info = resolvedRefs[refKey(tick.subject)];
      if (info?.gradeRef === undefined || !info.grade || info.grade.scale === "unknown") continue;
      const month = tick.climbedAt.slice(0, 7);
      const current = months.get(month);
      if (!current || info.gradeRef > current.ref)
        months.set(month, { ref: info.gradeRef, grade: displayGrade(info.grade) });
    }
    return [...months.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([month, entry]) => ({ month, ...entry }));
  });
  const maxGradeRef = $derived(Math.max(1, ...maxGradePerMonth.map((m) => m.ref)));

  /** Tries (attempts) per grade in the display scale: only meaningful when attempts are logged (issue #199) */
  const triesPerGrade = $derived.by(() => {
    const counts = new Map<string, { grade: string; count: number; ref: number }>();
    for (const tick of osmTicks) {
      if (tick.outcome !== "attempt") continue;
      const info = resolvedRefs[refKey(tick.subject!)];
      if (!info?.grade || info.grade.scale === "unknown") continue;
      const displayed = displayGrade(info.grade);
      if (displayed.scale === "unknown") continue;
      const ref = getReference(displayed.v, getScale(displayed.scale as ScaleId)!) ?? 0;
      const entry = counts.get(displayed.v) ?? { grade: displayed.v, count: 0, ref };
      entry.count += 1;
      counts.set(displayed.v, entry);
    }
    return [...counts.values()].sort((a, b) => a.ref - b.ref);
  });
  const maxTries = $derived(Math.max(1, ...triesPerGrade.map((g) => g.count)));

  /** Grade pyramid, filterable by route style */
  let pyramidType = $state("all");
  const pyramidTypes = $derived([
    "all",
    ...new Set(
      osmTicks.map((t) => resolvedRefs[refKey(t.subject!)]?.style).filter((style): style is string => !!style),
    ),
  ]);
  const pyramidStats = $derived(
    computeUserStats(
      pyramidType === "all"
        ? atproto.ticks
        : osmTicks.filter((t) => resolvedRefs[refKey(t.subject!)]?.style === pyramidType),
      gradeLookup,
    ),
  );
  const pyramidEntries = $derived(
    [...pyramidStats.pyramid].sort(
      (a, b) =>
        (getReference(a.grade, getScale(a.scale as ScaleId)!) ?? 0) -
        (getReference(b.grade, getScale(b.scale as ScaleId)!) ?? 0),
    ),
  );
  const maxPyramidCount = $derived(Math.max(1, ...pyramidEntries.map((e) => e.total)));
  const pyramidHeight = $derived(pyramidEntries.length * 26 + padding.top + padding.bottom);

  const monthLabel = (month: string) =>
    new Date(`${month}-01T00:00:00`).toLocaleDateString(undefined, { month: "short", year: "2-digit" });
</script>

{#if atproto.configured || atproto.ticks.length > 0 || atproto.stars.length > 0 || atproto.comments.length > 0 || atproto.ratings.length > 0}
  <section class="flex flex-col gap-4 border-t py-6">
    <div>
      <h2 class="font-medium">Your climbing stats</h2>
      <p class="mt-1 text-sm text-muted-foreground">
        {stats.totalTicks} ticks ({stats.totalSends} sends, {stats.totalAttempts} attempts) · {routeCount} routes ·
        {sessionCount} sessions · {atproto.stars.length} bookmarked · {atproto.comments.length} comments ·
        {atproto.ratings.length} ratings
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

    {#if pyramidEntries.length > 0}
      <div class="flex flex-col gap-2">
        <div class="flex flex-wrap items-center gap-1.5">
          <h3 class="text-xs font-semibold uppercase text-muted-foreground">Grade pyramid</h3>
          <div class="flex flex-wrap gap-1">
            {#each pyramidTypes as type (type)}
              <Button
                size="xs"
                variant={pyramidType === type ? "secondary" : "ghost"}
                class="h-6 capitalize"
                onclick={() => (pyramidType = type)}
              >
                {type}
              </Button>
            {/each}
          </div>
        </div>
        <div class="w-full max-w-md" style={`height: ${pyramidHeight}px`}>
          <Chart
            data={pyramidEntries}
            height={pyramidHeight}
            x="total"
            y="grade"
            xScale={scaleLinear()}
            yScale={scaleBand().padding(0.2)}
            xDomain={[0, maxPyramidCount]}
            {padding}
          >
            {#snippet children({ context })}
              <Layer>
                <Axis placement="bottom" ticks={Math.min(4, maxPyramidCount)} grid rule />
                {#each pyramidEntries as entry (entry.grade)}
                  {@const y = context.yScale(entry.grade) ?? 0}
                  {@const bh = context.yScale.bandwidth?.() ?? 16}
                  {@const wTotal = context.xScale(entry.total) - context.xScale(0)}
                  {@const wSends = context.xScale(entry.sends) - context.xScale(0)}
                  <Rect
                    x={context.xScale(0)}
                    {y}
                    width={Math.max(1, wTotal)}
                    height={bh}
                    fill="#f59e0b"
                    rx={2}
                    opacity={0.45}
                  />
                  <Rect x={context.xScale(0)} {y} width={Math.max(1, wSends)} height={bh} fill="#10b981" rx={2} />
                  <Text x={4} y={y + bh / 2} fontSize={10} dominantBaseline="middle" value={entry.grade} />
                {/each}
              </Layer>
            {/snippet}
          </Chart>
          <p class="mt-1 text-xs text-muted-foreground">
            <span class="inline-block size-2 rounded-sm bg-[#10b981] align-middle"></span> sends ·
            <span class="inline-block size-2 rounded-sm bg-[#f59e0b]/45 align-middle"></span> attempts
          </p>
        </div>
      </div>
    {/if}

    {#if maxGradePerMonth.length > 1}
      <div class="flex flex-col gap-2">
        <h3 class="text-xs font-semibold uppercase text-muted-foreground">Max grade climbed per month</h3>
        <div class="h-[160px] w-full max-w-md">
          <Chart
            data={maxGradePerMonth}
            height={160}
            x="month"
            y="ref"
            xScale={scaleBand().padding(0.28)}
            yScale={scaleLinear()}
            yDomain={[0, maxGradeRef]}
            {padding}
          >
            {#snippet children({ context })}
              <Layer>
                <Axis placement="left" ticks={Math.min(4, maxGradeRef)} grid rule />
                <Axis placement="bottom" rule format={(v: string) => monthLabel(v)} />
                {#each maxGradePerMonth as entry (entry.month)}
                  {@const x = context.xScale(entry.month) ?? 0}
                  {@const bw = context.xScale.bandwidth?.() ?? 20}
                  {@const yTop = context.yScale(entry.ref)}
                  {@const yBot = context.yScale(0)}
                  <Rect {x} y={yTop} width={bw} height={Math.max(1, yBot - yTop)} fill="#3b82f6" rx={2} />
                  <Text
                    x={x + bw / 2}
                    y={yTop - 4}
                    textAnchor="middle"
                    fontSize={10}
                    value={entry.grade.v}
                    class="fill-muted-foreground"
                  />
                {/each}
              </Layer>
            {/snippet}
          </Chart>
        </div>
      </div>
    {/if}

    {#if sessionMonths.length > 1}
      <div class="flex flex-col gap-2">
        <h3 class="text-xs font-semibold uppercase text-muted-foreground">Climbing sessions per month</h3>
        <div class="h-[160px] w-full max-w-md">
          <Chart
            data={sessionMonths}
            height={160}
            x="month"
            y="sessions"
            xScale={scaleBand().padding(0.28)}
            yScale={scaleLinear()}
            yDomain={[0, maxSessions]}
            {padding}
          >
            {#snippet children({ context })}
              <Layer>
                <Axis placement="left" ticks={Math.min(4, maxSessions)} grid rule />
                <Axis placement="bottom" rule format={(v: string) => monthLabel(v)} />
                {#each sessionMonths as entry (entry.month)}
                  {@const x = context.xScale(entry.month) ?? 0}
                  {@const bw = context.xScale.bandwidth?.() ?? 20}
                  {@const yTop = context.yScale(entry.sessions)}
                  {@const yBot = context.yScale(0)}
                  <Rect {x} y={yTop} width={bw} height={Math.max(1, yBot - yTop)} fill="#10b981" rx={2} />
                  <Text
                    x={x + bw / 2}
                    y={yTop - 4}
                    textAnchor="middle"
                    fontSize={10}
                    value={String(entry.sessions)}
                    class="fill-muted-foreground"
                  />
                {/each}
              </Layer>
            {/snippet}
          </Chart>
        </div>
      </div>
    {/if}

    {#if stats.totalAttempts > 0 && triesPerGrade.length > 0}
      <div class="flex flex-col gap-2">
        <h3 class="text-xs font-semibold uppercase text-muted-foreground">Tries per grade</h3>
        <div class="h-[160px] w-full max-w-md">
          <Chart
            data={triesPerGrade}
            height={160}
            x="grade"
            y="count"
            xScale={scaleBand().padding(0.28)}
            yScale={scaleLinear()}
            yDomain={[0, maxTries]}
            {padding}
          >
            {#snippet children({ context })}
              <Layer>
                <Axis placement="left" ticks={Math.min(4, maxTries)} grid rule />
                <Axis placement="bottom" rule />
                {#each triesPerGrade as entry (entry.grade)}
                  {@const x = context.xScale(entry.grade) ?? 0}
                  {@const bw = context.xScale.bandwidth?.() ?? 20}
                  {@const yTop = context.yScale(entry.count)}
                  {@const yBot = context.yScale(0)}
                  <Rect {x} y={yTop} width={bw} height={Math.max(1, yBot - yTop)} fill="#8b5cf6" rx={2} />
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
                {resolvedRefs[`${star.subject.type}-${star.subject.id}`]?.name ??
                  star.label ??
                  `${star.subject.type}/${star.subject.id}`}
              </a>
              {#if !star.uri}
                <PendingSyncBadge />
              {/if}
            </li>
          {/each}
        </ul>
      </div>
    {/if}
  </section>
{/if}
