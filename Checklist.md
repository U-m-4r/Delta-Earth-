# Delta Earth — Development Checklist

**Project:** Delta Earth  
**Event:** NASA Space Apps Challenge 2026  
**Challenge:** Tracking and Visualizing Earth's Surface Changes Using NISAR  
**Repository:** https://github.com/U-m-4r/Delta-Earth-  
**Status:** In Development

---

## Project Objective

Build an interactive web application that uses real NASA–ISRO NISAR radar observations to detect, measure, visualize, and explain changes across Earth's surface.

### Primary Use Case

Detect and visualize changes in **surface-water and floodplain extent** between different NISAR acquisitions.

### Target Demonstration

A user should be able to:

1. Open the Delta Earth application.
2. Select a study area on an interactive map.
3. View available NISAR observations.
4. Select two comparable acquisition dates.
5. Run or retrieve a real change-detection analysis.
6. View the before and after radar observations.
7. Inspect a map highlighting detected changes.
8. Read measured statistics and evidence-backed explanations.
9. Understand the possible environmental causes.
10. View the original data sources and analysis methodology.

### Priority Definitions

- **P0 — Critical:** Required for the working demonstration.
- **P1 — Important:** Improves scientific credibility, usability, and presentation.
- **P2 — Optional:** Advanced features to develop after completing the MVP.

**Rule:** Complete P0 before starting P2.

**Completion rule:** Mark a task as completed only after the corresponding feature has been implemented and tested using actual outputs.

---

# PHASE 1 — PROJECT SETUP AND ARCHITECTURE

**Priority: P0**

## Task 1.1 — Inspect and Organize the Repository

- [ ] Inspect the existing frontend implementation.
- [ ] Inspect the existing backend implementation.
- [ ] Identify existing working features and unfinished components.
- [ ] Remove unused experimental code only after confirming it is not needed.
- [ ] Establish a clear project directory structure.
- [ ] Configure `.gitignore` to exclude downloaded satellite files, secrets, caches, and generated outputs.
- [ ] Create a shared development task-tracking workflow.

### What to do

Keep the existing `Frontend/` and `Backend/` directories.

Organize future functionality into modules such as:

**Frontend**
- `components/` — Shared UI components
- `pages/` — Application screens
- `services/` — Backend API communication
- `hooks/` — Reusable application logic
- `types/` — TypeScript interfaces

**Backend**
- `api/` — HTTP endpoints
- `services/` — Data discovery and processing
- `processing/` — SAR processing algorithms
- `models/` — Request and response schemas
- `utils/` — Shared utilities
- `tests/` — Backend tests

Create these directories only where they fit the existing framework.

### Done when

- Both applications start successfully.
- Project dependencies are documented.
- No important code has been accidentally removed.
- Team members understand where to implement their features.

## Task 1.2 — Establish the Backend and Frontend Connection

- [ ] Start the backend locally.
- [ ] Start the frontend locally.
- [ ] Configure the backend API base URL.
- [ ] Configure CORS for the frontend origin.
- [ ] Implement a health-check endpoint.
- [ ] Display backend connection errors clearly.

### What to do

Implement an endpoint such as:

`GET /api/health`

Expected response should contain an application status such as `healthy`.

The frontend should call this endpoint to verify connectivity.

### Done when

The frontend can successfully communicate with the backend, and connection failures produce understandable errors.

## Task 1.3 — Define the Analysis Data Contract

- [ ] Define a GeoJSON polygon input format.
- [ ] Define the acquisition metadata structure.
- [ ] Define analysis request and response structures.
- [ ] Define analysis status values.
- [ ] Define error response formats.

### What to do

Each analysis request should contain:

- Study-area polygon
- Baseline acquisition ID
- Comparison acquisition ID
- Selected frequency and polarization
- Requested analysis type

Each result should include:

- Analysis ID
- Source acquisition IDs
- Processing status
- Geographic bounds
- Acquisition dates
- Numerical metrics
- Raster layer URLs
- Quality information
- Processing configuration

### Done when

The frontend and backend use matching schemas and can exchange a valid sample request.

---

# PHASE 2 — REAL NISAR DATA ACQUISITION

**Priority: P0 — MOST IMPORTANT**

## Task 2.1 — Choose a Verified Study Area

