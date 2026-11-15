# 🌍 Delta Earth
### Decode Earth's Changing Surface

**Turning NASA–ISRO NISAR radar observations into interactive, explainable stories of environmental change.**

**NASA Space Apps Challenge 2026**  
**Team:** E = MC² + AI  
**Challenge Domain:** Earth Science · Remote Sensing · Geospatial Analytics  
**Status:** Prototype in Development  
**Repository:** https://github.com/U-m-4r/Delta-Earth-

---

## 1. Overview

**Delta Earth** is an open-source geospatial intelligence platform designed to help people discover, measure, visualize, and understand changes occurring across Earth's surface using data from the NASA–ISRO Synthetic Aperture Radar (NISAR) mission.

Earth's surface is constantly evolving. Floodplains expand and contract, forests experience disturbances, agricultural fields change seasonally, and human activities transform landscapes.

Many of these changes are difficult to monitor consistently because conventional optical satellites depend on sunlight and can be obstructed by clouds.

Delta Earth addresses this challenge by making radar observations accessible through an interactive map-based application.

Our goal is to transform complex satellite measurements into understandable, evidence-backed insights for researchers, environmental organizations, disaster-response teams, students, and the public.

**Our guiding principle:**

> Don't just show that Earth changed. Show where it changed, how much it changed, what the radar measured, and what might explain the change.

## 2. The Problem

### Environmental change is difficult to understand

Monitoring Earth's changing surface presents several challenges:

- **Observational limitations:** Optical satellite imagery is frequently obstructed by clouds, particularly during severe weather and monsoon seasons.
- **Complex satellite data:** Radar measurements require specialized scientific knowledge and processing.
- **Fragmented information:** Satellite observations, environmental context, and geographic information are often distributed across different systems.
- **Limited explainability:** Visual differences between images do not automatically reveal what caused the changes.
- **Accessibility barriers:** Nontechnical users struggle to interpret raw SAR measurements and scientific datasets.

These problems create a gap between the availability of Earth observation data and its practical use in decision-making.

## 3. Our Solution

Delta Earth is designed as an interactive Earth-observation workspace with five connected capabilities.

| Capability | Description |
|---|---|
| Interactive Earth Explorer | Navigate a globe or map and select a geographic study area |
| NISAR Data Discovery | Find available radar observations for the selected location and dates |
| Surface Change Detection | Process comparable radar scenes to identify significant surface changes |
| Temporal Visualization | Explore before/after maps, change overlays, charts, and timelines |
| Evidence-Based Insights | Explain detected changes using measurements, metadata, and environmental context |

### Intended user workflow

**Explore → Select → Discover → Analyze → Understand → Share**

1. Open the Delta Earth dashboard.
2. Navigate to a location of interest.
3. Draw a polygon representing the study area.
4. Choose an environmental change category.
5. Search available satellite observations.
6. Select two or more comparable acquisition dates.
7. Run the change-detection analysis.
8. Explore the results using interactive visualizations.
9. Review supporting satellite evidence and potential explanations.
10. Export or share a reproducible analysis summary.

## 4. Primary Demonstration: Water and Floodplain Change

### Proposed study region

**Brahmaputra River floodplain, Assam, India**

The Brahmaputra floodplain is a compelling candidate because water distribution is influenced by seasonal precipitation, river discharge, erosion, sediment movement, and human activity.

The final demonstration polygon and observation dates will be selected after verifying NISAR acquisition coverage and product availability.

### Research question

**Can repeat-pass NISAR radar observations reveal measurable changes in open-water extent across a floodplain, and can those observations be communicated in a way that non-specialists can understand?**

### Working hypothesis

Changes in river discharge and seasonal rainfall may produce measurable differences in the radar backscatter and spatial extent of exposed water surfaces.

However, radar backscatter can also change because of wind, vegetation, soil moisture, sensor geometry, and other conditions.

Delta Earth therefore treats radar differences as observations requiring interpretation rather than automatically assigning a single cause.

### Expected demonstration outputs

- Geographically aligned SAR observations from two dates
- Backscatter difference visualization
- Candidate water gain and water loss masks
- Estimated changed area in square kilometers
- Change distribution across the user-selected polygon
- Interactive before/after comparison
- Acquisition metadata and source references
- Explanation of the likely physical drivers and limitations

**Scientific measurements and final findings will be added only after actual data processing and validation.**

## 5. Why NISAR?

NISAR is a joint Earth-observation mission developed by NASA and the Indian Space Research Organisation (ISRO).

