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

Health checks are available at `GET /health` and `GET /api/health`.

`POST /api/study-areas/analyze` accepts a GeoJSON Feature with Polygon geometry and
returns the validated area, centroid, bounds, available acquisition dates,
frequencies, polarizations, and catalog observation metadata.

```bash
curl -X POST http://localhost:8787/api/study-areas/analyze \
  -H 'content-type: application/json' \
  --data @polygon.json
```

Set `CMR_BASE_URL`, `CMR_PAGE_SIZE`, `REQUEST_TIMEOUT_MS`, `PORT`, `DATA_DIR`,
`PYTHON_BIN`, and `EARTHDATA_TOKEN` through the environment when deploying.

## Processing pipeline

Each analysis queues every discovered granule for processing. Source HDF5 files
are downloaded to `DATA_DIR/studies/{study_id}/observations/`, then
`src/processing/process_nisar.py` selects an actual numeric 2-D measurement
dataset, finds its coordinate axes, reprojects the GeoJSON polygon into the
raster CRS, and writes a clipped GeoTIFF plus PNG preview. No synthetic values
are created.

Install the raster runtime before starting the backend:

```bash
python3 -m pip install -r processing-requirements.txt
```

Products without a numeric 2-D measurement and georeferencing axes are returned
as `unsupported_product_format`; download and processing errors are returned as
`failed`. Configure `EARTHDATA_TOKEN` when the CMR data link requires bearer
authentication.

## Processing API

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
GET /api/studies/{study_id}/observations/{observation_id}/preview
GET /api/studies/{study_id}/observations/{observation_id}/raster
GET /api/studies/{study_id}/observations/{observation_id}/pixel?longitude={lon}&latitude={lat}
```

`processed-observations` reports the explicit state of every catalog observation,
including processing errors, raster bounds, CRS, resolution, valid-pixel count,
NoData count, measurement name, and asset URLs. `preview` is a quick-look PNG;
`raster` is the clipped GeoTIFF for downstream analysis.