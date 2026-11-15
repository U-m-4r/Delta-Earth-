# SK radar stories

Canonical location after the Story-design pull: Backend/Stories/sk. These six story definitions use the same sequence format and the same shared StoryViewer and AcquisitionTimeline as Umar's Bangalore and Jeddah stories. Actual rendered frames are served from the adjacent case-studies/<slug> folders, as for Umar. Raw calibrated GeoTIFF subsets are retained under data/ and referenced by radar-sources.json with exact source IDs, dates and file hashes.

- assam-brahmaputra-2026 — 4 observations; NISAR; 2026-06-16, 2026-07-22, 2026-08-15, 2026-10-14
- pakistan-indus-2026 — 4 observations; NISAR; 2026-06-17, 2026-07-23, 2026-08-16, 2026-10-15 (archived from showcase)
- pakistan-tarbela-2026 — 3 observations; NISAR; 2026-06-25, 2026-07-19, 2026-08-12
- nepal-glacier-flood-2026 — 3 observations; NISAR; 2026-08-19, 2026-08-31, 2026-10-06
- punjab-floods-2025 — 4 observations; Sentinel-1 RTC; 2025-08-01, 2025-08-13, 2025-08-25, 2025-09-18
- pakistan-floods-2022 — 4 observations; Sentinel-1 RTC; 2022-08-03, 2022-08-15, 2022-08-27, 2022-09-20

The older optical research and independent flood evidence remain preserved in the original stories/sk directory. They are not substituted for these real radar frames. Nepal's old optical year conflict is separate from these catalogued NISAR acquisition timestamps. The 2022 and 2025 stories use Sentinel-1 C-band VV terrain-corrected data, not NISAR. Those two stories focus on explicitly defined subregions, not the entire country or province.

Each sequence uses a common grid and fixed viridis −30 to +5 dB display. NISAR source dB values are not converted a second time; linear GCOV / Sentinel-1 gamma-naught power uses 10*log10. Preview grids are resampled to at most roughly 1800 pixels per side for practical viewing; statistics refer to that grid. Do not compare different missions or polarization channels as equivalent measurements. These are measured radar sequences, not validated flood classification, flood depth or storage estimates.

Reproduction: use dw Python, run Backend/scripts/build-sk-sequences.py for local/historical cases, Backend/scripts/retrieve-sk-nisar.py for the two NASA extractions, then Backend/scripts/finalize-sk-sequences.py. Historical subset selection uses the saved public STAC discovery under .local-run/sk-radar. Full originals are not downloaded; calibrated COG windows are read and saved locally. No signed access token is recorded in the story manifests.

The pull completed at e1603b7. Prior local tracked edits are retained in Git stash and .local-run/before-story-design-pull.
Final browser checks passed for the five active SK sequences and both Umar sequences: all image hashes and dates, the shared viewer, date selection, captions, baseline comparison, synchronized zoom, mobile layout and no upstream retrieval during viewing. All six SK sequences passed the saved-source/statistics verification (22 frames total). Use Backend/scripts/build-ready-sk-nisar.py to reproduce the three-date Nepal/Tarbela selection after retrieval. Local preview currently uses frontend 127.0.0.1:5173 and the new Python backend 127.0.0.1:8788; the earlier backend session on 8787 was preserved.
