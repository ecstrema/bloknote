<script lang="ts">
  import { allAidScales } from "@bloknote/holy-grade";
  import GradeComparisonChart from "../GradeComparisonChart.svelte";
  import { pageTitle } from "#lib/page-title.js";
</script>

<svelte:head>
  <title>{pageTitle("Bloknote - Aid Grade Comparison")}</title>
</svelte:head>

<GradeComparisonChart scales={allAidScales} />
