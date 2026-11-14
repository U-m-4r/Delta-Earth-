#!/usr/bin/env python3
"""Extract and clip a numeric NISAR HDF5 dataset without inventing measurements.

Runtime dependencies are intentionally explicit: h5py, numpy, rasterio, shapely,
and pyproj. The script fails with an actionable unsupported-product error when a
product does not expose a georeferenced 2-D measurement dataset.
"""
import argparse
import json
import os
import sys

try:
    import h5py
    import numpy as np
    import rasterio
    from rasterio.mask import mask
    from rasterio.transform import from_origin
    from shapely.geometry import shape
    from shapely.ops import transform as transform_geometry
    from pyproj import Transformer
except ImportError as exc:
    raise SystemExit(f"Unsupported product format: raster processing dependency is missing ({exc.name}). Install Backend/processing-requirements.txt.")


def datasets(group, prefix=""):
    for name, value in group.items():
        path = f"{prefix}/{name}"
        if isinstance(value, h5py.Dataset):
            yield path, value
        elif isinstance(value, h5py.Group):
            yield from datasets(value, path)


def choose_measurement(handle):
    candidates = []
    excluded = ("latitude", "longitude", "projection_x", "projection_y", "incidence", "mask", "quality", "noise")
    for path, dataset in datasets(handle):
        if len(dataset.shape) != 2 or not np.issubdtype(dataset.dtype, np.number):
            continue
        lowered = path.lower()
        if any(word in lowered for word in excluded):
            continue
        score = 0
        if "gcov" in lowered:
            score += 4
        if any(pol in lowered for pol in ("hhhh", "hvhv", "vhvh", "vvvv", "hh", "hv", "vh", "vv")):
            score += 3
        if "science/lsar" in lowered:
            score += 2
        candidates.append((score, path, dataset))
    if not candidates:
        raise ValueError("Unsupported product format: no suitable 2-D numeric NISAR measurement dataset was found.")
    return max(candidates, key=lambda item: item[0])


