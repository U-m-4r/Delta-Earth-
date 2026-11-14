import asyncio
import hashlib
import json
import logging
import re
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import quote, urljoin, urlsplit
from uuid import uuid4

import httpx
import numpy as np
import rasterio
from rasterio.mask import mask as raster_mask
from rasterio.warp import transform_geom
from shapely.geometry import shape
from .geometry import study_id_for_feature
from .settings import get_settings

log = logging.getLogger(__name__)
MEASUREMENTS = ("HHHH", "HVHV", "VVVV", "VHVH", "HHHV", "HHVH", "HHVV", "HVVH", "HVVV", "VHVV", "RHRH", "RVRV", "RHRV")
AUXILIARY = ("numberOfLooks", "mask", "rtcGammaToSigmaFactor")


class HarmonyConfigurationError(RuntimeError):
    """Raised when Harmony cannot be authenticated from local configuration."""


class HarmonySubmissionUnknownError(RuntimeError):
    """Submission outcome is ambiguous; reconcile the persisted record before retrying."""


class HarmonySubmissionError(RuntimeError):
    """Harmony rejected or failed to accept an extraction request."""


class HarmonyProcessingError(RuntimeError):
    """Harmony accepted a job but failed while processing it."""


JOB_SUCCESS_STATES = {"successful", "complete", "completed", "succeeded"}
JOB_FAILURE_STATES = {"failed", "canceled", "cancelled"}


def _sanitize_text(value: object, limit: int = 500) -> str:
    text = str(value)[:limit]
    cfg = get_settings()
    token = cfg.edl_token.get_secret_value() if cfg.edl_token else ""
    if token:
        text = text.replace(token, "[REDACTED]")
    return re.sub(r"(?i)([?&](?:token|signature|credential|x-amz-[^=]*)=)[^&\s]+", r"\1[REDACTED]", text)


def _job_error_details(job: dict) -> list[dict]:
    errors = job.get("errors") or []
    if not isinstance(errors, list):
        errors = [errors]
    result = []
    for error in errors[:10]:
        if isinstance(error, dict):
            result.append({key: _sanitize_text(error[key]) for key in ("code", "type", "title", "message", "description", "serviceID") if error.get(key) is not None})
        else:
            result.append({"message": _sanitize_text(error)})
    return result


def _job_record_path(submission_key: str) -> Path:
    return get_settings().resolved_data_dir / "harmony_jobs" / f"{submission_key}.json"


