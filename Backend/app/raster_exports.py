"""Deterministic temporary exports built only from persisted raster registry entries."""

from __future__ import annotations

import json
import math
import re
import shutil
import struct
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from uuid import uuid4

import numpy as np
import rasterio
from rasterio.enums import Resampling
from rasterio.io import MemoryFile
from rasterio.transform import from_bounds, from_origin
from rasterio.vrt import WarpedVRT
from rasterio.warp import transform_bounds, reproject
from rasterio.windows import Window, from_bounds as window_from_bounds

from .raster_display import PALETTE_ANCHORS, colorize_values
from .raster_registry import query_registry


class RasterExportError(RuntimeError):
    def __init__(self, message: str, status_code: int = 422):
        super().__init__(message)
        self.status_code = status_code


def safe_token(value: Any, fallback: str = "Unknown") -> str:
    token = re.sub(r"[^A-Za-z0-9]+", "_", str(value or "")).strip("_")
    return token[:100] or fallback


def _study_properties(data_root: Path, study_id: str) -> tuple[str, list[float] | None]:
    for candidate in (data_root / "studies" / study_id / "study.geojson",
                      data_root / "study_areas" / f"{study_id}.geojson"):
        try:
            geometry = json.loads(candidate.read_text())
            props = geometry.get("properties") or {}
            bbox = geometry.get("bbox")
            if not bbox and geometry.get("geometry"):
                from shapely.geometry import shape
                bounds = shape(geometry["geometry"]).bounds
                bbox = list(bounds)
            return str(props.get("name") or study_id), list(bbox[:4]) if bbox and len(bbox) >= 4 else None
        except (OSError, ValueError, TypeError):
            continue
    return study_id, None


def _entry(data_root: Path, study_id: str, reference: dict[str, Any]) -> dict[str, Any]:
    observation_id = str(reference.get("observationId") or "")
    variable = str(reference.get("sourceVariable") or "")
    frequency = str(reference.get("frequency") or "")
    if not observation_id or not variable or frequency not in {"frequencyA", "frequencyB"}:
        raise RasterExportError("Each raster reference needs a granule ID, source variable, and valid frequency.", 400)
    try:
        matches = query_registry(data_root, study_id, observation_id=observation_id,
                                 variable=variable, frequency=frequency)
    except ValueError as exc:
        raise RasterExportError("Raster reference is invalid.", 400) from exc
    if not matches:
        raise RasterExportError("A referenced raster is not a successfully persisted raster for this study.", 404)
    path = (data_root / matches[0]["rasterPath"]).resolve()
    if not path.is_relative_to(data_root.resolve()) or not path.is_file():
        raise RasterExportError("A referenced local raster is unavailable.", 404)
    return matches[0]


def _raster_path(data_root: Path, entry: dict[str, Any]) -> Path:
    path = (data_root / entry["rasterPath"]).resolve()
    if not path.is_relative_to(data_root.resolve()) or not path.is_file():
        raise RasterExportError("A referenced local raster is unavailable.", 404)
    return path


def _unit(entry: dict[str, Any]) -> str:
    return str((entry.get("raster") or {}).get("units") or "").strip()


def _calibration(entry: dict[str, Any]) -> str:
    acquisition = entry.get("acquisitionMetadata") or {}
    raster = entry.get("raster") or {}
    return str(raster.get("calibration") or acquisition.get("calibration") or
               acquisition.get("productType") or "").strip().lower()


def _validate_pair(left: dict[str, Any], right: dict[str, Any]) -> str:
    if left["variable"] != right["variable"] or left["frequency"] != right["frequency"]:
        raise RasterExportError("Changes require the same measurement polarization and frequency on both sides.", 422)
    left_units, right_units = _unit(left), _unit(right)
    if not left_units or left_units.lower() in {"unknown", "none"} or left_units.lower() != right_units.lower():
        raise RasterExportError("Changes require matching, known measurement units.", 422)
    left_calibration, right_calibration = _calibration(left), _calibration(right)
    if not left_calibration or left_calibration != right_calibration:
        raise RasterExportError("Changes require matching, known calibration or product-type metadata.", 422)
    return left_units


def _change_tolerance(units: str, values: np.ndarray) -> tuple[float, str]:
    if units.strip().lower() == "db":
        return .1, "0.1 dB absolute difference"
    scale = float(np.median(np.abs(values))) if values.size else 0.0
    tolerance = max(1e-9, scale * .01)
    return tolerance, f"1% of median absolute measured value (minimum {tolerance:.8g} {units})"


