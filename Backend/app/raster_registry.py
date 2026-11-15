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
from rasterio.enums import Resampling
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
        temporary.write_text(json.dumps(_json_safe(value), indent=2, allow_nan=False))
        with temporary.open("rb") as stream:
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
                             processed_at: str | None = None) -> dict[str, Any]:
    """Save a study-scoped raster and manifest, then rebuild the persistent index."""
    if not STUDY_ID_RE.fullmatch(study_id):
        raise ValueError("Invalid stable study identifier.")
    observation_id = _safe_id(observation_id)
    variable = _safe_id(variable)
    if not source_path.is_file():
        raise FileNotFoundError("Processed raster is missing from local storage.")
    study_dir = data_root / "studies" / study_id
    observation_dir = study_dir / "observations" / observation_id
    raster_path = observation_dir / "rasters" / f"{variable}.tif"
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
        "acquisitionDate": acquisition_metadata.get("acquiredAt") or acquisition_metadata.get("startAt") or acquisition_metadata.get("time_start"),
        "acquisitionMetadata": acquisition_metadata,
        "updatedAt": datetime.now(timezone.utc).isoformat(),
    })
    variables = [item for item in manifest.get("variables", []) if item.get("name") != variable]
    variables.append({
        "name": variable, "available": True, "rasterAvailable": True,
        "visualizationAvailable": True,
        "rasterPath": raster_path.relative_to(data_root).as_posix(),
        "previewPath": (observation_dir / "visualizations" / f"{variable}.png").relative_to(data_root).as_posix(),
        "raster": summary, "processingTimestamp": processed_at or datetime.now(timezone.utc).isoformat(),
        "bytes": raster_path.stat().st_size,
    })
    manifest["variables"] = sorted(variables, key=lambda item: item["name"])
    _atomic_json(manifest_path, manifest)
    rebuild_registry(data_root)
    return next(item for item in variables if item["name"] == variable)


