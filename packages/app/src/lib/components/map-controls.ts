import type { IControl, Map as MapLibreMap } from "#lib/maplibre.js";

/**
 * Look of the custom map buttons, matching the app's own buttons
 * (see the AddRouteControl button in location-map.svelte).
 */
const BUTTON_CLASS =
  "flex size-7 shrink-0 cursor-pointer items-center justify-center bg-background/90 text-foreground backdrop-blur transition-colors hover:bg-background";

export interface MapButton {
  title: string;
  /** Inline lucide-style SVG markup (stroke-based, currentColor) */
  svg: string;
  onClick: (map: MapLibreMap) => void;
  /** Hidden on phones, where pinch zoom replaces the zoom buttons */
  desktopOnly?: boolean;
}

/** A vertical group of custom map buttons, replacing the default styled MapLibre controls */
export class MapButtonsControl implements IControl {
  #container?: HTMLDivElement;
  #buttons: MapButton[];

  constructor(buttons: MapButton[]) {
    this.#buttons = buttons;
  }

  onAdd(map: MapLibreMap): HTMLElement {
    const container = document.createElement("div");
    container.className =
      "maplibregl-ctrl map-buttons flex flex-col overflow-hidden rounded-md border border-border/80 shadow-sm";
    this.#buttons.forEach((button, index) => {
      const element = document.createElement("button");
      element.type = "button";
      element.title = button.title;
      element.setAttribute("aria-label", button.title);
      element.className = `${BUTTON_CLASS}${index > 0 ? " border-t border-border/80" : ""}${button.desktopOnly ? " max-sm:hidden" : ""}`;
      element.innerHTML = button.svg;
      element.onclick = () => button.onClick(map);
      container.appendChild(element);
    });
    this.#container = container;
    return container;
  }

  onRemove(): void {
    this.#container?.remove();
    this.#container = undefined;
  }
}

/** Lucide "plus" */
export const PLUS_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="M12 5v14"/></svg>';

/** Lucide "minus" */
export const MINUS_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/></svg>';

/** Lucide "locate-fixed" */
export const LOCATE_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="2" x2="5" y1="12" y2="12"/><line x1="19" x2="22" y1="12" y2="12"/><line x1="12" x2="12" y1="2" y2="5"/><line x1="12" x2="12" y1="19" y2="22"/><circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="3"/></svg>';
