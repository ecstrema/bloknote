<script lang="ts">
  import type { Snippet } from "svelte";
  import { PersistentState } from "@friendofsvelte/state";

  import { setPreferredRouteGradingScale, setPreferredBoulderGradingScale } from "./settings.svelte";
  import type { BoulderScaleId, RouteScaleId } from "@bloknote/holy-grade";

  const preferredRouteGradingScale = new PersistentState<RouteScaleId | "local">(
    "bloknote:preferred-route-grading-scale",
    "local",
  );

  const preferredBoulderGradingScale = new PersistentState<BoulderScaleId | "local">(
    "bloknote:preferred-boulder-grading-scale",
    "local",
  );

  setPreferredRouteGradingScale(preferredRouteGradingScale);
  setPreferredBoulderGradingScale(preferredBoulderGradingScale);

  const {
    children,
  }: {
    children: Snippet;
  } = $props();
</script>

{@render children?.()}
