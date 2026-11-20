import { loadOpeningHours } from "./opening-hours.js";

export const openingHoursReady = $state({ value: false });

let requested = false;

/** Loads the opening_hours parser once; gate opening-hours parsing on `openingHoursReady` */
export function ensureOpeningHoursLoaded(): void {
  if (requested) return;
  requested = true;
  loadOpeningHours()
    .catch((error: unknown) => console.error("Failed to load the opening_hours parser:", error))
    .finally(() => (openingHoursReady.value = true));
}
