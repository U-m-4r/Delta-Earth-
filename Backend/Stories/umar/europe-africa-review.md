# Europe and Africa story additions

Pulled the updated story design before implementation and kept the redesigned chapter viewer. Two new five-date stories broaden the catalog beyond South Asia:

| Region | Story | Observation dates in 2026 |
| --- | --- | --- |
| Europe | Where the Po Meets the Sea — Po Delta, Italy | 19 June; 13 July; 18 August; 11 September; 17 October |
| Africa | Following the Senegal's Seasonal Pulse — Podor floodplain | 22 June; 16 July; 2 September; 26 September; 20 October |

Each frame comes from an individual frequency-A HHHH GeoTIFF retrieved through the project's Harmony extraction pipeline. All five frames within each story share one geographic grid, viridis palette and fixed −30 to +5 dB scale. Source power is converted to pixel-level dB after masking invalid and nonpositive values. The source TIFFs remain in ignored pipeline storage; product IDs, source URLs and TIFF/PNG SHA-256 hashes are published with the prepared story.

## Findings used in the chapter copy

Po Delta mean HH response across valid study pixels rises from −12.55 dB in June to −9.87 dB in September, then eases to −10.14 dB in October. The field mosaic changes while branching waterways remain recognizable. The story distinguishes these measurements from possible vegetation, moisture and agricultural explanations.

The Senegal River sequence is almost unchanged in its June/July area-wide average, strengthens in late September and decreases in October. These values describe radar scattering rather than a validated flood extent or recovery chronology. There is no August acquisition in the selected track, so the chapter text explicitly retains that gap.

Landscape and historical context is sourced in each location's story copy. Neither source is presented as validation of a 2026 event.

## Verification

- The full Chrome/Playwright regression run passed across all **nine** catalog stories, including both additions. It covered chapter selection, synchronized baseline comparisons, preserved zoom, keyboard and mouse timeline controls, mobile layout, failed-frame recovery and stale-request handling. No page errors were reported. The local visualization fixture also passed.
- All **78 backend tests passed**, including new regional provenance, PNG integrity, common-grid and offline-story API checks.
- The frontend production build passed.
- Each of the ten new PNGs and its corresponding downloaded TIFF independently matched its recorded SHA-256 hash. Each story has five distinct image hashes.
- Per-location `validation.json` and `browser-verification.json` record the regional checks. `europe-africa-browser-verification.json` records the full browser suite. Screenshots are generated locally under `.local-run/browser-verification/` and `.local-run/regional-browser/`.

Reproduce the renderer with `Backend/scripts/build-story-sequence.py po-delta` or `senegal-river`. Its CLI now discovers valid story folders instead of restricting authors to the original two cities. The catalog entries include region labels and the result files retain the study polygons for future globe-marker integration.