- [ ] Investigate the Brahmaputra floodplain in Assam as the first candidate.
- [ ] Search for available NISAR acquisitions covering that region.
- [ ] Confirm at least two suitable acquisitions exist.
- [ ] If coverage is insufficient, select another study area with confirmed data.
- [ ] Draw a manageable polygon around the selected location.
- [ ] Save the polygon as GeoJSON.
- [ ] Record the location and reason for selecting it.

### What to do

Start with a small geographic area rather than attempting to process an entire state or country.

Use:

- https://search.asf.alaska.edu/
- https://search.earthdata.nasa.gov/search

Filter by available NISAR products and geographic coverage.

Select an area with visible environmental features that can be analyzed using radar data.

### Done when

The project has one verified study-area polygon and a real, compatible pair of NISAR acquisitions.

**Deliverable:** `data/study_area.geojson`

## Task 2.2 — Access NISAR GCOV Products

- [ ] Create or configure NASA Earthdata authentication where required.
- [ ] Locate suitable NISAR L-band GCOV products.
- [ ] Check acquisition dates and orbit information.
- [ ] Check product maturity and processing version.
- [ ] Check available frequency and polarization channels.
- [ ] Download or remotely access the selected products.
- [ ] Record every source URL and acquisition ID.

### What to do

Use ASF Vertex manually or the Python `asf_search` library for programmatic discovery.

NISAR GCOV products are stored as HDF5 files.

Use a compatible pair with the same polarization and appropriately matched acquisition geometry.

Do not compare arbitrary satellite scenes and assume they are scientifically equivalent.

### Done when

Two real NISAR products can be opened, and their exact source metadata has been saved.

**Deliverables:**
- Two source scene records
- `data/scene_manifest.json`

## Task 2.3 — Implement Automated Data Discovery

- [ ] Implement a scene-search service in the backend.
- [ ] Accept geographic polygon input.
- [ ] Accept a date range.
- [ ] Search for available NISAR scenes.
- [ ] Return acquisition metadata.
- [ ] Handle missing observations.
- [ ] Allow the user to select valid scenes.

### What to do

Create a backend service using ASF search capabilities.

Suggested endpoint:

`POST /api/scenes/search`

Return scene information such as:

- Product ID
- Acquisition date
- Geographic footprint
- Product type
- Available polarizations
- Orbit information
- Dataset access reference

### Done when

A frontend request returns real acquisition metadata instead of hardcoded sample records.

**Fallback:** If live discovery is unreliable, provide the verified demo scenes from a local manifest and label them as preselected observations.

## Task 2.4 — Read Actual Radar Measurements

- [ ] Implement HDF5 reading using `h5py` or another suitable library.
- [ ] Inspect the selected GCOV frequency group.
- [ ] Find the available backscatter datasets.
- [ ] Extract a real-valued diagonal covariance layer.
- [ ] Extract geolocation or projection metadata.
- [ ] Handle invalid and missing measurements.
- [ ] Export a small test raster.

### What to do

Read the documented GCOV backscatter datasets.

Possible examples include:

- `HHHH`
- `HVHV`
- `VVVV`

The actual available layers depend on the acquisition.

Do not treat off-diagonal complex covariance layers as ordinary backscatter intensity images.

Use the selected dataset's coordinate information to preserve geographic alignment.

### Done when

A genuine radar layer can be extracted from the HDF5 product and displayed correctly on a map.

**Deliverable:** A georeferenced test GeoTIFF.

---

# PHASE 3 — SAR PREPROCESSING

**Priority: P0**

## Task 3.1 — Prepare Comparable Radar Observations

- [ ] Confirm the two scenes use compatible frequencies.
- [ ] Confirm the selected polarization matches.
- [ ] Check orbit direction and acquisition geometry.
- [ ] Read the spatial resolution and projection.
- [ ] Reproject to a common coordinate system if needed.
- [ ] Align both rasters to the same pixel grid.
- [ ] Clip to the study-area polygon.
- [ ] Apply valid-data masks.
- [ ] Exclude pixels without valid observations in both scenes.

### What to do

Use:

- Rasterio
- GDAL
- NumPy
- Shapely

Record the input scene properties and all transformations applied.

Do not interpret differences arising only from mismatched pixel grids as environmental changes.

### Done when

Both arrays have matching dimensions, geographic alignment, and a clearly defined common valid-data mask.

## Task 3.2 — Convert Radar Power to Decibels

