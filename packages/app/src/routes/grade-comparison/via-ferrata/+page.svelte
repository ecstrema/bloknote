<script lang="ts">
  import { allViaFerrataScales } from "@bloknote/holy-grade";
  import GradeComparisonChart from "../GradeComparisonChart.svelte";
</script>

<svelte:head>
  <title>{import.meta.env.DEV ? "[DEV] " : ""}Bloknote - Via Ferrata Grade Comparison</title>
</svelte:head>

<GradeComparisonChart scales={allViaFerrataScales} />
