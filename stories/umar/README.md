# Umar's location stories

These location folders contain story copy, study polygons, original NASA browse images and reproducible acquisition evidence. They are kept separate from the shared finished-story catalog so teammates can review and integrate them without conflicting edits to the application.

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
