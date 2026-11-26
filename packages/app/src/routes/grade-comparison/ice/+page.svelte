<script lang="ts">
  import { allIceScales } from "@bloknote/holy-grade";
  import GradeComparisonChart from "../GradeComparisonChart.svelte";
  import { pageTitle } from "#lib/page-title.js";
</script>

<svelte:head>
  <title>{pageTitle("Bloknote - Ice Grade Comparison")}</title>
</svelte:head>

<GradeComparisonChart scales={allIceScales} />
