# Jeddah: reading a dry city's drainage landscape

Owner: Umar. Location: eastern urban Jeddah, Saudi Arabia.

## Browser sequence

The integrated story now includes **20 June, 14 July, 19 August, 24 September and 18 October 2026**. Every frame uses the same grid and viridis −30 to +5 dB scale. Open “Jeddah: five visits to a dry city's drainage landscape” in the browser Stories catalog. [Published frames, captions and provenance](../../case-studies/jeddah-sequence-2026/result.json) are generated from [sequence-content.json](sequence-content.json) and individually retrieved pipeline TIFFs. The original two-date comparison below remains supporting evidence.

## Story copy

### A dry setting with a water story

Jeddah lies between the Red Sea and higher ground to the east. Research describes drainage routes crossing the city toward the coast, where brief storms can create flash-flood hazards. A study of historical events identifies June–September as the usual dry season and November–January as the wetter period.[1] That background motivates an investigation; it does not demonstrate a flood in the images selected here.

### Establishing a baseline

The selected NISAR dates are **20 June and 18 October 2026**: a summer observation and an autumn observation before the main wetter period described in the historical study. Both use descending track 093, frame 078, frequency A and HHHH. They provide a candidate baseline comparison of the urban drainage landscape. They are not labeled “before flood” and “after flood,” because no matching event has been established.

### Read the land before naming the change

Start with broad drainage corridors and neighboring built surfaces. If the radar response changes, ask where the change occurs and whether it follows a plausible surface feature. Smooth dry ground can appear dark, while buildings and terrain can create shadows or strong returns. A dark patch in this setting needs additional evidence before it is interpreted as standing water.

### What the processed comparison measured

The retrieved rasters share **292.2155 km² of valid comparison area** (2,922,155 pixels). The mean native linear-power response rose from **0.5437 to 0.6243**, giving a mean later-minus-earlier difference of **+0.08058**. These dimensionless values (`1`) are **not dB**, rainfall totals or water-depth measurements. Strong urban scatterers can influence the mean. See [change-statistics.json](change-statistics.json) for exact values, masks and the alignment method.

### Why it matters

The useful question is **what does this drainage landscape look like before a documented storm, and can a later acquisition capture a response?** A repeatable baseline helps frame that question. Event-specific rainfall timing and an observation soon after the storm are essential: a short-lived flow may disappear between satellite passes. Absence of mapped standing water cannot establish that flooding did not occur.

## Evidence and assets

- Study polygon: [study-area.geojson](study-area.geojson), 39.17–39.32° E, 21.45–21.62° N. This rectangular urban investigation area is not a delineated watershed or flood-risk boundary.
- Public discovery: [discovery.json](discovery.json), queried for 1 June–15 November 2026; 34 catalog observations.
- Selected baseline: `G4244036293-ASF`, 2026-06-20T15:55:15Z.
- Selected comparison: `G4379922692-ASF`, 2026-10-18T15:55:12Z.
- Selected measurement: NISAR provisional GCOV, frequency A, HHHH.
- [Earlier scene](browse-before.png) and [later scene](browse-after.png): original full-scene NASA browse images, **not** application timeline screenshots. They provide regional context and are not cropped GeoTIFFs or classified flood maps.
- [assets.json](assets.json) records URLs, acquisition dates and SHA-256 hashes.
- [pipeline-check.json](pipeline-check.json) records a successful live API workflow through batch retrieval, individual TIFF downloads, previews, comparison, change export and animated-timeline export.
- [comparison.png](comparison.png), [change.png](change.png) and the `preview-*.png` files are generated from the extracted rasters. Individual previews use independent stretches; compare dates with the shared-range timeline. Change colors indicate radar response differences rather than inundation classes.
- Individual source TIFFs and export ZIPs are retained locally in `.local-run/story-downloads/jeddah/`, with hashes in the pipeline report.

## Publication requirements

Retrieve the individual GeoTIFFs, verify actual overlap and valid masks, and use matching units, polarization, frequency and processing versions. Inspect the study area independently of the full-scene preview. Do not apply another region's water threshold without local evaluation. Keep stable coastal water out of any inland flood-area estimate. Combine a confirmed storm timestamp with local rainfall or GPM observations, terrain and an independent event map before attributing a change to flooding.

No 2026 flood event, inundation area, damage total or detection accuracy is asserted here. This story establishes a baseline and a reproducible question. Historical flood research supplies context rather than validation of these two observations.

## Sources

1. [Tekeli (2017), Exploring Jeddah Floods by Tropical Rainfall Measuring Mission Analysis, Water 9(8), 612](https://www.mdpi.com/2073-4441/9/8/612). Historical regional and seasonal context; the paper examines 2000–2014, not the selected 2026 scenes.
2. [NASA CMR collection C2854338529-ASF](https://cmr.earthdata.nasa.gov/search/concepts/C2854338529-ASF.html). Exact scene provenance is retained in the discovery snapshot.
