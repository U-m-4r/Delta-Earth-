# Bangalore: following water through the city's lake corridor

Owner: Umar. Location: Bellandur–Varthur, Bengaluru (Bangalore), India.

## Browser sequence

The integrated story now includes **27 June, 21 July, 26 August, 19 September and 13 October 2026**. All five frames use the same map grid and viridis −30 to +5 dB scale. Open “Bangalore: five views of a lake corridor” in the browser Stories catalog. [Published frames, captions and provenance](../../../Frontend/public/case-studies/bangalore-sequence-2026/result.json) are generated from [sequence-content.json](sequence-content.json) and the individual pipeline TIFFs. The original two-date analysis below remains supporting evidence.

## Story copy

### A connected landscape

Bellandur and Varthur are linked parts of Bangalore's drainage system. Water leaving Bellandur continues toward Varthur, so a change around one lake belongs to a wider catchment story. IISc research documents urban development around these wetlands and seasonal variation in floating vegetation. That makes this corridor a useful place to investigate how water and the surrounding land appear to radar.[1][2]

### Two views across a season

Our selected NISAR observations were acquired on **27 June and 13 October 2026**. They share ascending track 012, frame 008 and the same acquisition mode. The first comparison uses frequency A, HHHH, rather than mixing channels or looking directions. These are early and late observations in the available sequence; neither is identified as a flood peak.

### What to look for

Compare the lake margins first, then inspect the connecting landscape. Changes in radar response can identify places worth investigating. A darker surface may be consistent with smooth open water, but it can also reflect other surface conditions. Floating vegetation and buildings can complicate the pattern. A before/after image alone cannot establish how much water was stored or whether a neighborhood flooded.

### What the processed comparison measured

The extracted HHHH rasters share **144.2266 km² of valid comparison area** (1,442,266 pixels). Across that overlap, the mean native linear-power value changed from **0.8331 to 0.9032**, a mean later-minus-earlier difference of **+0.07006**. Units are dimensionless (`1`), **not dB**. These area-wide averages can be influenced by strong urban returns and do not measure lake area or demonstrate a flood. See [change-statistics.json](change-statistics.json) for the exact values and alignment method.

### Why it matters

Following the corridor gives viewers a local question they can investigate: **do the same lake edges and drainage connections remain visible on both dates?** A useful result would connect a mapped change to an acquisition date, a defined polygon and a reproducible measurement. Rainfall records, contemporary optical images and local observations are needed to explain the cause.

## Evidence and assets

- Study polygon: [study-area.geojson](study-area.geojson), 77.62–77.77° E, 12.90–12.98° N. This rectangular investigation area is not a surveyed lake or catchment boundary.
- Public discovery: [discovery.json](discovery.json), queried for 1 June–15 November 2026; 18 catalog observations.
- Selected baseline: `G4243038533-ASF`, 2026-06-27T00:24:49Z.
- Selected comparison: `G4366260007-ASF`, 2026-10-13T00:24:46Z.
- Selected measurement: NISAR provisional GCOV, frequency A, HHHH.
- [Earlier scene](browse-before.png) and [later scene](browse-after.png): downloaded full-scene NASA browse images, **not** images captured from the application timeline. They cover more than this polygon, use provider rendering and are not quantitative change products.
- [assets.json](assets.json) records the original URLs, dates and SHA-256 hashes.
- [pipeline-check.json](pipeline-check.json) records the successful live API check, including batch retrieval, individual GeoTIFF downloads, previews, comparison and both change and animated-timeline exports.
- [comparison.png](comparison.png), [change.png](change.png) and the two `preview-*.png` files were generated from the extracted rasters. Preview stretches are selected independently; use the shared-range timeline for visual comparison across dates. Change colors show measured response differences, not water classes.
- Individual source TIFFs and export ZIPs are available locally in `.local-run/story-downloads/bangalore/`; their hashes are recorded in the pipeline report.

## Publication requirements

Use the individual exported GeoTIFFs for analysis. Check the actual valid-pixel overlap, projection, units, processing versions, acquisition geometry and quality masks. Apply one documented display range to both previews. Report the valid comparison area and the method used for any classification; do not reuse the flood thresholds from another location. Validate changes against contemporary independent evidence. Radar cannot measure sewage concentration, water quality or reservoir volume from these previews.

No water-area change, flood footprint, damage count or classification accuracy is claimed in this draft. The successful extraction and measured response differences establish an observation comparison; they do not establish an environmental event.

## Sources

1. [IISc: Insights to bioprocess and treatment competence of urban wetlands — study methods](https://wgbis.ces.iisc.ac.in/energy/water/paper/urban%20wetlands/method.htm). Historical context, not evidence of a 2026 event.
2. [IISc: Pathetic status of wetlands in Bangalore — report](https://wgbis.ces.iisc.ac.in/energy/water/paper/ETR93/ETR93_Varthur-Fiasco-Full-report.pdf). Historical study-area context, not a contemporary lake survey.
3. [NASA CMR collection C2854338529-ASF](https://cmr.earthdata.nasa.gov/search/concepts/C2854338529-ASF.html). Acquisition provenance is retained in the discovery snapshot.