def _area_km2(valid: np.ndarray, transform: Any, crs: Any) -> float | None:
    count = int(valid.sum())
    from pyproj import CRS
    geodetic_crs = CRS.from_user_input(crs)
    if geodetic_crs.is_projected:
        factor = (geodetic_crs.axis_info[0].unit_conversion_factor if geodetic_crs.axis_info else None)
        if factor and math.isfinite(factor):
            return count * abs(transform.a * transform.e - transform.b * transform.d) * factor * factor / 1_000_000
    if geodetic_crs.is_geographic:
        from pyproj import Geod
        geod = geodetic_crs.get_geod()
        rows = np.flatnonzero(valid.any(axis=1))
        total = 0.0
        for row in rows:
            y = transform.f + (row + .5) * transform.e
            x = transform.c + .5 * transform.a
            x2 = x + transform.a
            y2 = y + transform.e
            _, _, width_m = geod.inv(x, y, x2, y)
            _, _, height_m = geod.inv(x, y, x, y2)
            total += int(valid[row].sum()) * abs(width_m * height_m)
        return total / 1_000_000
    return None


def _difference_rgba(sample: Any, limit: float) -> np.ndarray:
    values = np.asarray(np.ma.getdata(sample), dtype=np.float64)
    valid = ~np.ma.getmaskarray(sample) & np.isfinite(values)
    normalized = np.clip(values / max(limit, np.finfo(float).tiny), -1, 1)
    rgba = np.zeros((*values.shape, 4), dtype=np.uint8)
    zero = np.array([245.0, 245.0, 245.0])
    blue = np.array([33.0, 102.0, 172.0])
    red = np.array([178.0, 24.0, 43.0])
    neg = valid & (normalized < 0)
    pos = valid & (normalized >= 0)
    rgba[..., :3][neg] = np.rint(zero + (-normalized[neg, None]) * (blue - zero)).astype(np.uint8)
    rgba[..., :3][pos] = np.rint(zero + normalized[pos, None] * (red - zero)).astype(np.uint8)
    rgba[..., 3][valid] = 255
    return rgba


def _write_png(rgba: np.ndarray, path: Path) -> None:
    height, width = rgba.shape[:2]
    with MemoryFile(ext=".png") as memory:
        with memory.open(driver="PNG", width=width, height=height, count=4, dtype="uint8") as output:
            output.write(rgba.transpose(2, 0, 1))
        path.write_bytes(memory.read())


def _pdf_escape(text: str) -> str:
    text = text.encode("ascii", "replace").decode("ascii")
    return text.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


