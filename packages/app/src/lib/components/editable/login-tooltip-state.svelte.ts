/**
 * Shared state for the single "Log in with OSM to edit" tooltip.
 *
 * Instead of mounting one tooltip per editable element (they can stack on top of
 * each other and waste memory), editable elements register themselves here on
 * hover/focus, and a single tooltip instance mounted in +layout.svelte positions
 * itself over the active element.
 */
export const sharedLoginTooltip = $state({
  /** Element currently hovered or focused by the user */
  anchor: null as HTMLElement | null,
});

export function showLoginTooltip(anchor: HTMLElement) {
  sharedLoginTooltip.anchor = anchor;
}

export function hideLoginTooltip(anchor?: HTMLElement) {
  if (!anchor || sharedLoginTooltip.anchor === anchor) sharedLoginTooltip.anchor = null;
}
