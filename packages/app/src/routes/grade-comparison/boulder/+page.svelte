<script lang="ts">
  import { allBoulderScales } from "@bloknote/holy-grade";
  import GradeComparisonChart from "../GradeComparisonChart.svelte";
  import { pageTitle } from "#lib/page-title.js";
</script>

<svelte:head>
  <title>{pageTitle("Bloknote - Boulder Grade Comparison")}</title>
</svelte:head>

<GradeComparisonChart scales={allBoulderScales} />