def _write_text_pdf(path: Path, title: str, lines: list[str]) -> None:
    page_lines = [lines[index:index + 48] for index in range(0, max(1, len(lines)), 48)]
    objects: list[bytes] = []
    objects.append(b"<< /Type /Catalog /Pages 2 0 R >>")
    kids = " ".join(f"{3 + i * 2} 0 R" for i in range(len(page_lines)))
    objects.append(f"<< /Type /Pages /Kids [{kids}] /Count {len(page_lines)} >>".encode())
    for page_index, chunk in enumerate(page_lines):
        page_obj = 3 + page_index * 2
        content_obj = page_obj + 1
        objects.append(f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 {3 + len(page_lines) * 2} 0 R >> >> /Contents {content_obj} 0 R >>".encode())
        content = ["BT /F1 10 Tf 48 748 Td"]
        if page_index == 0:
            content.append(f"({ _pdf_escape(title) }) Tj 0 -20 Td")
        else:
            content.append(f"({ _pdf_escape(title + ' - continued') }) Tj 0 -20 Td")
        for line in chunk:
            content.append(f"({_pdf_escape(line[:115])}) Tj 0 -14 Td")
        content.append("ET")
        stream = "\n".join(content).encode("ascii")
        objects.append(f"<< /Length {len(stream)} >>\nstream\n".encode() + stream + b"\nendstream")
    objects.append(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")
    output = bytearray(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
    offsets = [0]
    for i, obj in enumerate(objects, 1):
        offsets.append(len(output))
        output.extend(f"{i} 0 obj\n".encode() + obj + b"\nendobj\n")
    xref = len(output)
    output.extend(f"xref\n0 {len(offsets)}\n0000000000 65535 f \n".encode())
    for offset in offsets[1:]: output.extend(f"{offset:010d} 00000 n \n".encode())
    output.extend(f"trailer\n<< /Size {len(offsets)} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode())
    path.write_bytes(output)


def _gif_palette() -> list[tuple[int, int, int]]:
    values = []
    for index in range(256):
        r = ((index >> 5) & 7) * 255 // 7
        g = ((index >> 2) & 7) * 255 // 7
        b = (index & 3) * 255 // 3
        values.append((r, g, b))
    values[255] = (0, 0, 0)
    return values


def _gif_lzw(indices: bytes) -> bytes:
    # Keep the stream at GIF's minimum 9-bit code width by clearing its
    # dictionary periodically. This favors a validated bounded encoder over
    # compression while keeping memory use predictable.
    clear, end = 256, 257
    bits = 0
    bit_count = 0
    packed = bytearray()
    def emit(code: int) -> None:
        nonlocal bits, bit_count
        bits |= code << bit_count
        bit_count += 9
        while bit_count >= 8:
            packed.append(bits & 255); bits >>= 8; bit_count -= 8
    emit(clear)
    since_clear = 0
    for value in indices:
        emit(value)
        since_clear += 1
        if since_clear == 200:
            emit(clear)
            since_clear = 0
    emit(end)
    if bit_count: packed.append(bits & 255)
    return bytes(packed)


def _write_gif_header(stream: Any, width: int, height: int) -> None:
    stream.write(b"GIF89a" + struct.pack("<HHBBB", width, height, 0xF7, 0, 0))
    for color in _gif_palette(): stream.write(bytes(color))


def _append_gif_frame(stream: Any, rgba: np.ndarray, delay_cs: int = 150) -> None:
    height, width = rgba.shape[:2]
    rgb = rgba[..., :3].astype(np.uint16)
    indices = ((rgb[..., 0] >> 5) << 5) | ((rgb[..., 1] >> 5) << 2) | (rgb[..., 2] >> 6)
    indices[indices == 255] = 254
    indices[rgba[..., 3] == 0] = 255
    stream.write(b"!\xf9\x04\x01" + struct.pack("<H", delay_cs) + b"\xff\x00")
    stream.write(b"," + struct.pack("<HHHHB", 0, 0, width, height, 0))
    stream.write(b"\x08")
    data = _gif_lzw(indices.astype(np.uint8).tobytes())
    for start in range(0, len(data), 255):
        chunk = data[start:start + 255]
        stream.write(bytes([len(chunk)]) + chunk)
    stream.write(b"\x00")


_FONT_5X7 = {
    "0": ("01110", "10001", "10011", "10101", "11001", "10001", "01110"),
    "1": ("00100", "01100", "00100", "00100", "00100", "00100", "01110"),
    "2": ("01110", "10001", "00001", "00010", "00100", "01000", "11111"),
    "3": ("11110", "00001", "00001", "01110", "00001", "00001", "11110"),
    "4": ("00010", "00110", "01010", "10010", "11111", "00010", "00010"),
    "5": ("11111", "10000", "10000", "11110", "00001", "00001", "11110"),
    "6": ("01110", "10000", "10000", "11110", "10001", "10001", "01110"),
    "7": ("11111", "00001", "00010", "00100", "01000", "01000", "01000"),
    "8": ("01110", "10001", "10001", "01110", "10001", "10001", "01110"),
    "9": ("01110", "10001", "10001", "01111", "00001", "00001", "01110"),
    "A": ("01110", "10001", "10001", "11111", "10001", "10001", "10001"),
    "B": ("11110", "10001", "10001", "11110", "10001", "10001", "11110"),
    "C": ("01111", "10000", "10000", "10000", "10000", "10000", "01111"),
    "D": ("11110", "10001", "10001", "10001", "10001", "10001", "11110"),
    "E": ("11111", "10000", "10000", "11110", "10000", "10000", "11111"),
    "F": ("11111", "10000", "10000", "11110", "10000", "10000", "10000"),
    "G": ("01111", "10000", "10000", "10111", "10001", "10001", "01111"),
    "H": ("10001", "10001", "10001", "11111", "10001", "10001", "10001"),
    "I": ("01110", "00100", "00100", "00100", "00100", "00100", "01110"),
    "J": ("00111", "00010", "00010", "00010", "10010", "10010", "01100"),
    "K": ("10001", "10010", "10100", "11000", "10100", "10010", "10001"),
    "L": ("10000", "10000", "10000", "10000", "10000", "10000", "11111"),
    "M": ("10001", "11011", "10101", "10101", "10001", "10001", "10001"),
    "N": ("10001", "11001", "10101", "10011", "10001", "10001", "10001"),
    "O": ("01110", "10001", "10001", "10001", "10001", "10001", "01110"),
    "P": ("11110", "10001", "10001", "11110", "10000", "10000", "10000"),
    "Q": ("01110", "10001", "10001", "10001", "10101", "10010", "01101"),
    "R": ("11110", "10001", "10001", "11110", "10100", "10010", "10001"),
    "S": ("01111", "10000", "10000", "01110", "00001", "00001", "11110"),
    "T": ("11111", "00100", "00100", "00100", "00100", "00100", "00100"),
    "U": ("10001", "10001", "10001", "10001", "10001", "10001", "01110"),
    "V": ("10001", "10001", "10001", "10001", "10001", "01010", "00100"),
    "W": ("10001", "10001", "10001", "10101", "10101", "10101", "01010"),
    "X": ("10001", "10001", "01010", "00100", "01010", "10001", "10001"),
    "Y": ("10001", "10001", "01010", "00100", "00100", "00100", "00100"),
    "Z": ("11111", "00001", "00010", "00100", "01000", "10000", "11111"),
    "-": ("00000", "00000", "00000", "11111", "00000", "00000", "00000"),
    ".": ("00000", "00000", "00000", "00000", "00000", "00110", "00110"),
    ":": ("00000", "00110", "00110", "00000", "00110", "00110", "00000"),
    "/": ("00001", "00010", "00010", "00100", "01000", "01000", "10000"),
    "|": ("00100", "00100", "00100", "00100", "00100", "00100", "00100"),
    " ": ("00000",) * 7,
}


def _draw_label(image: np.ndarray, text: str, x: int, y: int, color: tuple[int, int, int]) -> None:
    height, width = image.shape[:2]
    for char_index, char in enumerate(text.upper()):
        glyph = _FONT_5X7.get(char, _FONT_5X7[" "])
        origin_x = x + char_index * 6
        for row, line in enumerate(glyph):
            for col, pixel in enumerate(line):
                px, py = origin_x + col, y + row
                if pixel == "1" and 0 <= px < width and 0 <= py < height:
                    image[py, px, :3] = color
                    image[py, px, 3] = 255


def _annotate_timeline_frame(rgba: np.ndarray, entry: dict[str, Any], palette: str,
                             minimum: float, maximum: float, units: str,
                             stretch: str, bands: int, normalization_scale: float | None) -> np.ndarray:
    height, raster_width = rgba.shape[:2]
    width = max(320, raster_width)
    canvas = np.zeros((height + 36, width, 4), dtype=np.uint8)
    canvas[..., 3] = 255
    canvas[height:] = (20, 30, 38, 255)
    offset = (width - raster_width) // 2
    canvas[:height, offset:offset + raster_width] = rgba
    acquisition = str(entry.get("acquisitionDate") or "DATE UNAVAILABLE")[:10]
    polarization = {"HHHH": "HH", "HVHV": "HV", "VHVH": "VH", "VVVV": "VV"}.get(entry["variable"], entry["variable"])
    label = f"{acquisition} | {polarization} | {entry['frequency']}"
    _draw_label(canvas, label, 3, height + 2, (240, 245, 245))
    bar_width = width - 6
    bar_x = 3
    ramp_values = np.linspace(minimum, maximum, bar_width, dtype=np.float32)[None, :]
    ramp, _, _ = colorize_values(np.ma.array(ramp_values), palette=palette, minimum=minimum, maximum=maximum,
        stretch=stretch, bands=bands, normalization_scale=normalization_scale)
    ramp_y = height + 27
    canvas[ramp_y:ramp_y + 7, bar_x:bar_x + bar_width] = np.repeat(ramp, 7, axis=0)
    _draw_label(canvas, f"MIN {minimum:.3g} MAX {maximum:.3g} {units}", 3, height + 13, (240, 245, 245))
    return canvas


def _json_safe(value: Any) -> Any:
    if isinstance(value, dict): return {key: _json_safe(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)): return [_json_safe(item) for item in value]
    if isinstance(value, np.generic): value = value.item()
    if isinstance(value, float) and not math.isfinite(value): return None
    return value


def _export_study_info(data_root: Path, study_id: str) -> tuple[str, list[float] | None]:
    return _study_properties(data_root, study_id)


def _zip_files(zip_path: Path, files: list[tuple[Path, str]]) -> None:
    with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
        for path, archive_name in files: archive.write(path, archive_name)


def create_change_export(data_root: Path, session_dir: Path, study_id: str,
                         left_reference: dict[str, Any], right_reference: dict[str, Any],
                         max_storage_bytes: int, max_dimension: int) -> dict[str, Any]:
    left_entry = _entry(data_root, study_id, left_reference)
    right_entry = _entry(data_root, study_id, right_reference)
    units = _validate_pair(left_entry, right_entry)
    left_path, right_path = _raster_path(data_root, left_entry), _raster_path(data_root, right_entry)
    product_id = uuid4().hex
    exports_dir = session_dir / "exports" / product_id
    exports_dir.mkdir(parents=True, exist_ok=False)
    zip_dir = exports_dir / "payload"; zip_dir.mkdir()
    tif_path = zip_dir / "difference.tif"
    png_path = zip_dir / "change.png"
    stats_path = zip_dir / "change_statistics.json"
    zip_path = session_dir / "exports" / f"{product_id}.zip"
    image_path = session_dir / "comparisons" / f"{product_id}.png"
    try:
        import rasterio.windows
        with rasterio.open(left_path) as left, rasterio.open(right_path) as right:
            if left.crs is None or right.crs is None:
                raise RasterExportError("Both rasters must have a CRS to calculate changes.")
            right_bounds = transform_bounds(right.crs, left.crs, *right.bounds, densify_pts=21)
            overlap = (max(left.bounds.left, right_bounds[0]), max(left.bounds.bottom, right_bounds[1]),
                       min(left.bounds.right, right_bounds[2]), min(left.bounds.top, right_bounds[3]))
            if overlap[2] <= overlap[0] or overlap[3] <= overlap[1]:
                raise RasterExportError("The selected rasters have no geographic overlap.")
            window = window_from_bounds(*overlap, transform=left.transform).round_offsets().round_lengths()
            window = window.intersection(Window(0, 0, left.width, left.height))
            width, height = int(window.width), int(window.height)
            if width < 1 or height < 1:
                raise RasterExportError("The rasters have no usable overlapping pixels.")
            if width * height > 8_000_000 or width * height * 4 > max_storage_bytes:
                raise RasterExportError("The overlapping change raster exceeds the configured processing/storage limit.", 413)
            transform = rasterio.windows.transform(window, left.transform)
            profile = left.profile.copy()
            profile.pop("blockxsize", None); profile.pop("blockysize", None)
            profile.update(driver="GTiff", width=width, height=height, count=1, dtype="float32",
                           transform=transform, nodata=-9999.0, compress="deflate", tiled=False)
            differences: list[np.ndarray] = []
            left_values: list[np.ndarray] = []
            right_values: list[np.ndarray] = []
            valid_rows = np.zeros((height, width), dtype=bool)
            with WarpedVRT(right, crs=left.crs, transform=left.transform, width=left.width,
                           height=left.height, resampling=Resampling.bilinear,
                           nodata=right.nodata if right.nodata is not None else np.nan) as aligned:
                with rasterio.open(tif_path, "w", **profile) as output:
                    output.update_tags(1, units=units, description="Right raster minus left raster",
                        operation="right_minus_left", left_granule=left_entry["observationId"],
                        right_granule=right_entry["observationId"], polarization=left_entry["variable"],
                        frequency=left_entry["frequency"])
                    for row in range(0, height, 256):
                        block_h = min(256, height - row)
                        out_window = Window(0, row, width, block_h)
                        left_window = Window(window.col_off, window.row_off + row, width, block_h)
                        before = left.read(1, window=left_window, masked=True).astype(np.float32)
                        after = aligned.read(1, window=left_window, masked=True).astype(np.float32)
                        before_data, after_data = np.asarray(before.data), np.asarray(after.data)
                        valid = (~np.ma.getmaskarray(before) & ~np.ma.getmaskarray(after) &
                                 np.isfinite(before_data) & np.isfinite(after_data))
                        diff = np.full((block_h, width), -9999.0, dtype=np.float32)
                        diff[valid] = after_data[valid] - before_data[valid]
                        output.write(diff, 1, window=out_window)
                        valid_rows[row:row + block_h] = valid
                        if valid.any():
                            differences.append(diff[valid].astype(np.float64))
                            left_values.append(before_data[valid].astype(np.float64))
                            right_values.append(after_data[valid].astype(np.float64))
            if not differences:
                raise RasterExportError("The rasters have no valid overlapping pixels after NoData masking.")
            delta = np.concatenate(differences); before = np.concatenate(left_values); after = np.concatenate(right_values)
            tolerance, tolerance_description = _change_tolerance(units, np.concatenate((before, after)))
            positive = delta > tolerance; negative = delta < -tolerance; unchanged = ~(positive | negative)
            valid_count = int(delta.size)
            area = _area_km2(valid_rows, transform, left.crs)
            stats = {"operation": "right_minus_left", "leftGranuleId": left_entry["observationId"],
                "rightGranuleId": right_entry["observationId"], "polarization": left_entry["variable"],
                "frequency": left_entry["frequency"], "units": units, "meanLeft": float(before.mean()),
                "meanRight": float(after.mean()), "meanDifference": float(delta.mean()),
                "medianDifference": float(np.median(delta)), "minimumDifference": float(delta.min()),
                "maximumDifference": float(delta.max()), "standardDeviationDifference": float(delta.std()),
                "validOverlappingPixelCount": valid_count, "validOverlappingAreaKm2": area,
                "percentageIncreased": float(positive.sum() / valid_count * 100),
                "percentageDecreased": float(negative.sum() / valid_count * 100),
                "percentageUnchanged": float(unchanged.sum() / valid_count * 100),
                "unchangedTolerance": tolerance, "unchangedToleranceMethod": tolerance_description,
                "interpretation": "Positive means the right raster has higher measured values; negative means lower values. These measurements alone do not confirm an environmental event."}
            with rasterio.open(tif_path) as difference_ds:
                scale = min(1, max_dimension / max(difference_ds.width, difference_ds.height))
                preview_width = max(1, int(difference_ds.width * scale)); preview_height = max(1, int(difference_ds.height * scale))
                sample = difference_ds.read(1, out_shape=(preview_height, preview_width), masked=True,
                                            resampling=Resampling.average)
            limit = float(np.percentile(np.abs(delta), 98))
            if limit <= 0 or not math.isfinite(limit): limit = max(float(np.max(np.abs(delta))), 1.0)
            rgba = _difference_rgba(sample, limit)
            _write_png(rgba, png_path); _write_png(rgba, image_path)
            bounds_wgs84 = list(transform_bounds(left.crs, "EPSG:4326", *rasterio.transform.array_bounds(height, width, transform), densify_pts=21))
        study_name, _ = _study_properties(data_root, study_id)
        left_date = str(left_entry.get("acquisitionDate") or "DateUnavailable")[:10]
        right_date = str(right_entry.get("acquisitionDate") or "DateUnavailable")[:10]
        pol = {"HHHH": "HH", "HVHV": "HV", "VHVH": "VH", "VVVV": "VV"}.get(left_entry["variable"], left_entry["variable"])
        label = f"DeltaEarth_{safe_token(study_name, study_id)}_{pol}_{safe_token(left_date)}_vs_{safe_token(right_date)}"
        if left_date == right_date:
            label += f"_{safe_token(left_entry['observationId'])}_vs_{safe_token(right_entry['observationId'])}"
        filename = f"{label}_Changes.zip"
        (session_dir / "exports" / f"{product_id}.json").write_text(json.dumps({"filename": filename}, allow_nan=False))
        stats_doc = {**stats, "studyId": study_id, "studyName": study_name,
            "leftSourceRaster": {"granuleId": left_entry["observationId"], "variable": left_entry["variable"],
                "frequency": left_entry["frequency"], "acquisitionDate": left_entry.get("acquisitionDate")},
            "rightSourceRaster": {"granuleId": right_entry["observationId"], "variable": right_entry["variable"],
                "frequency": right_entry["frequency"], "acquisitionDate": right_entry.get("acquisitionDate")},
            "boundsWgs84": bounds_wgs84, "exportedAt": datetime.now(timezone.utc).isoformat(),
            "methodology": "The right measurement was bilinearly reprojected onto the left GeoTIFF grid in the geographic overlap. Differences were calculated from scientific raster values (right minus left) for pixels valid in both masks. NoData was excluded, never replaced with zero."}
        stats_path.write_text(json.dumps(_json_safe(stats_doc), indent=2, allow_nan=False))
        _zip_files(zip_path, [(tif_path, "difference.tif"), (png_path, "change.png"), (stats_path, "change_statistics.json")])
        if zip_path.stat().st_size > max_storage_bytes:
            raise RasterExportError("Change export exceeds the visualization session storage limit.", 413)
        shutil.rmtree(exports_dir, ignore_errors=True)
        return {"productId": product_id, "downloadId": product_id, "downloadFilename": filename,
            "downloadUrl": f"/api/visualization/sessions/{session_dir.name}/exports/{product_id}",
            "productUrl": f"/api/visualization/sessions/{session_dir.name}/products/{product_id}",
            "statistics": _json_safe(stats), "legend": {"minimum": -limit, "maximum": limit,
                "palette": "blue-neutral-red", "units": units, "zero": 0}, "boundsWgs84": bounds_wgs84}
    except Exception:
        image_path.unlink(missing_ok=True); zip_path.unlink(missing_ok=True)
        (session_dir / "exports" / f"{product_id}.json").unlink(missing_ok=True)
        shutil.rmtree(exports_dir, ignore_errors=True)
        raise


def _align_timeline_frame(path: Path, crs: Any, transform: Any, width: int, height: int) -> tuple[np.ndarray, np.ndarray]:
    with rasterio.open(path) as source:
        values = np.full((height, width), np.nan, dtype=np.float32)
        reproject(source=rasterio.band(source, 1), destination=values,
            src_transform=source.transform, src_crs=source.crs, src_nodata=source.nodata,
            dst_transform=transform, dst_crs=crs, dst_nodata=np.nan,
            resampling=Resampling.bilinear)
        valid = np.isfinite(values)
        return values, valid


def create_timeline_export(data_root: Path, session_dir: Path, study_id: str,
                           references: list[dict[str, Any]], display: dict[str, Any],
                           max_storage_bytes: int, max_dimension: int) -> dict[str, Any]:
    if len(references) < 2 or len(references) > 100:
        raise RasterExportError("Timeline export requires between 2 and 100 saved raster frames.", 400)
    entries = [_entry(data_root, study_id, ref) for ref in references]
    if len({entry["observationId"] + entry["variable"] for entry in entries}) != len(entries):
        raise RasterExportError("Timeline frame references must be unique.", 400)
    first = entries[0]
    units = _unit(first)
    if not units or units.lower() in {"unknown", "none"}:
        raise RasterExportError("Timeline quantitative exports require known raster units.")
    calibration = _calibration(first)
    for entry in entries[1:]:
        _validate_pair(first, entry)
        if _calibration(entry) != calibration:
            raise RasterExportError("Timeline frames have incompatible calibration or product metadata.")
    palette = str(display.get("palette", "viridis"))
    stretch = str(display.get("stretch", "linear"))
    bands = int(display.get("bands", 0))
    lower = float(display.get("lowerPercentile", 2)); upper = float(display.get("upperPercentile", 98))
    minimum = float(display.get("minimum")); maximum = float(display.get("maximum"))
    normalization_scale = display.get("normalizationScale")
    if palette not in PALETTE_ANCHORS or stretch not in {"linear", "log"}:
        raise RasterExportError("Timeline export display settings are invalid.", 400)
    if not (math.isfinite(minimum) and math.isfinite(maximum) and minimum <= maximum):
        raise RasterExportError("Timeline export requires resolved finite display intensity limits.", 400)
    if stretch == "log" and normalization_scale is not None and (not math.isfinite(float(normalization_scale)) or float(normalization_scale) <= 0):
        raise RasterExportError("Timeline logarithmic normalization scale is invalid.", 400)
    paths = [_raster_path(data_root, entry) for entry in entries]
    session_dir = session_dir.resolve()
    export_id = uuid4().hex
    work_dir = session_dir / "exports" / f"work-{export_id}"
    work_dir.mkdir(parents=True, exist_ok=False)
    gif_path = work_dir / "timeline.gif"
    pdf_path = work_dir / "timeline_report.pdf"
    json_path = work_dir / "timeline_metadata.json"
    zip_path = session_dir / "exports" / f"{export_id}.zip"
    try:
        with rasterio.open(paths[0]) as reference_ds:
            if reference_ds.crs is None: raise RasterExportError("Timeline raster has no CRS.")
            crs = reference_ds.crs
            transformed_bounds = []
            pixel_width, pixel_height = abs(reference_ds.res[0]), abs(reference_ds.res[1])
            if pixel_width <= 0 or pixel_height <= 0: raise RasterExportError("Timeline raster resolution is invalid.")
            for path in paths:
                with rasterio.open(path) as source:
                    if source.crs is None: raise RasterExportError("A timeline raster has no CRS.")
                    transformed_bounds.append(transform_bounds(source.crs, crs, *source.bounds, densify_pts=21))
            left = min(item[0] for item in transformed_bounds); bottom = min(item[1] for item in transformed_bounds)
            right = max(item[2] for item in transformed_bounds); top = max(item[3] for item in transformed_bounds)
            full_width = max(1, math.ceil((right - left) / pixel_width)); full_height = max(1, math.ceil((top - bottom) / pixel_height))
            scale = min(1, max_dimension / max(full_width, full_height))
            width = max(1, int(full_width * scale)); height = max(1, int(full_height * scale))
            transform = from_bounds(left, bottom, right, top, width, height)
            if width * height * 4 > max_storage_bytes:
                raise RasterExportError("Timeline frame size exceeds the visualization processing limit.", 413)
        study_name, study_bounds = _export_study_info(data_root, study_id)
        ordered = sorted(zip(entries, paths), key=lambda pair: (pair[0].get("acquisitionDate") or "", pair[0]["observationId"]))
        frame_meta = []
        pair_stats = []
        previous_values = previous_valid = None
        tolerance, tolerance_description = _change_tolerance(units, np.array([], dtype=np.float64))
        with gif_path.open("wb") as gif:
            _write_gif_header(gif, width, height)
            for entry, path in ordered:
                values, valid = _align_timeline_frame(path, crs, transform, width, height)
                rgba, _, _ = colorize_values(np.ma.array(values, mask=~valid), palette=palette,
                    minimum=minimum, maximum=maximum, lower_percentile=lower, upper_percentile=upper,
                    stretch=stretch, bands=bands,
                    normalization_scale=float(normalization_scale) if normalization_scale is not None else None)
                rgba = _annotate_timeline_frame(rgba, entry, palette, minimum, maximum, units,
                    stretch, bands, float(normalization_scale) if normalization_scale is not None else None)
                _append_gif_frame(gif, rgba)
                if gif.tell() > max_storage_bytes:
                    raise RasterExportError("Animated timeline exceeds the visualization session storage limit.", 413)
                frame_meta.append({"granuleId": entry["observationId"], "acquisitionTimestamp": entry.get("acquisitionDate"),
                    "frequency": entry["frequency"], "polarization": entry["variable"],
                    "sourceRasterIdentifier": {"studyId": study_id, "observationId": entry["observationId"],
                        "sourceVariable": entry["variable"], "frequency": entry["frequency"]},
                    "validPixelCount": int(valid.sum())})
                if previous_values is not None and previous_valid is not None:
                    pair_valid = valid & previous_valid
                    delta = values[pair_valid].astype(np.float64) - previous_values[pair_valid].astype(np.float64)
                    left_values = previous_values[pair_valid].astype(np.float64)
                    right_values = values[pair_valid].astype(np.float64)
                    threshold, description = _change_tolerance(units, np.concatenate((left_values, right_values)))
                    if delta.size:
                        unchanged = np.abs(delta) <= threshold
                        pair_stats.append({"earlierGranuleId": previous_entry["observationId"], "laterGranuleId": entry["observationId"],
                            "earlierTimestamp": previous_entry.get("acquisitionDate"), "laterTimestamp": entry.get("acquisitionDate"),
                            "units": units, "meanEarlier": float(left_values.mean()), "meanLater": float(right_values.mean()),
                            "meanDifference": float(delta.mean()), "medianDifference": float(np.median(delta)),
                            "minimumDifference": float(delta.min()), "maximumDifference": float(delta.max()),
                            "standardDeviationDifference": float(delta.std()), "validOverlappingPixelCount": int(delta.size),
                            "percentageIncreased": float((delta > threshold).sum() / delta.size * 100),
                            "percentageDecreased": float((delta < -threshold).sum() / delta.size * 100),
                            "percentageUnchanged": float(unchanged.sum() / delta.size * 100),
                            "unchangedTolerance": threshold, "unchangedToleranceMethod": description,
                            "interpretation": f"Mean measured value {('increased' if delta.mean() > threshold else 'decreased' if delta.mean() < -threshold else 'remained within tolerance')} by {abs(float(delta.mean())):.5g} {units} across valid aligned pixels."})
                    else:
                        pair_stats.append({"earlierGranuleId": previous_entry["observationId"], "laterGranuleId": entry["observationId"],
                            "limitation": "No valid overlapping pixels were available for quantitative comparison."})
                previous_values, previous_valid, previous_entry = values, valid, entry
            gif.write(b";")
        if gif_path.stat().st_size > max_storage_bytes:
            raise RasterExportError("Animated timeline exceeds the visualization session storage limit.", 413)
        first_date = (ordered[0][0].get("acquisitionDate") or "DateUnavailable")[:10]
        last_date = (ordered[-1][0].get("acquisitionDate") or "DateUnavailable")[:10]
        pol = {"HHHH": "HH", "HVHV": "HV", "VHVH": "VH", "VVVV": "VV"}.get(first["variable"], first["variable"])
        name = f"DeltaEarth_{safe_token(study_name, study_id)}_{pol}_{safe_token(first_date)}_to_{safe_token(last_date)}_Timeline.zip"
        (session_dir / "exports" / f"{export_id}.json").write_text(json.dumps({"filename": name}, allow_nan=False))
        metadata = {"studyId": study_id, "studyName": study_name, "studyBoundsWgs84": study_bounds,
            "acquisitionTimestamps": [item["acquisitionTimestamp"] for item in frame_meta],
            "frames": frame_meta, "granuleIds": [item["granuleId"] for item in frame_meta],
            "polarization": first["variable"], "frequency": first["frequency"], "units": units,
            "palette": palette, "displayIntensityMinimum": minimum, "displayIntensityMaximum": maximum,
            "normalization": stretch, "normalizationScale": normalization_scale, "bands": bands,
            "exportedAt": datetime.now(timezone.utc).isoformat(), "animationFormat": "GIF (MP4 encoder unavailable)",
            "frameDurationSeconds": 1.5, "changeStatistics": pair_stats,
            "methodology": {"alignment": "All saved rasters were reprojected with bilinear resampling to a common grid in the first raster CRS over the union of their extents.",
                "mask": "NoData and non-finite source values were masked and excluded from all statistics.",
                "unchangedTolerance": tolerance_description,
                "interpretationLimit": "Radar backscatter change alone does not establish deforestation, flooding, urban growth, or vegetation loss; moisture, vegetation structure, roughness, geometry, and other conditions can change measurements."}}
        json_path.write_text(json.dumps(_json_safe(metadata), indent=2, allow_nan=False))
        report_lines = [f"Study: {study_name} ({study_id})", f"Study bounds WGS84: {study_bounds}",
            f"Measurement: {first['frequency']} / {pol} ({units})", f"Frames: {len(frame_meta)}",
            f"First acquisition: {frame_meta[0]['acquisitionTimestamp']}", f"Last acquisition: {frame_meta[-1]['acquisitionTimestamp']}",
            "Granules: " + ", ".join(item["granuleId"] for item in frame_meta),
            f"Display: {palette}, {stretch}, fixed range {minimum:g} to {maximum:g} {units}",
            "Method: Bilinear alignment to common CRS grid; NoData excluded; changes are later minus earlier.",
            "Unchanged threshold: " + tolerance_description, "", "Consecutive acquisition statistics:"]
        for item in pair_stats:
            if "limitation" in item:
                report_lines.append(f"{item['earlierGranuleId']} to {item['laterGranuleId']}: {item['limitation']}")
            else:
                report_lines.extend([f"{item['earlierTimestamp']} -> {item['laterTimestamp']} ({item['earlierGranuleId']} -> {item['laterGranuleId']})",
                    f"Mean earlier/later: {item['meanEarlier']:.5g} / {item['meanLater']:.5g} {units}; mean delta: {item['meanDifference']:.5g} {units}",
                    f"Median delta: {item['medianDifference']:.5g}; min/max: {item['minimumDifference']:.5g} / {item['maximumDifference']:.5g}; standard deviation: {item['standardDeviationDifference']:.5g}",
                    f"Valid pixels: {item['validOverlappingPixelCount']}; increased/decreased/unchanged: {item['percentageIncreased']:.1f}% / {item['percentageDecreased']:.1f}% / {item['percentageUnchanged']:.1f}%",
                    item["interpretation"], ""])
        report_lines.extend(["Scientific note: Radar backscatter can vary with surface moisture, vegetation structure, surface roughness, observation geometry, and other acquisition or environmental conditions.",
            "These calculations describe measured raster differences and are not evidence by themselves of a specific environmental event."])
        _write_text_pdf(pdf_path, "Delta-Earth NISAR Timeline Report", report_lines)
        _zip_files(zip_path, [(gif_path, "timeline.gif"), (pdf_path, "timeline_report.pdf"), (json_path, "timeline_metadata.json")])
        if zip_path.stat().st_size > max_storage_bytes:
            raise RasterExportError("Timeline export exceeds the visualization session storage limit.", 413)
        shutil.rmtree(work_dir, ignore_errors=True)
        return {"exportId": export_id, "filename": name, "path": zip_path}
    except Exception:
        zip_path.unlink(missing_ok=True)
        (session_dir / "exports" / f"{export_id}.json").unlink(missing_ok=True)
        shutil.rmtree(work_dir, ignore_errors=True)
        raise