- [ ] Identify the source measurement units.
- [ ] Confirm whether the source layer contains linear radar power.
- [ ] Exclude invalid or nonpositive values.
- [ ] Convert valid power values into dB where necessary.
- [ ] Save the processed baseline and comparison rasters.

### What to do

For positive linear power measurements:

`backscatter_dB = 10 × log10(power)`

Avoid applying this conversion twice to already-logarithmic values.

### Done when

Both processed images use the same documented units and can be visualized using consistent display ranges.

## Task 3.3 — Reduce Noise and Prepare Quality Masks

- [ ] Investigate speckle-reduction requirements.
- [ ] Choose an appropriate filter or smoothing approach.
- [ ] Document the filter parameters.
- [ ] Avoid excessive smoothing of narrow rivers and boundaries.
- [ ] Incorporate valid-data and quality-mask information.
- [ ] Preserve unfiltered measurements for comparison.

### What to do

Test simple filtering methods first.

Compare the original image with the filtered result and document whether small water features are being lost.

Do not claim that filtering improves accuracy without a supporting comparison.

### Done when

The preprocessing pipeline produces consistent, documented outputs and preserves an unfiltered reference.

---

# PHASE 4 — SURFACE CHANGE DETECTION

**Priority: P0 — CORE SCIENTIFIC FEATURE**

## Task 4.1 — Implement Backscatter Change Detection

- [ ] Load the two aligned radar images.
- [ ] Calculate the pixel-wise dB difference.
- [ ] Exclude invalid pixels.
- [ ] Create a change magnitude layer.
- [ ] Implement an adjustable change threshold.
- [ ] Visualize positive and negative backscatter changes.
- [ ] Export the calculated difference raster.

### What to do

Calculate:

`delta_dB = comparison_dB - baseline_dB`

A positive value indicates increased radar backscatter.

A negative value indicates decreased radar backscatter.

These changes do not, by themselves, establish a specific environmental cause.

### Done when

The backend generates a geographically correct change raster from two genuine NISAR observations.

**Deliverable:** `change_db.tif`

## Task 4.2 — Implement Candidate Surface-Water Detection

- [ ] Investigate the radar response of open water in the chosen study area.
- [ ] Select an initial water-classification method.
- [ ] Justify the threshold or classification logic.
- [ ] Generate a water mask for Date 1.
- [ ] Generate a water mask for Date 2.
- [ ] Compare the masks.
- [ ] Identify candidate water gain and recession.
- [ ] Document sources of false detections.

### What to do

Calm open water often exhibits low SAR backscatter, but wind, vegetation, surface roughness, and imaging geometry can change that response.

Start with a documented threshold-based classification using one compatible radar channel.

Use the same clearly defined classification methodology for both dates.

Allow threshold calibration using independent reference information where available.

### Done when

The application generates two water masks and a meaningful comparison map.

**Deliverables:**
- `water_before.tif`
- `water_after.tif`
- `water_change.tif`

## Task 4.3 — Classify Change Categories

- [ ] Identify stable water pixels.
- [ ] Identify candidate newly inundated pixels.
- [ ] Identify candidate water recession pixels.
- [ ] Identify stable nonwater pixels.
- [ ] Exclude missing-data pixels.
- [ ] Assign distinct map categories and colors.

### What to do

Use a simple categorical change legend:

| Category | Meaning |
|---|---|
| Stable water | Water detected on both dates |
| Water gain | Nonwater to water |
| Water loss | Water to nonwater |
| Stable nonwater | Nonwater on both dates |
| No data | Insufficient valid observations |

Do not classify a missing pixel as a surface change.

### Done when

The output includes a correctly georeferenced categorical raster and legend.

## Task 4.4 — Calculate Real Environmental Metrics

- [ ] Calculate total valid analyzed area.
- [ ] Calculate estimated water area on Date 1.
- [ ] Calculate estimated water area on Date 2.
- [ ] Calculate gross water gain.
- [ ] Calculate gross water loss.
- [ ] Calculate net water-area change.
- [ ] Calculate percentages relative to the valid analyzed area.
- [ ] Calculate valid-data coverage.

### What to do

Use the actual raster pixel dimensions and appropriate projected area calculations.

For equal-area pixels:

`area_km2 = pixel_count × pixel_area_m2 / 1,000,000`

If the raster is in latitude and longitude, do not treat degrees as meters.

Document how area is calculated.

### Done when

Every displayed number is calculated from real processed raster values, with its unit and analysis scope identified.

