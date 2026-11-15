# Where the Po Meets the Sea

Owner: Umar. Region: Europe — Po Delta, Italy.

Five real NISAR frequency-A HHHH acquisitions follow the delta's river branches, coastal water margins and agricultural field mosaic from June to October 2026. This story uses the updated chapter viewer and synchronized baseline comparison.

| Chapter | Acquisition | CMR granule |
| --- | --- | --- |
| A delta in early summer | 19 June 2026 | G4244115365-ASF |
| The July field mosaic | 13 July 2026 | G4253074530-ASF |
| Across the August landscape | 18 August 2026 | G4286147567-ASF |
| The strongest selected response | 11 September 2026 | G4310309581-ASF |
| The October return | 17 October 2026 | G4377830715-ASF |

## What is observed

The mean HH radar response across valid study pixels progresses from −12.55 dB in June to −11.36 in July, −11.08 in August and −9.87 in September, before easing to −10.14 in October. The baseline comparison shows changes in the field mosaic while branching waterways remain recognizable. These are radar measurements; crop activity, vegetation and moisture are interpretations requiring independent evidence. No flood extent, erosion rate or harvested area is claimed.

The study rectangle covers 12.10–12.35° E, 44.80–45.02° N. It is an investigation area, not an official delta boundary. All images share a 1027 × 1255 grid in EPSG:32633 at 20 m resolution. The display is fixed to viridis, −30 to +5 dB, across all five images. Positive source power is converted with `10*log10`; nonpositive values and NoData are excluded. Mean dB is the mean of pixel-level dB values, not dB of the mean linear power.

## Reproduction and evidence

From the repository root:

```powershell
rtk proxy .\.venv\Scripts\python.exe Backend/scripts/prepare-story.py Backend/Stories/umar/po-delta
rtk proxy .\.venv\Scripts\python.exe Backend/scripts/build-story-sequence.py po-delta
```

- [Study area](study-area.geojson) and [explicit dates and chapter copy](sequence-content.json).
- [CMR discovery](discovery.json): 52 overlapping catalog records; the selected dates share descending track 080, frame 066 and acquisition mode.
- [Original browse provenance](assets.json): full-scene context downloaded from NASA, not timeline screenshots.
- [Published frames and measurement provenance](../../case-studies/po-delta-sequence-2026/result.json): exact product identifiers, source URLs, source TIFF hashes, output PNG hashes and valid-pixel statistics.
- [Independent source/image checks](validation.json) and [Chrome browser verification](browser-verification.json).

Source TIFFs remain in the ignored persistent pipeline data directories. Opening the curated story reads local prepared assets and does not submit another NASA extraction.

## Context source

[ESA: Earth from Space — Po](https://www.esa.int/Applications/Observing_the_Earth/Earth_from_Space_Po) describes the delta's agricultural setting and branching channels in a historical multi-date radar image. It provides landscape context rather than validation of a 2026 event.
