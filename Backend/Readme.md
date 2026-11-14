# Dancing With SAR backend

This service validates a user-selected GeoJSON polygon and searches NASA's Common
Metadata Repository for real NISAR observations intersecting that polygon. It does
not fabricate coverage or environmental measurements: catalog failures are returned
as warnings and an empty catalog remains an honest result.

The catalogue parser uses official CMR granule fields (`time_start`, `time_end`,
`producer_granule_id`, `dataset_id`, `polygons`, and ASF typed links). It preserves
individual product records while grouping products from the same acquisition in the
`acquisitions` response field, so GCOV/GSLC/RSLC/SME2 products are not counted as
separate dates.

## Run locally

```bash
npm install
npm run build
npm start
```

The development command uses Node's built-in TypeScript stripping:

```bash
npm run dev
```

## API

`POST /api/study-areas/analyze` accepts a GeoJSON Feature with Polygon geometry and
returns the validated area, centroid, bounds, available acquisition dates,
frequencies, polarizations, and catalog observation metadata.

```bash
curl -X POST http://localhost:8787/api/study-areas/analyze \
  -H 'content-type: application/json' \
  --data @polygon.json
```

Set `CMR_BASE_URL`, `CMR_PAGE_SIZE`, `REQUEST_TIMEOUT_MS`, and `PORT` through the
environment when deploying.

## Processing API status

The following study-scoped routes are available after the analysis request returns
its `studyId`:

```text
GET /api/studies/{study_id}/processing/status
GET /api/studies/{study_id}/processed-observations
GET /api/studies/{study_id}/timeseries
GET /api/studies/{study_id}/layers
GET /api/studies/{study_id}/analysis
GET /api/studies/{study_id}/context
GET /api/studies/{study_id}/story
GET /api/studies/{study_id}/observations
GET /api/studies/{study_id}/observations/{observation_id}/metadata
```

These routes currently expose discovery records and explicit unavailable states.
Raster processing is not silently simulated: a real HDF5/GDAL worker, secure
Earthdata authentication, polygon clipping, GeoTIFF/COG generation, previews,
statistics, and retryable jobs still need to be added before the first processing
milestone can be considered complete.