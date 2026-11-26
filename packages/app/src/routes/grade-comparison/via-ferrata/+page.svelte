<script lang="ts">
  import { allViaFerrataScales } from "@bloknote/holy-grade";
  import GradeComparisonChart from "../GradeComparisonChart.svelte";
  import { pageTitle } from "#lib/page-title.js";
</script>

<svelte:head>
  <title>{pageTitle("Bloknote - Via Ferrata Grade Comparison")}</title>
</svelte:head>

<GradeComparisonChart scales={allViaFerrataScales} />
