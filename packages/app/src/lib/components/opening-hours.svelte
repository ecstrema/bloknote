<script lang="ts">
  import { Chart, Layer, Axis, Rect, Text } from "layerchart/svg";
  import { scaleBand, scaleLinear } from "d3-scale";
  import {
    applyOpeningHoursDrag,
    cloneWeekHours,
    DAYS,
    formatOpeningHours,
    formatTime,
    MIN_OPENING_DURATION,
    parseOpeningHours,
    snapMinutes,
    type OpeningHoursCoordinates,
    type OpeningHoursDrag,
    type WeekHours,
  } from "#lib/data/parse/opening-hours.js";

  let {
    value,
    coordinates,
    editable = false,
    onchangestart,
    onchange,
    onchangeend,
  }: {
    value: string;
    coordinates?: OpeningHoursCoordinates;
    editable?: boolean;
    onchangestart?: () => void;
    onchange?: (value: string | undefined) => void;
    onchangeend?: () => void;
  } = $props();

  const height = 190;
  const padding = $derived({ top: 4, right: editable ? 22 : 8, bottom: 22, left: 26 });

  let svgEl = $state<SVGSVGElement | undefined>(undefined);
  let drag = $state<OpeningHoursDrag | null>(null);
  let draftWeek = $state<WeekHours | null>(null);
  let lastEmitted: string | undefined;

  const trimmed = $derived(value.trim());
  const parsed = $derived(trimmed ? parseOpeningHours(trimmed, coordinates) : DAYS.map(() => []));
  const week = $derived(draftWeek ?? parsed);

  type DisplayedSegment = { start: number; end: number; source: "own" | "previous"; index: number };

  /** Ranges closing after midnight continue on the next day */
  const rows = $derived.by(() => {
    if (!week) return [];
    return week.map((_, day) => {
      const own: DisplayedSegment[] = week[day]!.map((r, index) => ({
        start: r.start,
        end: Math.min(r.end, 1440),
        source: "own",
        index,
      }));
      const previous: DisplayedSegment[] = week[(day + 6) % 7]!
        .filter((r) => r.end > 1440)
        .map((r) => ({ start: 0, end: r.end - 1440, source: "previous", index: -1 }));
      return [...own, ...previous].sort((a, b) => a.start - b.start);
    });
  });

  const flatData = $derived(
    rows.flatMap((segments, day) => segments.map((seg) => ({ ...seg, dayLabel: DAYS[day]! }))),
  );

  function emitWeek(next: WeekHours) {
    draftWeek = next;
    const formatted = formatOpeningHours(next);
    if (formatted !== lastEmitted) {
      lastEmitted = formatted;
      onchange?.(formatted);
    }
  }

  function beginInteraction(event: PointerEvent, state: OpeningHoursDrag) {
    if (!editable || !svgEl || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    svgEl.setPointerCapture(event.pointerId);
    lastEmitted = trimmed || undefined;
    drag = state;
    draftWeek = cloneWeekHours(state.initialWeek);
    onchangestart?.();
  }

  function endDrag() {
    if (!drag) return;
    drag = null;
    draftWeek = null;
    onchangeend?.();
  }

  function commitSingleEdit(mutate: (w: WeekHours) => void) {
    if (!editable || !week) return;
    const next = cloneWeekHours(week);
    mutate(next);
    onchangestart?.();
    onchange?.(formatOpeningHours(next));
    onchangeend?.();
  }

  function getLabelLayout(segments: DisplayedSegment[], idx: number, xPx: (minutes: number) => number) {
    const seg = segments[idx]!;
    const x1 = xPx(seg.start);
    const x2 = xPx(seg.end);
    const barW = x2 - x1;
    const fullLabel = `${formatTime(seg.start)}-${formatTime(seg.end)}`;
    const estW = fullLabel.length * 5.6;

    if (barW >= estW + 6) return { text: fullLabel, xPos: (x1 + x2) / 2, anchor: "middle" as const, inside: true };
    const nextX = idx < segments.length - 1 ? xPx(segments[idx + 1]!.start) : xPx(1440);
    if (nextX - x2 >= estW + 8) return { text: fullLabel, xPos: x2 + 4, anchor: "start" as const, inside: false };
    const prevX = idx > 0 ? xPx(segments[idx - 1]!.end) : xPx(0);
    if (x1 - prevX >= estW + 8) return { text: fullLabel, xPos: x1 - 4, anchor: "end" as const, inside: false };
    if (seg.start % 60 === 0 && seg.end % 60 === 0) {
      const compact = `${seg.start / 60}-${seg.end / 60}`;
      if (barW >= compact.length * 5.6 + 4) {
        return { text: compact, xPos: (x1 + x2) / 2, anchor: "middle" as const, inside: true };
      }
    }
    return null;
  }

  const isCopyTarget = (day: number) =>
    drag?.mode === "copy-day" && day >= Math.min(drag.sourceDay, drag.targetDay) && day <= Math.max(drag.sourceDay, drag.targetDay);
</script>

{#if week}
  <div class="w-full max-w-md select-none {editable ? 'touch-none' : ''}">
    <Chart
      data={flatData}
      x="start"
      y="dayLabel"
      xDomain={[0, 1440]}
      xScale={scaleLinear()}
      yDomain={[...DAYS]}
      yScale={scaleBand().paddingInner(0.2)}
      {padding}
      {height}
      aria-label="Opening hours: {value || 'None'}"
    >
      {#snippet children({ context })}
        {@const xPx = (minutes: number) => context.xScale(minutes)}
        {@const yBand = (day: number) => context.yScale(DAYS[day]!) ?? 0}
        {@const bandH = context.yScale.bandwidth?.() ?? 16}
        {@const pointerToCoords = (event: PointerEvent) => {
          const rect = svgEl!.getBoundingClientRect();
          const pxX = event.clientX - rect.left - padding.left;
          const pxY = event.clientY - rect.top - padding.top;
          const minutes = context.xScale.invert?.(pxX) ?? (pxX / Math.max(1, context.width)) * 1440;
          const day = Math.max(0, Math.min(6, Math.floor((pxY / Math.max(1, context.height)) * 7)));
          return { minutes, day };
        }}
        <Layer
          bind:ref={svgEl}
          role="img"
          aria-label="Opening hours: {value || 'None'}"
          onpointermove={(e) => {
            if (!drag || !svgEl) return;
            const { minutes, day } = pointerToCoords(e);
            if (drag.mode === "copy-day") drag.targetDay = day;
            emitWeek(applyOpeningHoursDrag(drag, minutes, day));
          }}
          onpointerup={endDrag}
          onpointercancel={endDrag}
        >
          <Axis
            placement="bottom"
            ticks={[0, 360, 720, 1080, 1440]}
            format={(v) => String(Number(v) / 60)}
            grid
            rule
            tickLength={3}
          />
          <Axis
            placement="left"
            rule={false}
            tickLength={0}
            classes={{ tickLabel: "text-[11px] fill-muted-foreground" }}
          />

          {#each rows as segments, day (day)}
            {@const yRow = yBand(day)}
            {@const copyHighlighted = isCopyTarget(day)}

            {#if editable}
              <!-- svelte-ignore a11y_no_static_element_interactions -->
              <g
                class="cursor-ns-resize"
                onpointerdown={(e) =>
                  week && beginInteraction(e, { mode: "copy-day", sourceDay: day, targetDay: day, initialWeek: cloneWeekHours(week) })}
              >
                <title>Drag vertically to copy {DAYS[day]} hours to other days</title>
                <rect x={-padding.left} y={yRow} width={padding.left} height={bandH} fill="transparent" />
              </g>
            {/if}

            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <Rect
              x={0}
              y={yRow}
              width={context.width}
              height={bandH}
              rx={3}
              class="{copyHighlighted ? 'fill-primary/15' : 'fill-muted/50'} {editable ? 'cursor-crosshair' : ''}"
              onpointerdown={(e) => {
                if (!editable || !week) return;
                const snapped = snapMinutes(pointerToCoords(e).minutes);
                const ranges = week[day]!;
                const prev = ranges.filter((r) => r.end <= snapped).at(-1);
                const next = ranges.find((r) => r.start >= snapped);
                const minStart = prev ? Math.min(prev.end, 1440) : 0;
                const maxEnd = next ? next.start : 1440;
                if (maxEnd - minStart < MIN_OPENING_DURATION) return;

                beginInteraction(e, {
                  mode: "create",
                  day,
                  initialWeek: cloneWeekHours(week),
                  anchorMinutes: Math.max(minStart, Math.min(maxEnd, snapped)),
                  minStart,
                  maxEnd,
                });
              }}
            />

            {#each segments as r, i (i)}
              {@const x1 = xPx(r.start)}
              {@const x2 = xPx(r.end)}
              {@const barW = Math.max(x2 - x1, 2)}
              {@const labelLayout = getLabelLayout(segments, i, xPx)}
              {@const canEditBar = editable && r.source === "own"}
              {@const startBarDrag = (e: PointerEvent, mode: "move" | "resize-start" | "resize-end") => {
                if (!editable || !week) return;
                const ranges = week[day]!;
                const target = ranges[r.index];
                if (!target) return;
                const minStart = r.index > 0 ? Math.min(ranges[r.index - 1]!.end, 1440) : 0;
                const maxEnd = r.index < ranges.length - 1 ? ranges[r.index + 1]!.start : 1440;
                const initialWeek = cloneWeekHours(week);

                if (mode === "move") {
                  beginInteraction(e, {
                    mode: "move",
                    day,
                    index: r.index,
                    initialWeek,
                    originMinutes: pointerToCoords(e).minutes,
                    initialStart: target.start,
                    initialEnd: Math.min(target.end, 1440),
                    minStart,
                    maxEnd,
                  });
                } else {
                  beginInteraction(e, { mode, day, index: r.index, initialWeek, minStart, maxEnd });
                }
              }}

              <g>
                <title>{DAYS[day]} {formatTime(r.start)}-{formatTime(r.end)}</title>
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <Rect
                  x={x1}
                  y={yRow}
                  width={barW}
                  height={bandH}
                  rx={3}
                  class="{r.source === 'previous' ? 'fill-primary/80' : 'fill-primary'} {canEditBar
                    ? 'cursor-grab active:cursor-grabbing'
                    : ''}"
                  onpointerdown={canEditBar ? (e) => startBarDrag(e, "move") : undefined}
                  ondblclick={canEditBar ? () => commitSingleEdit((w) => w[day]!.splice(r.index, 1)) : undefined}
                />

                {#if labelLayout}
                  <Text
                    x={labelLayout.xPos}
                    y={yRow + bandH / 2}
                    verticalAnchor="middle"
                    textAnchor={labelLayout.anchor}
                    fontSize={10}
                    value={labelLayout.text}
                    class="pointer-events-none {labelLayout.inside
                      ? 'fill-primary-foreground font-medium'
                      : 'fill-muted-foreground'}"
                  />
                {/if}

                {#if canEditBar}
                  {#if barW >= 18}
                    <line
                      x1={x1 + 3}
                      x2={x1 + 3}
                      y1={yRow + 4}
                      y2={yRow + bandH - 4}
                      stroke-width="1.2"
                      class="stroke-primary-foreground/60 pointer-events-none"
                    />
                    <line
                      x1={x2 - 3}
                      x2={x2 - 3}
                      y1={yRow + 4}
                      y2={yRow + bandH - 4}
                      stroke-width="1.2"
                      class="stroke-primary-foreground/60 pointer-events-none"
                    />
                  {/if}
                  <!-- svelte-ignore a11y_no_static_element_interactions -->
                  <rect
                    x={x1 - 3}
                    y={yRow}
                    width={6}
                    height={bandH}
                    fill="transparent"
                    class="cursor-ew-resize"
                    onpointerdown={(e) => startBarDrag(e, "resize-start")}
                  />
                  <!-- svelte-ignore a11y_no_static_element_interactions -->
                  <rect
                    x={x2 - 3}
                    y={yRow}
                    width={6}
                    height={bandH}
                    fill="transparent"
                    class="cursor-ew-resize"
                    onpointerdown={(e) => startBarDrag(e, "resize-end")}
                  />
                {/if}
              </g>
            {/each}

            {#if editable && week[day]!.length > 0}
              <g
                role="button"
                tabindex="0"
                aria-label="Clear {DAYS[day]}"
                class="cursor-pointer opacity-60 hover:opacity-100"
                onpointerdown={(e) => e.stopPropagation()}
                onclick={(e) => {
                  e.stopPropagation();
                  commitSingleEdit((w) => (w[day] = []));
                }}
                onkeydown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    commitSingleEdit((w) => (w[day] = []));
                  }
                }}
              >
                <title>Clear {DAYS[day]}</title>
                <rect x={context.width + 2} y={yRow} width={padding.right - 2} height={bandH} fill="transparent" />
                <text
                  x={context.width + padding.right / 2 + 1}
                  y={yRow + bandH / 2}
                  dominant-baseline="central"
                  text-anchor="middle"
                  font-size="13"
                  class="fill-muted-foreground hover:fill-destructive"
                >
                  ×
                </text>
              </g>
            {/if}
          {/each}
        </Layer>
      {/snippet}
    </Chart>
  </div>
{:else}
  <p class="text-sm">{value}</p>
{/if}