**Deliverable:** `metrics.json`

## Task 4.5 — Add Scientific Quality Checks

- [ ] Reject mismatched polarization comparisons.
- [ ] Flag incompatible acquisition geometry.
- [ ] Detect incomplete image coverage.
- [ ] Report masked or invalid pixel percentages.
- [ ] Flag insufficient scene overlap.
- [ ] Prevent area calculation using invalid pixels.
- [ ] Distinguish a successful analysis from a scientifically unreliable result.

### What to do

Implement explicit analysis statuses:

- `COMPLETE`
- `PARTIAL`
- `FAILED`

A `PARTIAL` result must explain which limitations affect interpretation.

### Done when

Invalid comparisons produce actionable warnings rather than misleading maps and statistics.

---

# PHASE 5 — BACKEND ANALYSIS ENGINE

**Priority: P0**

## Task 5.1 — Create a Reusable Analysis Pipeline

- [ ] Connect scene retrieval to preprocessing.
- [ ] Connect preprocessing to change detection.
- [ ] Connect detection to metrics generation.
- [ ] Save analysis metadata.
- [ ] Save generated raster results.
- [ ] Handle exceptions safely.
- [ ] Prevent duplicate processing where possible.

### What to do

Implement the full pipeline:

`Scene selection → Load data → Align rasters → Mask → Detect change → Calculate metrics → Export outputs`

The pipeline should run independently of the frontend.

### Done when

One backend command or API request can reproduce the same analysis from the same input data and parameters.

## Task 5.2 — Expose Analysis API Endpoints

- [ ] Implement `POST /api/analysis`.
- [ ] Implement `GET /api/analysis/{id}`.
- [ ] Implement `GET /api/analysis/{id}/results`.
- [ ] Implement a way to retrieve available raster layers.
- [ ] Validate input polygons and acquisition IDs.
- [ ] Return errors with meaningful messages.
- [ ] Document endpoint responses.

### What to do

An analysis response should provide:

- Status
- Source scene IDs
- Study area
- Acquisition dates
- Processing configuration
- Computed metrics
- Map layer references
- Quality warnings

For long-running processing, the application should expose status instead of blocking the request indefinitely.

### Done when

API endpoints return actual processed results that can be displayed by the frontend.

## Task 5.3 — Generate Web-Compatible Map Layers

- [ ] Export processed geospatial outputs.
- [ ] Preserve projection and geographic bounds.
- [ ] Generate transparent change overlays.
- [ ] Build appropriate visualization previews.
- [ ] Serve raster tiles or another suitable map-compatible representation.
- [ ] Test geographic alignment against a basemap.

### What to do

Use Cloud Optimized GeoTIFFs, a raster tile server, or appropriately georeferenced overlays.

Do not stretch an arbitrary PNG across a geographic extent if its projection or pixel alignment is incorrect.

### Done when

Detected changes appear in their correct real-world locations on the map.

---

# PHASE 6 — FRONTEND AND INTERACTIVE EXPERIENCE

**Priority: P0**

## Task 6.1 — Build the Main Geographic Explorer

- [ ] Implement the primary map or globe.
- [ ] Enable zooming and panning.
- [ ] Add location search if feasible.
- [ ] Show coordinates.
- [ ] Add drawing controls for geographic selection.
- [ ] Allow users to edit and clear selections.
- [ ] Send GeoJSON coordinates to the backend.

### What to do

Use the existing frontend framework.

MapLibre GL JS is suitable for a fast 2D implementation.

CesiumJS can support a 3D globe if it is already integrated or time permits.

Prioritize working interaction over 3D visual polish.

### Done when

A user can select a valid geographic polygon and the backend receives its coordinates.

## Task 6.2 — Build the Satellite Observation Selector

- [ ] Display available observation dates.
- [ ] Show product and polarization details.
- [ ] Allow baseline date selection.
- [ ] Allow comparison date selection.
- [ ] Disable incompatible comparisons.
- [ ] Show a loading state while searching.
- [ ] Clearly display when observations are unavailable.

### What to do

Fetch available scenes from the backend.

Use actual acquisition dates; do not show continuous daily coverage unless those observations exist.

### Done when

A user can select two compatible NISAR observations and submit an analysis request.

## Task 6.3 — Build the Before/After Viewer

