# Following the Senegal's Seasonal Pulse

Owner: Umar. Region: Africa — Podor floodplain, Senegal–Mauritania border.

This story follows five NISAR frequency-A HHHH observations of the Senegal River corridor and its adjacent lowlands. It uses the updated chapter viewer, geographic zoom and synchronized baseline comparison to follow the same ground through the season.

## Observations

The selected dates are **22 June, 16 July, 2 September, 26 September and 20 October 2026**, all from descending track 124, frame 080 with the same acquisition mode. There is no August observation in this selected track; the gap must remain visible in the chronology. These acquisition dates are not independently established event stages, a maximum flood or a recovery sequence.

The rectangular study area covers 15.05–14.82° W, 16.50–16.72° N. It is an investigation window, not a delineated watershed or an official flood-risk boundary. Each frame is aligned to the first acquisition and uses viridis with one fixed −30 to +5 dB range. Positive source power is converted to dB with `10*log10`; invalid and nonpositive pixels are excluded. The scientific metadata records the actual grid and measurements.

The common grid is 1226 × 1216 in EPSG:32628 at 20 m resolution, with 1,490,707 valid pixels in each selected frame. Mean pixel-level dB progresses through **−15.12, −15.17, −14.75, −12.92 and −14.20 dB**. The strongest selected average is late September; it is not a flood-area or water-depth estimate. These figures average pixel-level dB, rather than converting mean linear power to dB.

## Reading the story

Research on the Senegal floodplain describes a river pulse influenced by monsoon rainfall upstream and river management. Historical peaks often occur in September or October, and floodplain water supports farming, fishing and grazing. That seasonal context explains why these visits are useful; it does not prove the timing or extent of a particular 2026 flood. Darkening may be consistent with smooth water, while vegetation, roughness and imaging conditions can also alter radar response. Independent water-level and contemporary reference imagery are needed before reporting validated inundation.

## Reproduction and evidence

```powershell
rtk proxy .\.venv\Scripts\python.exe Backend/scripts/prepare-story.py Backend/Stories/umar/senegal-river
rtk proxy .\.venv\Scripts\python.exe Backend/scripts/build-story-sequence.py senegal-river
```

- [Study area](study-area.geojson) and [explicit dates and chapters](sequence-content.json).
- [CMR discovery](discovery.json): 19 overlapping records, with the selected dates grouped by compatible acquisition geometry.
- [Original browse provenance](assets.json): full-scene NASA context imagery, not timeline screenshots.
- [Published frames and source provenance](../../case-studies/senegal-river-sequence-2026/result.json).
- [Independent source/image validation](validation.json) and [Chrome browser verification](browser-verification.json).

The individual source TIFFs are retained in ignored pipeline storage. Prepared story playback requires no further satellite retrieval.

## Context source

[Ogilvie et al. (2020), Improved understanding of the Senegal floodplain socio-hydrosystems with multi-scalar earth observations](https://piahs.copernicus.org/articles/383/255/2020/index.html) documents regional seasonal hydrology and floodplain livelihoods. Its historical observations are context, not validation of the selected 2026 images.