def find_axis(handle, names, size):
    for path, dataset in datasets(handle):
        if dataset.ndim != 1 or len(dataset) != size:
            continue
        basename = path.lower().split("/")[-1]
        standard_name = str(dataset.attrs.get("standard_name", "")).lower()
        if any(name in basename or name in standard_name for name in names):
            return np.asarray(dataset[:], dtype=float)
    return None


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input")
    parser.add_argument("--polygon")
    parser.add_argument("--output")
    parser.add_argument("--preview")
    parser.add_argument("--pixel-raster")
    parser.add_argument("--longitude", type=float)
    parser.add_argument("--latitude", type=float)
    parser.add_argument("--compare-a")
    parser.add_argument("--compare-b")
    args = parser.parse_args()

    if args.pixel_raster:
        with rasterio.open(args.pixel_raster) as raster:
            row, col = raster.index(args.longitude, args.latitude)
            if row < 0 or col < 0 or row >= raster.height or col >= raster.width:
                raise ValueError("Coordinate is outside the processed raster bounds.")
            value = float(raster.read(1)[row, col])
            print(json.dumps({"longitude": args.longitude, "latitude": args.latitude, "value": None if raster.nodata is not None and value == raster.nodata else value, "measurement": "processed raster value", "units": None, "acquiredAt": None}))
        return

    if args.compare_a or args.compare_b:
        if not args.compare_a or not args.compare_b:
            raise ValueError("Both baseline and current rasters are required for comparison.")
        with rasterio.open(args.compare_a) as baseline, rasterio.open(args.compare_b) as current:
            if baseline.crs != current.crs or baseline.transform != current.transform or baseline.shape != current.shape:
                raise ValueError("Rasters are not spatially aligned and cannot be compared.")
            a = baseline.read(1)
            b = current.read(1)
            valid = np.isfinite(a) & np.isfinite(b)
            if baseline.nodata is not None:
                valid &= a != baseline.nodata
            if current.nodata is not None:
                valid &= b != current.nodata
            difference = b[valid] - a[valid]
            if difference.size == 0:
                print(json.dumps({"validPixelCount": 0, "difference": None}))
            else:
                print(json.dumps({"validPixelCount": int(difference.size), "meanDifference": float(np.mean(difference)), "medianDifference": float(np.median(difference)), "standardDeviation": float(np.std(difference)), "minimumDifference": float(np.min(difference)), "maximumDifference": float(np.max(difference))}))
        return

    if not args.input or not args.polygon or not args.output or not args.preview:
        raise ValueError("Input, polygon, output, and preview are required for raster processing.")

    with h5py.File(args.input, "r") as handle:
        _, _, measurement = choose_measurement(handle)
        values = np.asarray(measurement[:], dtype="float32")
        if values.ndim != 2:
            raise ValueError("Unsupported product format: selected measurement is not a 2-D raster.")
        height, width = values.shape
        x = find_axis(handle, ("projection_x", "xcoordinates", "longitude"), width)
        y = find_axis(handle, ("projection_y", "ycoordinates", "latitude"), height)
        if x is None or y is None:
            raise ValueError("Unsupported product format: no georeferencing axes were found for the measurement dataset.")
        if x[0] > x[-1]:
            x = x[::-1]
            values = values[:, ::-1]
        if y[0] < y[-1]:
            y = y[::-1]
            values = values[::-1, :]
        dx = float(abs(x[1] - x[0])) if width > 1 else 1.0
        dy = float(abs(y[1] - y[0])) if height > 1 else 1.0
        transform = from_origin(float(x.min()) - dx / 2, float(y.max()) + dy / 2, dx, dy)
        crs = measurement.attrs.get("crs_wkt") or measurement.attrs.get("spatial_ref")
        if not crs and measurement.attrs.get("grid_mapping"):
            mapping_name = measurement.attrs["grid_mapping"]
            if isinstance(mapping_name, bytes):
                mapping_name = mapping_name.decode()
            mapping = measurement.parent[mapping_name]
            epsg = mapping.attrs.get("epsg_code")
            spatial_ref = mapping.attrs.get("spatial_ref")
            crs = spatial_ref or (f"EPSG:{int(epsg)}" if epsg is not None else None)
        crs = crs or "EPSG:4326"
        if isinstance(crs, bytes):
            crs = crs.decode()
        geometry = shape(json.load(open(args.polygon, "r", encoding="utf-8"))["geometry"])
        if str(crs).upper() not in ("EPSG:4326", "EPSG:CRS84"):
            geometry = transform_geometry(Transformer.from_crs("EPSG:4326", crs, always_xy=True).transform, geometry)
        source_profile = {"driver": "GTiff", "height": height, "width": width, "count": 1, "dtype": "float32", "crs": crs, "transform": transform, "nodata": -9999.0}
        with rasterio.io.MemoryFile() as memory:
            with memory.open(**source_profile) as source:
                source.write(np.where(np.isfinite(values), values, -9999.0), 1)
                clipped, clipped_transform = mask(source, [geometry.__geo_interface__], crop=True, filled=True, nodata=-9999.0)
                profile = source.profile.copy()
                profile.update(height=clipped.shape[1], width=clipped.shape[2], transform=clipped_transform)
                with rasterio.open(args.output, "w", **profile) as target:
                    target.write(clipped)
        with rasterio.open(args.output, "r+") as raster:
            array = raster.read(1)
            valid = array != raster.nodata
            raster.write_mask((valid * 255).astype("uint8")) if raster.count else None
            preview = np.where(valid, array, np.nan)
            if np.isfinite(preview).any():
                lo, hi = np.nanpercentile(preview, [2, 98])
                scaled = np.clip((preview - lo) / max(hi - lo, 1e-12) * 255, 0, 255)
                scaled = np.where(valid, scaled, 0).astype("uint8")
            else:
                scaled = np.zeros_like(array, dtype="uint8")
            with rasterio.open(args.preview, "w", driver="PNG", width=raster.width, height=raster.height, count=1, dtype="uint8", nodata=0) as image:
                image.write(scaled, 1)
            bounds = raster.bounds
            print(json.dumps({"measurement": os.path.basename(measurement.name), "bounds": [bounds.left, bounds.bottom, bounds.right, bounds.top], "crs": str(raster.crs) if raster.crs else None, "width": raster.width, "height": raster.height, "resolution": [abs(raster.res[0]), abs(raster.res[1])], "validPixelCount": int(valid.sum()), "nodataPixelCount": int((~valid).sum())}))


if __name__ == "__main__":
    main()