- [ ] Display the baseline radar image.
- [ ] Display the comparison radar image.
- [ ] Use synchronized geographic bounds.
- [ ] Add an interactive comparison slider or switch.
- [ ] Show acquisition dates.
- [ ] Show radar measurement units.
- [ ] Add a consistent image legend.

### What to do

Both views must use identical geographic alignment.

Where possible, use a consistent backscatter display range to make the comparison meaningful.

### Done when

A user can visually inspect the same location on two acquisition dates without misalignment.

## Task 6.4 — Build the Change Detection Overlay

- [ ] Display the calculated change layer.
- [ ] Add category colors.
- [ ] Add layer visibility toggles.
- [ ] Add opacity controls.
- [ ] Show a map legend.
- [ ] Allow zooming into detected areas.
- [ ] Handle missing-data regions appropriately.

### What to do

Use the categorical raster produced by the backend.

Clearly label water gain, water loss, stable classes, and no-data areas.

### Done when

The change map is interactive and all classes can be interpreted without reading backend code.

## Task 6.5 — Build the Environmental Metrics Dashboard

- [ ] Display analyzed area.
- [ ] Display estimated water extent for both dates.
- [ ] Display candidate water gain.
- [ ] Display candidate water loss.
- [ ] Display net water-area change.
- [ ] Display valid-data coverage.
- [ ] Add meaningful charts.
- [ ] Connect every number to the actual API response.

### What to do

Suggested dashboard structure:

**Top:** Study-area name, location, and acquisition dates.

**Middle:** Before/after map and change overlay.

**Bottom:** Statistics, charts, and interpretation.

Use visually consistent units and precision.

### Done when

All dashboard statistics correspond exactly to the backend's saved analysis outputs.

---

# PHASE 7 — DELTA EARTH'S NOVELTY FEATURES

**Priority: P1**

## Task 7.1 — Create Evidence Cards

- [ ] Create a reusable evidence-card component.
- [ ] Display the geographic location.
- [ ] Display baseline and comparison dates.
- [ ] Display actual measured changes.
- [ ] Display source acquisition IDs.
- [ ] Display polarization and product information.
- [ ] Display processing method and threshold.
- [ ] Display valid-data coverage and limitations.
- [ ] Link to available source dataset information.

### What to do

An evidence card should explain:

**What changed?**  
Describe the classified change.

**How much changed?**  
Show the actual measured area.

**How was it detected?**  
Identify the satellite data and processing method.

**Why might it have changed?**  
Explain plausible physical drivers without claiming unsupported causality.

**How reliable is it?**  
Display validation evidence or clearly explain why classification accuracy is unknown.

### Done when

A judge can inspect a result and trace it back to its original satellite observations and processing configuration.

## Task 7.2 — Implement Explainable Environmental Insights

- [ ] Generate a plain-language analysis summary.
- [ ] Separate observations from interpretations.
- [ ] Explain relevant SAR measurements.
- [ ] Identify plausible environmental drivers.
- [ ] Display scientific limitations.
- [ ] Avoid unsupported causal claims.
- [ ] Cite the source datasets used.

### What to do

Start with deterministic templates populated using measured backend outputs.

For example, a summary can explain that an increase in classified open-water area was observed between two dates, while identifying rainfall or river-level variation as potential causes requiring independent evidence.

If an AI model is later introduced, provide it with structured verified measurements and prohibit invented statistics or citations.

### Done when

The explanation matches the map and numerical results and clearly distinguishes evidence from hypotheses.

## Task 7.3 — Build a Guided Story Mode

- [ ] Introduce the study region.
- [ ] Show the first radar observation.
- [ ] Show the second observation.
- [ ] Reveal the detected change.
- [ ] Present the measured statistics.
- [ ] Explain potential environmental causes.
- [ ] Describe why the findings matter.

### What to do

Create a narrative flow:

**Discover → Observe → Compare → Measure → Explain → Impact**

Allow the user to switch between guided storytelling and free exploration.

### Done when

A first-time visitor can understand the demonstration without technical knowledge of SAR.

---

# PHASE 8 — SCIENTIFIC VALIDATION AND TESTING

**Priority: P0 for essential tests; P1 for expanded evaluation**

## Task 8.1 — Validate Surface-Water Detection

- [ ] Find independent reference data for the chosen region and dates.
- [ ] Check reference imagery quality and geographic alignment.
- [ ] Compare the generated water masks with reference observations.
- [ ] Inspect false detections and missed water regions.
- [ ] Build a confusion matrix where valid reference labels are available.
- [ ] Calculate supported evaluation metrics.
- [ ] Document reference-data limitations.