def _manifest_entries(data_root: Path):
    # New study-scoped records take precedence over legacy granule manifests.
    entries: dict[tuple[str, str, str], dict[str, Any]] = {}
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
                key = (study_id, observation_id, item["name"])
                entries[key] = {"studyId": study_id, "observationId": observation_id,
                                "acquisitionDate": manifest.get("acquisitionDate"),
                                "acquisitionMetadata": manifest.get("acquisitionMetadata", {}),
                                "variable": item["name"], "rasterPath": path.relative_to(data_root.resolve()).as_posix(),
                                "previewPath": item.get("previewPath"), "raster": summary,
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
                key = (study_id, observation_id, item.get("variable", ""))
                entries.setdefault(key, {"studyId": study_id, "observationId": observation_id,
                    "acquisitionDate": acquisition.get("acquiredAt") or acquisition.get("startAt"),
                    "acquisitionMetadata": acquisition, "variable": item["variable"],
                    "rasterPath": path.relative_to(data_root.resolve()).as_posix(),
                    "previewPath": None, "raster": summary,
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
                   acquisition_date: str | None = None, variable: str | None = None) -> list[dict[str, Any]]:
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
    return [entry for entry in entries if entry["studyId"] == study_id
            and (observation_id is None or entry["observationId"] == observation_id)
            and (acquisition_date is None or str(entry.get("acquisitionDate", "")).startswith(acquisition_date))
            and (variable is None or entry["variable"] == variable)]


def generate_preview(data_root: Path, raster_path: Path, preview_relative_path: str,
                     max_dimension: int = 1024) -> Path:
    """Create/reuse a cached transparent RGBA PNG from a local GeoTIFF."""
    from rasterio.io import MemoryFile

    destination = (data_root / preview_relative_path).resolve()
    if not destination.is_relative_to(data_root.resolve()):
        raise ValueError("Invalid preview path.")
    if destination.is_file() and destination.stat().st_mtime_ns >= raster_path.stat().st_mtime_ns:
        return destination
    with rasterio.open(raster_path) as dataset:
        scale = min(1.0, max_dimension / max(dataset.width, dataset.height))
        width, height = max(1, int(dataset.width * scale)), max(1, int(dataset.height * scale))
        sample = dataset.read(1, out_shape=(height, width), resampling=Resampling.average, masked=True)
        values = np.asarray(sample.data, dtype=np.float64)
        valid = ~np.ma.getmaskarray(sample) & np.isfinite(values)
        if not valid.any():
            raise ValueError("Cannot visualize an empty or all-NoData raster.")
        low, high = np.percentile(values[valid], [2, 98])
        if not np.isfinite(low) or not np.isfinite(high) or high <= low:
            low, high = float(values[valid].min()), float(values[valid].max())
        stretched = np.zeros((height, width), dtype=np.uint8)
        if high > low:
            stretched[valid] = np.clip((values[valid] - low) / (high - low) * 255, 0, 255).astype(np.uint8)
        else:
            stretched[valid] = 180
        rgba = np.stack((stretched // 3, stretched, np.minimum(255, stretched.astype(np.uint16) + 35).astype(np.uint8),
                         valid.astype(np.uint8) * 220), axis=0)
        preview_transform = dataset.transform @ rasterio.Affine.scale(dataset.width / width, dataset.height / height)
        with MemoryFile() as memory:
            with memory.open(driver="PNG", width=width, height=height, count=4, dtype="uint8",
                             transform=preview_transform, crs=dataset.crs) as output:
                output.write(rgba)
            content = memory.read()
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_name(f".{destination.name}.{uuid4().hex}.tmp")
    try:
        temporary.write_bytes(content)
        os.replace(temporary, destination)
    finally:
        temporary.unlink(missing_ok=True)
    return destination


def generate_difference_preview(data_root: Path, baseline_path: Path, current_path: Path,
                                preview_relative_path: str, max_dimension: int = 1024) -> Path:
    """Cache a diverging display of current minus baseline for exactly aligned rasters."""
    from rasterio.io import MemoryFile

    destination = (data_root / preview_relative_path).resolve()
    if not destination.is_relative_to(data_root.resolve()):
        raise ValueError("Invalid difference preview path.")
    newest_input = max(baseline_path.stat().st_mtime_ns, current_path.stat().st_mtime_ns)
    if destination.is_file() and destination.stat().st_mtime_ns >= newest_input:
        return destination
    with rasterio.open(baseline_path) as before, rasterio.open(current_path) as after:
        if (before.crs != after.crs or before.transform != after.transform or
                before.width != after.width or before.height != after.height):
            raise ValueError("These rasters do not share a grid and cannot be compared directly.")
        scale = min(1.0, max_dimension / max(before.width, before.height))
        width, height = max(1, int(before.width * scale)), max(1, int(before.height * scale))
        first = before.read(1, out_shape=(height, width), resampling=Resampling.average, masked=True)
        second = after.read(1, out_shape=(height, width), resampling=Resampling.average, masked=True)
        a, b = np.asarray(first.data, dtype=np.float64), np.asarray(second.data, dtype=np.float64)
        valid = (~np.ma.getmaskarray(first) & ~np.ma.getmaskarray(second) & np.isfinite(a) & np.isfinite(b))
        if not valid.any():
            raise ValueError("The rasters have no overlapping finite, valid pixels.")
        difference = b - a
        limit = float(np.percentile(np.abs(difference[valid]), 98))
        if not np.isfinite(limit) or limit <= 0:
            limit = float(np.max(np.abs(difference[valid])))
        intensity = np.zeros((height, width), dtype=np.uint8)
        if limit > 0:
            intensity[valid] = np.clip(np.abs(difference[valid]) / limit * 255, 0, 255).astype(np.uint8)
        positive = valid & (difference >= 0)
        negative = valid & (difference < 0)
        rgba = np.zeros((4, height, width), dtype=np.uint8)
        rgba[0, positive] = intensity[positive]
        rgba[1, positive] = intensity[positive] // 5
        rgba[1, negative] = intensity[negative] // 3
        rgba[2, negative] = intensity[negative]
        rgba[3, valid] = 220
        transform = before.transform @ rasterio.Affine.scale(before.width / width, before.height / height)
        with MemoryFile() as memory:
            with memory.open(driver="PNG", width=width, height=height, count=4, dtype="uint8",
                             transform=transform, crs=before.crs) as output:
                output.write(rgba)
            content = memory.read()
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_name(f".{destination.name}.{uuid4().hex}.tmp")
    try:
        temporary.write_bytes(content)
        os.replace(temporary, destination)
    finally:
        temporary.unlink(missing_ok=True)
    return destination