It uses Synthetic Aperture Radar to observe Earth's surface using microwave signals.

Unlike passive optical instruments, radar generates its own illumination and can collect observations during both day and night, including through cloud cover.

The mission supports measurements related to:

- Surface deformation
- Ecosystem changes
- Vegetation structure
- Soil moisture
- Floodplains and wetlands
- Glacier and ice-sheet dynamics
- Natural hazards

NISAR operates with L-band and S-band radar systems. Different wavelengths and polarizations provide complementary information about surface structure and material properties.

### Selected data product

Our primary processing workflow targets **NISAR Level-2 Geocoded Polarimetric Covariance (GCOV)** products.

GCOV products provide geocoded and radiometrically terrain-corrected radar backscatter measurements.

These products are suitable for studying surface changes without requiring the application to implement a complete raw SAR processing chain.

### Polarization analysis

Available radar polarization channels depend on the acquisition mode.

Where supported, Delta Earth will compare selected co-polarized and cross-polarized measurements to investigate differences in surface response.

The platform will always display the actual polarization used rather than assuming that every scene contains identical channels.

## 6. Scientific Methodology

The analysis workflow is designed around reproducibility and scientific transparency.

### Step 1 — Define the area of interest

The user selects a geographic region through an interactive map.

The application represents this region as a GeoJSON polygon and sends it to the backend.

The backend validates the geometry, applies area limits, and determines the relevant spatial bounds.

### Step 2 — Discover satellite observations

The backend searches available NISAR acquisitions using:

- Geographic coverage
- Acquisition date
- Product type
- Orbit and imaging geometry
- Available polarization
- Data maturity and processing version

Only compatible observations are selected for direct quantitative comparison.

### Step 3 — Retrieve and prepare radar data

The selected scenes are downloaded or accessed from a prepared data cache.

Processing includes:

- Reading relevant GCOV layers
- Extracting backscatter values
- Applying quality and validity masks
- Clipping data to the study region
- Aligning observations to a common spatial grid
- Applying appropriate noise-reduction techniques
- Converting power values into decibels where needed

### Step 4 — Calculate change

For a comparable pair of radar observations:

**Backscatter change (dB) = Backscatter at Date 2 (dB) − Backscatter at Date 1 (dB)**

This represents the difference in measured radar response between acquisitions.

Depending on the selected analysis mode, candidate changes can be identified using thresholding, statistical analysis, or other documented change-detection methods.

For open-water analysis, the application may classify candidate water pixels independently for each date and compare the resulting masks.

Thresholds must be justified for the study area and validated rather than assumed to work globally.

### Step 5 — Calculate geographic statistics

The application aggregates valid change pixels into spatial summaries.

Planned metrics include:

- Total analyzed area
- Area classified as water on each date
- Candidate newly inundated area
- Candidate water recession area
- Net change in estimated water extent
- Percentage of the study area classified as changed
- Percentage of valid observations

All geographic area calculations must account for the raster projection and pixel size.

### Step 6 — Validate observations

Where reference data is available, detected changes will be compared against suitable independent evidence.

Potential supporting datasets include:

- Cloud-free Sentinel-2 imagery
- Verified event or flood maps
- Historical water occurrence datasets
- Relevant local hydrological observations
- Ground observations or documented event records

Validation metrics may include precision, recall, intersection-over-union, and confusion matrices where reliable reference labels exist.

If reference labels are unavailable, the application will report observations without claiming classification accuracy.

### Step 7 — Generate an evidence-based explanation

Delta Earth translates the analysis into an understandable summary containing:

- What changed
- Where the change occurred
- How large the measured change was
- Which observations support the result
- Potential environmental drivers
- Important limitations
- Relevant dataset references

Explanations distinguish measured observations from hypotheses about causation.

## 7. Key Product Features

### 7.1 Interactive Globe and Area Selection

A geographic explorer allows users to:

- Navigate worldwide
- Search for locations
- Zoom into environmental regions
- Draw and edit polygons
- Inspect geographic coordinates
- Display selected study-area boundaries

The map is the primary interface between the user and the remote-sensing analysis engine.

### 7.2 Satellite Observation Timeline

An interactive timeline will show available acquisitions for the chosen region.

Users can choose the baseline and comparison dates and inspect the metadata of each observation.

The timeline will distinguish dates with available usable data from dates without observations.

### 7.3 Interactive Change-Detection Map

The result map will support:

