"""Save public NISAR discovery evidence for a location without loading credentials.

Run from the repository root:
  .venv/Scripts/python Backend/scripts/prepare-story.py stories/umar/bangalore
This prepares evidence, not a finished change classification or flood claim.
"""
import argparse
import asyncio
import hashlib
import json
import re
from datetime import date, datetime, timezone
from pathlib import Path

import httpx
from app import cmr
from app.geometry import validate_geojson
from app.settings import Settings


async def prepare(folder: Path, start: date, end: date):
    feature = json.loads((folder / "study-area.geojson").read_text(encoding="utf-8"))
    polygon, area, bounds, _ = validate_geojson(feature)
    # Public discovery must never reuse a credential committed to the repository.
    config = Settings(_env_file=None, earthdata_token=None, edl_token=None)
    cmr.get_settings = lambda: config
    result = await cmr.search_granules(polygon, start, end, all_pages=True)
    groups = {}
    for observation in result["observations"]:
        # Orbit cycle changes between passes; track, direction, frame and mode
        # must stay the same. These are candidate comparisons for later review.
        match = re.search(r"GCOV_\d+_(\d+_[AD]_\d+_[A-Z0-9]+_[A-Z0-9]+_[AB])_", observation["title"])
        if not match:
            continue
        # CMR boxes are south/west/north/east; actual footprint overlap is still
        # required when the downloaded raster is inspected.
        box = observation.get("bbox")
        if box and not (box[1] <= bounds[0] and box[0] <= bounds[1]
                        and box[3] >= bounds[2] and box[2] >= bounds[3]):
            continue
        for variable in observation["availableVariables"]:
            if variable["variable"] not in {"HHHH", "VVVV", "HVHV", "VHVH"}:
                continue
            key = (match[1], variable["frequency"], variable["variable"])
            groups.setdefault(key, []).append(observation)
    candidates = []
    for (geometry, frequency, variable), rows in groups.items():
        rows.sort(key=lambda item: (item["acquiredAt"], item["id"]))
        unique = {item["acquiredAt"]: item for item in rows}
        rows = list(unique.values())
        if len(rows) < 2:
            continue
        candidates.append({"geometry": geometry, "frequency": frequency, "variable": variable,
                           "observationCount": len(rows), "before": rows[0]["id"],
                           "after": rows[-1]["id"], "dates": [item["acquiredAt"] for item in rows]})
    candidates.sort(key=lambda item: (item["variable"] != "HHHH", -item["observationCount"], item["geometry"]))
    for observation in result["observations"]:
        observation["assets"] = [asset for asset in observation["assets"]
                                 if asset["url"].startswith("https://")
                                 and "PRIVATE-DATA" not in asset["url"]]
    result.update({"queriedAt": datetime.now(timezone.utc).isoformat(),
                   "requestedDates": [start.isoformat(), end.isoformat()], "areaKm2": area,
                   "candidateComparisons": candidates,
                   "status": "discovered; GeoTIFF retrieval and interpretation pending",
                   "limitations": "Catalog overlap only; boxes may be unavailable. Verify actual raster coverage, units, quality masks and alignment before comparing."})
    (folder / "discovery.json").write_text(json.dumps(result, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    # Save a public browse preview for each endpoint of the strongest candidate.
    # Browse images are context only and must never supply quantitative metrics.
    assets = []
    if candidates:
        chosen = candidates[0]
        async with httpx.AsyncClient(follow_redirects=True, timeout=60) as client:
            for label in ("before", "after"):
                observation = next(row for row in result["observations"] if row["id"] == chosen[label])
                browse = next((asset for asset in observation["assets"] if asset["type"] == "browse"
                               and asset["url"].startswith("https://")
                               and asset["url"].split("?", 1)[0].lower().endswith(".png")), None)
                if not browse:
                    continue
                response = await client.get(browse["url"])
                response.raise_for_status()
                if not response.content.startswith(b"\x89PNG\r\n\x1a\n"):
                    raise ValueError("Browse asset was not a PNG image")
                name = f"browse-{label}.png"
                (folder / name).write_bytes(response.content)
                assets.append({"file": name, "url": browse["url"], "granuleId": observation["id"],
                               "acquiredAt": observation["acquiredAt"],
                               "sha256": hashlib.sha256(response.content).hexdigest(),
                               "role": "Full-scene browse context; not an AOI GeoTIFF or quantitative result"})
    (folder / "assets.json").write_text(json.dumps(assets, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"location": str(folder), "observations": len(result["observations"]),
                      "candidateComparisons": len(candidates), "browseImages": len(assets)}))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("folder", type=Path)
    parser.add_argument("--start", type=date.fromisoformat, default=date(2026, 6, 1))
    parser.add_argument("--end", type=date.fromisoformat, default=date(2026, 11, 15))
    args = parser.parse_args()
    if args.start > args.end:
        parser.error("start must be on or before end")
    asyncio.run(prepare(args.folder, args.start, args.end))
