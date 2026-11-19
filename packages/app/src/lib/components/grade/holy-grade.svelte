<script lang="ts">
  import { mode } from "mode-watcher";
  import {
    getPreferredBoulderGradingScale,
    getPreferredRouteGradingScale,
  } from "#components/shell/providers/settings.svelte.js";
  import { getScale, convertGrade } from "@bloknote/holy-grade";
  import type { Grade } from "#lib/types.js";
  import { getColorFromGrade } from "#lib/data/network/grade.js";

  const {
    grade,
    convert = true,
    class: className = "",
  }: {
    grade?: Grade;
    class?: string;
    convert?: boolean;
  } = $props();

  const scale = $derived.by(() => {
    if (!grade || grade.scale === "unknown") return;
    return getScale(grade.scale);
  });

  const color = $derived.by(() => {
    if (!grade || grade.scale === "unknown") return;

    return getColorFromGrade(grade.v, grade.scale, mode.current === "dark");
  });

  const preferredRouteScale = getPreferredRouteGradingScale();
  const preferredBoulderScale = getPreferredBoulderGradingScale();

  const targetScaleId = $derived.by(() => {
    if (!scale) return;
    if (scale.gradeType === "route" && preferredRouteScale.current !== "local") return preferredRouteScale.current;
    if (scale.gradeType === "boulder" && preferredBoulderScale.current !== "local") return preferredBoulderScale.current;
    return undefined;
  });

  const convertedGrade: string | undefined = $derived.by(() => {
    if (!convert || !grade || !scale || grade.scale === "unknown" || !targetScaleId || targetScaleId === grade.scale) {
      return;
    }

    const targetScale = getScale(targetScaleId);
    if (!targetScale || targetScale.gradeType !== scale.gradeType) return;

    return convertGrade(grade.v, scale, targetScale);
  });
</script>

{#if grade}
  <span class={className} style={`color: ${color || "currentColor"};`}>
    {#if convertedGrade}
      {convertedGrade}
    {:else}
      {grade.v}
    {/if}
  </span>
{/if}
