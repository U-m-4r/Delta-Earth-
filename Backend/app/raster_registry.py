"""Persistent, study-scoped registry for locally processed rasters.

Granule GeoTIFFs remain the extraction pipeline's canonical output. This module
atomically publishes immutable study-scoped links/copies and a rebuildable index
so visualization requests can use local outputs without invoking Harmony.
"""

from __future__ import annotations

import json
import logging
import os
import re
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from uuid import uuid4

import numpy as np
import rasterio
from rasterio.warp import transform_bounds

log = logging.getLogger(__name__)
STUDY_ID_RE = re.compile(r"^[a-f0-9]{16}$")
SAFE_ID_RE = re.compile(r"[^A-Za-z0-9_.-]")
REGISTRY_VERSION = 1


def _json_safe(value: Any) -> Any:
    if isinstance(value, dict):
        return {key: _json_safe(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_json_safe(item) for item in value]
    if isinstance(value, np.generic):
        value = value.item()
    if isinstance(value, float) and not np.isfinite(value):
        return None
    return value


def _atomic_json(path: Path, value: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.{uuid4().hex}.tmp")
    try:
        with temporary.open("w", encoding="utf-8") as stream:
            stream.write(json.dumps(_json_safe(value), indent=2, allow_nan=False))
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def _safe_id(value: str) -> str:
    return SAFE_ID_RE.sub("_", value)[:300]


def _openable_tiff(path: Path) -> bool:
    try:
        with rasterio.open(path) as dataset:
            return dataset.driver == "GTiff" and dataset.count > 0 and dataset.width > 0 and dataset.height > 0 and dataset.crs is not None
    except (OSError, rasterio.errors.RasterioError):
        return False


def raster_summary(path: Path) -> dict[str, Any]:
    """Read georeferencing and finite pixel statistics without loading the full raster."""
    with rasterio.open(path) as dataset:
        if dataset.driver != "GTiff" or dataset.count < 1 or dataset.width < 1 or dataset.height < 1:
            raise ValueError("Stored output is not a valid, non-empty GeoTIFF.")
        if dataset.crs is None:
            raise ValueError("Stored GeoTIFF has no CRS.")
        nodata = dataset.nodata
        band_tags = dataset.tags(1)
        nodata_state = None
        if isinstance(nodata, (float, np.floating)) and not np.isfinite(nodata):
            nodata_state = "nan" if np.isnan(nodata) else "positive_infinity" if nodata > 0 else "negative_infinity"
        sample_parts: list[np.ndarray] = []
        valid_count = 0
        value_sum = 0.0
        minimum = maximum = None
        for _, window in dataset.block_windows(1):
            masked = dataset.read(1, window=window, masked=True)
            values = np.asarray(masked.data)
            valid = ~np.ma.getmaskarray(masked) & np.isfinite(values)
            if valid.any():
                current = values[valid].astype(np.float64, copy=False)
                valid_count += int(current.size)
                value_sum += float(current.sum(dtype=np.float64))
                current_min, current_max = float(current.min()), float(current.max())
                minimum = current_min if minimum is None else min(minimum, current_min)
                maximum = current_max if maximum is None else max(maximum, current_max)
                sample_parts.append(current[::max(1, current.size // 4096)])
        if valid_count:
            sample = np.concatenate(sample_parts)
            mean, median = value_sum / valid_count, float(np.median(sample))
        else:
            minimum = maximum = mean = median = None
        bounds = [dataset.bounds.left, dataset.bounds.bottom, dataset.bounds.right, dataset.bounds.top]
        bounds_wgs84 = list(transform_bounds(dataset.crs, "EPSG:4326", *bounds, densify_pts=21))
        return _json_safe({
            "crs": dataset.crs.to_string(), "transform": list(dataset.transform)[:6],
            "width": dataset.width, "height": dataset.height,
            "resolution": list(dataset.res), "nodata": nodata,
            "units": band_tags.get("units"),
            "description": band_tags.get("long_name") or band_tags.get("description"),
            "nodataNonFinite": nodata_state, "bounds": bounds,
            "boundsWgs84": bounds_wgs84, "dtype": dataset.dtypes[0],
            "validPixelCount": valid_count,
            "nodataPixelCount": dataset.width * dataset.height - valid_count,
            "minimum": minimum, "maximum": maximum, "mean": mean, "median": median,
        })


def _atomic_raster_publish(source: Path, destination: Path) -> bool:
    """Publish an immutable raster; return False when an existing valid output wins."""
    destination.parent.mkdir(parents=True, exist_ok=True)
    if destination.exists():
        try:
            raster_summary(destination)
            return False
        except (OSError, ValueError, rasterio.errors.RasterioError):
            destination.unlink(missing_ok=True)
    temporary = destination.with_name(f".{destination.name}.{uuid4().hex}.tmp")
    try:
        try:
            os.link(source, temporary)
        except OSError:
            with source.open("rb") as input_stream, temporary.open("wb") as output_stream:
                shutil.copyfileobj(input_stream, output_stream)
                output_stream.flush()
                os.fsync(output_stream.fileno())
        with rasterio.open(temporary) as dataset:
            if dataset.driver != "GTiff" or dataset.count < 1 or dataset.width < 1 or dataset.height < 1:
                raise ValueError("Refusing to register invalid GeoTIFF output.")
        try:
            os.link(temporary, destination)
            return True
        except FileExistsError:
            try:
                raster_summary(destination)
                return False
            except (OSError, ValueError, rasterio.errors.RasterioError):
                destination.unlink(missing_ok=True)
                os.link(temporary, destination)
                return True
    finally:
        temporary.unlink(missing_ok=True)


def persist_processed_raster(data_root: Path, study_id: str, observation_id: str,
                             acquisition_metadata: dict[str, Any], variable: str,
                             source_path: Path, study_feature: dict[str, Any],
                             processed_at: str | None = None,
                             retrieval_session_id: str | None = None,
                             frequency: str | None = None) -> dict[str, Any]:
    """Save a study-scoped raster and manifest, then rebuild the persistent index."""
    if not STUDY_ID_RE.fullmatch(study_id):
        raise ValueError("Invalid stable study identifier.")
    observation_id = _safe_id(observation_id)
    variable = _safe_id(variable)
    frequency = frequency or acquisition_metadata.get("frequency") or "frequencyA"
    if frequency not in {"frequencyA", "frequencyB"}:
        raise ValueError("Invalid NISAR frequency.")
    if not source_path.is_file():
        raise FileNotFoundError("Processed raster is missing from local storage.")
    study_dir = data_root / "studies" / study_id
    observation_dir = study_dir / "observations" / observation_id
    raster_path = observation_dir / "rasters" / (f"{variable}.tif" if frequency == "frequencyA"
                                                   else f"{frequency}/{variable}.tif")
    feature_path = study_dir / "study.geojson"
    if not feature_path.exists():
        _atomic_json(feature_path, study_feature)
    _atomic_raster_publish(source_path, raster_path)
    summary = raster_summary(raster_path)
    if summary["validPixelCount"] == 0:
        raster_path.unlink(missing_ok=True)
        raise ValueError("Processed raster contains no finite, valid pixels.")

    manifest_path = observation_dir / "manifest.json"
    try:
        manifest = json.loads(manifest_path.read_text()) if manifest_path.exists() else {}
    except (OSError, ValueError):
        manifest = {}
    manifest.update({
        "studyId": study_id, "observationId": observation_id,
        "retrievalSessionId": retrieval_session_id or manifest.get("retrievalSessionId"),
        "acquisitionDate": acquisition_metadata.get("acquiredAt") or acquisition_metadata.get("startAt") or acquisition_metadata.get("time_start"),
        "acquisitionMetadata": acquisition_metadata,
        "updatedAt": datetime.now(timezone.utc).isoformat(),
    })
    existing_variables = manifest.get("variables", [])
    previous_variable = next((item for item in existing_variables if item.get("name") == variable
                              and item.get("frequency", "frequencyA") == frequency), {})
    variables = [item for item in existing_variables if not (item.get("name") == variable
                 and item.get("frequency", "frequencyA") == frequency)]
    retrieval_session_ids = set(previous_variable.get("retrievalSessionIds", []))
    if previous_variable.get("retrievalSessionId"):
        retrieval_session_ids.add(previous_variable["retrievalSessionId"])
    if retrieval_session_id:
        retrieval_session_ids.add(retrieval_session_id)
    variables.append({
        "name": variable, "available": True, "rasterAvailable": True,
        "visualizationAvailable": True,
        "sourceVariable": variable, "frequency": frequency,
        "polarization": variable,
        "retrievalSessionId": retrieval_session_id or previous_variable.get("retrievalSessionId"),
        "retrievalSessionIds": sorted(retrieval_session_ids),
        "rasterPath": raster_path.relative_to(data_root).as_posix(),
        "raster": summary, "processingTimestamp": processed_at or datetime.now(timezone.utc).isoformat(),
        "bytes": raster_path.stat().st_size,
    })
    manifest["variables"] = sorted(variables, key=lambda item: (item.get("frequency", "frequencyA"), item["name"]))
    _atomic_json(manifest_path, manifest)
    rebuild_registry(data_root)
    return next(item for item in variables if item["name"] == variable and item.get("frequency") == frequency)


def _manifest_entries(data_root: Path):
    # New study-scoped records take precedence over legacy granule manifests.
    entries: dict[tuple[str, str, str, str], dict[str, Any]] = {}
    for manifest_path in (data_root / "studies").glob("*/observations/*/manifest.json"):
        try:
            manifest = json.loads(manifest_path.read_text())
            study_id, observation_id = manifest["studyId"], manifest["observationId"]
            if not STUDY_ID_RE.fullmatch(study_id):
                continue
            for item in manifest.get("variables", []):
                path = (data_root / item["rasterPath"]).resolve()
                if not path.is_relative_to(data_root.resolve()) or not path.is_file():
                    continue
                if not _openable_tiff(path):
                    continue
                summary = item.get("raster") or raster_summary(path)
                frequency = item.get("frequency", (manifest.get("acquisitionMetadata") or {}).get("frequency", "frequencyA"))
                key = (study_id, observation_id, frequency, item["name"])
                entries[key] = {"studyId": study_id, "observationId": observation_id,
                                "retrievalSessionId": item.get("retrievalSessionId"),
                                "retrievalSessionIds": item.get("retrievalSessionIds", []),
                                "acquisitionDate": manifest.get("acquisitionDate"),
                                "acquisitionMetadata": manifest.get("acquisitionMetadata", {}),
                                "variable": item["name"], "sourceVariable": item.get("sourceVariable", item["name"]),
                                "frequency": frequency,
                                "rasterPath": path.relative_to(data_root.resolve()).as_posix(),
                                "raster": summary,
                                "processingTimestamp": item.get("processingTimestamp"), "bytes": path.stat().st_size}
        except (OSError, ValueError, KeyError, TypeError, rasterio.errors.RasterioError):
            log.warning("Skipping invalid local raster manifest %s", manifest_path)

    # Migrate discoverability for already processed outputs in the established data/granules tree.
    for manifest_path in (data_root / "granules").glob("*/metadata.json"):
        try:
            manifest = json.loads(manifest_path.read_text())
            study_ref = manifest.get("studyArea", "")
            match = re.search(r"([a-f0-9]{16})\.geojson$", study_ref)
            study_id = match.group(1) if match else None
            if not study_id:
                continue
            obs_meta_path = manifest_path.parent / "acquisition_metadata.json"
            acquisition = json.loads(obs_meta_path.read_text()) if obs_meta_path.exists() else {}
            observation_id = manifest.get("granuleId", manifest_path.parent.name)
            for item in manifest.get("variables", []):
                if item.get("status") not in {"downloaded", "already_present"}:
                    continue
                stored_path = Path(item.get("path", ""))
                path = stored_path.resolve() if stored_path.is_absolute() else (data_root / stored_path).resolve()
                if not path.is_relative_to(data_root.resolve()) or not path.is_file():
                    continue
                summary = raster_summary(path)
                if summary["validPixelCount"] == 0:
                    continue
                frequency = item.get("frequency") or acquisition.get("frequency", "frequencyA")
                key = (study_id, observation_id, frequency, item.get("variable", ""))
                entries.setdefault(key, {"studyId": study_id, "observationId": observation_id,
                    "frequency": frequency, "sourceVariable": item.get("variable", ""),
                    "acquisitionDate": acquisition.get("acquiredAt") or acquisition.get("startAt"),
                    "acquisitionMetadata": acquisition, "variable": item["variable"],
                    "rasterPath": path.relative_to(data_root.resolve()).as_posix(),
                    "raster": summary,
                    "processingTimestamp": manifest.get("processedAt"), "bytes": path.stat().st_size})
        except (OSError, ValueError, KeyError, TypeError, rasterio.errors.RasterioError):
            log.warning("Skipping invalid legacy raster manifest %s", manifest_path)
    return entries


def rebuild_registry(data_root: Path) -> list[dict[str, Any]]:
    """Rebuild the on-disk index using only manifest-backed valid raster files."""
    entries = list(_manifest_entries(data_root).values())
    index = {"version": REGISTRY_VERSION, "rebuiltAt": datetime.now(timezone.utc).isoformat(), "rasters": entries}
    _atomic_json(data_root / "raster_registry.json", index)
    return entries


def query_registry(data_root: Path, study_id: str, observation_id: str | None = None,
                   acquisition_date: str | None = None, variable: str | None = None,
                   retrieval_session_id: str | None = None,
                   frequency: str | None = None) -> list[dict[str, Any]]:
    if not STUDY_ID_RE.fullmatch(study_id):
        raise ValueError("Invalid stable study identifier.")
    registry_path = data_root / "raster_registry.json"
    try:
        index = json.loads(registry_path.read_text())
        if index.get("version") != REGISTRY_VERSION or not isinstance(index.get("rasters"), list):
            raise ValueError("Unsupported registry index.")
        entries = index["rasters"]
        for entry in entries:
            path = (data_root / entry["rasterPath"]).resolve()
            if not path.is_relative_to(data_root.resolve()) or not _openable_tiff(path):
                raise ValueError("Registry has a missing or invalid raster; rebuilding it.")
    except (OSError, ValueError, KeyError, TypeError, json.JSONDecodeError):
        entries = rebuild_registry(data_root)
    if variable and ":" in variable and frequency is None:
        frequency, variable = variable.split(":", 1)
    return [entry for entry in entries if entry["studyId"] == study_id
            and (observation_id is None or entry["observationId"] == observation_id)
            and (acquisition_date is None or str(entry.get("acquisitionDate", "")).startswith(acquisition_date))
            and (variable is None or entry["variable"] == variable)
            and (frequency is None or entry.get("frequency", "frequencyA") == frequency)
            and (retrieval_session_id is None or retrieval_session_id in entry.get("retrievalSessionIds", [])
                 or retrieval_session_id == entry.get("retrievalSessionId"))]
