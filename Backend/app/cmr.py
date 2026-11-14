import asyncio
import json
import logging
import math
import re
from datetime import date
from typing import Any

import httpx
from shapely.geometry import MultiPolygon, Polygon, mapping
from shapely.geometry.polygon import orient

from .settings import get_settings

log = logging.getLogger(__name__)


class CMRRequestError(RuntimeError):
    def __init__(self, message: str, status_code: int | None = None, response_body: str = ""):
        super().__init__(message)
        self.status_code = status_code
        self.response_body = response_body


class CMRGeometryError(ValueError):
    pass


def _validate_cmr_geometry(geometry: Any) -> None:
    if not isinstance(geometry, (Polygon, MultiPolygon)) or geometry.is_empty or not geometry.is_valid:
        raise CMRGeometryError("CMR discovery requires a valid WGS84 Polygon or MultiPolygon.")
    polygons = [geometry] if isinstance(geometry, Polygon) else list(geometry.geoms)
    for polygon in polygons:
        for ring in [polygon.exterior, *polygon.interiors]:
            coordinates = list(ring.coords)
            if len(coordinates) < 4 or coordinates[0][:2] != coordinates[-1][:2]:
                raise CMRGeometryError("Every CMR polygon ring must be closed and contain at least three vertices.")
            if len({(point[0], point[1]) for point in coordinates[:-1]}) < 3:
                raise CMRGeometryError("Every CMR polygon ring must contain at least three unique vertices.")
            for point in coordinates:
                lon, lat = point[:2]
                if not math.isfinite(lon) or not math.isfinite(lat):
                    raise CMRGeometryError("CMR polygon coordinates must be finite numbers.")
                if not (-180 <= lon <= 180 and -90 <= lat <= 90):
                    raise CMRGeometryError("CMR polygon coordinates must be longitude/latitude in EPSG:4326 ranges.")


def normalize_cmr_polygon(polygon: Polygon) -> str:
    """Serialize a hole-free WGS84 Polygon using CMR's comma-separated CCW syntax."""
    _validate_cmr_geometry(polygon)
    if polygon.interiors:
        raise CMRGeometryError("CMR's polygon parameter cannot represent holes; use the GeoJSON shapefile request.")
    normalized = orient(polygon, sign=1.0)
    values = []
    for lon, lat, *_ in normalized.exterior.coords:
        values.extend((repr(float(lon)), repr(float(lat))))
    return ",".join(values)


def _normalized_geojson(geometry: Polygon | MultiPolygon) -> bytes:
    _validate_cmr_geometry(geometry)
    if isinstance(geometry, Polygon):
        normalized = orient(geometry, sign=1.0)
    else:
        normalized = MultiPolygon([orient(part, sign=1.0) for part in geometry.geoms])
    points = sum(len(poly.exterior.coords) + sum(len(ring.coords) for ring in poly.interiors)
                 for poly in ([normalized] if isinstance(normalized, Polygon) else normalized.geoms))
    if points > 5000:
        raise CMRGeometryError("CMR GeoJSON shapefile requests support at most 5,000 points; this geometry is larger.")
    feature = {"type": "Feature", "properties": {}, "geometry": mapping(normalized)}
    encoded = json.dumps(feature, allow_nan=False, separators=(",", ":")).encode("utf-8")
    if len(encoded) > 1_000_000:
        raise CMRGeometryError("CMR GeoJSON shapefile requests are limited to 1,000,000 bytes.")
    return encoded


def _asset_links(links: list[dict[str, Any]]) -> list[dict[str, str]]:
    assets = []
    for link in links:
        href = link.get("href")
        if not href or link.get("inherited"):
            continue
        title = link.get("title", "")
        rel = link.get("rel", "")
        kind = "browse" if "browse" in title.lower() or "browse" in rel.lower() else "metadata" if "metadata" in title.lower() else "data"
        assets.append({"type": kind, "url": href, "title": title or rel, "mediaType": link.get("type", "")})
    return assets


async def _get_with_retry(client: httpx.AsyncClient, url: str, **kwargs) -> httpx.Response:
    last_error: CMRRequestError | None = None
    for attempt in range(4):
        try:
            response = await client.get(url, **kwargs)
            if response.is_success:
                return response
            body = response.text[:4000]
            log.error("CMR granule search returned HTTP %s: %s", response.status_code, body)
            last_error = CMRRequestError(
                f"NASA CMR returned HTTP {response.status_code}: {body or response.reason_phrase}",
                status_code=response.status_code,
                response_body=body,
            )
            if response.status_code < 500 and response.status_code != 429:
                raise last_error
            if attempt == 3:
                raise last_error
            await asyncio.sleep(min(2**attempt, 8))
        except httpx.TransportError:
            if attempt == 3:
                raise CMRRequestError("Could not connect to NASA CMR after 4 attempts.")
            await asyncio.sleep(min(2**attempt, 8))
    raise last_error or CMRRequestError("NASA CMR request failed after 4 attempts.")


