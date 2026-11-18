<script lang="ts">
  import { allIceScales } from "@bloknote/holy-grade";
  import GradeComparisonChart from "../GradeComparisonChart.svelte";
</script>

<svelte:head>
  <title>{import.meta.env.DEV ? "[DEV] " : ""}Bloknote - Ice Grade Comparison</title>
</svelte:head>

<GradeComparisonChart scales={allIceScales} />
