<script lang="ts">
  import { resolve } from "$app/paths";
  import { atproto } from "#lib/data/network/atproto.svelte.js";
  import { CLEAN_ASCENT_STYLES, computeUserStats, type ClimbingGradeRef, type OsmElementRef } from "@bloknote/common";
  import {
    findOsmRecoveryCandidates,
    relinkOsmElement,
    type CandidateFeature,
    type GeoPoint,
    type RecoveryCandidate,
  } from "@bloknote/common";
  import { getFeature, getFeatureHistory, type OsmFeature, type OsmNode, type OsmRelation, type OsmWay } from "osm-api";
  import type { LocalTickEntry } from "#lib/data/network/atproto.svelte.js";
  import PendingSyncBadge from "#lib/components/pending-sync-badge.svelte";
  import { Chart, Layer, Axis, Rect, Text } from "layerchart/svg";
  import { scaleBand, scaleLinear } from "d3-scale";
  import { localDb } from "#lib/data/db/local-db.svelte.js";
  import { getCoordinates, getGrade, getGradeReference } from "#lib/data/parse/osm-tags.js";
  import { extractRouteStyle } from "#lib/data/parse/route-styles.js";
  import HolyGrade from "#components/grade/holy-grade.svelte";
  import { Button } from "#components/ui/button/index.js";
  import { getReference, getScale, type ScaleId } from "@bloknote/holy-grade";
  import type { Grade } from "#lib/types.js";

  type ResolvedRef = { slug: string; name?: string; grade?: Grade; gradeRef?: number; style?: string };

  /** Ticks and stars resolved against the local database: the route's slug, name, and grade */
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

  /** Grade of a tick's route, resolved against the local database */
  function gradeLookup(subject: OsmElementRef): ClimbingGradeRef | undefined {
    const grade = resolvedRefs[refKey(subject)]?.grade;
    if (!grade || grade.scale === "unknown") return undefined;
    return { scale: grade.scale, value: grade.v };
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
    { label: "Attempt", count: stats.byStyle.attempt ?? 0, color: "#f59e0b" },
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
  const routeCount = $derived(new Set(atproto.ticks.map((t) => refKey(t.subject))).size);
  const maxSessions = $derived(Math.max(1, ...sessionMonths.map((m) => m.sessions)));

  /** Best clean send grade for each month, as a reference number for comparison */
  const maxGradePerMonth = $derived.by(() => {
    const months = new Map<string, { ref: number; grade: Grade }>();
    for (const tick of atproto.ticks) {
      if (!CLEAN_ASCENT_STYLES.has(tick.style) || !tick.climbedAt) continue;
      const info = resolvedRefs[refKey(tick.subject)];
      if (info?.gradeRef === undefined || !info.grade || info.grade.scale === "unknown") continue;
      const month = tick.climbedAt.slice(0, 7);
      const current = months.get(month);
      if (!current || info.gradeRef > current.ref) months.set(month, { ref: info.gradeRef, grade: info.grade });
    }
    return [...months.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, entry]) => ({ month, ...entry }));
  });
  const maxGradeRef = $derived(Math.max(1, ...maxGradePerMonth.map((m) => m.ref)));

  /** Tick count per route: the number of tries on each climbed route */
  const triesPerRoute = $derived.by(() => {
    const counts = new Map<string, { name: string; count: number }>();
    for (const tick of atproto.ticks) {
      const key = refKey(tick.subject);
      const entry = counts.get(key) ?? { name: resolvedRefs[key]?.name ?? tick.label ?? key, count: 0 };
      entry.count += 1;
      counts.set(key, entry);
    }
    return [...counts.values()].sort((a, b) => b.count - a.count).slice(0, 8);
  });
  const maxTries = $derived(Math.max(1, ...triesPerRoute.map((r) => r.count)));

  /** Grade pyramid, filterable by route style */
  let pyramidType = $state("all");
  const pyramidTypes = $derived([
    "all",
    ...new Set(
      atproto.ticks
        .map((t) => resolvedRefs[refKey(t.subject)]?.style)
        .filter((style): style is string => !!style),
    ),
  ]);
  const pyramidStats = $derived(
    computeUserStats(
      pyramidType === "all"
        ? atproto.ticks
        : atproto.ticks.filter((t) => resolvedRefs[refKey(t.subject)]?.style === pyramidType),
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

  /**
   * Background checks for ticks whose route disappeared from the local dataset: the OSM element may
   * have been deleted or converted, in which case a replacement is proposed for relinking the tick.
   */
  type TickCheck =
    | { status: "checking" }
    | { status: "existsOsm" }
    | { status: "missing" }
    | { status: "suggestion"; candidate: RecoveryCandidate }
    | { status: "error"; message: string };
  let tickChecks = $state<Record<string, TickCheck>>({});

  function toCandidateFeature(feature: OsmFeature): CandidateFeature {
    const coordinates = getCoordinates(feature);
    return {
      type: feature.type,
      id: feature.id,
      name: feature.tags?.name,
      coordinates: coordinates ? { latitude: coordinates.lat, longitude: coordinates.lon } : undefined,
      grade: getGrade(feature.tags ?? {})?.v.v,
    };
  }

  /** Coordinates of a deleted element: nodes directly, ways through their first node (possibly also deleted) */
  async function deletedFeatureCoordinates(
    feature: OsmNode | OsmWay | OsmRelation,
  ): Promise<GeoPoint | undefined> {
    if (feature.type === "node") return { latitude: feature.lat, longitude: feature.lon };
    if (feature.type === "way" && feature.nodes.length > 0) {
      const nodeId = feature.nodes[0]!;
      try {
        const [node] = await getFeature("node", nodeId);
        return { latitude: node.lat, longitude: node.lon };
      } catch {
        const [node] = await getFeatureHistory("node", nodeId).then((history) => history.slice(-1));
        if (node) return { latitude: node.lat, longitude: node.lon };
      }
    }
    return undefined;
  }

  async function checkTick(tick: LocalTickEntry) {
    const key = refKey(tick.subject);
    if (!localDb.ready || tickChecks[key]?.status === "checking") return;
    tickChecks[key] = { status: "checking" };
    try {
      try {
        await getFeature(tick.subject.type, tick.subject.id);
        tickChecks[key] = { status: "existsOsm" };
        return;
      } catch {
        // The element is gone (or the request failed, which the history call will also report)
      }
      const history = await getFeatureHistory(tick.subject.type, tick.subject.id);
      const last = history.at(-1);
      const coordinates = last ? await deletedFeatureCoordinates(last) : undefined;
      if (!last || !coordinates) {
        tickChecks[key] = { status: "missing" };
        return;
      }
      const deleted = toCandidateFeature(last);
      deleted.id = tick.subject.id;
      deleted.coordinates = coordinates;
      const nearby = await localDb.getNearbyElements(coordinates.latitude, coordinates.longitude, 250);
      const candidates = findOsmRecoveryCandidates(
        deleted,
        nearby.map((c) => ({
          type: c.type,
          id: c.id,
          name: c.name,
          coordinates:
            c.latitude !== undefined && c.longitude !== undefined
              ? { latitude: c.latitude, longitude: c.longitude }
              : undefined,
          grade: c.grade,
        })),
        { maxDistanceMeters: 250 },
      );
      const top = candidates[0];
      tickChecks[key] = top && top.confidence >= 0.5 ? { status: "suggestion", candidate: top } : { status: "missing" };
    } catch (error) {
      tickChecks[key] = { status: "error", message: error instanceof Error ? error.message : String(error) };
    }
  }

  async function relinkTick(tick: LocalTickEntry, candidate: RecoveryCandidate) {
    await atproto.relinkTick(tick, relinkOsmElement(candidate.feature));
    delete tickChecks[refKey(tick.subject)];
  }
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

    {#if triesPerRoute.length > 0}
      {@const triesHeight = triesPerRoute.length * 26 + padding.top + padding.bottom}
      <div class="flex flex-col gap-2">
        <h3 class="text-xs font-semibold uppercase text-muted-foreground">Tries per route</h3>
        <div class="w-full max-w-md" style={`height: ${triesHeight}px`}>
          <Chart
            data={triesPerRoute}
            height={triesHeight}
            x="count"
            y="name"
            xScale={scaleLinear()}
            yScale={scaleBand().padding(0.2)}
            xDomain={[0, maxTries]}
            {padding}
          >
            {#snippet children({ context })}
              <Layer>
                <Axis placement="bottom" ticks={Math.min(4, maxTries)} grid rule />
                {#each triesPerRoute as entry (entry.name)}
                  {@const y = context.yScale(entry.name) ?? 0}
                  {@const bh = context.yScale.bandwidth?.() ?? 16}
                  {@const w = context.xScale(entry.count) - context.xScale(0)}
                  <Rect x={context.xScale(0)} {y} width={Math.max(1, w)} height={bh} fill="#8b5cf6" rx={2} />
                  <Text x={4} y={y + bh / 2} fontSize={10} dominantBaseline="middle" value={entry.name} />
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
              {#if localDb.ready && !resolvedRefs[refKey(tick.subject)]}
                <button
                  type="button"
                  class="text-muted-foreground hover:text-foreground"
                  title="Check what happened to this route on OpenStreetMap"
                  onclick={() => checkTick(tick)}
                >
                  <span class="icon-[lucide--search] size-3.5"></span>
                </button>
                {#if tickChecks[refKey(tick.subject)]}
                  {@render tickCheckStatus(tickChecks[refKey(tick.subject)]!, tick)}
                {/if}
              {/if}
            </li>
          {/each}
        </ul>
      </div>
    {/if}
  </section>
{/if}

{#snippet tickCheckStatus(check: TickCheck, tick: LocalTickEntry)}
  <span class="basis-full text-xs text-muted-foreground">
    {#if check.status === "checking"}
      Checking OpenStreetMap…
    {:else if check.status === "existsOsm"}
      The route still exists on OpenStreetMap but is missing from the climbing data.
    {:else if check.status === "missing"}
      The route was deleted from OpenStreetMap and no replacement was found nearby.
    {:else if check.status === "error"}
      {check.message}
    {:else if check.status === "suggestion"}
      Replacement found: {check.candidate.feature.name ?? `${check.candidate.feature.type}/${check.candidate.feature.id}`}
      ({Math.round(check.candidate.confidence * 100)}% match)
      <Button size="xs" variant="outline" onclick={() => relinkTick(tick, check.candidate)}>Relink tick</Button>
    {/if}
  </span>
{/snippet}
