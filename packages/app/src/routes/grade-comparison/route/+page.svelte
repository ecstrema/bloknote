<script lang="ts">
  import { allRouteScales } from "@bloknote/holy-grade";
  import GradeComparisonChart from "../GradeComparisonChart.svelte";
  import { pageTitle } from "#lib/page-title.js";
</script>

<svelte:head>
  <title>{pageTitle("Bloknote - Route Grade Comparison")}</title>
</svelte:head>

<GradeComparisonChart scales={allRouteScales} />