- Before/after image comparison
- Adjustable comparison slider
- Radar backscatter visualization
- Difference overlays
- Water gain and recession layers
- Raster legend and units
- Polygon-level statistics

### 7.4 Environmental Analytics Dashboard

The analytics view will summarize the observation results through:

- Time-series charts
- Change-area statistics
- Polarization comparisons where available
- Spatial distribution of detected changes
- Data quality indicators
- Downloadable analysis summaries

### 7.5 Evidence Cards — Our Core Differentiator

Each major result will be accompanied by an evidence card.

An evidence card will connect the interpretation to:

1. The affected location
2. The observation dates
3. The measured radar change
4. The product and polarization used
5. The source acquisition identifiers
6. The classification or detection method
7. Quality indicators and known uncertainties
8. A concise explanation of potential causes

This helps users move from a visually striking result to an observation that can be inspected and reproduced.

### 7.6 Storytelling Mode

A guided storytelling interface will present analysis findings through a sequence:

**Location → Before → After → Measured Change → Possible Explanation → Why It Matters**

The feature is intended for educational use, science communication, and public-facing environmental reporting.

## 8. What Makes Delta Earth Different?

### From images to explainable environmental evidence

Many satellite visualization applications focus on displaying imagery.

Delta Earth aims to combine visualization with measurable change analysis, transparent data provenance, and accessible scientific interpretation.

Our proposed innovations are:

**1. Evidence-linked change detection**

Each output is traceable to the satellite observations, processing decisions, and measurements that generated it.

**2. Quality-aware interpretation**

The application explicitly communicates incomplete coverage, unsuitable scene comparisons, ambiguous radar responses, and other limitations.

**3. Interactive, location-specific storytelling**

Users explore environmental change within their own selected geographic area, rather than viewing only predefined satellite examples.

**4. Accessibility for non-specialists**

Scientific radar measurements are translated into understandable maps, statistics, and explanations without hiding their underlying evidence.

**5. Reproducible geospatial analysis**

Study polygons, selected acquisitions, processing configurations, and derived outputs are recorded to support repeatable analysis.

## 9. Proposed Technical Architecture

Delta Earth follows a modular frontend–backend architecture.

### Frontend

**Proposed technologies:**

- React and TypeScript
- MapLibre GL JS or CesiumJS
- Deck.gl or equivalent geospatial visualization tools
- Recharts or Plotly
- Tailwind CSS

**Responsibilities:**

- Map and globe interaction
- Polygon drawing
- Date and polarization selection
- Layer rendering
- Interactive comparisons
- Analytics dashboard
- Evidence presentation

### Backend

**Proposed technologies:**

- Python
- FastAPI
- Rasterio and GDAL
- NumPy
- h5py
- GeoPandas and Shapely
- `asf_search` for supported data discovery

**Responsibilities:**

- Validate geographic requests
- Discover compatible NISAR observations
- Access and process radar datasets
- Generate spatial change products
- Calculate analysis metrics
- Return structured results and metadata

### Data and storage

Initial prototype storage may use:

- GeoJSON for geographic boundaries
- GeoTIFF or Cloud Optimized GeoTIFF for raster outputs
- JSON for processing metadata and statistics
- Local or object-storage caching for processed scenes

Database and cloud infrastructure can be introduced as deployment needs increase.

### Processing architecture

**User Interface → Geographic Selection → Backend API → NISAR Data Discovery → SAR Processing → Change Analysis → Geospatial Outputs → Interactive Dashboard**

### Suggested API endpoints

The following endpoints describe the intended API contract, not necessarily existing implementations.

| Endpoint | Purpose |
|---|---|
| `POST /api/scenes/search` | Find available observations within a polygon |
| `POST /api/analysis` | Start an analysis using selected scenes |
| `GET /api/analysis/{id}` | Retrieve analysis status and metadata |
| `GET /api/analysis/{id}/results` | Retrieve spatial statistics and change summaries |
| `GET /api/analysis/{id}/layers` | List available output map layers |
| `GET /api/health` | Check backend availability |

## 10. Repository Structure

The existing repository contains `Frontend/` and `Backend/` directories.

The following is a **proposed organizational layout**, not a verified description of all existing files.

| Directory | Responsibility |
|---|---|
| `Frontend/` | Interactive user interface and visualization components |
| `Backend/` | API services, SAR processing, analysis routines |
| `data/samples/` | Small, reproducible example inputs |
| `docs/` | Architecture, methodology, screenshots and validation |
| `tests/` | Unit and integration testing |
| `scripts/` | Data preparation and reproducible demo scripts |

