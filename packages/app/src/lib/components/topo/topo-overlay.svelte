<script lang="ts">
  import type { RouteOverlayPath } from "./topo-helpers.js";

  const {
    ratio,
    paths,
    compact = false,
  }: {
    ratio: number;
    paths: RouteOverlayPath[];
    compact?: boolean;
  } = $props();

  const h = $derived(1 / ratio);
</script>

{#if paths.length > 0}
  <svg viewBox="0 0 1 {h}" class="pointer-events-none absolute inset-0 h-full w-full" aria-hidden="true">
    {#each paths as routePath (routePath.slug)}
      {@const points = routePath.points}
      {@const strokeColor = routePath.active ? "#e5484d" : "#2563eb"}
      {@const opacity = routePath.active ? 1 : 0.78}
      {#if points.length > 0}
        <g {opacity}>
          {#each points.slice(1) as point, index (`${index}-${point.x}-${point.y}`)}
            {@const previous = points[index]!}
            <line
              x1={previous.x}
              y1={previous.y * h}
              x2={point.x}
              y2={point.y * h}
              stroke="white"
              stroke-width={compact ? 0.013 : 0.009}
              stroke-dasharray={previous.dottedAfter ? "0.018 0.012" : undefined}
            />
            <line
              x1={previous.x}
              y1={previous.y * h}
              x2={point.x}
              y2={point.y * h}
              stroke={strokeColor}
              stroke-width={compact ? 0.007 : 0.0045}
              stroke-dasharray={previous.dottedAfter ? "0.018 0.012" : undefined}
            />
          {/each}

          {#each points as point, index (`${index}-${point.x}-${point.y}`)}
            <circle
              cx={point.x}
              cy={point.y * h}
              r={point.marker ? (compact ? 0.017 : 0.013) : compact ? 0.011 : 0.008}
              fill={routePath.active && routePath.selectedPoint === index
                ? "#f59e0b"
                : point.marker
                  ? "#2563eb"
                  : strokeColor}
              stroke="white"
              stroke-width={compact ? 0.005 : 0.004}
            />
            {#if !compact && point.marker}
              <text
                x={point.x + 0.015}
                y={point.y * h - 0.012}
                fill="white"
                stroke="#111827"
                stroke-width="0.003"
                paint-order="stroke"
                font-size="0.035"
                font-weight="bold">{point.marker}</text
              >
            {/if}
          {/each}

          {#if !compact && routePath.label && points[0]}
            <text
              x={points[0].x}
              y={Math.min(h - 0.01, points[0].y * h + 0.04)}
              text-anchor="middle"
              fill="white"
              stroke="#111827"
              stroke-width="0.004"
              paint-order="stroke"
              font-size="0.028"
              font-weight="600">{routePath.label}</text
            >
          {/if}
        </g>
      {/if}
    {/each}
  </svg>
{/if}