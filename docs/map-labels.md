# English map labels

## Inspected configuration

The globe used OpenStreetMap Standard raster tiles (`https://tile.openstreetmap.org/{z}/{x}/{y}.png`) via Cesium's `UrlTemplateImageryProvider`, plus `EllipsoidTerrainProvider`. Country, city, road and geographic-feature labels were embedded in the raster images. There was no independent label/vector layer, Cesium ion imagery, Bing or Mapbox provider configured by the application. Changing the browser locale or adding `lang=en` to those OSM URLs cannot select an English rendering.

All imagery-provider construction is now centralized in [`Frontend/src/config/mapProvider.ts`](../Frontend/src/config/mapProvider.ts). Both initial globe construction and raster-overlay refreshes use its factory, so loading a NISAR overlay does not revert the map language. Terrain, camera, marker entities, drawing, scientific raster data, pixel inspection and story/timeline components retain their existing implementation.

## English-label source and dependencies

The configured base source is **Esri World Street Map**, a pre-rendered English/romanized street-map style:

```text
https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}
```

The language configuration is `en`; the fixed raster style determines the label language, not an unsupported language query parameter. XYZ Web Mercator alignment and 256 px tiles remain compatible with the existing Cesium layer. The English source has its own street/relief cartography. Provider credits are visible through the existing Cesium attribution container.

**Dependency:** the public endpoint currently serves tiles without a token, and this change adds no API key or paid account. Public HTTP access is not an unrestricted-use licence. The service is governed by the **Esri Master License Agreement**. Esri's published guidance for third-party clients requires appropriate ArcGIS account/licence entitlement; confirm the project's entitlement before public deployment. No promise of free commercial usage is made here. The provider can be replaced centrally if an authenticated English-OSM service or an existing licensed service is preferred.

**Lifecycle:** Esri classifies this as a legacy raster service. Its official notice says legacy raster basemaps have not received updates since 2021 and schedules World Street Map retirement for **December 2029**. Existing data may therefore contain older place names and road coverage. This is a reported provider dependency, not a new satellite-data source.

CARTO Voyager was investigated as an OSM-derived alternative, but its current service requires a key and watermarks unauthenticated requests. Tracestrack offers explicitly `en`-localized OSM raster tiles, also requiring an API key. Neither service has been registered, billed or silently configured.

## Translation limits

English labels are used where supplied by the style. Proper names can retain accents and local spelling in normal English usage, such as **São Paulo** and **Île-de-France**. Russian and other names may be romanized, for example **Podol'sk**, rather than translated word-for-word. Minor roads, rivers and points of interest can retain a local name when the source lacks an English form. Some features are intentionally not labeled at a given zoom. This implementation does not translate, erase or alter text inside scientific or cartographic raster imagery, and does not guarantee that every source label has an English translation.

## Verification

`npm run test:map-labels --prefix Frontend` loads **real**, unmocked basemap tiles in a Japanese (`ja-JP`) browser locale and visits all six requested regions. It checks tile delivery, the common provider configuration, language independence and visible attribution, saving screenshots and a JSON report under `.local-run/map-label-verification/`. HTTP status checks verify delivery; label wording was separately inspected visually.

Observed regional labels in the reviewed screenshots/sample tiles:

| Region | Observed examples |
| --- | --- |
| India | India, New Delhi, Chandigarh, Lucknow, Bhagalpur |
| China | Beijing, Tianjin, Yellow Sea, Bohai Sea |
| Japan | Japan, Tokyo, Kyoto, Yokohama, Sendai |
| Russia | Moscow, Saint Petersburg, Voronezh, Nizhny Novgorod |
| Europe | France, Germany, Netherlands, Cologne, The Hague, English Channel |
| South America | São Paulo, Sorocaba, São Bernardo do Campo |

These are representative views and sample tiles, not an assertion that every road, mountain or river in the world has been independently checked. The translation and data-age exceptions above still apply.

`npm run test:globe --prefix Frontend` covers existing native marker picking, camera restoration, polygon drawing, preview cards, visibility, mobile touch and raster click/overlay isolation. Its deterministic tile substitute remains test-only. The overlay test also asserts that overlay refreshes retain the English base provider.

## Provider references

- [OSM explanation of raster versus localized vector maps](https://openstreetmap.us/news/2022/12/americana-language/)
- [Esri World Street Map item, credits and terms](https://www.arcgis.com/home/item.html?id=3b93337983e9436f8db950e38a8629af)
- [Esri guidance for open-source/third-party clients](https://www.esri.com/arcgis-blog/products/developers/developers/open-source-developers-time-to-upgrade-to-the-new-arcgis-basemap-layer-service)
- [Esri legacy-service retirement schedule](https://www.esri.com/arcgis-blog/products/arcgis-living-atlas/announcements/sunsetting-legacy-basemaps)
- [Current CARTO basemap requirements](https://www.carto.com/basemaps/)
- [Tracestrack localized raster API](https://www.tracestrack.com/docs/)