Large satellite products and private credentials should not be committed to Git.

## 11. Implementation Status

This README describes the intended end-to-end solution.

Features should be marked complete only after being implemented and demonstrated.

| Component | Target |
|---|---|
| Geographic explorer | Interactive study-area selection |
| NISAR data discovery | Real acquisition search |
| Data processing | Reproducible GCOV analysis |
| Change visualization | Aligned before/after observations |
| Environmental metrics | Calculated from processed imagery |
| Evidence cards | Measured values and provenance |
| Validation | Independent reference comparison |
| Demo deployment | Accessible, tested project demonstration |

Current completion status, verified results, screenshots, and deployment instructions will be maintained as development progresses.

## 12. Scientific Validation and Transparency

Delta Earth distinguishes three different concepts:

**Observation:** What the satellite measured.

**Detection:** What the processing algorithm classified or identified.

**Interpretation:** What physical or environmental processes might explain those detections.

These are not interchangeable.

A radar backscatter change does not automatically prove flooding, deforestation, erosion, or another specific environmental event.

Where numerical classification accuracy is reported, the project will document the reference dataset, sample size, method, evaluation metrics, and limitations.

Where accuracy cannot be established, Delta Earth will not fabricate a confidence percentage.

## 13. Known Limitations

- NISAR acquisition coverage and dates vary by location.
- Multiple comparable observations may not be available for every study area.
- Radar backscatter changes can have several possible physical causes.
- Speckle, geometry, vegetation, and acquisition differences can influence measurements.
- Surface-water detection may be unreliable under dense vegetation or certain surface conditions.
- Small geographic features may fall below the effective spatial resolution of the selected product.
- Environmental attribution requires additional evidence beyond radar differences alone.
- This prototype is not an operational flood-warning system.

## 14. Future Scope

After the primary water-change demonstration is validated, the platform could expand to:

**Forest Disturbance Monitoring:** Analyze changes in forest radar responses and investigate possible disturbance patterns.

**Agricultural Monitoring:** Explore temporal radar signatures associated with agricultural activity and crop development.

**Wetland Dynamics:** Study seasonal changes in surface water and wetland conditions.

**Ground Deformation:** Integrate suitable NISAR interferometric products to visualize land displacement.

**Multi-Sensor Fusion:** Compare radar observations with optical imagery and complementary environmental datasets.

**Automated Monitoring:** Support recurring scene discovery and analysis for registered geographic regions.

These extensions will require scenario-specific algorithms and validation.

## 15. Project Impact

Delta Earth is designed to make Earth-observation science more useful to a wider audience.

**Researchers** could explore and compare environmental observations without constructing every visualization from scratch.

**Environmental organizations** could investigate changes in wetlands, rivers, and natural resources.

**Disaster-response planners** could use validated surface-change products as supporting situational evidence.

**Educators and students** could explore the relationship between satellite measurements and environmental processes.

**Communities** could better understand how landscapes around them evolve.

The longer-term objective is to help bridge the gap between scientific satellite data and accessible environmental insight.

## 16. Demonstration and Reproducibility

The final hackathon submission will aim to include:

- An accessible application demonstration
- A verified geographic study area
- The exact satellite acquisitions used
- At least one reproducible change-detection analysis
- Interactive before/after results
- Measurements derived from actual SAR observations
- Supporting validation evidence
- A concise walkthrough video
- Documentation and source code

**Live demo:** To be added after deployment.  
**Demo video:** To be added after recording.  
**Study-area results:** To be added after processing real observations.

## 17. Data Sources and References

**Primary NASA–ISRO data**

