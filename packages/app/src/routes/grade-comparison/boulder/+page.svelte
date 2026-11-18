<script lang="ts">
  import { allBoulderScales } from "@bloknote/holy-grade";
  import GradeComparisonChart from "../GradeComparisonChart.svelte";
</script>

<svelte:head>
  <title>{import.meta.env.DEV ? "[DEV] " : ""}Bloknote - Boulder Grade Comparison</title>
</svelte:head>

<GradeComparisonChart scales={allBoulderScales} />
