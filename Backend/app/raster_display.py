"""Palette and intensity mapping for downsampled single-band raster previews."""

from __future__ import annotations

from typing import Any

import numpy as np


PALETTE_ANCHORS: dict[str, tuple[str, ...]] = {
    "grayscale": ("#000000", "#ffffff"),
    "red": ("#000000", "#ff0000"),
    "viridis": ("#440154", "#3b528b", "#21918c", "#5ec962", "#fde725"),
    "plasma": ("#0d0887", "#7e03a8", "#cc4778", "#f89540", "#f0f921"),
    "inferno": ("#000004", "#420a68", "#932667", "#dd513a", "#fca50a", "#fcffa4"),
    "magma": ("#000004", "#3b0f70", "#8c2981", "#de4968", "#fe9f6d", "#fcfdbf"),
    "turbo": ("#30123b", "#4662d8", "#28bbec", "#32f298", "#a0fc3a", "#f9ba38", "#f66b19", "#c82704", "#7a0403"),
    "jet": ("#00007f", "#0000ff", "#00ffff", "#ffff00", "#ff0000", "#7f0000"),
    "terrain": ("#333399", "#2c7fb8", "#41b6c4", "#a1dab4", "#ffffcc", "#c2b280", "#8c6d31", "#ffffff"),
    "custom": ("#00008b", "#00ffff", "#00a000", "#ffff00", "#ff0000"),
}


def _hex_rgb(value: str) -> np.ndarray:
    value = value.lstrip("#")
    return np.array([int(value[index:index + 2], 16) for index in (0, 2, 4)], dtype=np.float64)


def palette_color(normalized: np.ndarray, palette: str, bands: int = 0) -> np.ndarray:
    if palette not in PALETTE_ANCHORS:
        raise ValueError(f"Unsupported raster palette: {palette}")
    t = np.clip(np.asarray(normalized, dtype=np.float64), 0.0, 1.0)
    if bands > 1:
        t = np.minimum(1.0, np.floor(t * bands) / (bands - 1))
    anchors = np.stack([_hex_rgb(color) for color in PALETTE_ANCHORS[palette]])
    scaled = t * (len(anchors) - 1)
    lower = np.floor(scaled).astype(np.int64)
    upper = np.minimum(lower + 1, len(anchors) - 1)
    weight = (scaled - lower)[..., None]
    rgb = anchors[lower] * (1.0 - weight) + anchors[upper] * weight
    return np.clip(np.rint(rgb), 0, 255).astype(np.uint8)


def colorize_values(sample: Any, *, palette: str = "viridis", minimum: float | None = None,
                    maximum: float | None = None, lower_percentile: float = 2.0,
                    upper_percentile: float = 98.0, stretch: str = "linear",
                    bands: int = 0, normalization_scale: float | None = None) -> tuple[np.ndarray, float, float]:
    """Colorize a masked array; source values and mask are never modified."""
    if palette not in PALETTE_ANCHORS:
        raise ValueError(f"Unsupported raster palette: {palette}")
    if stretch not in {"linear", "log"}:
        raise ValueError("Raster stretch must be linear or log.")
    if not (0 <= lower_percentile < upper_percentile <= 100):
        raise ValueError("Percentile clipping must satisfy 0 ≤ lower < upper ≤ 100.")
    values = np.asarray(np.ma.getdata(sample), dtype=np.float64)
    valid = ~np.ma.getmaskarray(sample) & np.isfinite(values)
    if not valid.any():
        raise ValueError("Raster contains no valid pixels to render.")
    low = float(minimum) if minimum is not None else float(np.percentile(values[valid], lower_percentile))
    high = float(maximum) if maximum is not None else float(np.percentile(values[valid], upper_percentile))
    if not np.isfinite(low) or not np.isfinite(high) or high < low:
        raise ValueError("Intensity minimum and maximum must be finite and minimum must not exceed maximum.")
    selected = np.clip(values, low, high)
    range_low, range_high = low, high
    if stretch == "log":
        # Signed log1p supports zero and negative intensities without log(x) on x ≤ 0.
        scale = normalization_scale or max(float(np.median(np.abs(values[valid]))), np.finfo(np.float64).tiny)
        selected = np.sign(selected) * np.log1p(np.abs(selected) / scale)
        range_low = float(np.sign(low) * np.log1p(abs(low) / scale))
        range_high = float(np.sign(high) * np.log1p(abs(high) / scale))
    normalized = np.zeros(values.shape, dtype=np.float64)
    if range_high > range_low:
        normalized[valid] = (selected[valid] - range_low) / (range_high - range_low)
    else:
        normalized[valid] = 0.5
    rgb = palette_color(normalized, palette, bands)
    rgba = np.zeros((*values.shape, 4), dtype=np.uint8)
    rgba[..., :3] = rgb
    rgba[..., 3] = valid.astype(np.uint8) * 255
    return rgba, low, high


def palette_legend(palette: str, minimum: float, maximum: float, ticks: int = 5,
                   bands: int = 0) -> dict[str, Any]:
    stops = PALETTE_ANCHORS[palette]
    discrete_colors = palette_color(np.linspace(0, 1, bands), palette).tolist() if bands > 1 else None
    return {"palette": palette, "stops": list(stops),
            "ticks": np.linspace(minimum, maximum, max(2, ticks)).tolist(),
            "minimum": minimum, "maximum": maximum, "bands": bands,
            "bandColors": ["#%02x%02x%02x" % tuple(color) for color in discrete_colors]
                if discrete_colors is not None else None}


def log_normalization_scale(sample: Any) -> float:
    values = np.asarray(np.ma.getdata(sample), dtype=np.float64)
    valid = ~np.ma.getmaskarray(sample) & np.isfinite(values)
    if not valid.any():
        raise ValueError("Raster contains no valid pixels to render.")
    return max(float(np.median(np.abs(values[valid]))), np.finfo(np.float64).tiny)