### What to do

Useful metrics, where ground-truth labels are available:

- Precision
- Recall
- F1-score
- Intersection over Union (IoU)
- Confusion matrix

Use comparable dates and geographic boundaries.

Do not publish an accuracy percentage without documented validation data.

### Done when

The project includes transparent reference comparisons, or explicitly states that quantitative validation has not been established.

**Deliverable:** `docs/validation.md`

## Task 8.2 — Add Automated Backend Tests

- [ ] Test polygon validation.
- [ ] Test invalid scene metadata.
- [ ] Test unsupported polarization combinations.
- [ ] Test raster alignment.
- [ ] Test linear-power-to-dB conversion.
- [ ] Test invalid pixel masking.
- [ ] Test change-mask logic.
- [ ] Test area calculations.
- [ ] Test API response schemas.
- [ ] Test error handling.

### What to do

Use `pytest` with small synthetic test arrays for deterministic algorithm tests.

Separately maintain at least one integration test using actual NISAR sample data.

### Done when

The test suite passes and includes known expected outputs for the important calculations.

## Task 8.3 — Test the Complete User Workflow

- [ ] Open the application from a clean start.
- [ ] Select the study-area polygon.
- [ ] Retrieve actual scene metadata.
- [ ] Select two compatible dates.
- [ ] Run or load an analysis.
- [ ] Inspect the before/after comparison.
- [ ] Inspect the change overlay.
- [ ] Verify displayed metrics.
- [ ] Open the evidence card.
- [ ] Test error states.
- [ ] Confirm no browser-console or backend errors affect the demo.

### Done when

The demonstration can be repeated successfully without manually changing code or substituting fabricated outputs.

---

# PHASE 9 — PERFORMANCE AND DEPLOYMENT

**Priority: P0**

## Task 9.1 — Optimize the Demonstration

- [ ] Preprocess the selected demo scenes.
- [ ] Cache computed outputs.
- [ ] Avoid unnecessary repeated downloads.
- [ ] Reduce map tile and preview sizes where appropriate.
- [ ] Add frontend loading indicators.
- [ ] Implement useful error messages.
- [ ] Prepare a cached fallback when remote services are unavailable.

### What to do

For the hackathon demonstration, prefer a precomputed real analysis that loads reliably.

Live, unrestricted processing of arbitrary global regions can be developed later.

The precomputed result must retain its original source IDs and processing configuration.

### Done when

The complete demo runs reliably using saved genuine analysis results, even if live satellite discovery is temporarily unavailable.

## Task 9.2 — Deploy the Application

- [ ] Configure production environment variables.
- [ ] Deploy the frontend.
- [ ] Deploy the backend or prepare a documented local demo.
- [ ] Configure allowed frontend origins.
- [ ] Verify the backend is reachable.
- [ ] Verify geospatial layers load correctly.
- [ ] Check that credentials are not exposed.
- [ ] Test the public link from a separate browser session.

### What to do

Possible deployment options:

- Vercel or Netlify for the frontend
- A suitable Python hosting platform for the backend
- Static hosting for cached geospatial outputs

Choose a deployment that can handle the actual memory and storage requirements.

### Done when

The judges can access a working demonstration through the documented link or reliably reproduce it using the supplied instructions.

---

# PHASE 10 — DOCUMENTATION AND FINAL SUBMISSION

**Priority: P0**

## Task 10.1 — Finalize README.md

- [ ] Describe the problem clearly.
- [ ] Describe the implemented solution.
- [ ] Explain why NISAR was selected.
- [ ] Explain the scientific methodology.
- [ ] Document the actual technology stack.
- [ ] Provide setup instructions.
- [ ] Include dataset source links.
- [ ] Explain the project's novelty.
- [ ] Provide screenshots of genuine application outputs.
- [ ] Document validation and limitations.
- [ ] Add the demo link.
- [ ] Add team contributions.

### Done when

A new developer or judge can understand and run the completed project using the README.

## Task 10.2 — Prepare Scientific Evidence

- [ ] Save the study-area GeoJSON.
- [ ] Save source acquisition identifiers.
- [ ] Save acquisition dates.
- [ ] Save selected polarization and frequency.
- [ ] Save processing parameters.
- [ ] Save result metrics.
- [ ] Save change-map screenshots.
- [ ] Document any reference comparison.
- [ ] Document major limitations.

