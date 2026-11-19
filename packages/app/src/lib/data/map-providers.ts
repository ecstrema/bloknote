export interface MapCoordinates {
  lat: number;
  lon: number;
}

export interface MapProvider {
  id: string;
  label: string;
  description: string;
  mobileOnly?: boolean;
  defaultEnabled: boolean;
  external?: boolean;
  buildHref: (coordinates: MapCoordinates, name?: string) => string;
}

export const MAP_PROVIDERS: MapProvider[] = [
  {
    id: "geo",
    label: "Default maps app",
    description: "Opens your device default maps handler (geo:)",
    mobileOnly: true,
    defaultEnabled: true,
    buildHref: ({ lat, lon }, name) => {
      const ll = `${lat},${lon}`;
      const label = name ? encodeURIComponent(name) : "";
      return `geo:${ll}${label ? `?q=${ll}(${label})` : ""}`;
    },
  },
  {
    id: "google",
    label: "Google Maps",
    description: "Web & mobile app",
    defaultEnabled: true,
    external: true,
    buildHref: ({ lat, lon }) => `https://www.google.com/maps/search/?api=1&query=${lat},${lon}`,
  },
  {
    id: "apple",
    label: "Apple Maps",
    description: "Web & Apple devices",
    defaultEnabled: true,
    external: true,
    buildHref: ({ lat, lon }, name) => {
      const ll = `${lat},${lon}`;
      const label = name ? encodeURIComponent(name) : "";
      return `https://maps.apple.com/?ll=${ll}&q=${label || ll}`;
    },
  },
  {
    id: "osm",
    label: "OpenStreetMap",
    description: "Open-source web map",
    defaultEnabled: true,
    external: true,
    buildHref: ({ lat, lon }) => `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=17/${lat}/${lon}`,
  },
  {
    id: "comaps",
    label: "CoMaps / Organic Maps",
    description: "Offline mobile maps app (om://)",
    mobileOnly: true,
    defaultEnabled: false,
    buildHref: ({ lat, lon }, name) => {
      const label = name ? encodeURIComponent(name) : "";
      return `om://map?ll=${lat},${lon}${label ? `&n=${label}` : ""}`;
    },
  },
  {
    id: "osmand",
    label: "OsmAnd",
    description: "Offline & outdoor maps (web or mobile app)",
    defaultEnabled: false,
    external: true,
    buildHref: ({ lat, lon }) => `https://osmand.net/map?pin=${lat},${lon}#16/${lat}/${lon}`,
  },
  {
    id: "mapy",
    label: "Mapy.com",
    description: "Outdoor & trail maps",
    defaultEnabled: false,
    external: true,
    buildHref: ({ lat, lon }) =>
      `https://mapy.com/fnc/v1/showmap?mapset=outdoor&center=${lon},${lat}&zoom=16&marker=true`,
  },
  {
    id: "waze",
    label: "Waze",
    description: "Turn-by-turn navigation",
    defaultEnabled: false,
    external: true,
    buildHref: ({ lat, lon }) => `https://waze.com/ul?ll=${lat},${lon}&navigate=yes`,
  },
  {
    id: "here",
    label: "HERE WeGo",
    description: "Web & mobile navigation",
    defaultEnabled: false,
    external: true,
    buildHref: ({ lat, lon }, name) => {
      const label = name ? encodeURIComponent(name) : "";
      return `https://share.here.com/l/${lat},${lon}${label ? `,${label}` : ""}`;
    },
  },
  {
    id: "bing",
    label: "Bing Maps",
    description: "Web map",
    defaultEnabled: false,
    external: true,
    buildHref: ({ lat, lon }, name) => {
      const label = name ? encodeURIComponent(name) : "";
      return `https://www.bing.com/maps?cp=${lat}~${lon}&lvl=16&sp=point.${lat}_${lon}_${label}`;
    },
  },
];

export function isMapProviderDefaultEnabled(provider: MapProvider, isMobile: boolean): boolean {
  return provider.defaultEnabled && (!provider.mobileOnly || isMobile);
}
