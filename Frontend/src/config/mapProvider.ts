import { Credit, UrlTemplateImageryProvider } from 'cesium';

/** OSM Standard embeds local-language labels and has no language parameter.
 * This public raster style is authored with English/romanized labels, so there
 * is deliberately no ineffective `lang=en` query or browser-locale dependency.
 * Service lifecycle and translation exceptions: docs/map-labels.md.
 */
export const MAP_LANGUAGE = 'en';
export const BASEMAP = {
  name: 'Esri World Street Map (English labels)',
  url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}',
  maximumLevel: 19,
} as const;

// One provider factory for initial globe creation and raster-overlay refreshes.
// Cesium owns each provider instance; sharing an instance across viewers would
// incorrectly share its lifecycle, whereas this configuration is immutable.
export function createBaseMapProvider(): UrlTemplateImageryProvider {
  return new UrlTemplateImageryProvider({
    url: BASEMAP.url,
    maximumLevel: BASEMAP.maximumLevel,
    credit: new Credit('Tiles &copy; <a href="https://www.arcgis.com/home/item.html?id=3b93337983e9436f8db950e38a8629af" target="_blank" rel="noopener noreferrer">Esri</a> &middot; Sources: Esri, HERE, Garmin, USGS, Intermap, INCREMENT P, NRCan, Esri Japan, METI, Esri China (Hong Kong), Esri Korea, Esri (Thailand), NGCC, <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap contributors</a>, GIS User Community', true),
  });
}
