<script lang="ts">
  import type { Snippet } from "svelte";
  import { getAppState } from "#lib/data/app-state.js";
  import { hideLoginTooltip, showLoginTooltip } from "./login-tooltip-state.svelte.js";

  const {
    children,
  }: {
    children: Snippet<[any]>;
  } = $props();

  const appState = getAppState();

  /**
   * When logged out, the wrapped element forwards these to the single shared
   * "Log in with OSM to edit" tooltip (see shared-login-tooltip.svelte), instead
   * of mounting one tooltip instance per editable element.
   */
  const loginTooltipProps = {
    onpointerenter: (e: PointerEvent & { currentTarget: HTMLElement }) => showLoginTooltip(e.currentTarget),
    onpointerleave: (e: PointerEvent & { currentTarget: HTMLElement }) => hideLoginTooltip(e.currentTarget),
    onfocusin: (e: FocusEvent & { currentTarget: HTMLElement }) => showLoginTooltip(e.currentTarget),
    onfocusout: (e: FocusEvent & { currentTarget: HTMLElement }) => hideLoginTooltip(e.currentTarget),
  };
</script>

{#if appState.osmUser.loggedIn}
  {@render children({})}
{:else}
  {@render children(loginTooltipProps)}
{/if}

