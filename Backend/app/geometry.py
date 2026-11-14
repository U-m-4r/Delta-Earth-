import hashlib
import json
from typing import Any

from pyproj import Geod
from shapely.geometry import shape
from shapely.validation import explain_validity

from .settings import get_settings

GEOD = Geod(ellps="WGS84")


class PolygonInputError(ValueError):
    pass


def study_id_for_feature(feature: dict[str, Any]) -> str:
    """Return a stable, collision-resistant identifier for the complete study feature."""
    serialized = json.dumps(feature, sort_keys=True).encode()
    return hashlib.sha256(serialized).hexdigest()[:16]


def validate_geojson(feature: dict[str, Any]) -> tuple[Any, float, list[float], list[float]]:
    if feature.get("type") != "Feature":
        raise PolygonInputError("Input must be a GeoJSON Feature.")
    crs = feature.get("properties", {}).get("coordinateSystem", "EPSG:4326")
    if crs not in ("EPSG:4326", "CRS84", "OGC:CRS84"):
        raise PolygonInputError("Coordinates must use WGS84 longitude/latitude (EPSG:4326).")
    try:
        polygon = shape(feature.get("geometry", {}))
    except Exception as exc:
        raise PolygonInputError("Invalid GeoJSON geometry.") from exc
    if polygon.geom_type != "Polygon":
        raise PolygonInputError("Study area geometry must be a Polygon.")
    if polygon.is_empty or not polygon.is_valid:
        raise PolygonInputError(f"Invalid polygon: {explain_validity(polygon)}")
    for lon, lat in polygon.exterior.coords:
        if not (-180 <= lon <= 180 and -90 <= lat <= 90):
            raise PolygonInputError("Coordinates must be valid longitude/latitude values.")
    area_m2, _ = GEOD.geometry_area_perimeter(polygon)
    area_km2 = abs(area_m2) / 1_000_000
    if area_km2 <= 0:
        raise PolygonInputError("Polygon area must be greater than zero.")
    if area_km2 > get_settings().max_polygon_area_km2:
        raise PolygonInputError(f"Polygon exceeds the {get_settings().max_polygon_area_km2:,.0f} km² limit.")
    bounds = list(polygon.bounds)
    centroid = [polygon.centroid.x, polygon.centroid.y]
    return polygon, area_km2, bounds, centroid
