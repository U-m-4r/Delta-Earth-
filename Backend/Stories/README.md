# Delta-Earth story library

This directory owns all curated story content and assets. No satellite downloads are needed to view these stories.

- `Bagalpur/`: eight supplied Frequency A / HV GeoTIFFs and the Bhagalpur chapter definition (`story.json`). The original directory spelling is preserved.
- `case-studies/`: migrated frontend story bundles, their original result manifests, imagery, narrative, checksums and provenance. All six previously implemented bundles are retained, including Manchar, which was absent from the old catalogue.
- `umar/`: original Bangalore and Jeddah research, narratives, previews and pipeline evidence.
- `definitions.json`: original case-study processing definitions.

`NAN` means content is unavailable. Each migrated bundle has an `inventory.json`; missing original source narratives are explicitly `NAN`, while available published narrative is retained in `story.md` and `result.json`. Shared retrieval-pipeline files remain in their original locations so the Data Retriever and Visualization continue to work.

## Serving

Start the existing FastAPI application. It serves `/api/stories`, `/api/stories/{slug}`, `/api/stories/{slug}/observations`, and the curated preview, pixel-inspection and raster routes. Migrated static story assets keep their `/case-studies/...` URLs on the backend origin. The frontend uses its existing `VITE_BACKEND_URL` configuration (default `http://localhost:8787`). No frontend public-data copy is needed.

Bhagalpur files are selected by verified acquisition ID, not directory order. Exact UTC acquisition times were recovered from the existing local raster registry and stored in `Bagalpur/story.json`. Raster CRS, bounds, dimensions, masks, tags and measured statistics are inspected locally. The eight input files have no accompanying PNG/JSON manifests; preview PNGs are generated through the existing raster renderer and cached under `Bagalpur/.cache/`.

The inputs use EPSG:32645 at both 10 m and 20 m resolution. The existing visualization alignment helper puts every frame on the June 20 grid before display, comparison, subtraction or inspection. The viewer retains one geographic view across dates and synchronizes pan/zoom between comparison panels. Its initial view covers the supplied study bounds near 86.9085–87.0082° E, 25.2421–25.3615° N; pixel inspection returns WGS84 coordinates.

All frames use Turbo, logarithmic stretch, the requested fixed range 0.00272371–0.0954112, and the same baseline-derived log normalization scale. Changes use source-unit current minus June 20 values and the existing scientific difference palette, with a fixed symmetric ±0.0954112 display range. Saturated colours indicate values outside that display range, not a water classification. Preview cache keys include both source and baseline modification times. GeoTIFF downloads are restricted to the curated story's allowlisted acquisition IDs; private retrieval session routes retain their existing access controls.

Narrative stages reproduce the supplied visual interpretation. September 2 stays unclassified; September 17 is the greatest apparent extent among the examined observations, not an established hydrological peak. External event references are `NAN` for Bhagalpur. No flooded areas, water depths, discharge or impact estimates are inferred.

## Checks

```sh
PYTHONPATH=Backend .venv/bin/pytest Backend/tests -q
npm run build --prefix Frontend
npm run test:stories --prefix Frontend
```

The browser check expects the backend on port 8787 and frontend on port 5173. Override the frontend origin with `STORIES_BASE_URL`.

## Shared frontend viewer and timeline

All seven catalogue entries now render through `Frontend/src/components/stories/StoryViewer.tsx`. `storyDefinition.ts` adapts the existing documentary, sequence and pair-comparison response formats without rewriting stored content. Chapter counts, dates, imagery, narratives, comparison pairs, statistics and original metadata remain story-specific. The Bhagalpur layout remains the visual reference; older sequence and pair viewers no longer have separate rendering paths.

`Frontend/src/components/timeline/AcquisitionTimeline.tsx` contains the native acquisition-index slider extracted from Visualization. Visualization and Stories both use it, including checkpoints, previous/next controls, keyboard operation and touch input. Irregular acquisition intervals remain discrete observations rather than implying interpolated satellite frames. A single-observation story disables the slider and both navigation buttons.

`useTimelineFrames.ts` shares Visualization's decode-before-swap lifecycle, adjacent-frame caching, cancellation of superseded requests and old-frame retention. Story narrative, date, progression, comparison pair and active checkpoint all derive from the committed preview. While another acquisition loads, the request cursor moves and a loading label identifies the pending date; the last complete raster and its matching chapter remain visible. Failures keep that chapter visible and offer a retry. Camera state is independent of frame state.

Older stories use their saved comparison and water-change products only where such products exist. The original baseline pairs, quantitative statistics, calibration notes and reference agreement remain available. Sequence stories without saved difference products expose synchronized baseline comparison, without synthesizing differences from display colours. Unknown metadata uses `NAN`; full original metadata is available in the viewer's details.

## Globe story markers

The existing `/api/stories` catalogue now includes `markerLocation` with validated WGS84 longitude/latitude and a derivation `method`. The existing curated index remains the publication registry: entries marked `published: false` or `status: draft/unpublished` are excluded. Location priority is explicit `markerLocation`, a `representativeLocation` validated within the study geometry/bounds, an interior point of the study polygon, then a bounds center. Polygon holes and dateline crossings are handled. Bhagalpur uses its supplied bounds center, which is a study-area reference rather than a verified point on the river. Invalid or absent locations return `null`; those stories remain in the library.

No raster is opened to build the marker catalogue. The frontend shares one cached catalogue request across the globe, home strip and Stories page. It checks for stale metadata on window focus after 60 seconds; an explicit `delta-earth:stories-updated` window event refreshes it immediately. New published stories with valid metadata are picked up without editing globe code.

`StoryMarkerLayer` owns one Cesium `CustomDataSource` inside the existing viewer. Native billboards cluster nearby stories into a chooser. Stable IDs allow updates/removals without duplicate entities or a viewer rebuild. Hover and selected styles respect reduced motion; the Stories toggle affects only this data source. The globe's existing input handler gives marker picks precedence over raster clicks and disables marker picking while drawing. Manual camera gestures cancel marker flights; repeating a selection does not restart a flight. Preview close, outside click and Escape dismiss the card. The existing story navigation opens the viewer, retaining the camera vectors and toggle state across normal navigation.

The narrow-screen globe starts with its existing information panel collapsed so markers and previews remain usable; the panel is still available through its toolbar toggle.

Run `npm run test:globe --prefix Frontend` with the local frontend/backend running. This tests the real globe and native Cesium picks, including mobile touch, cluster selection, drawing isolation, metadata refresh, camera restoration and catalogue sharing. Its test-only instrumentation is under `Frontend/tests`, outside the production bundle. Map tile requests in this browser test are replaced by a deterministic test image; production map imagery is unchanged.

The overlay regression check also covers the installed Cesium image-provider API: saved raster previews now initialize with `SingleTileImageryProvider.fromUrl`, which reads their dimensions asynchronously and cancels stale overlay additions on navigation. The existing bounds, opacity and scientific values are preserved.