- [NASA Earthdata Search](https://search.earthdata.nasa.gov/search)
- [ASF Vertex SAR Data Search](https://search.asf.alaska.edu/)
- [NISAR Data User Guide](https://nisar-docs.asf.alaska.edu/)
- [NISAR GCOV Product Documentation](https://nisar-docs.asf.alaska.edu/gcov/)
- [NASA NISAR Mission](https://science.nasa.gov/mission/nisar/)

**Supporting resources**

- [NASA Introduction to SAR](https://www.earthdata.nasa.gov/learn/earth-observation-data-basics/sar)
- [NASA ARSET Training](https://appliedsciences.nasa.gov/get-involved/training)
- [ISRO Bhoonidhi](https://bhoonidhi.nrsc.gov.in/)
- [NASA NISAR StoryMaps](https://nisar.jpl.nasa.gov/applications/arcgis-storymaps/)

Data attribution, product identifiers, licensing requirements, and acquisition details will be included with each demonstrated analysis.

## 18. Team

**E = MC² + AI**

Developed for the **2026 NASA Space Apps Challenge**.

We aim to combine software engineering, remote sensing, geospatial analytics, and scientific communication to make changes on Earth's surface easier to investigate and understand.

## 19. License

This project is released under the MIT License. See [LICENSE](LICENSE) for details.

The availability and redistribution of external datasets remain subject to their respective terms and attribution requirements.

## 20. Acknowledgements

We acknowledge NASA, ISRO, the Alaska Satellite Facility, and the broader Earth-observation community for providing the scientific resources and open datasets that make this project possible.

This is an independent hackathon project and is not an official NASA or ISRO product.

---

**Delta Earth — See the change. Understand the evidence. Explore the planet.**

## Running the NISAR retrieval backend

Phase 1 provides a Python API for validating WGS84 polygons, discovering provisional NISAR GCOV granules in ASF CMR, checking the live Harmony capabilities for the selected collection, and extracting individual variables as GeoTIFFs. Retrieval is available from the frontend **Data** action after selecting an area.

### Install and start

```bash
cd Backend
python -m venv .venv
source .venv/bin/activate
pip install -e '.[dev]'
cp .env.example .env
uvicorn app.main:app --reload --port 8787
```

Set `EDL_TOKEN` to your NASA Earthdata bearer token in the ignored local `Backend/.env`. Harmony requests use `Authorization: Bearer …`; a `~/.netrc` file is not required. Never commit credentials. The default collection is ASF's provisional GCOV collection `C2854338529-ASF`; set `NISAR_GCOV_COLLECTION` to the desired collection concept ID to change it.

Start the frontend in another terminal:

```bash
cd Frontend
npm install
npm run dev
```

Set `VITE_BACKEND_URL` if the API is not at `http://localhost:8787`.

### API and CLI

- `GET /api/health` — service check.
- `GET /api/nisar/capabilities` — reports Harmony's configured services, variables, and operations for this collection.
- `POST /api/nisar/scenes/search` — accepts `{ "studyArea": <GeoJSON Feature>, "startDate": "YYYY-MM-DD", "endDate": "YYYY-MM-DD" }` (dates optional) and returns matching CMR granules.
- `POST /api/study-areas/analyze` — frontend-compatible discovery endpoint, also returning polygon area and bounds.
- `POST /api/nisar/extractions` — accepts `granuleId`, `studyArea`, `variables`, and `frequency` (`frequencyA` or `frequencyB`); submits a distinct Harmony job per variable and waits for the GeoTIFF results.
- `GET /api/data/{path}` — serves validated local rasters and metadata.

CLI examples (from `Backend/`):

```bash
python -m app.cli capabilities
python -m app.cli search ../data/study_area.geojson
python -m app.cli extract GRANULE_ID ../data/study_area.geojson --variables HHHH,HVHV
```

Outputs are stored under `data/study_areas/` and `data/granules/{GRANULE_ID}/`. Each granule includes a manifest and acquisition metadata, with measurement and auxiliary TIFFs in separate folders. Every GeoTIFF is opened with Rasterio before it is marked as complete; CRS, transform, dimensions, resolution, NoData, and data type are retained in the manifest. Scientific values are not transformed into display imagery.

The extractor checks Harmony's **service-level** capabilities and requires a single service that reports variable selection, polygon subsetting, and GeoTIFF output together. It will stop with a clear message if the live collection configuration does not confirm that combination. The official NISAR guide says selected variables absent from a product are ignored by Harmony, so each requested variable is submitted separately and absent output is recorded. An end-to-end live extraction still requires valid Earthdata access and a granule whose available datasets overlap the selected variables.

### Tests

From `Backend/`, run `pytest`. CMR and Harmony HTTP interactions in the test suite use mocked responses; a live Earthdata Login is only needed for a real catalog-to-GeoTIFF run.

### Interactive Stories

Open **Stories** to explore the Bhagalpur monsoon sequence and six preserved case studies. Curated story data now lives in [`Backend/Stories`](Backend/Stories/README.md), served by the existing FastAPI backend. Missing source content is recorded as `NAN`. The Bhagalpur story uses the eight local NISAR observations only; viewing it does not start satellite retrieval or processing jobs.
