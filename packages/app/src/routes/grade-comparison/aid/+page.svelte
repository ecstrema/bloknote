<script lang="ts">
  import { allAidScales } from "@bloknote/holy-grade";
  import GradeComparisonChart from "../GradeComparisonChart.svelte";
</script>

<svelte:head>
  <title>{import.meta.env.DEV ? "[DEV] " : ""}Bloknote - Aid Grade Comparison</title>
</svelte:head>

<GradeComparisonChart scales={allAidScales} />
