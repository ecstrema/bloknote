<script lang="ts">
  import { allDangerScales } from "@bloknote/holy-grade";
  import GradeComparisonChart from "../GradeComparisonChart.svelte";
</script>

<svelte:head>
  <title>{import.meta.env.DEV ? "[DEV] " : ""}Bloknote - Danger Grade Comparison</title>
</svelte:head>

<GradeComparisonChart scales={allDangerScales} />