### What to do

Create a reproducibility document describing the entire process.

**Suggested file:** `docs/methodology.md`

### Done when

Every important scientific claim can be supported using identifiable data and documented calculations.

## Task 10.3 — Record the Final Demonstration Video

- [ ] Introduce the environmental problem.
- [ ] Explain the NISAR data source.
- [ ] Open Delta Earth.
- [ ] Select the study area.
- [ ] Show the two acquisition dates.
- [ ] Demonstrate the before/after map.
- [ ] Show detected changes.
- [ ] Explain the measured area.
- [ ] Open the evidence card.
- [ ] Summarize the project's impact and limitations.

### Recommended narrative

1. **Problem:** Important landscape changes are difficult to observe consistently.
2. **Solution:** Delta Earth uses NISAR observations to investigate those changes.
3. **Demonstration:** Show one real environmental-change analysis.
4. **Evidence:** Explain the measurements and their data provenance.
5. **Impact:** Explain how scientists, communities, or decision-makers could benefit.

### Done when

The video demonstrates the real application and clearly communicates its technical and scientific value.

## Task 10.4 — Review the Submission Against Judging Criteria

- [ ] **Impact:** Identify the real-world environmental problem being addressed.
- [ ] **Creativity:** Demonstrate evidence-linked visualization and explanation.
- [ ] **Validity:** Show real data, documented calculations, and honest limitations.
- [ ] **Relevance:** Demonstrate direct use of NISAR to investigate surface changes.
- [ ] **Presentation:** Deliver a clear, visually understandable demonstration.

### Done when

Each criterion has an identifiable piece of evidence in the application, README, or video.

## Task 10.5 — Final Submission Check

- [ ] Verify the project title and team details.
- [ ] Verify the final challenge selection.
- [ ] Verify the GitHub repository link.
- [ ] Verify the demo link.
- [ ] Verify the video link.
- [ ] Verify screenshots and documentation.
- [ ] Verify no secret keys or credentials are exposed.
- [ ] Ensure the latest code is pushed.
- [ ] Test the demonstration one final time.
- [ ] Submit the project through the official NASA Space Apps portal before the deadline.

---

# PHASE 11 — OPTIONAL ADVANCED FEATURES

**Priority: P2 — ONLY AFTER MVP**

## Task 11.1 — Multi-Date Time-Series Analysis

- [ ] Discover more than two compatible acquisitions.
- [ ] Process all observations using a consistent method.
- [ ] Calculate change metrics across dates.
- [ ] Display a temporal graph.
- [ ] Add a timeline slider.
- [ ] Animate map changes.

**Done when:** Multiple real observation dates can be explored, with actual values and acquisition gaps represented correctly.

## Task 11.2 — Multi-Polarization Analysis

- [ ] Detect available polarization channels.
- [ ] Extract compatible channels.
- [ ] Compare their surface responses.
- [ ] Display side-by-side polarization visualizations.
- [ ] Explain differences in scattering mechanisms.

**Done when:** Polarization comparisons use real compatible data and have documented scientific interpretations.

## Task 11.3 — Multi-Sensor Context

- [ ] Retrieve suitable Sentinel-2 imagery.
- [ ] Align optical and radar observations.
- [ ] Compare water or land-cover features.
- [ ] Add supporting layers.
- [ ] Explain differences between optical and radar measurements.

**Done when:** Supplementary observations genuinely improve interpretation or validation.

## Task 11.4 — Ground Deformation Analysis

- [ ] Investigate suitable NISAR interferometric products.
- [ ] Study available displacement measurements and quality layers.
- [ ] Select a validated deformation dataset.
- [ ] Render displacement values and units.
- [ ] Explain uncertainties and measurement geometry.

**Important:** Backscatter differences are not direct measurements of ground displacement.

**Done when:** Actual deformation measurements are visualized with appropriate products and documented limitations.

## Task 11.5 — Forest and Agricultural Change

- [ ] Research the radar signatures associated with the selected process.
- [ ] Choose a suitable study region.
- [ ] Implement scenario-specific classification.
- [ ] Validate results independently.
- [ ] Create dedicated visualizations.

**Done when:** The added application demonstrates a genuine scientifically supported use case rather than relabeling generic backscatter changes.

## Task 11.6 — Exportable Analysis Reports