def _record(entry: dict[str, Any]) -> dict[str, Any]:
    title = entry.get("producer_granule_id") or entry.get("title") or entry.get("id")
    start = entry.get("time_start")
    frequencies = sorted(set(re.findall(r"frequency([AB])", title, re.I)))
    frequency_names = [f"frequency{value.upper()}" for value in frequencies]
    polarizations = sorted(set(re.findall(r"(?:^|_)((?:HH|HV|VV|VH|RH|RV){2})(?:_|$)", title)))
    links = _asset_links(entry.get("links", []))
    bbox = entry.get("boxes", [None])[0]
    box_values = [float(value) for value in bbox.split()] if bbox else None
    assets = links
    try:
        granule_size_mb = round(float(entry.get("granule_size", 0) or 0), 2)
    except (TypeError, ValueError):
        granule_size_mb = None
    return {
        "id": entry.get("id", ""), "provider": "NASA ASF DAAC", "title": title,
        "mission": "NISAR", "productShortName": "NISAR_L2_GCOV_PROVISIONAL_V1",
        "acquiredAt": start, "startAt": start, "endAt": entry.get("time_end"),
        "productType": "GCOV", "processingMaturity": "PROVISIONAL",
        "frequencies": frequency_names, "polarizations": polarizations,
        "bbox": box_values, "assets": assets,
        "downloadUrl": next((x["url"] for x in assets if x["type"] == "data"), None),
        "metadataUrl": next((x["url"] for x in assets if x["type"] == "metadata"), None),
        "sourceMetadata": {"collectionConceptId": entry.get("collection_concept_id"),
                            "dataCenter": entry.get("data_center"), "datasetId": entry.get("dataset_id"),
                            "granuleSizeMb": granule_size_mb},
        "_raw": entry,
    }


async def search_granules(polygon: Any, start_date: date | None = None, end_date: date | None = None, page_size: int = 100) -> dict[str, Any]:
    cfg = get_settings()
    _validate_cmr_geometry(polygon)
    temporal = None
    if start_date or end_date:
        temporal = f"{start_date.isoformat()}T00:00:00Z" if start_date else ""
        temporal += ","
        temporal += f"{end_date.isoformat()}T23:59:59Z" if end_date else ""
    params: dict[str, Any] = {
        "collection_concept_id": cfg.nisar_gcov_collection,
        "page_size": min(max(page_size, 1), 200), "page_num": 1,
    }
    if temporal:
        params["temporal"] = temporal
    headers = {"Accept": "application/json"}
    if cfg.earthdata_token:
        headers["Authorization"] = f"Bearer {cfg.earthdata_token}"
    async with httpx.AsyncClient(timeout=cfg.discovery_timeout_seconds, follow_redirects=True) as client:
        url = f"{cfg.cmr_base_url}/granules.json"
        if isinstance(polygon, Polygon) and not polygon.interiors:
            params["polygon"] = normalize_cmr_polygon(polygon)
            response = await _get_with_retry(client, url, params=params, headers=headers)
        else:
            # CMR's documented GeoJSON shapefile POST preserves holes and multipart geometries.
            geometry_bytes = _normalized_geojson(polygon)
            response = await _post_geojson_with_retry(client, url, params, headers, geometry_bytes)
        payload = response.json()
    feed = payload.get("feed", {})
    entries = [_record(entry) for entry in feed.get("entry", [])]
    for entry in entries:
        entry.pop("_raw", None)
    dates = sorted({item["acquiredAt"][:10] for item in entries if item.get("acquiredAt")})
    return {"observations": entries, "acquisitionDates": dates,
            "acquisitions": [{"id": d, "acquiredAt": d, "observationIds": [x["id"] for x in entries if x.get("acquiredAt", "").startswith(d)], "mission": "NISAR", "productTypes": ["GCOV"]} for d in dates],
            "collections": [{"id": cfg.nisar_gcov_collection, "shortName": "NISAR_L2_GCOV_PROVISIONAL_V1", "title": "NISAR Provisional Geocoded Polarimetric Covariance Product", "maturity": "PROVISIONAL", "productType": "GCOV", "granuleCount": len(entries)}],
            "frequencies": sorted({v for item in entries for v in item["frequencies"]}),
            "polarizations": sorted({v for item in entries for v in item["polarizations"]}),
            "hits": int(feed.get("hits", len(entries)) or 0), "warnings": []}


async def _post_geojson_with_retry(client: httpx.AsyncClient, url: str, params: dict[str, Any], headers: dict[str, str], geometry: bytes) -> httpx.Response:
    last_error: CMRRequestError | None = None
    for attempt in range(4):
        try:
            response = await client.post(url, data={key: str(value) for key, value in params.items()},
                                         files={"shapefile": ("study-area.geojson", geometry, "application/geo+json")},
                                         headers=headers)
            if response.is_success:
                return response
            body = response.text[:4000]
            log.error("CMR GeoJSON granule search returned HTTP %s: %s", response.status_code, body)
            last_error = CMRRequestError(f"NASA CMR returned HTTP {response.status_code}: {body or response.reason_phrase}", response.status_code, body)
            if response.status_code < 500 and response.status_code != 429:
                raise last_error
            if attempt == 3:
                raise last_error
            await asyncio.sleep(min(2**attempt, 8))
        except httpx.TransportError:
            if attempt == 3:
                raise CMRRequestError("Could not connect to NASA CMR after 4 attempts.")
            await asyncio.sleep(min(2**attempt, 8))
    raise last_error or CMRRequestError("NASA CMR request failed after 4 attempts.")
