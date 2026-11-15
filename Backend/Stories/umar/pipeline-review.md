# Pipeline review — 15 November 2026

Tested checkout: latest `main` pulled before work; Windows, Python 3.14.7, local virtual environment. The API check exercised FastAPI against real NASA services. The completed five-date stories were also tested in installed Chrome through Playwright on the local frontend. A deployed environment was not tested.

## Verified

Both Bangalore and Jeddah passed health, live CMR discovery, retrieval-session batch processing, individual GeoTIFF downloads, raster previews, session-scoped catalog/timeline, before/after comparison, change ZIP download, animated timeline ZIP download and session deletion. Both timeline archives contain GIF, PDF and metadata JSON. Exact endpoint status codes, acquisition IDs, file hashes and display ranges are recorded in each `pipeline-check.json`.

All **71 backend tests passed** after the persistence fix. The frontend production build passed after `npm ci`; no dependency files needed changing.

## Fixed

The registry and both session stores wrote temporary JSON, reopened it read-only, then called `fsync`. On Windows that raised `OSError: [Errno 9] Bad file descriptor`, preventing retrieved GeoTIFF registration and session creation. Each writer now writes, flushes and synchronizes the same writable stream before atomic replacement. Existing tests reproduced 8 failures and 9 setup errors before the change and all passed afterward. Commit: `b01bbde`.

## Changes worth making next

1. **Repair the old story builder.** `Backend/scripts/build-case-studies.mjs` calls `/api/studies/{id}/process` and `/processing/status`, which this backend does not expose, and invokes missing `Backend/src/processing/process_nisar.py`. The new preparation and live-check scripts use current APIs and provide a reproducible path for these two locations. The old builder remains unchanged for its owner's review.
2. **Reconnect the download-access UI.** `EarthdataAccess.tsx` calls `/api/auth/status` and `/api/auth/token`, but neither route is registered in the current backend. API-level extraction worked with the existing configured token; the browser token-entry flow still needs an implementation or revised UI. Do not infer UI completion from this API check.
3. **Make units consistent across views.** The comparison display converts linear power to dB, while the scientific change export correctly reports subtraction in source units (`1` for these files). Label the operation and units explicitly so viewers do not compare the two numbers as equivalent.
4. **Review quality masks before event publication.** GDAL warned that a source per-dataset mask was ignored where explicit NoData was also supplied to the warper. The extracted files used NaN outside this polygon, and the comparison statistics excluded nonfinite values. Independently verify the mission quality layers and mask behavior before treating any classification as validated.
5. **Use confirmed event timing.** These longest-span compatible pairs provide seasonal baselines, not verified flood-event pairs. A Jeddah flash flood may be shorter than the revisit interval. Match a confirmed storm to available acquisition timestamps and independent reference imagery before adding a flood narrative.

## Browser story verification

Bangalore and Jeddah now each have five pipeline-derived observations in the browser Stories catalog. All dates use the same geographic grid per location and viridis −30 to +5 dB display limits. The viewer supports direct date selection, previous/next boundaries, first-date comparison, acquisition details and keyboard navigation. A narrow-screen header overflow found during screenshot review was fixed.

Automated Chrome checks passed for all ten images, matching captions/dates, fixed legends, baseline comparison, provenance, keyboard selection and 390-pixel layout. The original Indus water story and return-to-globe flow also passed. Injected missing-story and failed-image responses displayed errors and recovered successfully. Normal navigation produced no page errors or missing story assets. See `browser-verification.json` and `Frontend/tests/stories.browser.mjs`.

All source TIFF and rendered PNG hashes were independently verified against the sequence metadata. Each location has five distinct image hashes and identical dimensions across frames: Bangalore 1637 × 902; Jeddah 1555 × 1883. No new flood markers or unvalidated water-area statistics were added. The sequences provide seasonal radar observations rather than an independently confirmed flood-and-recovery chronology.
