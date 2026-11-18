<script lang="ts">
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

  const width = 240;
  const rowHeight = 15;
  const labelWidth = 20;
  const rightPad = 12;
  const chartWidth = width - labelWidth - rightPad;
  const svgHeight = rowHeight * 7 + 12;
  const x = (minutes: number) => labelWidth + (minutes / 1440) * chartWidth;

  let svgEl = $state<SVGSVGElement | null>(null);
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

  function pointerToCoords(event: PointerEvent) {
    const rect = svgEl!.getBoundingClientRect();
    const svgX = ((event.clientX - rect.left) / rect.width) * width;
    const svgY = ((event.clientY - rect.top) / rect.height) * svgHeight;
    return {
      minutes: ((svgX - labelWidth) / chartWidth) * 1440,
      day: Math.max(0, Math.min(6, Math.floor(svgY / rowHeight))),
    };
  }

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

  function onTrackPointerDown(event: PointerEvent, day: number) {
    if (!editable || !week) return;
    const snapped = snapMinutes(pointerToCoords(event).minutes);
    const ranges = week[day]!;
    const prev = ranges.filter((r) => r.end <= snapped).at(-1);
    const next = ranges.find((r) => r.start >= snapped);
    const minStart = prev ? Math.min(prev.end, 1440) : 0;
    const maxEnd = next ? next.start : 1440;
    if (maxEnd - minStart < MIN_OPENING_DURATION) return;

    beginInteraction(event, {
      mode: "create",
      day,
      initialWeek: cloneWeekHours(week),
      anchorMinutes: Math.max(minStart, Math.min(maxEnd, snapped)),
      minStart,
      maxEnd,
    });
  }

  function onBarPointerDown(event: PointerEvent, day: number, index: number, mode: "move" | "resize-start" | "resize-end") {
    if (!editable || !week) return;
    const ranges = week[day]!;
    const target = ranges[index];
    if (!target) return;
    const minStart = index > 0 ? Math.min(ranges[index - 1]!.end, 1440) : 0;
    const maxEnd = index < ranges.length - 1 ? ranges[index + 1]!.start : 1440;
    const initialWeek = cloneWeekHours(week);

    if (mode === "move") {
      beginInteraction(event, {
        mode: "move",
        day,
        index,
        initialWeek,
        originMinutes: pointerToCoords(event).minutes,
        initialStart: target.start,
        initialEnd: Math.min(target.end, 1440),
        minStart,
        maxEnd,
      });
    } else {
      beginInteraction(event, { mode, day, index, initialWeek, minStart, maxEnd });
    }
  }

  function onSvgPointerMove(event: PointerEvent) {
    if (!drag || !svgEl) return;
    const { minutes, day } = pointerToCoords(event);
    if (drag.mode === "copy-day") drag.targetDay = day;
    emitWeek(applyOpeningHoursDrag(drag, minutes, day));
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

  function getLabelLayout(segments: DisplayedSegment[], idx: number) {
    const seg = segments[idx]!;
    const x1 = x(seg.start);
    const x2 = x(seg.end);
    const barW = x2 - x1;
    const fullLabel = `${formatTime(seg.start)}-${formatTime(seg.end)}`;
    const estW = fullLabel.length * 3.15;

    if (barW >= estW + 3) return { text: fullLabel, xPos: (x1 + x2) / 2, anchor: "middle" as const, inside: true };
    const nextX = idx < segments.length - 1 ? x(segments[idx + 1]!.start) : x(1440);
    if (nextX - x2 >= estW + 4) return { text: fullLabel, xPos: x2 + 2, anchor: "start" as const, inside: false };
    const prevX = idx > 0 ? x(segments[idx - 1]!.end) : x(0);
    if (x1 - prevX >= estW + 4) return { text: fullLabel, xPos: x1 - 2, anchor: "end" as const, inside: false };
    if (seg.start % 60 === 0 && seg.end % 60 === 0) {
      const compact = `${seg.start / 60}-${seg.end / 60}`;
      if (barW >= compact.length * 3.2 + 2) {
        return { text: compact, xPos: (x1 + x2) / 2, anchor: "middle" as const, inside: true };
      }
    }
    return null;
  }

  const isCopyTarget = (day: number) =>
    drag?.mode === "copy-day" && day >= Math.min(drag.sourceDay, drag.targetDay) && day <= Math.max(drag.sourceDay, drag.targetDay);
</script>

{#if week}
  <svg
    bind:this={svgEl}
    viewBox="0 0 {width} {svgHeight}"
    class="w-full max-w-md text-xs select-none {editable ? 'touch-none' : ''}"
    role="img"
    aria-label="Opening hours: {value || 'None'}"
    onpointermove={onSvgPointerMove}
    onpointerup={endDrag}
    onpointercancel={endDrag}
  >
    {#each rows as segments, day (day)}
      {@const yRow = day * rowHeight + 1.5}
      {@const barH = rowHeight - 3}
      {@const copyHighlighted = isCopyTarget(day)}

      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <g
        class={editable ? "cursor-ns-resize" : undefined}
        onpointerdown={(e) =>
          week && beginInteraction(e, { mode: "copy-day", sourceDay: day, targetDay: day, initialWeek: cloneWeekHours(week) })}
      >
        <rect x="0" y={yRow} width={labelWidth} height={barH} fill="transparent">
          {#if editable}
            <title>Drag vertically to copy {DAYS[day]} hours to other days</title>
          {/if}
        </rect>
        <text
          x="1"
          y={day * rowHeight + 9.5}
          class={copyHighlighted ? "fill-primary font-semibold pointer-events-none" : "fill-muted-foreground pointer-events-none"}
          font-size="6.5"
        >
          {DAYS[day]}
        </text>
      </g>

      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <rect
        x={labelWidth}
        y={yRow}
        width={chartWidth}
        height={barH}
        rx="2"
        class="{copyHighlighted ? 'fill-primary/15' : 'fill-muted/50'} {editable ? 'cursor-crosshair' : ''}"
        onpointerdown={(e) => onTrackPointerDown(e, day)}
      />

      {#each segments as r, i (i)}
        {@const x1 = x(r.start)}
        {@const x2 = x(r.end)}
        {@const barW = Math.max(x2 - x1, 1)}
        {@const labelLayout = getLabelLayout(segments, i)}
        {@const canEditBar = editable && r.source === "own"}

        <g>
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <rect
            x={x1}
            y={yRow}
            width={barW}
            height={barH}
            rx="2"
            class="{r.source === 'previous' ? 'fill-primary/80' : 'fill-primary'} {canEditBar
              ? 'cursor-grab active:cursor-grabbing'
              : ''}"
            onpointerdown={canEditBar ? (e) => onBarPointerDown(e, day, r.index, "move") : undefined}
            ondblclick={canEditBar ? () => commitSingleEdit((w) => w[day]!.splice(r.index, 1)) : undefined}
          >
            <title>{DAYS[day]} {formatTime(r.start)}-{formatTime(r.end)}</title>
          </rect>

          {#if labelLayout}
            <text
              x={labelLayout.xPos}
              y={day * rowHeight + 9.4}
              text-anchor={labelLayout.anchor}
              font-size="5.5"
              class="pointer-events-none {labelLayout.inside
                ? 'fill-primary-foreground font-medium'
                : 'fill-muted-foreground'}"
            >
              {labelLayout.text}
            </text>
          {/if}

          {#if canEditBar}
            {#if barW >= 10}
              <line x1={x1 + 1.5} x2={x1 + 1.5} y1={yRow + 3} y2={yRow + barH - 3} stroke-width="0.7" class="stroke-primary-foreground/60 pointer-events-none" />
              <line x1={x2 - 1.5} x2={x2 - 1.5} y1={yRow + 3} y2={yRow + barH - 3} stroke-width="0.7" class="stroke-primary-foreground/60 pointer-events-none" />
            {/if}
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <rect x={x1 - 2} y={yRow} width="4" height={barH} fill="transparent" class="cursor-ew-resize" onpointerdown={(e) => onBarPointerDown(e, day, r.index, "resize-start")} />
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <rect x={x2 - 2} y={yRow} width="4" height={barH} fill="transparent" class="cursor-ew-resize" onpointerdown={(e) => onBarPointerDown(e, day, r.index, "resize-end")} />
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
          <rect x={labelWidth + chartWidth + 1} y={yRow} width={rightPad - 1} height={barH} fill="transparent" />
          <text
            x={labelWidth + chartWidth + rightPad / 2 + 0.5}
            y={day * rowHeight + 9.5}
            text-anchor="middle"
            font-size="7"
            class="fill-muted-foreground hover:fill-destructive"
          >
            ×
          </text>
        </g>
      {/if}
    {/each}

    {#each [0, 6, 12, 18, 24] as h (h)}
      <line x1={x(h * 60)} x2={x(h * 60)} y1="0" y2={rowHeight * 7} class="stroke-border pointer-events-none" stroke-width="0.5" />
      <text x={x(h * 60)} y={rowHeight * 7 + 9} text-anchor="middle" class="fill-muted-foreground pointer-events-none" font-size="6">
        {h}
      </text>
    {/each}
  </svg>
{:else}
  <p class="text-sm">{value}</p>
{/if}
