"""Temporary visualization products and session-scoped raster access."""

from __future__ import annotations

import hashlib
import hmac
import json
import logging
import os
import re
import secrets
import shutil
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from uuid import uuid4

import numpy as np
import rasterio
from rasterio.enums import Resampling
from rasterio.transform import array_bounds
from rasterio.vrt import WarpedVRT
from rasterio.warp import transform_bounds

log = logging.getLogger(__name__)
SESSION_ID_RE = re.compile(r"^[a-f0-9]{32}$")
PRODUCT_ID_RE = re.compile(r"^[a-f0-9]{32}$")
POLARIZATION_LABELS = {"HHHH": "HH", "HVHV": "HV", "VHVH": "VH", "VVVV": "VV"}
SESSION_DIRECTORIES = ("rgb", "aligned", "comparisons", "previews", "products")


class VisualizationSessionError(RuntimeError):
    def __init__(self, message: str, status_code: int = 400):
        super().__init__(message)
        self.status_code = status_code


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _digest(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _atomic_json(path: Path, value: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.{uuid4().hex}.tmp")
    try:
        temporary.write_text(json.dumps(value, allow_nan=False, indent=2))
        with temporary.open("rb") as stream:
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def _session_path(session_root: Path, session_id: str) -> Path:
    if not SESSION_ID_RE.fullmatch(session_id):
        raise VisualizationSessionError("Invalid visualization session identifier.", 400)
    root = session_root.resolve()
    path = (root / session_id).resolve()
    if not path.is_relative_to(root):
        raise VisualizationSessionError("Invalid visualization session path.", 400)
    return path


def _expired(metadata: dict[str, Any], ttl_seconds: int, now: datetime | None = None) -> bool:
    now = now or _now()
    try:
        last = datetime.fromisoformat(metadata["lastActivityAt"])
        if last.tzinfo is None:
            last = last.replace(tzinfo=timezone.utc)
        return now - last > timedelta(seconds=ttl_seconds)
    except (KeyError, TypeError, ValueError):
        return True


def cleanup_expired_sessions(session_root: Path, ttl_seconds: int, now: datetime | None = None) -> int:
    """Remove only expired workspaces under the configured visualization root."""
    root = session_root.resolve()
    if not root.exists():
        return 0
    removed = 0
    for path in root.iterdir():
        if not path.is_dir() or path.is_symlink() or not SESSION_ID_RE.fullmatch(path.name):
            continue
        try:
            metadata = json.loads((path / "session.json").read_text())
        except (OSError, ValueError):
            age = _now().timestamp() - path.stat().st_mtime
            expired = age > ttl_seconds
        else:
            expired = _expired(metadata, ttl_seconds, now)
        if expired and path.resolve().parent == root:
            shutil.rmtree(path)
            removed += 1
    return removed


def create_session(session_root: Path, study_id: str, ttl_seconds: int,
                   max_sessions: int) -> dict[str, Any]:
    cleanup_expired_sessions(session_root, ttl_seconds)
    session_root.mkdir(parents=True, exist_ok=True)
    active = [path for path in session_root.iterdir() if path.is_dir() and SESSION_ID_RE.fullmatch(path.name)]
    if len(active) >= max_sessions:
        raise VisualizationSessionError("Visualization session limit reached. Close an active session and retry.", 429)
    session_id = uuid4().hex
    token = secrets.token_urlsafe(32)
    created = _now()
    path = _session_path(session_root, session_id)
    path.mkdir(mode=0o700)
    for directory in SESSION_DIRECTORIES:
        (path / directory).mkdir()
    metadata = {"sessionId": session_id, "studyId": study_id,
                "createdAt": created.isoformat(), "lastActivityAt": created.isoformat(),
                "sessionTokenHash": _digest(token)}
    _atomic_json(path / "session.json", metadata)
    return {"sessionId": session_id, "sessionToken": token,
            "studyId": study_id,
            "expiresAt": (created + timedelta(seconds=ttl_seconds)).isoformat()}


def require_session(session_root: Path, session_id: str, token: str | None,
                    ttl_seconds: int, *, touch: bool = True) -> tuple[Path, dict[str, Any]]:
    path = _session_path(session_root, session_id)
    if not path.is_dir():
        raise VisualizationSessionError("Visualization session was not found or has expired.", 404)
    try:
        metadata = json.loads((path / "session.json").read_text())
    except (OSError, ValueError) as exc:
        raise VisualizationSessionError("Visualization session metadata is unavailable.", 410) from exc
    if _expired(metadata, ttl_seconds):
        shutil.rmtree(path, ignore_errors=True)
        raise VisualizationSessionError("Visualization session has expired.", 410)
    if not token or not hmac.compare_digest(metadata.get("sessionTokenHash", ""), _digest(token)):
        raise VisualizationSessionError("A valid session token is required.", 403)
    if touch:
        metadata["lastActivityAt"] = _now().isoformat()
        _atomic_json(path / "session.json", metadata)
    return path, metadata


def write_pipeline_state(session_dir: Path, state: dict[str, Any]) -> None:
    """Atomically persist restart-safe progress and catalog state inside its session."""
    _atomic_json(session_dir / "pipeline.json", state)


def read_pipeline_state(session_dir: Path) -> dict[str, Any]:
    try:
        return json.loads((session_dir / "pipeline.json").read_text())
    except (OSError, ValueError) as exc:
        raise VisualizationSessionError("Visualization pipeline status is unavailable.", 404) from exc


def read_session_catalog(session_dir: Path) -> dict[str, Any]:
    try:
        return json.loads((session_dir / "catalog.json").read_text())
    except FileNotFoundError:
        state_path = session_dir / "pipeline.json"
        if state_path.is_file():
            state = json.loads(state_path.read_text())
            study_id = state.get("studyId")
        else:
            metadata = json.loads((session_dir / "session.json").read_text())
            study_id = metadata.get("studyId")
        return {"studyId": study_id, "timeline": [], "observations": [], "rasters": []}
    except (OSError, ValueError) as exc:
        raise VisualizationSessionError("Visualization catalog is unavailable.", 500) from exc


def delete_session(session_root: Path, session_id: str, token: str | None,
                   ttl_seconds: int) -> None:
    path, _ = require_session(session_root, session_id, token, ttl_seconds, touch=False)
    shutil.rmtree(path)


def _raster_entries(data_root: Path, study_id: str, observation_id: str,
                    session_dir: Path | None = None) -> dict[str, dict[str, Any]]:
    # Visualization only consumes persisted source rasters listed in this session's
    # catalog; session-local files are reserved for derived products.
    if session_dir is None or not (session_dir / "catalog.json").is_file():
        return {}
    catalog = read_session_catalog(session_dir)
    return {entry["variable"]: entry for entry in catalog.get("rasters", [])
            if entry.get("studyId") == study_id and entry.get("observationId") == observation_id
            and entry.get("temporary") is False}


def _raster_source_path(data_root: Path, session_dir: Path, entry: dict[str, Any]) -> Path:
    if entry.get("temporary") is not False or not isinstance(entry.get("rasterPath"), str):
        raise VisualizationSessionError("Visualization source raster is not a persisted retrieval output.", 404)
    path = (data_root / entry["rasterPath"]).resolve()
    if not path.is_relative_to(data_root.resolve()):
        raise VisualizationSessionError("Persisted raster path is invalid.", 400)
    return path


def _output_grid(paths: list[Path], max_dimension: int):
    first = rasterio.open(paths[0])
    scale = min(1.0, max_dimension / max(first.width, first.height))
    width, height = max(1, int(first.width * scale)), max(1, int(first.height * scale))
    transform = first.transform @ rasterio.Affine.scale(first.width / width, first.height / height)
    bounds = array_bounds(height, width, transform)
    bounds_wgs84 = list(transform_bounds(first.crs, "EPSG:4326", *bounds, densify_pts=21))
    return first, width, height, transform, bounds_wgs84


def _read_aligned(path: Path, target, width: int, height: int) -> tuple[np.ndarray, np.ndarray]:
    with rasterio.open(path) as source:
        with WarpedVRT(source, crs=target.crs, transform=target.transform,
                       width=target.width, height=target.height,
                       resampling=Resampling.bilinear) as aligned:
            sample = aligned.read(1, out_shape=(height, width), masked=True, resampling=Resampling.average)
    values = np.asarray(sample.data, dtype=np.float64)
    valid = ~np.ma.getmaskarray(sample) & np.isfinite(values)
    return values, valid


def _normalise(values: np.ndarray, valid: np.ndarray) -> np.ndarray:
    output = np.zeros(values.shape, dtype=np.uint8)
    finite = values[valid]
    if finite.size == 0:
        raise VisualizationSessionError("A selected raster has no finite valid pixels.", 422)
    low, high = np.percentile(finite, [2, 98])
    if not np.isfinite(low) or not np.isfinite(high) or high <= low:
        low, high = float(finite.min()), float(finite.max())
    if high > low:
        output[valid] = np.clip((values[valid] - low) / (high - low) * 255, 0, 255).astype(np.uint8)
    else:
        output[valid] = 180
    return output


def _png_bytes(rgba: np.ndarray, transform, crs) -> bytes:
    from rasterio.io import MemoryFile
    height, width = rgba.shape[1:]
    with MemoryFile() as memory:
        with memory.open(driver="PNG", width=width, height=height, count=4,
                         dtype="uint8", transform=transform, crs=crs) as dataset:
            dataset.write(rgba)
        return memory.read()


def _store_product(session_dir: Path, folder: str, key: str, content: bytes,
                   max_storage_bytes: int) -> Path:
    target = session_dir / folder / f"{key}.png"
    if target.exists():
        return target
    current_size = sum(path.stat().st_size for path in session_dir.rglob("*") if path.is_file())
    if current_size + len(content) > max_storage_bytes:
        raise VisualizationSessionError("Visualization session storage limit exceeded.", 413)
    temporary = target.with_name(f".{target.name}.{uuid4().hex}.tmp")
    try:
        with temporary.open("wb") as stream:
            stream.write(content)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, target)
    finally:
        temporary.unlink(missing_ok=True)
    return target


def _legend(variable: str, band: int) -> str:
    if variable.startswith("RATIO:"):
        _, frequency, numerator, denominator = variable.split(":", 3)
        label = f"{frequency.removeprefix('frequency')} · {POLARIZATION_LABELS.get(numerator, numerator)} / {POLARIZATION_LABELS.get(denominator, denominator)} ratio"
    else:
        _, separator, source = variable.partition(":")
        frequency = _ if separator else ""
        source = source if separator else variable
        prefix = f"{frequency.removeprefix('frequency')} · " if frequency else ""
        label = f"{prefix}{POLARIZATION_LABELS.get(source, source)} ({source})"
    return f"{label} → {'RGB'[band]}"


def generate_rgb(data_root: Path, session_dir: Path, study_id: str, observation_id: str,
                 red: str, green: str, blue: str, max_dimension: int,
                 max_storage_bytes: int) -> tuple[Path, list[float], list[str]]:
    entries = _raster_entries(data_root, study_id, observation_id, session_dir)
    variables = [red, green, blue]
    source_specs: list[tuple[dict[str, Any], ...]] = []
    for variable in variables:
        if variable.startswith("RATIO:"):
            parts = variable.split(":")
            if len(parts) != 4:
                raise VisualizationSessionError("RGB ratio must name a frequency, numerator, and denominator.", 422)
            numerator_key, denominator_key = f"{parts[1]}:{parts[2]}", f"{parts[1]}:{parts[3]}"
            if numerator_key not in entries or denominator_key not in entries:
                raise VisualizationSessionError("RGB ratio layers are not both available for this observation and frequency.", 422)
            source_specs.append((entries[numerator_key], entries[denominator_key]))
        elif variable in entries:
            source_specs.append((entries[variable],))
        else:
            raise VisualizationSessionError("One or more selected RGB layers are unavailable in this granule.", 422)
    paths = [_raster_source_path(data_root, session_dir, entry)
             for spec in source_specs for entry in spec]
    first, width, height, transform, bounds = _output_grid(paths, max_dimension)
    key = hashlib.sha256("|".join((observation_id, red, green, blue, str(max_dimension))).encode()).hexdigest()[:32]
    try:
        target = session_dir / "rgb" / f"{key}.png"
        if not target.is_file():
            channels, masks = [], []
            for spec in source_specs:
                values, valid = _read_aligned(_raster_source_path(data_root, session_dir, spec[0]), first, width, height)
                if len(spec) == 2:
                    denominator, denominator_valid = _read_aligned(
                        _raster_source_path(data_root, session_dir, spec[1]), first, width, height)
                    valid &= denominator_valid & np.isfinite(denominator) & (denominator != 0)
                    ratio = np.zeros(values.shape, dtype=np.float64)
                    ratio[valid] = values[valid] / denominator[valid]
                    values = ratio
                channels.append(_normalise(values, valid))
                masks.append(valid)
            valid = np.logical_and.reduce(masks)
            rgba = np.stack((channels[0], channels[1], channels[2], valid.astype(np.uint8) * 255), axis=0)
            content = _png_bytes(rgba, transform, first.crs)
            target = _store_product(session_dir, "rgb", key, content, max_storage_bytes)
        return target, bounds, [_legend(variable, index) for index, variable in enumerate(variables)]
    finally:
        first.close()


def generate_comparison(data_root: Path, session_dir: Path, study_id: str,
                        baseline_id: str, current_id: str, variable: str,
                        mode: str, include_difference: bool, max_dimension: int,
                        max_storage_bytes: int) -> dict[str, Any]:
    if mode not in {"side_by_side", "difference"}:
        raise VisualizationSessionError("Comparison mode must be side_by_side or difference.")
    baseline_entries = _raster_entries(data_root, study_id, baseline_id, session_dir)
    current_entries = _raster_entries(data_root, study_id, current_id, session_dir)
    if variable not in baseline_entries or variable not in current_entries:
        raise VisualizationSessionError("The selected variable is not available in both observations.", 422)
    before_path = _raster_source_path(data_root, session_dir, baseline_entries[variable])
    after_path = _raster_source_path(data_root, session_dir, current_entries[variable])
    first, width, height, transform, bounds = _output_grid([before_path], max_dimension)
    key = hashlib.sha256("|".join((baseline_id, current_id, variable, mode, str(include_difference), str(max_dimension))).encode()).hexdigest()[:32]
    target = session_dir / "comparisons" / f"{key}.png"
    result_path = session_dir / "products" / f"{key}.json"
    try:
        if not target.is_file() or not result_path.is_file():
            earlier, earlier_valid = _read_aligned(before_path, first, width, height)
            later, later_valid = _read_aligned(after_path, first, width, height)
            before_units = str(baseline_entries[variable].get("raster", {}).get("units", "")).lower()
            after_units = str(current_entries[variable].get("raster", {}).get("units", "")).lower()
            if before_units and after_units and before_units != after_units:
                raise VisualizationSessionError("These acquisitions use incompatible measurement units.", 422)
            difference_units = "dB" if before_units in {"1", "linear", "power"} and after_units in {"1", "linear", "power"} else "source units"
            if difference_units == "dB":
                earlier_valid &= earlier > 0
                later_valid &= later > 0
                earlier_db = np.zeros(earlier.shape, dtype=np.float64)
                later_db = np.zeros(later.shape, dtype=np.float64)
                earlier_db[earlier_valid] = 10 * np.log10(earlier[earlier_valid])
                later_db[later_valid] = 10 * np.log10(later[later_valid])
                earlier, later = earlier_db, later_db
            valid = earlier_valid & later_valid
            if not valid.any():
                raise VisualizationSessionError("The two observations have no overlapping valid pixels.", 422)
            difference = later - earlier
            valid_differences = difference[valid]
            threshold = float(np.percentile(np.abs(valid_differences), 10))
            positive = valid & (difference > threshold)
            negative = valid & (difference < -threshold)
            near_zero = valid & ~(positive | negative)
            stats = {"sampledPixelCount": int(valid.sum()), "meanDifference": float(valid_differences.mean()),
                     "minimumDifference": float(valid_differences.min()), "maximumDifference": float(valid_differences.max()),
                     "differenceUnits": difference_units, "nearZeroThreshold": threshold, "positivePixelCount": int(positive.sum()),
                     "negativePixelCount": int(negative.sum()), "nearZeroPixelCount": int(near_zero.sum())}
            if mode == "difference":
                limit = float(np.percentile(np.abs(valid_differences), 98))
                if not np.isfinite(limit) or limit <= 0:
                    limit = float(np.max(np.abs(valid_differences)))
                intensity = np.zeros((height, width), dtype=np.uint8)
                if limit > 0:
                    intensity[valid] = np.clip(np.abs(difference[valid]) / limit * 255, 0, 255).astype(np.uint8)
                rgba = np.zeros((4, height, width), dtype=np.uint8)
                rgba[0, positive] = intensity[positive]
                rgba[1, positive] = intensity[positive] // 5
                rgba[2, negative] = intensity[negative]
                rgba[1, negative] = intensity[negative] // 5
                rgba[0, near_zero] = 220
                rgba[1, near_zero] = 190
                rgba[2, near_zero] = 40
                rgba[3, valid] = 230
            else:
                earlier_gray = _normalise(earlier, earlier_valid)
                later_gray = _normalise(later, later_valid)
                before_rgba = np.stack((earlier_gray, earlier_gray, earlier_gray,
                                        earlier_valid.astype(np.uint8) * 255), axis=0)
                after_rgba = np.stack((later_gray, later_gray, later_gray,
                                       later_valid.astype(np.uint8) * 255), axis=0)
                panels = [before_rgba, after_rgba]
                if include_difference:
                    intensity = np.zeros((height, width), dtype=np.uint8)
                    limit = float(np.percentile(np.abs(valid_differences), 98)) or 1.0
                    intensity[valid] = np.clip(np.abs(difference[valid]) / limit * 255, 0, 255).astype(np.uint8)
                    diff_rgba = np.zeros((4, height, width), dtype=np.uint8)
                    diff_rgba[0, positive] = intensity[positive]
                    diff_rgba[2, negative] = intensity[negative]
                    diff_rgba[1, near_zero] = 190
                    diff_rgba[3, valid] = 230
                    panels.append(diff_rgba)
                rgba = np.concatenate(panels, axis=2)
            content = _png_bytes(rgba, transform, first.crs)
            _store_product(session_dir, "comparisons", key, content, max_storage_bytes)
            _atomic_json(result_path, {"productId": key, "statistics": stats,
                "legend": (["Earlier", "Later", "Positive: red · Negative: blue · Near zero: gray"] if mode == "side_by_side" and include_difference
                           else ["Earlier", "Later"] if mode == "side_by_side"
                           else ["Positive: red", "Negative: blue", "Near zero: yellow"]),
                "boundsWgs84": bounds, "mode": mode, "differenceUnits": difference_units})
        metadata = json.loads(result_path.read_text()) if result_path.exists() else {
            "productId": key, "statistics": {}, "legend": [], "boundsWgs84": bounds, "mode": mode}
        metadata["productUrl"] = f"/api/visualization/sessions/{session_dir.name}/products/{key}"
        metadata["baselineObservationId"] = baseline_id
        metadata["currentObservationId"] = current_id
        metadata["variable"] = variable
        return metadata
    except Exception:
        target.unlink(missing_ok=True)
        result_path.unlink(missing_ok=True)
        raise
    finally:
        first.close()


def product_path(session_dir: Path, product_id: str) -> Path:
    if not PRODUCT_ID_RE.fullmatch(product_id):
        raise VisualizationSessionError("Invalid visualization product identifier.", 400)
    path = session_dir / "comparisons" / f"{product_id}.png"
    if not path.is_file():
        raise VisualizationSessionError("Temporary visualization product was not found.", 404)
    return path