- [ ] Export selected study-area information.
- [ ] Include source metadata.
- [ ] Include visualizations.
- [ ] Include computed statistics.
- [ ] Include methodological notes.
- [ ] Include validation and limitations.

**Done when:** A user can generate a reproducible analysis summary without manually taking screenshots.

---

# ACCEPTANCE TEST — THE COMPLETE MVP

The project is ready for demonstration only when the following conditions are satisfied.

- [ ] At least two real NISAR acquisitions have been processed.
- [ ] Their radar measurements are correctly extracted.
- [ ] Both observations are geographically aligned.
- [ ] At least one actual change-detection raster has been generated.
- [ ] The change measurements are calculated rather than invented.
- [ ] The analysis includes valid-data and quality checks.
- [ ] The frontend displays the before/after observations.
- [ ] The frontend displays the computed change layer.
- [ ] The dashboard statistics agree with backend results.
- [ ] Evidence cards link results to original acquisitions.
- [ ] The scientific methodology and limitations are documented.
- [ ] The end-to-end demonstration works.
- [ ] The README contains genuine results and screenshots.
- [ ] The project is ready for submission.

---

# RECOMMENDED IMPLEMENTATION ORDER

Do not work on every phase simultaneously without confirming the scientific processing first.

| Order | Workstream | Priority |
|---|---|---|
| 1 | Verify study region and acquire NISAR scenes | Critical |
| 2 | Extract actual GCOV raster measurements | Critical |
| 3 | Align observations and calculate differences | Critical |
| 4 | Generate candidate water masks and statistics | Critical |
| 5 | Validate outputs and preserve provenance | Critical |
| 6 | Build backend analysis endpoints | Critical |
| 7 | Connect the map and comparison interface | Critical |
| 8 | Display dashboard metrics and evidence cards | Critical |
| 9 | Test and prepare a reliable demo | Critical |
| 10 | Finalize README, video, and submission | Critical |
| 11 | Add animations and advanced visualizations | Optional |
| 12 | Expand to other environmental processes | Optional |

---

# TEAM WORKSTREAMS

Assign people according to expertise and availability.

### Workstream A — Radar Data and Scientific Processing

Responsible for:
- NISAR acquisition
- GCOV extraction
- SAR preprocessing
- Change detection
- Area calculations
- Scientific validation

**Required handoff:** Real processed rasters, metrics, acquisition metadata, and documentation.

### Workstream B — Backend and Data Integration

Responsible for:
- API development
- Scene discovery
- Analysis orchestration
- Data storage and caching
- Error handling
- Raster delivery
- Integration testing

**Required handoff:** Working API endpoints and reproducible analysis results.

### Workstream C — Frontend and Visualization

Responsible for:
- Interactive map
- Polygon selection
- Date selector
- Before/after viewer
- Change overlay
- Dashboard
- Evidence cards
- Responsive user interface

**Required handoff:** Working user flow connected to actual analysis data.

### Workstream D — Research, Testing, and Presentation

Responsible for:
- Environmental study-area research
- Methodology
- Validation evidence
- Documentation
- Demo script
- Recording
- Submission review

**Required handoff:** Scientific evidence, final presentation materials, and verified submission links.

One person can handle multiple workstreams if the team is small.

---

# NON-NEGOTIABLE PROJECT RULES

- Never fabricate satellite detections, accuracy percentages, or measurements.
- Do not confuse radar backscatter differences with confirmed environmental changes.
- Do not claim that a weather event caused a detected change without supporting evidence.
- Keep actual acquisition metadata attached to every scientific output.
- Always distinguish observed measurements, classifications, and interpretations.
- Ensure area statistics use correct geographic units.
- Do not present demonstration images or mock data as real satellite evidence.
- Avoid adding many incomplete features at the expense of the working MVP.
- Preserve reproducibility: the same inputs and processing settings should produce consistent results.
- Document scientific uncertainty rather than hiding it.
- Keep the final application understandable to users who do not know SAR technology.

---

# FINAL PROJECT MILESTONE

**Delta Earth is ready when a user can select a real location, compare genuine NISAR observations, visualize a measured surface change, understand the supporting evidence, and reproduce the analysis.**

**Core innovation:** Evidence-linked, explainable Earth surface-change visualization using NISAR radar measurements.

**Final priority:** A scientifically valid, reliable, interactive demonstration before additional features.

---

**Delta Earth — See the change. Understand the evidence. Explore the planet.**