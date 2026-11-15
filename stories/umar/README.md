# Umar's location stories

These location folders contain story copy, study polygons, original NASA browse images and reproducible acquisition evidence. Bangalore and Jeddah are now integrated into the browser story catalog as five-date observation sequences, alongside the existing water-change stories.

- [Bangalore: lake corridor](bangalore/story.md)
- [Jeddah: drainage landscape](jeddah/story.md)

`discovery.json` records the actual catalog response and candidate pairs. `assets.json` records downloaded full-scene browse images. Browse images provide context; quantitative analysis uses the individual extracted GeoTIFFs. The live API check records its steps in each location's `pipeline-check.json`. Successful change exports add `change-statistics.json`, `change.png` and `comparison.png`.

## Reproduce

From the repository root, using Python 3.11 or later and Node:

```powershell
rtk proxy python -m venv .venv
rtk proxy .\.venv\Scripts\python.exe -m pip install -e ./Backend[dev]
rtk proxy .\.venv\Scripts\python.exe Backend/scripts/prepare-story.py stories/umar/bangalore
rtk proxy .\.venv\Scripts\python.exe Backend/scripts/prepare-story.py stories/umar/jeddah
rtk proxy .\.venv\Scripts\python.exe Backend/scripts/check-story-pipeline.py stories/umar/bangalore
rtk proxy .\.venv\Scripts\python.exe Backend/scripts/check-story-pipeline.py stories/umar/jeddah
rtk proxy .\.venv\Scripts\python.exe -m pytest Backend/tests -q
```

Public preparation does not load an Earthdata credential. The live check uses the backend's locally configured Earthdata token and exercises the FastAPI app in-process with real NASA upstream calls. No separate server is needed. It checks health, scene discovery, extraction, individual TIFF download, previews, visualization catalog and timeline, comparison, change ZIP, animated timeline ZIP and session cleanup. It retains step status codes and hashes without recording the credential or session token. Read the terminal status before treating a check as complete.

Individual TIFFs and downloadable ZIPs are saved under `.local-run/story-downloads/<location>/`. Canonical processed rasters remain in the backend's ignored `data/` directories. Large satellite files and runtime jobs are excluded from new commits; existing tracked files are unaffected by the ignore additions.

The script chooses the widest date span for a common track/frame/mode/frequency/channel as a baseline comparison. This is a candidate selection rule, not a claim that the dates capture a flood. Review acquisition quality, real raster overlap and independent evidence before publishing an event interpretation. The timeline uses a shared display range calculated from the pooled valid source values; its statistics describe radar response, not classified water area.

## Five-date browser stories

The browser sequences use explicit acquisition dates in each location's `sequence-content.json`. Each source GeoTIFF is retrieved through `app.harmony.extract_granule`, aligned to the first acquisition's grid and converted from positive linear power to dB. Every frame uses **viridis, −30 to +5 dB**, without per-image stretching. Source TIFF and generated image SHA-256 hashes are stored in each published `result.json`.

```powershell
rtk proxy .\.venv\Scripts\python.exe Backend/scripts/build-story-sequence.py bangalore
rtk proxy .\.venv\Scripts\python.exe Backend/scripts/build-story-sequence.py jeddah
```

Open Stories from the globe toolbar or a home-panel story card. Each sequence has five date buttons, previous/next navigation, a first-date comparison toggle, a fixed legend, per-frame measurements and acquisition provenance. The existing water-classification stories retain their original viewer.

Browser verification uses installed Google Chrome through Playwright. From `Frontend`, start the local app in one terminal, then run the tests in another:

```powershell
rtk proxy node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5180 --strictPort
rtk npm run test:stories
```

The checks cover all ten frame images, source metadata and image hashes, all navigation controls, baseline comparison, keyboard selection, a 390-pixel viewport, legacy water-story rendering, return to globe, missing-story errors and image-failure recovery. Screenshots and machine-readable results are written to `.local-run/browser-verification/`. Set `STORIES_BASE_URL` to test another local server. These sequences show measured radar changes; their dates do not establish a confirmed flood-event chronology.
