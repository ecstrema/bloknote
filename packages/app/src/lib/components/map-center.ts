export type MapCenterProvider = () => { lat: number; lon: number } | undefined;

let provider: MapCenterProvider | undefined;

/** Registers the shared map's center getter, so callers don't need to import maplibre */
export function setMapCenterProvider(next: MapCenterProvider | undefined): void {
  provider = next;
}

/** Center of the shared map when it is mounted and positioned, else undefined */
export function getMapCenter(): { lat: number; lon: number } | undefined {
  return provider?.();
}
