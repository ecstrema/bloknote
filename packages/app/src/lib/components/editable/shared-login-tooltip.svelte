<script lang="ts">
  import * as Tooltip from "#components/ui/tooltip/index.js";
  import { Button } from "#components/ui/button/index.js";
  import { getAppState } from "#lib/data/app-state.js";
  import { sharedLoginTooltip } from "./login-tooltip-state.svelte.js";

  const appState = getAppState();

  let open = $state(false);
  let rect = $state<{ top: number; left: number; width: number; height: number }>();

  function updateRect() {
    const anchor = sharedLoginTooltip.anchor;
    if (!anchor) return;
    // The anchor can disappear (e.g. tree nodes collapsed by the search) while the tooltip is open
    if (!anchor.isConnected) {
      sharedLoginTooltip.anchor = null;
      return;
    }
    const { top, left, width, height } = anchor.getBoundingClientRect();
    rect = { top, left, width, height };
  }

  $effect(() => {
    if (appState.osmUser.loggedIn) {
      sharedLoginTooltip.anchor = null;
      return;
    }
    if (sharedLoginTooltip.anchor) {
      updateRect();
      open = true;
    } else {
      open = false;
    }
  });

  // Keep the invisible trigger glued to the anchor while it scrolls or the page resizes
  $effect(() => {
    if (!open) return;
    window.addEventListener("scroll", updateRect, true);
    window.addEventListener("resize", updateRect);
    return () => {
      window.removeEventListener("scroll", updateRect, true);
      window.removeEventListener("resize", updateRect);
    };
  });
</script>

<Tooltip.Root {open}>
  <!-- Invisible fixed-position trigger overlaying the hovered element, so the tooltip
       positions itself next to it -->
  <Tooltip.Trigger
    aria-hidden="true"
    tabindex={-1}
    style="position: fixed; pointer-events: none; top: {rect?.top ?? 0}px; left: {rect?.left ?? 0}px; width: {rect?.width ?? 0}px; height: {rect?.height ?? 0}px;"
  />
  <Tooltip.Content>
    <p class="text-sm">
      <Button variant="outline" class="cursor-pointer" onclick={() => appState.osmUser.login()}>
        Log in with OSM
      </Button>
      to edit
    </p>
  </Tooltip.Content>
</Tooltip.Root>