def _write_job_record(path: Path, record: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(".json.part")
    temporary.write_text(json.dumps(record, indent=2))
    temporary.replace(path)


def _safe_response_summary(response: httpx.Response) -> dict:
    """Keep useful Harmony diagnostics without storing auth, full URLs, or signed query strings."""
    summary = {"httpStatus": response.status_code, "contentType": response.headers.get("content-type")}
    location = response.headers.get("location")
    if location:
        parsed = urlsplit(urljoin(str(response.request.url), location))
        match = re.search(r"/jobs/([^/?]+)", parsed.path)
        summary["locationPath"] = "/jobs/<job-id>" if match else parsed.path[:200]
    if response.content:
        try:
            payload = response.json()
        except ValueError:
            payload = None
        if isinstance(payload, dict):
            summary["body"] = {
                key: _sanitize_text(payload[key])
                for key in ("jobID", "jobId", "status", "progress", "message")
                if payload.get(key) is not None
            }
        else:
            body = response.text[:1000]
            token = get_settings().edl_token.get_secret_value() if get_settings().edl_token else ""
            if token:
                body = body.replace(token, "[REDACTED]")
            summary["bodyExcerpt"] = re.sub(r"(?i)([?&](?:token|signature|credential|x-amz-[^=]*)=)[^&\s]+", r"\1[REDACTED]", body)
    return summary


def _submission_key(collection: str, granule_id: str, variable_path: str, geojson: dict) -> str:
    identity = json.dumps({"collection": collection, "granule": granule_id, "variable": variable_path, "geojson": geojson}, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(identity.encode()).hexdigest()


def _origin(url: str):
    parsed = urlsplit(url)
    port = parsed.port or (443 if parsed.scheme.lower() == "https" else 80 if parsed.scheme.lower() == "http" else None)
    return parsed.scheme.lower(), (parsed.hostname or "").lower(), port


def auth_kwargs(url: str | None = None) -> dict:
    """Return bearer auth only for the configured Harmony origin."""
    cfg = get_settings()
    if _origin(url or cfg.harmony_base_url) != _origin(cfg.harmony_base_url):
        return {}
    token = cfg.edl_token.get_secret_value().strip() if cfg.edl_token is not None else ""
    if not token:
        # Keep compatibility with older local configs that used EARTHDATA_TOKEN.
        token = (cfg.earthdata_token or "").strip()
    if not token:
        raise HarmonyConfigurationError(
            "EDL_TOKEN is missing from Backend/.env. Add your NASA Earthdata bearer token and restart the backend."
        )
    return {"headers": {"Authorization": f"Bearer {token}"}}


async def _get_with_retry(client: httpx.AsyncClient, url: str, **kwargs) -> httpx.Response:
    for attempt in range(4):
        try:
            response = await client.get(url, **kwargs)
            if response.status_code != 429 and response.status_code < 500:
                response.raise_for_status()
                return response
            if attempt == 3:
                response.raise_for_status()
            await asyncio.sleep(min(2**attempt, 8))
        except httpx.TransportError:
            if attempt == 3:
                raise
            await asyncio.sleep(min(2**attempt, 8))
    raise RuntimeError("Harmony request failed after 4 attempts.")


async def collection_capabilities(client: httpx.AsyncClient) -> dict:
    cfg = get_settings()
    url = f"{cfg.harmony_base_url}/capabilities"
    response = await _get_with_retry(client, url, params={"collectionId": cfg.nisar_gcov_collection}, **auth_kwargs(url))
    return response.json()


def _service_modes(capabilities: dict) -> dict[str, list[str]]:
    """Find individual services that support variable extraction and GeoTIFF."""
    services = capabilities.get("services", [])
    modes = {"shape": [], "bbox": []}
    for service in services:
        caps = service.get("capabilities", {})
        subsetting = caps.get("subsetting", {})
        formats = [str(value.get("mimeType", "") if isinstance(value, dict) else value).lower() for value in caps.get("outputFormats", [])]
        if not subsetting.get("variable") or not any("tiff" in value for value in formats):
            continue
        name = service.get("name", "unknown")
        if subsetting.get("shape"):
            modes["shape"].append(name)
        elif subsetting.get("bbox"):
            modes["bbox"].append(name)
    return modes


def _service_support(capabilities: dict) -> tuple[bool, list[str]]:
    """Accept polygon extraction or bbox extraction followed by local polygon masking."""
    modes = _service_modes(capabilities)
    if modes["shape"]:
        return True, modes["shape"]
    if modes["bbox"]:
        return True, modes["bbox"]
    return False, []


async def inspect_capabilities() -> dict:
    cfg = get_settings()
    async with httpx.AsyncClient(timeout=cfg.discovery_timeout_seconds, follow_redirects=True) as client:
        capabilities = await collection_capabilities(client)
    service_names = [service.get("name", "unknown") for service in capabilities.get("services", [])]
    supported, eligible = _service_support(capabilities)
    modes = _service_modes(capabilities)
    spatial_mode = "shape" if modes["shape"] else "bbox" if modes["bbox"] else None
    variables = capabilities.get("variables", [])
    variable_names = [v.get("name", v.get("nativeId", "")) if isinstance(v, dict) else str(v) for v in variables]
    service_details = []
    output_formats = set()
    for service in capabilities.get("services", []):
        service_capabilities = service.get("capabilities", {})
        formats = [
            value.get("mimeType", "") if isinstance(value, dict) else str(value)
            for value in service_capabilities.get("outputFormats", [])
        ]
        output_formats.update(value for value in formats if value)
        service_details.append({
            "name": service.get("name", "unknown"),
            "outputFormats": formats,
            "subsetting": service_capabilities.get("subsetting", {}),
        })
    return {"collectionId": capabilities.get("conceptId", cfg.nisar_gcov_collection),
            "shortName": capabilities.get("shortName", "NISAR_L2_GCOV_PROVISIONAL_V1"),
            "services": service_names, "eligibleExtractionServices": eligible,
            "serviceDetails": service_details, "outputFormats": sorted(output_formats),
            "collectionRecognized": capabilities.get("conceptId") == cfg.nisar_gcov_collection,
            "variableSubset": supported, "shapeSubset": bool(modes["shape"]),
            "bboxSubset": bool(modes["shape"] or modes["bbox"]),
            "spatialSubsetMode": spatial_mode,
            "polygonClipLocally": spatial_mode == "bbox",
            "geotiff": supported,
            "variables": variable_names,
            "message": (
                "Harmony supports shape-based variable GeoTIFF extraction."
                if spatial_mode == "shape" else
                "Harmony supports bbox-based variable GeoTIFF extraction; outputs will be clipped locally to the study polygon."
                if spatial_mode == "bbox" else
                "No single Harmony service supports GCOV variable extraction with spatial subsetting and GeoTIFF output."
            )}


def _candidate_paths(name: str, frequency: str) -> list[str]:
    return [f"/science/LSAR/GCOV/grids/{frequency}/{name}"]


def _observation_summary(metadata: dict) -> dict:
    keys = ("id", "provider", "title", "mission", "productShortName", "acquiredAt", "startAt", "endAt", "productType", "processingMaturity", "frequencies", "polarizations", "bbox")
    return {key: metadata[key] for key in keys if key in metadata}


async def _submit_variable(client: httpx.AsyncClient, collection: str, granule_id: str, variable_path: str, geojson: dict, spatial_mode: str = "shape", *, record_path: Path | None = None, allow_reconciled_retry: bool = False, observation_metadata: dict | None = None) -> tuple[str | None, dict | None, str | None]:
    cfg = get_settings()
    # A single variable belongs in the OGC Coverages path. `parameter_vars`
    # is the pseudo-variable route for requests selecting variables via query/form data.
    endpoint = (
        f"{cfg.harmony_base_url}/{quote(collection, safe='')}/ogc-api-coverages/1.0.0/"
        f"collections/{quote(variable_path, safe='')}/coverage/rangeset"
    )
    params = [
        ("granuleId", granule_id), ("format", "image/tiff"),
        ("forceAsync", "true"), ("ignoreErrors", "false"),
    ]
    method = "POST" if spatial_mode == "shape" else "GET"
    if spatial_mode == "shape":
        files = {"shape": ("study-area.geojson", json.dumps(geojson), "application/geo+json")}
    elif spatial_mode == "bbox":
        bounds = shape(geojson["geometry"]).bounds
        min_lon, min_lat, max_lon, max_lat = bounds
        params.extend((("subset", f"lat({min_lat}:{max_lat})"), ("subset", f"lon({min_lon}:{max_lon})")))
    else:
        raise ValueError(f"Unsupported Harmony spatial subset mode: {spatial_mode}")
    if record_path is not None and record_path.exists():
        previous = json.loads(record_path.read_text())
        if previous.get("jobId"):
            previous["studyId"] = previous.get("studyId") or study_id_for_feature(geojson)
            previous["observation"] = previous.get("observation") or _observation_summary(observation_metadata or {})
            _write_job_record(record_path, previous)
            return str(previous["jobId"]), None, None
        if previous.get("state") == "reconciled_not_found" and allow_reconciled_retry:
            record_path.with_suffix(".previous.json").write_text(json.dumps(previous, indent=2))
        elif previous.get("state") in {"submitting", "submission_unknown", "submission_failed", "reconciled_not_found"}:
            raise HarmonySubmissionUnknownError(
                f"A prior Harmony submission for this request is recorded as {previous.get('state')}; "
                f"it was not resubmitted. Reconcile record {record_path}."
            )
    record = {
        "state": "submitting", "collectionId": collection, "granuleId": granule_id,
        "variablePath": variable_path, "spatialMode": spatial_mode, "method": method,
        "endpoint": endpoint, "parameters": params, "studyId": study_id_for_feature(geojson),
        "observation": _observation_summary(observation_metadata or {}),
        "startedAt": datetime.now(timezone.utc).isoformat(),
    }
    if record_path is not None and record_path.with_suffix(".previous.json").exists():
        record["previousAttemptRecord"] = record_path.with_suffix(".previous.json").name
    if record_path is not None:
        _write_job_record(record_path, record)
    started = asyncio.get_running_loop().time()
    timeout = httpx.Timeout(
        connect=cfg.harmony_submission_connect_timeout_seconds,
        read=cfg.harmony_submission_read_timeout_seconds,
        write=cfg.harmony_submission_read_timeout_seconds,
        pool=cfg.harmony_submission_connect_timeout_seconds,
    )
    try:
        request_kwargs = {"params": params, "timeout": timeout, "follow_redirects": False, **auth_kwargs(endpoint)}
        if spatial_mode == "shape":
            response = await client.post(endpoint, files=files, **request_kwargs)
        else:
            response = await client.get(endpoint, **request_kwargs)
    except (httpx.TimeoutException, httpx.TransportError) as exc:
        record.update({"state": "submission_unknown", "durationSeconds": round(asyncio.get_running_loop().time() - started, 3),
                       "errorType": type(exc).__name__, "error": str(exc)[:500],
                       "retryAllowed": False, "updatedAt": datetime.now(timezone.utc).isoformat()})
        if record_path is not None:
            _write_job_record(record_path, record)
        log.error("Harmony submission outcome is unknown after %.3fs (error=%s); request will not be resubmitted automatically", record["durationSeconds"], type(exc).__name__)
        raise HarmonySubmissionUnknownError(
            "Harmony submission timed out or lost its connection before returning a job ID. "
            f"The request may have been accepted; it was not resubmitted. Reconcile record {record_path or '(not persisted)'}."
        ) from exc
    duration = round(asyncio.get_running_loop().time() - started, 3)
    safe_response = _safe_response_summary(response)
    location = response.headers.get("Location") or response.headers.get("Content-Location")
    body = {}
    if response.content and not response.headers.get("content-type", "").lower().startswith(("image/tiff", "image/geotiff", "application/octet-stream")):
        try:
            body = response.json()
        except ValueError:
            body = {}
    job_id = body.get("jobID") or body.get("jobId")
    if not job_id and location:
        match = re.search(r"/jobs/([^/?]+)", urlsplit(urljoin(str(response.request.url), location)).path)
        job_id = match.group(1) if match else None
    record.update({"httpStatus": response.status_code, "durationSeconds": duration,
                   "response": safe_response, "updatedAt": datetime.now(timezone.utc).isoformat()})
    if job_id:
        record.update({"state": "submitted", "jobId": str(job_id), "retryAllowed": False})
        if record_path is not None:
            _write_job_record(record_path, record)
        log.info("Harmony job submitted: job_id=%s status=%s duration_seconds=%.3f", job_id, response.status_code, duration)
        return str(job_id), None, None
    if response.status_code != 202 and (response.headers.get("content-type", "").lower().startswith(("image/tiff", "image/geotiff", "application/octet-stream")) or response.content[:4] in (b"II*\x00", b"MM\x00*")):
        record["state"] = "completed_inline"
        if record_path is not None:
            _write_job_record(record_path, record)
        return None, {"bytes": response.content, "url": str(response.url)}, None
    if response.status_code >= 400:
        record.update({"state": "submission_failed", "retryAllowed": False})
        if record_path is not None:
            _write_job_record(record_path, record)
        message = safe_response.get("body", {}).get("message") or safe_response.get("bodyExcerpt") or f"Harmony returned HTTP {response.status_code}."
        raise HarmonySubmissionError(f"Harmony rejected the extraction request: HTTP {response.status_code}: {message}")
    record.update({"state": "submission_unknown", "retryAllowed": False})
    if record_path is not None:
        _write_job_record(record_path, record)
    raise HarmonySubmissionUnknownError(
        f"Harmony returned HTTP {response.status_code} without a recognizable job ID; the request was not resubmitted."
    )


async def refresh_job_status(client: httpx.AsyncClient, job_id: str, *, record_path: Path | None = None, retrieve_assets: bool = False) -> dict:
    """Poll one persisted Harmony job; never submits or retries a job."""
    cfg = get_settings()
    url = f"{cfg.harmony_base_url}/jobs/{quote(job_id, safe='')}"
    response = await _get_with_retry(client, url, timeout=cfg.discovery_timeout_seconds, **auth_kwargs(url))
    job = response.json()
    status = str(job.get("status", "unknown")).lower()
    errors = _job_error_details(job)
    now = datetime.now(timezone.utc).isoformat()
    previous = json.loads(record_path.read_text()) if record_path is not None and record_path.exists() else {}
    previous_status = str(previous.get("jobStatus", {}).get("status") or previous.get("state") or "submitted").lower()
    summary = {key: (_sanitize_text(job[key]) if key == "message" else job[key]) for key in ("status", "progress", "message", "createdAt", "updatedAt", "dataExpiration") if key in job}
    if errors:
        summary["errors"] = errors
    current = {**previous, "state": status, "jobId": job.get("jobID", job_id), "jobStatus": summary, "updatedAt": now}
    if status in JOB_SUCCESS_STATES:
        current["completedAt"] = job.get("updatedAt") or now
    if record_path is not None:
        try:
            _write_job_record(record_path, current)
            persistence = "success"
        except OSError as exc:
            persistence = "failed"
            log.error("Harmony job persistence failed %s", json.dumps({"job_id": job_id, "status": status, "reason": _sanitize_text(exc)}))
            raise
    else:
        persistence = "not_configured"
    event = {"job_id": job_id, "http_status": response.status_code, "status": status,
             "progress": job.get("progress"), "transition": f"{previous_status}->{status}",
             "errors": errors, "persistence": persistence}
    log.info("Harmony job status %s", json.dumps(event, sort_keys=True))
    if status in JOB_SUCCESS_STATES and retrieve_assets and current.get("resultRetrievalVersion") != 2:
        try:
            assets = await _stac_assets(client, job_id, job_response=job)
            current["stacAssets"] = [{"scheme": urlsplit(asset["href"]).scheme, "host": urlsplit(asset["href"]).hostname, "path": urlsplit(asset["href"]).path,
                                       "title": asset.get("title"), "mediaType": asset.get("mediaType")} for asset in assets]
            current["resultRetrievalChecked"] = True
            current["resultRetrievalVersion"] = 2
            if record_path is not None:
                _write_job_record(record_path, current)
            log.info("Harmony results %s", json.dumps({"job_id": job_id, "output_asset_count": len(assets),
                                                        "asset_schemes": sorted({urlsplit(asset["href"]).scheme for asset in assets}),
                                                        "result_retrieval": "success" if assets else "empty",
                                                        "persistence": "success" if record_path is not None else persistence}, sort_keys=True))
        except Exception as exc:
            current["resultRetrievalError"] = _sanitize_text(exc)
            if record_path is not None:
                _write_job_record(record_path, current)
            log.error("Harmony results %s", json.dumps({"job_id": job_id, "result_retrieval": "failed",
                                                         "failure_reason": _sanitize_text(exc), "persistence": "success" if record_path is not None else persistence}, sort_keys=True))
    if status in JOB_FAILURE_STATES or status == "paused":
        reason = summary.get("message") or (errors[0].get("message") if errors else "No error detail supplied.")
        log.error("Harmony job terminal failure %s", json.dumps({"job_id": job_id, "status": status, "failure_reason": _sanitize_text(reason)}))
    return job


async def _wait_job(client: httpx.AsyncClient, job_id: str, *, record_path: Path | None = None) -> dict:
    cfg = get_settings()
    deadline = asyncio.get_running_loop().time() + cfg.processing_timeout_seconds
    delay = 1.0
    while asyncio.get_running_loop().time() < deadline:
        try:
            job = await refresh_job_status(client, job_id, record_path=record_path)
        except Exception as exc:
            if record_path is not None and record_path.exists():
                current = json.loads(record_path.read_text())
                current.update({"state": "polling_failed", "pollingErrorType": type(exc).__name__,
                                "pollingError": _sanitize_text(exc), "updatedAt": datetime.now(timezone.utc).isoformat()})
                _write_job_record(record_path, current)
            raise HarmonyProcessingError(f"Harmony accepted job {job_id}, but status polling failed: {_sanitize_text(exc)}") from exc
        status = str(job.get("status", "")).lower()
        if status in JOB_SUCCESS_STATES:
            return job
        if status in JOB_FAILURE_STATES or status == "paused":
            reason = job.get("message") or _job_error_details(job)
            raise HarmonyProcessingError(f"Harmony job {job_id} ended with status {status}: {_sanitize_text(reason)}")
        await asyncio.sleep(delay)
        delay = min(delay * 1.7, 15.0)
    if record_path is not None:
        current = json.loads(record_path.read_text())
        current.update({"state": "processing_timeout", "updatedAt": datetime.now(timezone.utc).isoformat()})
        _write_job_record(record_path, current)
        log.error("Harmony job processing timeout %s", json.dumps({"job_id": job_id, "status": current.get("jobStatus", {}).get("status"), "persistence": "success"}))
    raise HarmonyProcessingError(f"Harmony job {job_id} exceeded the processing timeout.")


async def _stac_assets(client: httpx.AsyncClient, job_id: str, *, job_response: dict | None = None) -> list[dict]:
    cfg = get_settings()
    catalog_url = f"{cfg.harmony_base_url}/stac/{quote(job_id, safe='')}"
    response = await _get_with_retry(client, catalog_url, **auth_kwargs(catalog_url))
    catalog = response.json()
    links = [link.get("href") for link in catalog.get("links", []) if link.get("rel") == "item" and link.get("href")]
    catalog_base = str(response.url).rstrip("/") + "/"
    item_urls = [urljoin(catalog_base, link) for link in links]
    items = []
    if catalog.get("type") == "Feature":
        items.append((catalog, str(response.url)))
    for url in item_urls:
        item_response = await _get_with_retry(client, url, **auth_kwargs(url))
        items.append((item_response.json(), str(item_response.url)))
    assets = []
    data_links = [link for link in (job_response or {}).get("links", []) if link.get("rel") == "data" and link.get("href")]
    for item, item_base in items:
        for asset in item.get("assets", {}).values():
            href = asset.get("href")
            if href:
                resolved_href = urljoin(item_base, href)
                parsed_href = urlsplit(resolved_href)
                if parsed_href.scheme == "s3" and data_links:
                    title = asset.get("title")
                    basename = Path(parsed_href.path).name
                    matching_links = [link for link in data_links if
                                      (title and link.get("title") == title) or
                                      (basename and Path(urlsplit(urljoin(catalog_base, link["href"])).path).name == basename)]
                    if len(matching_links) == 1:
                        resolved_href = urljoin(catalog_base, matching_links[0]["href"])
                assets.append({"href": resolved_href, "title": asset.get("title"), "mediaType": asset.get("type")})
    if not assets:
        assets = [{"href": urljoin(catalog_base, link["href"]), "title": link.get("title"), "mediaType": link.get("type")} for link in catalog.get("links", []) if link.get("rel") in {"enclosure", "data"} and link.get("href")]
    return assets


async def _download(client: httpx.AsyncClient, url: str, target: Path) -> Path:
    cfg = get_settings()
    partial = target.with_suffix(target.suffix + ".part")
    for attempt in range(4):
        offset = partial.stat().st_size if partial.exists() else 0
        options = auth_kwargs(url)
        headers = dict(options.pop("headers", {}))
        if offset:
            headers["Range"] = f"bytes={offset}-"
        try:
            async with client.stream("GET", url, timeout=cfg.download_timeout_seconds, follow_redirects=True,
                                     headers=headers, **options) as response:
                if response.status_code not in (200, 206):
                    response.raise_for_status()
                    raise RuntimeError(f"Unexpected download status {response.status_code}.")
                append = offset > 0 and response.status_code == 206
                if offset and response.status_code == 200:
                    offset = 0
                expected = response.headers.get("Content-Length")
                expected_total = (int(expected) + offset if response.status_code == 206 else int(expected)) if expected else None
                with partial.open("ab" if append else "wb") as stream:
                    async for chunk in response.aiter_bytes():
                        stream.write(chunk)
                if expected_total is not None and partial.stat().st_size != expected_total:
                    raise IOError(f"Incomplete Harmony download: expected {expected_total} bytes, found {partial.stat().st_size}.")
                return partial
        except (httpx.HTTPError, OSError) as exc:
            if attempt == 3:
                raise RuntimeError(f"Harmony download failed after 4 attempts: {exc}") from exc
            await asyncio.sleep(2**attempt)
    raise RuntimeError("Harmony download failed after 4 attempts.")


def _validate_raster(path: Path) -> dict:
    with rasterio.open(path) as dataset:
        if dataset.driver != "GTiff" or dataset.count < 1 or dataset.width < 1 or dataset.height < 1:
            raise ValueError("Harmony output is not a valid GeoTIFF raster.")
        return {"crs": dataset.crs.to_string() if dataset.crs else None,
                "transform": list(dataset.transform)[:6], "width": dataset.width,
                "height": dataset.height, "resolution": list(dataset.res), "nodata": dataset.nodata,
                "bounds": [dataset.bounds.left, dataset.bounds.bottom, dataset.bounds.right, dataset.bounds.top],
                "dtype": dataset.dtypes[0]}


def _clip_raster_to_polygon(source: Path, feature: dict, destination: Path) -> None:
    """Mask bbox-extracted cells outside the input WGS84 polygon without changing inside values."""
    with rasterio.open(source) as dataset:
        if dataset.crs is None:
            raise ValueError("Harmony GeoTIFF has no CRS; cannot clip it to the study polygon.")
        projected_geometry = transform_geom("EPSG:4326", dataset.crs, feature["geometry"])
        clipped, transform = raster_mask(dataset, [projected_geometry], crop=True, filled=False)
        profile = dataset.profile.copy()
        profile.update(width=clipped.shape[2], height=clipped.shape[1], transform=transform)
        tags = dataset.tags()
        band_tags = [dataset.tags(index) for index in range(1, dataset.count + 1)]
        nodata = dataset.nodata
    fill_value = nodata if nodata is not None else 0
    valid_mask = ~np.ma.getmaskarray(clipped).any(axis=0)
    with rasterio.open(destination, "w", **profile) as output:
        output.write(np.ma.filled(clipped, fill_value).astype(output.dtypes[0], copy=False))
        output.write_mask(valid_mask.astype("uint8") * 255)
        output.update_tags(**tags)
        for index, values in enumerate(band_tags, start=1):
            output.update_tags(index, **values)


async def extract_granule(granule_id: str, feature: dict, variables: list[str], frequency: str = "frequencyA", acquisition_metadata: dict | None = None) -> dict:
    cfg = get_settings()
    capability_report = await inspect_capabilities()
    if not capability_report["variableSubset"]:
        raise RuntimeError(capability_report["message"])
    area_dir = cfg.resolved_data_dir / "granules" / re.sub(r"[^A-Za-z0-9_.-]", "_", granule_id)
    area_dir.mkdir(parents=True, exist_ok=True)
    raw_geojson = json.dumps(feature, sort_keys=True).encode()
    study_hash = study_id_for_feature(feature)
    study_dir = cfg.resolved_data_dir / "study_areas"
    study_dir.mkdir(parents=True, exist_ok=True)
    (study_dir / f"{study_hash}.geojson").write_bytes(raw_geojson)
    results = []
    spatial_mode = capability_report["spatialSubsetMode"]
    timeout = httpx.Timeout(cfg.download_timeout_seconds, connect=30)
    async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as client:
        for variable in variables:
            if variable not in MEASUREMENTS + AUXILIARY:
                results.append({"variable": variable, "status": "rejected", "error": "Unknown GCOV variable."})
                continue
            var_dir = "measurements" if variable in MEASUREMENTS else "auxiliary"
            out_dir = area_dir / var_dir
            out_dir.mkdir(parents=True, exist_ok=True)
            target = out_dir / f"{variable}.tif"
            if target.exists():
                try:
                    raster_meta = _validate_raster(target)
                    results.append({"variable": variable, "status": "already_present", "path": str(target), "raster": raster_meta})
                    continue
                except Exception:
                    target.unlink(missing_ok=True)
            path = _candidate_paths(variable, frequency)[0]
            submission_key = _submission_key(cfg.nisar_gcov_collection, granule_id, path, feature)
            record_path = _job_record_path(submission_key)
            try:
                job_id, immediate, error = await _submit_variable(
                    client, cfg.nisar_gcov_collection, granule_id, path, feature, spatial_mode,
                    record_path=record_path, observation_metadata=acquisition_metadata,
                )
                if error:
                    results.append({"variable": variable, "variablePath": path, "status": "missing_or_rejected", "error": error})
                    continue
                if immediate:
                    content = immediate["bytes"]
                    source_job = None
                else:
                    job = await _wait_job(client, job_id or "", record_path=record_path)
                    assets = await _stac_assets(client, job_id or "", job_response=job)
                    record = json.loads(record_path.read_text())
                    record.update({
                        "state": "completed",
                        "completedAt": job.get("updatedAt") or datetime.now(timezone.utc).isoformat(),
                        "resultRetrievalChecked": True,
                        "resultRetrievalVersion": 2,
                        "jobStatus": {key: job[key] for key in ("status", "progress", "message", "createdAt", "updatedAt", "dataExpiration") if key in job},
                        "stacAssets": [{"scheme": urlsplit(asset["href"]).scheme, "host": urlsplit(asset["href"]).hostname, "path": urlsplit(asset["href"]).path,
                                        "title": asset.get("title"), "mediaType": asset.get("mediaType")} for asset in assets],
                        "updatedAt": datetime.now(timezone.utc).isoformat(),
                    })
                    _write_job_record(record_path, record)
                    log.info("Harmony results %s", json.dumps({"job_id": job_id, "output_asset_count": len(assets),
                                                                "geotiff_asset_count": sum("tiff" in str(asset.get("mediaType", "")).lower() for asset in assets),
                                                                "asset_schemes": sorted({urlsplit(asset["href"]).scheme for asset in assets}),
                                                                "result_retrieval": "success" if assets else "empty", "persistence": "success"}, sort_keys=True))
                    geotiffs = [asset for asset in assets if "tiff" in str(asset.get("mediaType", "")).lower() or str(asset.get("href", "")).lower().endswith((".tif", ".tiff"))]
                    if not geotiffs:
                        results.append({"variable": variable, "variablePath": path, "status": "missing", "jobId": job_id, "error": "Job completed without a GeoTIFF output for this variable."})
                        continue
                    temporary = await _download(client, geotiffs[0]["href"], target)
                    record = json.loads(record_path.read_text())
                    record.update({"resultDownloadOutcome": "success", "downloadedBytes": temporary.stat().st_size,
                                   "updatedAt": datetime.now(timezone.utc).isoformat()})
                    _write_job_record(record_path, record)
                    log.info("Harmony output download %s", json.dumps({"job_id": job_id, "variable": variable,
                                                                         "outcome": "success", "bytes": temporary.stat().st_size,
                                                                         "persistence": "success"}, sort_keys=True))
                    content = None
                    source_job = job_id
                if content is not None and content[:4] not in (b"II*\x00", b"MM\x00*"):
                    results.append({"variable": variable, "variablePath": path, "status": "failed", "error": "Downloaded response is not a TIFF; output was discarded."})
                    continue
                if content is not None:
                    temporary = target.with_suffix(f".{uuid4().hex}.part")
                    temporary.write_bytes(content)
                if spatial_mode == "bbox":
                    clipped_path = target.with_suffix(f".{uuid4().hex}.clip.tif")
                    try:
                        _clip_raster_to_polygon(temporary, feature, clipped_path)
                        temporary.unlink(missing_ok=True)
                        temporary = clipped_path
                    except Exception:
                        clipped_path.unlink(missing_ok=True)
                        temporary.unlink(missing_ok=True)
                        raise
                try:
                    raster_meta = _validate_raster(temporary)
                    temporary.replace(target)
                except Exception:
                    temporary.unlink(missing_ok=True)
                    raise
                results.append({"variable": variable, "variablePath": path, "status": "downloaded", "jobId": source_job, "path": str(target), "url": f"/api/data/{target.relative_to(cfg.resolved_data_dir).as_posix()}", "bytes": target.stat().st_size, "spatialSubsetMode": spatial_mode, "polygonClipAppliedLocally": spatial_mode == "bbox", "raster": raster_meta})
            except Exception as exc:
                stage = "submission" if isinstance(exc, (HarmonySubmissionError, HarmonySubmissionUnknownError)) else "processing"
                if record_path.exists():
                    record = json.loads(record_path.read_text())
                    record.update({"resultDownloadOutcome": "failed", "resultDownloadError": _sanitize_text(exc),
                                   "updatedAt": datetime.now(timezone.utc).isoformat()})
                    _write_job_record(record_path, record)
                log.error("Harmony extraction failure %s", json.dumps({"stage": stage, "granule_id": granule_id,
                                                                        "variable": variable, "job_id": json.loads(record_path.read_text()).get("jobId") if record_path.exists() else None,
                                                                        "failure_reason": _sanitize_text(exc), "result_download_outcome": "failed"}))
                results.append({"variable": variable, "variablePath": path, "status": "failed", "failureStage": stage,
                                "jobId": json.loads(record_path.read_text()).get("jobId") if record_path.exists() else None,
                                "submissionRecord": str(record_path), "error": _sanitize_text(exc)})
    manifest = {"granuleId": granule_id, "collectionId": cfg.nisar_gcov_collection, "studyArea": f"study_areas/{study_hash}.geojson", "crs": "EPSG:4326", "processedAt": datetime.now(timezone.utc).isoformat(), "capabilities": capability_report, "variables": results}
    (area_dir / "metadata.json").write_text(json.dumps(manifest, indent=2))
    acquisition_record = {"granuleId": granule_id, "collectionId": cfg.nisar_gcov_collection, **(acquisition_metadata or {})}
    (area_dir / "acquisition_metadata.json").write_text(json.dumps(acquisition_record, indent=2))
    log.info("Harmony extraction manifest persisted %s", json.dumps({"granule_id": granule_id, "study_id": study_hash,
                                                                      "path": str(area_dir / "metadata.json"),
                                                                      "variable_count": len(results), "persistence": "success"}))
    return manifest
