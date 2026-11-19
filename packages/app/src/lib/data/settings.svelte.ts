import { browser } from "$app/env";
import { isMapProviderDefaultEnabled, MAP_PROVIDERS, type MapProvider } from "./map-providers.js";

const STORAGE_KEY = "bloknote:low-data";
const MAP_PROVIDERS_STORAGE_KEY = "bloknote:map-providers";

function initialValue(): boolean {
  if (!browser) return false;
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored !== null) return stored === "true";
  return (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData === true;
}

function initialMapProviderOverrides(): Record<string, boolean> {
  if (!browser) return {};
  try {
    const raw = JSON.parse(localStorage.getItem(MAP_PROVIDERS_STORAGE_KEY) ?? "{}");
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      return Object.fromEntries(
        Object.entries(raw).filter((entry): entry is [string, boolean] => typeof entry[1] === "boolean"),
      );
    }
  } catch {
    // Ignore invalid stored preferences
  }
  return {};
}

class Settings {
  /** When enabled, the whole dataset is never downloaded automatically: pages fetch only what they show. */
  #lowData = $state(initialValue());
  #mapProviderOverrides = $state<Record<string, boolean>>(initialMapProviderOverrides());

  get lowData() {
    return this.#lowData;
  }

  set lowData(value: boolean) {
    this.#lowData = value;
    if (browser) localStorage.setItem(STORAGE_KEY, String(value));
  }

  isMapProviderEnabled(id: string, isMobile: boolean): boolean {
    const override = this.#mapProviderOverrides[id];
    if (override !== undefined) return override;
    const provider = MAP_PROVIDERS.find((p) => p.id === id);
    return provider ? isMapProviderDefaultEnabled(provider, isMobile) : false;
  }

  setMapProviderEnabled(id: string, enabled: boolean) {
    this.#mapProviderOverrides = { ...this.#mapProviderOverrides, [id]: enabled };
    if (browser) localStorage.setItem(MAP_PROVIDERS_STORAGE_KEY, JSON.stringify(this.#mapProviderOverrides));
  }

  toggleMapProvider(id: string, isMobile: boolean) {
    this.setMapProviderEnabled(id, !this.isMapProviderEnabled(id, isMobile));
  }

  getEnabledMapProviders(isMobile: boolean): MapProvider[] {
    return MAP_PROVIDERS.filter((provider) => this.isMapProviderEnabled(provider.id, isMobile));
  }
}

export const settings = new Settings();
