<script lang="ts">
  import { mode } from "mode-watcher";
  import { gradingScales, type PreferredScaleId } from "#lib/data/grading-scales.svelte.js";
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

  /**
   * Grades in a scale the user understands are shown as written; everything else is translated
   * to the preferred scale of the grade's discipline (issue #188).
   */
  const targetScaleId = $derived.by(() => {
    if (!scale || (scale.gradeType !== "route" && scale.gradeType !== "boulder" && scale.gradeType !== "viaFerrata")) {
      return;
    }
    if (gradingScales.isKnown(scale.id as PreferredScaleId)) return;
    return gradingScales.effective(scale.gradeType);
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
