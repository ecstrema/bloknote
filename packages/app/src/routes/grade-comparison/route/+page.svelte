<script lang="ts">
  import { allRouteScales } from "@bloknote/holy-grade";
  import GradeComparisonChart from "../GradeComparisonChart.svelte";
</script>

<svelte:head>
  <title>{import.meta.env.DEV ? "[DEV] " : ""}Bloknote - Route Grade Comparison</title>
</svelte:head>

<GradeComparisonChart scales={allRouteScales} />
