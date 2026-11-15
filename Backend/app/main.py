import asyncio
import logging
import json
import re
from contextlib import asynccontextmanager
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit, urlunsplit

import rasterio
import numpy as np
import httpx
from rasterio.enums import Resampling
from rasterio.io import MemoryFile
from rasterio.warp import transform as transform_coordinates, transform_bounds
from shapely.geometry import shape
from fastapi import FastAPI, Header, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles
from .stories import router as stories_router, ROOT as STORIES_ROOT
from pydantic import BaseModel, Field

from .cmr import CMRRequestError, search_granules
from .geometry import PolygonInputError, study_id_for_feature, validate_geojson
from .harmony import (AUXILIARY, MEASUREMENTS, HarmonyConfigurationError, extract_granule,
    inspect_capabilities, json_safe, refresh_job_status, _sanitize_text, _write_job_record)
from .raster_registry import persist_processed_raster, query_registry
from .raster_exports import (RasterExportError, create_change_export, create_timeline_export,
                             safe_token, _export_study_info)
from .raster_display import (PALETTE_ANCHORS, colorize_values, log_normalization_scale,
                             palette_legend)
from .settings import get_settings
from .retrieval_sessions import (create_session as create_retrieval_session,
    now as retrieval_now, read_session as read_retrieval_session,
    session_path as retrieval_session_path, write_session as write_retrieval_session)
from .visualization_sessions import (VisualizationSessionError, cleanup_expired_sessions,
                                    _atomic_json, create_session, delete_session,
                                    generate_comparison, generate_rgb, product_path,
                                    read_session_catalog, require_session)

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
logging.getLogger("httpx").setLevel(logging.WARNING)
log = logging.getLogger(__name__)
settings = get_settings()
_timeline_export_tasks: dict[str, asyncio.Task] = {}


def _cmr_http_error(error: CMRRequestError) -> HTTPException:
    upstream_status = error.status_code
    if upstream_status is None:
        status_code = 503
    elif upstream_status == 400:
        status_code = 400
    elif upstream_status in (401, 403):
        status_code = upstream_status
    elif upstream_status == 429:
        status_code = 429
    elif upstream_status >= 500:
        status_code = 502
    else:
        status_code = 502
    return HTTPException(status_code=status_code, detail=str(error))

@asynccontextmanager
async def lifespan(_app: FastAPI):
    root = settings.resolved_visualization_temp_dir
    cleanup_expired_sessions(root, settings.visualization_session_ttl_seconds)

    async def reap():
        while True:
            await asyncio.sleep(60)
            cleanup_expired_sessions(root, settings.visualization_session_ttl_seconds)

    reaper = asyncio.create_task(reap())
    try:
        yield
    finally:
        reaper.cancel()
        try:
            await reaper
        except asyncio.CancelledError:
            pass


def frontend_origins(origin: str) -> list[str]:
    origins = {origin.rstrip('/')}
    parsed = urlsplit(origin)
    if parsed.hostname in {'localhost', '127.0.0.1'} and parsed.scheme in {'http', 'https'}:
        port = f':{parsed.port}' if parsed.port else ''
        origins.update(urlunsplit((parsed.scheme, host + port, '', '', ''))
                       for host in ('localhost', '127.0.0.1'))
    return sorted(origins)


app = FastAPI(title="Delta Earth — NISAR Data API", version="0.1.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=frontend_origins(settings.frontend_origin), allow_credentials=True,
                   allow_methods=["GET", "POST", "DELETE"], allow_headers=["*"],
                   expose_headers=["X-Raster-Bounds-WGS84", "X-RGB-Channel-Legend", "X-Raster-Legend", "Content-Disposition"])

app.include_router(stories_router)
app.mount("/case-studies", StaticFiles(directory=STORIES_ROOT / "case-studies"), name="story-assets")


class ExtractRequest(BaseModel):
    granuleId: str = Field(min_length=3, max_length=300)
    studyArea: dict[str, Any]
    variables: list[str] = Field(min_length=1, max_length=8)
    frequency: str = "frequencyA"
    acquisitionMetadata: dict[str, Any] = Field(default_factory=dict)


class VisualizationSessionRequest(BaseModel):
    studyId: str = Field(pattern=r"^[a-f0-9]{16}$")
    retrievalSessionId: str | None = Field(default=None, pattern=r"^[a-f0-9]{32}$")


class BatchExtractionRequest(BaseModel):
    studyId: str = Field(pattern=r"^[a-f0-9]{16}$")
    studyArea: dict[str, Any]
    startDate: date | None = None
    endDate: date | None = None
    combinations: list[dict[str, Any]] = Field(min_length=1, max_length=1000)


class RasterReferenceRequest(BaseModel):
    observationId: str = Field(min_length=3, max_length=300)
    sourceVariable: str = Field(min_length=2, max_length=100)
    frequency: str = Field(pattern=r"^frequency[AB]$")


class ChangeExportRequest(BaseModel):
    left: RasterReferenceRequest
    right: RasterReferenceRequest


class TimelineExportRequest(BaseModel):
    frames: list[RasterReferenceRequest] = Field(min_length=2, max_length=100)
    settings: dict[str, Any]


@app.get("/api/health")
async def health():
    return {"status": "ok", "service": "delta-earth", "collectionId": settings.nisar_gcov_collection}


@app.get("/api/nisar/capabilities")
async def capabilities():
    try:
        return await inspect_capabilities()
    except HarmonyConfigurationError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:
        log.exception("Unable to load Harmony capabilities")
        raise HTTPException(status_code=502, detail=f"Harmony capabilities could not be loaded: {exc}") from exc


@app.post("/api/study-areas/analyze")
async def analyze_study_area(feature: dict[str, Any], start_date: date | None = Query(default=None), end_date: date | None = Query(default=None)):
    try:
        polygon, area_km2, bounds, centroid = validate_geojson(feature)
    except PolygonInputError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    if start_date and end_date and start_date > end_date:
        raise HTTPException(status_code=422, detail="Start date must be on or before end date.")
    try:
        results = await search_granules(polygon, start_date, end_date)
    except CMRRequestError as exc:
        raise _cmr_http_error(exc) from exc
    except Exception as exc:
        log.exception("CMR discovery failed")
        raise HTTPException(status_code=502, detail=f"NISAR catalog search failed: {exc}") from exc
    return {"studyId": study_id_for_feature(feature),
            "area": {"areaKm2": round(area_km2, 3), "centroid": centroid, "bbox": bounds}, **results}


@app.post("/api/nisar/scenes/search")
async def search_scenes(payload: dict[str, Any]):
    feature = payload.get("studyArea") or payload.get("feature") or payload
    try:
        polygon, area_km2, bounds, centroid = validate_geojson(feature)
        start = date.fromisoformat(payload["startDate"]) if payload.get("startDate") else None
        end = date.fromisoformat(payload["endDate"]) if payload.get("endDate") else None
        if start and end and start > end:
            raise PolygonInputError("Start date must be on or before end date.")
    except (PolygonInputError, ValueError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    try:
        results = await search_granules(polygon, start, end, int(payload.get("pageSize", 100)), all_pages=True)
    except CMRRequestError as exc:
        raise _cmr_http_error(exc) from exc
    except Exception as exc:
        log.exception("CMR discovery failed")
        raise HTTPException(status_code=502, detail=f"NISAR catalog search failed: {exc}") from exc
    return {"studyId": study_id_for_feature(feature), "area": {"areaKm2": round(area_km2, 3), "centroid": centroid, "bbox": bounds}, **results}


def _job_matches_study(record: dict, study_id: str, bounds: tuple[float, float, float, float]) -> bool:
    if record.get("studyId") == study_id:
        return True
    subsets = {axis: None for axis in ("lat", "lon")}
    for key, value in record.get("parameters", []):
        if key == "subset":
            match = re.fullmatch(r"(lat|lon)\(([-+0-9.eE]+):([-+0-9.eE]+)\)", value)
            if match:
                subsets[match.group(1)] = (float(match.group(2)), float(match.group(3)))
    min_lon, min_lat, max_lon, max_lat = bounds
    expected = {"lon": (min_lon, max_lon), "lat": (min_lat, max_lat)}
    return all(subsets[axis] is not None and all(abs(a - b) < 1e-8 for a, b in zip(subsets[axis], expected[axis])) for axis in expected)


@app.get("/api/studies/{study_id}/processed-observations")
async def processed_observations(study_id: str):
    if not re.fullmatch(r"[a-f0-9]{16}", study_id):
        raise HTTPException(status_code=400, detail="Study identifier must be the stable geometry ID returned by analysis.")
    study_path = settings.resolved_data_dir / "study_areas" / f"{study_id}.geojson"
    if not study_path.is_file():
        return {"studyId": study_id, "observations": []}
    feature = json.loads(study_path.read_text())
    bounds = shape(feature["geometry"]).bounds
    jobs_dir = settings.resolved_data_dir / "harmony_jobs"
    matching: list[tuple[Path, dict]] = []
    for record_path in jobs_dir.glob("*.json") if jobs_dir.exists() else []:
        if record_path.name.endswith(".previous.json"):
            continue
        try:
            record = json.loads(record_path.read_text())
        except (OSError, ValueError):
            continue
        if _job_matches_study(record, study_id, bounds):
            if record.get("studyId") != study_id:
                record["studyId"] = study_id
                _write_job_record(record_path, record)
            matching.append((record_path, record))

    grouped: dict[str, dict] = {}
    timeout = httpx.Timeout(settings.discovery_timeout_seconds)
    async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as client:
        for record_path, record in matching:
            job_id = record.get("jobId")
            if not job_id:
                continue
            try:
                old_status = str(record.get("jobStatus", {}).get("status", "")).lower()
                terminal = old_status in {"successful", "complete", "completed", "succeeded", "failed", "canceled", "cancelled"}
                result_checked = record.get("resultRetrievalVersion") == 2 or old_status in {"failed", "canceled", "cancelled"}
                if terminal and result_checked:
                    job = record.get("jobStatus", {})
                else:
                    job = await refresh_job_status(client, job_id, record_path=record_path, retrieve_assets=True)
                    record = json.loads(record_path.read_text())
            except HarmonyConfigurationError:
                raise
            except Exception as exc:
                log.warning("Harmony resume poll failed %s", json.dumps({"job_id": job_id, "reason": _sanitize_text(exc)}))
                job = record.get("jobStatus", {})
            item = grouped.setdefault(record["granuleId"], {
                **record.get("observation", {}), "id": record["granuleId"],
                "provider": record.get("observation", {}).get("provider", "ASF"),
                "title": record.get("observation", {}).get("title", record["granuleId"]),
                "mission": "NISAR", "frequencies": [], "polarizations": [],
                "processingStatus": "processing", "harmonyJobs": [],
            })
            variable = record.get("variablePath", "").rsplit("/", 1)[-1]
            harmony_status = str(job.get("status", "unknown")).lower()
            assets = record.get("stacAssets", [])
            target = settings.resolved_data_dir / "granules" / re.sub(r"[^A-Za-z0-9_.-]", "_", record["granuleId"]) / ("measurements" if variable not in {"numberOfLooks", "mask", "rtcGammaToSigmaFactor"} else "auxiliary") / f"{variable}.tif"
            result = {"variable": variable, "jobId": job_id, "harmonyStatus": harmony_status,
                      "progress": job.get("progress"), "outputAssetCount": len(assets),
                      "resultRetrievalError": record.get("resultRetrievalError")}
            item["harmonyJobs"].append(result)
            if variable and variable not in item["polarizations"]:
                item["polarizations"].append(variable)
            if harmony_status in {"failed", "canceled", "cancelled"} or record.get("state") == "submission_failed":
                item["processingStatus"] = "failed"
                item["processingError"] = (job.get("message") or record.get("pollingError") or "Harmony job failed.")
            elif target.is_file():
                item["processingStatus"] = "downloaded"
            elif harmony_status in {"successful", "complete", "completed", "succeeded"} and not assets:
                item["processingStatus"] = "failed"
                item["processingError"] = "Harmony completed without a retrievable output asset."
            elif harmony_status in {"successful", "complete", "completed", "succeeded"}:
                item["processingStatus"] = "ready"
            elif item["processingStatus"] != "failed":
                item["processingStatus"] = "processing"
    observations = list(grouped.values())
    log.info("Study processed observations %s", json.dumps({"study_id": study_id, "observation_count": len(observations),
                                                             "persisted_job_count": len(matching), "resumed_polling": True}))
    return {"studyId": study_id, "observations": observations}


@app.post("/api/nisar/extractions")
async def extract(request: ExtractRequest):
    try:
        validate_geojson(request.studyArea)
        if request.frequency not in {"frequencyA", "frequencyB"}:
            raise PolygonInputError("Frequency must be frequencyA or frequencyB.")
        result = await extract_granule(request.granuleId, request.studyArea, request.variables, request.frequency, request.acquisitionMetadata)
        return json_safe(result)
    except PolygonInputError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except HarmonyConfigurationError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:
        safe_error = _sanitize_text(exc)
        log.error("Extraction request failed %s", json.dumps({"failure_reason": safe_error}))
        raise HTTPException(status_code=502, detail=f"NISAR extraction failed: {safe_error}") from exc


_retrieval_tasks: dict[str, asyncio.Task] = {}


async def _process_retrieval_batch(session_id: str) -> None:
    data_root = settings.resolved_data_dir
    path = retrieval_session_path(data_root, session_id)
    state = read_retrieval_session(data_root, session_id)
    state.update({"status": "processing", "updatedAt": retrieval_now()})
    write_retrieval_session(path, state)
    for index, item in enumerate(state["combinations"], start=1):
        item.update({"status": "processing", "updatedAt": retrieval_now()})
        state.update({"currentGranuleId": item["granuleId"], "currentVariable": item["variable"],
                      "currentIndex": index, "updatedAt": retrieval_now()})
        write_retrieval_session(path, state)
        try:
            existing = query_registry(data_root, state["studyId"], observation_id=item["granuleId"],
                                      variable=item["variable"], frequency=item["frequency"])
            if existing:
                stored_path = (data_root / existing[0]["rasterPath"]).resolve()
                registry_item = persist_processed_raster(
                    data_root, state["studyId"], item["granuleId"],
                    {**item.get("acquisitionMetadata", {}), "frequency": item["frequency"]},
                    item["variable"], stored_path, state["studyArea"], retrieval_session_id=session_id,
                    frequency=item["frequency"])
                item.update({"status": "completed", "alreadyPresent": True, "jobId": None,
                             "raster": registry_item["raster"], "bytes": registry_item["bytes"]})
            else:
                metadata = {**item.get("acquisitionMetadata", {}), "frequency": item["frequency"],
                            "retrievalSessionId": session_id}
                result = await extract_granule(item["granuleId"], state["studyArea"], [item["variable"]],
                    item["frequency"], metadata)
                layer = next((row for row in result.get("variables", []) if row.get("variable") == item["variable"]), {})
                if layer.get("status") in {"downloaded", "already_present"} and layer.get("registryPersistence") == "success":
                    item.update({"status": "completed", "alreadyPresent": layer.get("status") == "already_present",
                                 "jobId": layer.get("jobId"), "raster": layer.get("raster"), "bytes": layer.get("bytes")})
                else:
                    item.update({"status": "failed", "jobId": layer.get("jobId"),
                                 "error": layer.get("error") or f"Extraction ended with status {layer.get('status', 'unknown')}."})
        except Exception as exc:
            item.update({"status": "failed", "error": _sanitize_text(exc)[:500]})
            log.exception("Retrieval combination failed %s", json.dumps({"retrieval_session_id": session_id,
                "granule_id": item["granuleId"], "variable": item["variable"]}))
        item["updatedAt"] = retrieval_now()
        state["completedCount"] = sum(row["status"] == "completed" for row in state["combinations"])
        state["failedCount"] = sum(row["status"] == "failed" for row in state["combinations"])
        state["updatedAt"] = retrieval_now()
        write_retrieval_session(path, state)
    state.update({"status": "completed" if not state["failedCount"] else
                  "partial" if state["completedCount"] else "failed", "completedAt": retrieval_now(),
                  "currentGranuleId": None, "currentVariable": None, "updatedAt": retrieval_now()})
    write_retrieval_session(path, state)
    _retrieval_tasks.pop(session_id, None)


@app.post("/api/nisar/extractions/batch", status_code=202)
async def start_retrieval_batch(request: BatchExtractionRequest):
    try:
        polygon, _, _, _ = validate_geojson(request.studyArea)
        if study_id_for_feature(request.studyArea) != request.studyId:
            raise PolygonInputError("The studyId does not match the submitted study area.")
        if request.startDate and request.endDate and request.startDate > request.endDate:
            raise PolygonInputError("Start date must be on or before end date.")
        try:
            discovery = await search_granules(polygon, request.startDate, request.endDate, all_pages=True)
        except CMRRequestError as exc:
            raise _cmr_http_error(exc) from exc
        available_granules = {item["id"]: item for item in discovery.get("observations", []) if item.get("id")}
        combinations = []
        seen = set()
        for selected in request.combinations:
            granule_id = str(selected.get("granuleId", ""))
            frequency = selected.get("frequency")
            variable = selected.get("variable")
            if len(granule_id) < 3 or len(granule_id) > 300:
                raise PolygonInputError("A selected granule identifier is invalid.")
            if frequency not in {"frequencyA", "frequencyB"}:
                raise PolygonInputError("Frequency must be frequencyA or frequencyB.")
            if not isinstance(variable, str) or variable not in MEASUREMENTS + AUXILIARY:
                raise PolygonInputError("A selected measurement variable is invalid.")
            source = available_granules.get(granule_id)
            if source is None:
                raise PolygonInputError(f"Selected granule {granule_id} is no longer available for this study and date range.")
            supported = {(value.get("frequency"), value.get("variable"))
                         for value in source.get("availableVariables", [])}
            if not supported:
                source_frequencies = source.get("frequencies", [])
                source_variables = source.get("polarizations", [])
                supported = {(source_frequency, source_variable)
                             for source_frequency in source_frequencies for source_variable in source_variables}
            if (frequency, variable) not in supported:
                raise PolygonInputError(
                    f"{frequency}/{variable} is not listed as available for selected granule {granule_id}.")
            key = (granule_id, frequency, variable)
            if key in seen:
                continue
            seen.add(key)
            combinations.append({"granuleId": granule_id, "frequency": frequency, "variable": variable,
                                 "acquisitionMetadata": selected.get("acquisitionMetadata") or {}})
        if not combinations:
            raise PolygonInputError("Select at least one available granule and measurement combination.")
        session = create_retrieval_session(settings.resolved_data_dir, request.studyId, request.studyArea,
            request.startDate.isoformat() if request.startDate else None,
            request.endDate.isoformat() if request.endDate else None, combinations)
        task = asyncio.create_task(_process_retrieval_batch(session["retrievalSessionId"]))
        _retrieval_tasks[session["retrievalSessionId"]] = task
        return {key: value for key, value in session.items() if key != "studyArea"}
    except PolygonInputError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@app.get("/api/retrieval-sessions/{session_id}")
async def retrieval_session(session_id: str):
    try:
        session = read_retrieval_session(settings.resolved_data_dir, session_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return {key: value for key, value in session.items() if key != "studyArea"}


@app.get("/api/retrieval-sessions/{session_id}/rasters")
async def retrieval_session_rasters(session_id: str):
    try:
        session = read_retrieval_session(settings.resolved_data_dir, session_id)
        entries = query_registry(settings.resolved_data_dir, session["studyId"], retrieval_session_id=session_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    results = [{key: value for key, value in entry.items() if key != "rasterPath"} | {
        "sourceVariable": entry["variable"],
        "variable": f"{entry.get('frequency', 'frequencyA')}:{entry['variable']}",
        "rasterUrl": f"/api/visualization/{session['studyId']}/raster/{entry['observationId']}/{entry['variable']}?frequency={entry.get('frequency', 'frequencyA')}"}
        for entry in entries]
    return {"retrievalSessionId": session_id, "studyId": session["studyId"], "rasters": results}


def _local_processed_observations(study_id: str) -> dict[str, Any]:
    try:
        entries = query_registry(settings.resolved_data_dir, study_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    grouped: dict[str, dict[str, Any]] = {}
    for entry in entries:
        obs_id = entry["observationId"]
        metadata = entry.get("acquisitionMetadata") or {}
        item = grouped.setdefault(obs_id, {
            **metadata, "id": obs_id, "observationId": obs_id, "granuleId": obs_id,
            "acquiredAt": entry.get("acquisitionDate") or metadata.get("acquiredAt") or metadata.get("startAt"),
            "acquisitionDate": entry.get("acquisitionDate"), "processingStatus": "processed",
            "variables": [], "polarizations": [],
        })
        variable = entry["variable"]
        frequency = entry.get("frequency", "frequencyA")
        variable_key = f"{frequency}:{variable}"
        raster_url = f"/api/visualization/{study_id}/raster/{obs_id}/{variable}?frequency={frequency}"
        variable_data = {"name": variable_key, "sourceVariable": variable, "frequency": frequency,
                         "available": True, "rasterAvailable": True,
                         "visualizationAvailable": entry["raster"].get("validPixelCount", 0) > 0,
                         "rasterUrl": raster_url,
                         "raster": entry["raster"], "processingTimestamp": entry.get("processingTimestamp"),
                         "bytes": entry.get("bytes")}
        item["variables"].append(variable_data)
        if variable_key not in item["polarizations"]:
            item["polarizations"].append(variable_key)
    observations = []
    for item in grouped.values():
        item["variables"].sort(key=lambda variable: variable["name"])
        selected = item["variables"][0]
        item["raster"] = {**selected["raster"], "measurement": selected["name"], "url": selected["rasterUrl"]}
        observations.append(item)
    observations.sort(key=lambda item: (item.get("acquiredAt") or "", item["id"]))
    return json_safe({"studyId": study_id, "observations": observations})


@app.get("/api/study-areas/{study_id}/processed-observations")
async def locally_processed_observations(study_id: str):
    """Return only manifest-registered local rasters; this route never contacts Harmony."""
    return _local_processed_observations(study_id)


def _registered_raster(study_id: str, observation_id: str, variable: str,
                       frequency: str = "frequencyA") -> tuple[Path, dict[str, Any]]:
    try:
        entries = query_registry(settings.resolved_data_dir, study_id,
                                 observation_id=observation_id, variable=variable, frequency=frequency)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if not entries:
        raise HTTPException(status_code=404, detail="No successfully persisted raster matches this study, observation, and variable.")
    path = (settings.resolved_data_dir / entries[0]["rasterPath"]).resolve()
    if not path.is_relative_to(settings.resolved_data_dir.resolve()) or not path.is_file():
        raise HTTPException(status_code=404, detail="The registered raster is no longer available locally.")
    return path, entries[0]


async def _stream_local_file(path: Path, chunk_size: int = 1024 * 1024):
    with path.open("rb") as stream:
        while chunk := stream.read(chunk_size):
            yield chunk


def _visualization_http_error(error: VisualizationSessionError) -> HTTPException:
    return HTTPException(status_code=error.status_code, detail=str(error))


@app.post("/api/visualization/sessions")
async def visualization_session_create(request: VisualizationSessionRequest):
    try:
        session = create_session(settings.resolved_visualization_temp_dir, request.studyId,
                                 settings.visualization_session_ttl_seconds,
                                 settings.visualization_max_sessions)
        entries = query_registry(settings.resolved_data_dir, request.studyId,
            retrieval_session_id=request.retrievalSessionId) if request.retrievalSessionId else []
        observations: dict[str, dict[str, Any]] = {}
        rasters = []
        for entry in entries:
            metadata = entry.get("acquisitionMetadata") or {}
            observation_id = entry["observationId"]
            observation = observations.setdefault(observation_id, {
                "observationId": observation_id, "granuleId": observation_id,
                "acquisitionDate": entry.get("acquisitionDate"),
                "title": metadata.get("title", observation_id), "provider": metadata.get("provider", "NASA ASF DAAC"),
                "productType": metadata.get("productType", "GCOV"), "frequencies": [],
                "variables": [], "polarizations": [], "channels": [], "processingStatus": "processed"})
            variable = entry["variable"]
            frequency = metadata.get("frequency") or "frequencyA"
            variable_key = f"{frequency}:{variable}"
            observation["variables"].append(variable_key)
            observation["polarizations"].append(variable)
            label = {"HHHH": "HH", "HVHV": "HV", "VHVV": "VH", "VHVH": "VH", "VVVV": "VV"}.get(variable, variable)
            observation["channels"].append(f"{frequency.removeprefix('frequency')} · {label}")
            observation["frequencies"].append(frequency)
            rasters.append({**entry, "variable": variable_key, "sourceVariable": variable,
                            "frequency": frequency, "temporary": False})
        for observation in observations.values():
            for key in ("variables", "polarizations", "channels", "frequencies"):
                observation[key] = sorted(set(observation[key]))
        dates: dict[str, list[dict[str, Any]]] = {}
        for observation in observations.values():
            day = str(observation.get("acquisitionDate") or "undated")[:10]
            dates.setdefault(day, []).append(observation)
        catalog = {"studyId": request.studyId, "retrievalSessionId": request.retrievalSessionId,
            "observations": sorted(observations.values(), key=lambda item: (item.get("acquisitionDate") or "", item["observationId"])),
            "rasters": rasters,
            "timeline": [{"date": None if day == "undated" else day, "granuleCount": len(items),
                "granuleIds": sorted(item["granuleId"] for item in items),
                "polarizations": sorted({pol for item in items for pol in item["polarizations"]}),
                "channels": sorted({channel for item in items for channel in item["channels"]}),
                "processingStatus": "processed"} for day, items in sorted(dates.items())]}
        _atomic_json(settings.resolved_visualization_temp_dir / session["sessionId"] / "catalog.json", catalog)
        return {**session, "retrievalSessionId": request.retrievalSessionId,
                "rasterCount": len(rasters), "observationCount": len(observations)}
    except VisualizationSessionError as exc:
        raise _visualization_http_error(exc) from exc


def _require_visualization_session(session_id: str, session_token: str | None):
    try:
        session_dir, metadata = require_session(settings.resolved_visualization_temp_dir,
            session_id, session_token, settings.visualization_session_ttl_seconds)
    except VisualizationSessionError as exc:
        raise _visualization_http_error(exc) from exc
    return session_dir, metadata


@app.get("/api/visualization/sessions/{session_id}/catalog")
async def visualization_catalog(session_id: str, x_visualization_session_token: str | None = Header(default=None)):
    session_dir, _ = _require_visualization_session(session_id, x_visualization_session_token)
    return json_safe(read_session_catalog(session_dir))


@app.get("/api/visualization/sessions/{session_id}/timeline")
async def visualization_timeline(session_id: str, x_visualization_session_token: str | None = Header(default=None)):
    session_dir, _ = _require_visualization_session(session_id, x_visualization_session_token)
    return json_safe(read_session_catalog(session_dir).get("timeline", []))


@app.delete("/api/visualization/sessions/{session_id}")
async def visualization_session_delete(session_id: str, x_visualization_session_token: str | None = Header(default=None)):
    try:
        _require_visualization_session(session_id, x_visualization_session_token)
        delete_session(settings.resolved_visualization_temp_dir, session_id,
                       x_visualization_session_token, settings.visualization_session_ttl_seconds)
    except VisualizationSessionError as exc:
        raise _visualization_http_error(exc) from exc
    return {"deleted": True}


@app.get("/api/visualization/sessions/{session_id}/rgb/{observation_id}")
async def visualization_rgb(session_id: str, observation_id: str, red: str, green: str, blue: str,
                            max_dimension: int = Query(default=1024, ge=32, le=4096),
                            x_visualization_session_token: str | None = Header(default=None)):
    session_dir, metadata = _require_visualization_session(session_id, x_visualization_session_token)
    max_dimension = min(max_dimension, settings.visualization_max_dimension)
    try:
        product, bounds, legend = generate_rgb(settings.resolved_data_dir, session_dir,
            metadata["studyId"], observation_id, red, green, blue,
            max_dimension, settings.visualization_max_storage_bytes)
    except VisualizationSessionError as exc:
        raise _visualization_http_error(exc) from exc
    except (OSError, rasterio.errors.RasterioError) as exc:
        raise HTTPException(status_code=422, detail=f"RGB composite generation failed: {exc}") from exc
    return Response(content=product.read_bytes(), media_type="image/png",
                    headers={"X-Raster-Bounds-WGS84": json.dumps(bounds),
                             "X-RGB-Channel-Legend": json.dumps(legend),
                             "Cache-Control": "no-store"})


@app.get("/api/visualization/sessions/{session_id}/compare")
async def visualization_compare(session_id: str, baseline: str, current: str, variable: str,
                                mode: str = "side_by_side", include_difference: bool = False,
                                max_dimension: int = Query(default=1024, ge=32, le=4096),
                                x_visualization_session_token: str | None = Header(default=None)):
    session_dir, metadata = _require_visualization_session(session_id, x_visualization_session_token)
    max_dimension = min(max_dimension, settings.visualization_max_dimension)
    try:
        return generate_comparison(settings.resolved_data_dir,
            session_dir, metadata["studyId"], baseline, current, variable, mode,
            include_difference, max_dimension, settings.visualization_max_storage_bytes)
    except VisualizationSessionError as exc:
        raise _visualization_http_error(exc) from exc
    except (OSError, rasterio.errors.RasterioError) as exc:
        raise HTTPException(status_code=422, detail=f"Comparison generation failed: {exc}") from exc


@app.get("/api/visualization/sessions/{session_id}/products/{product_id}")
async def visualization_product(session_id: str, product_id: str,
                                x_visualization_session_token: str | None = Header(default=None)):
    session_dir, _ = _require_visualization_session(session_id, x_visualization_session_token)
    try:
        path = product_path(session_dir, product_id)
    except VisualizationSessionError as exc:
        raise _visualization_http_error(exc) from exc
    return Response(content=path.read_bytes(), media_type="image/png",
                    headers={"Cache-Control": "no-store"})


def _export_http_error(error: RasterExportError) -> HTTPException:
    return HTTPException(status_code=error.status_code, detail=str(error))


def _export_job_path(session_dir: Path, export_id: str) -> Path:
    if not re.fullmatch(r"[a-f0-9]{32}", export_id):
        raise HTTPException(status_code=400, detail="Invalid export identifier.")
    path = session_dir / "exports" / f"{export_id}.json"
    if not path.is_file():
        raise HTTPException(status_code=404, detail="Export job was not found or has expired.")
    return path


@app.post("/api/visualization/sessions/{session_id}/changes")
async def visualization_changes(session_id: str, request: ChangeExportRequest,
                                x_visualization_session_token: str | None = Header(default=None)):
    session_dir, metadata = _require_visualization_session(session_id, x_visualization_session_token)
    try:
        result = await asyncio.to_thread(create_change_export, settings.resolved_data_dir, session_dir,
            metadata["studyId"], request.left.model_dump(), request.right.model_dump(),
            settings.visualization_max_storage_bytes, settings.visualization_max_dimension)
    except RasterExportError as exc:
        raise _export_http_error(exc) from exc
    except (OSError, rasterio.errors.RasterioError, ValueError) as exc:
        log.exception("Comparison change export failed")
        raise HTTPException(status_code=422, detail="Could not generate the change raster from the selected saved measurements.") from exc
    return result


@app.post("/api/visualization/sessions/{session_id}/timeline/exports", status_code=202)
async def visualization_timeline_export(session_id: str, request: TimelineExportRequest,
                                        x_visualization_session_token: str | None = Header(default=None)):
    session_dir, metadata = _require_visualization_session(session_id, x_visualization_session_token)
    export_id = __import__("uuid").uuid4().hex
    exports_dir = session_dir / "exports"; exports_dir.mkdir(exist_ok=True)
    status_path = exports_dir / f"{export_id}.json"
    _atomic_json(status_path, {"exportId": export_id, "status": "queued", "createdAt": datetime.now(timezone.utc).isoformat()})

    async def process_export():
        _atomic_json(status_path, {"exportId": export_id, "status": "processing", "startedAt": datetime.now(timezone.utc).isoformat()})
        try:
            result = await asyncio.to_thread(create_timeline_export, settings.resolved_data_dir,
                session_dir, metadata["studyId"], [frame.model_dump() for frame in request.frames],
                request.settings, settings.visualization_max_storage_bytes,
                settings.visualization_max_dimension)
            _atomic_json(exports_dir / f"{result['exportId']}.json", {"filename": result["filename"]})
            _atomic_json(status_path, {"exportId": export_id, "status": "completed", "filename": result["filename"],
                "downloadUrl": f"/api/visualization/sessions/{session_id}/exports/{result['exportId']}",
                "completedAt": datetime.now(timezone.utc).isoformat()})
        except RasterExportError as exc:
            _atomic_json(status_path, {"exportId": export_id, "status": "failed", "error": str(exc),
                "completedAt": datetime.now(timezone.utc).isoformat()})
        except Exception:
            log.exception("Timeline export job failed %s", export_id)
            _atomic_json(status_path, {"exportId": export_id, "status": "failed",
                "error": "Timeline export failed during raster processing.",
                "completedAt": datetime.now(timezone.utc).isoformat()})
        finally:
            _timeline_export_tasks.pop(export_id, None)

    _timeline_export_tasks[export_id] = asyncio.create_task(process_export())
    return {"exportId": export_id, "status": "queued"}


@app.get("/api/visualization/sessions/{session_id}/timeline/exports/{export_id}")
async def visualization_timeline_export_status(session_id: str, export_id: str,
                                               x_visualization_session_token: str | None = Header(default=None)):
    session_dir, _ = _require_visualization_session(session_id, x_visualization_session_token)
    status_path = _export_job_path(session_dir, export_id)
    try:
        return json.loads(status_path.read_text())
    except (OSError, ValueError) as exc:
        raise HTTPException(status_code=500, detail="Timeline export status could not be read.") from exc


@app.get("/api/visualization/sessions/{session_id}/exports/{export_id}")
async def visualization_export_download(session_id: str, export_id: str,
                                        x_visualization_session_token: str | None = Header(default=None)):
    session_dir, _ = _require_visualization_session(session_id, x_visualization_session_token)
    if not re.fullmatch(r"[a-f0-9]{32}", export_id):
        raise HTTPException(status_code=400, detail="Invalid export identifier.")
    zip_path = session_dir / "exports" / f"{export_id}.zip"
    meta_path = session_dir / "exports" / f"{export_id}.json"
    # Timeline export IDs use a separate status ID and record the download URL;
    # resolve only from session-owned export files.
    if not zip_path.is_file():
        status_path = _export_job_path(session_dir, export_id)
        record = json.loads(status_path.read_text())
        download_url = str(record.get("downloadUrl", ""))
        match = re.search(r"/exports/([a-f0-9]{32})$", download_url)
        if record.get("status") != "completed" or not match:
            raise HTTPException(status_code=409, detail="Export is not ready to download.")
        export_id = match.group(1); zip_path = session_dir / "exports" / f"{export_id}.zip"
        meta_path = session_dir / "exports" / f"{export_id}.json"
    if not zip_path.is_file():
        raise HTTPException(status_code=404, detail="Export file was not found or has expired.")
    try:
        record = json.loads(meta_path.read_text()) if meta_path.is_file() else {}
    except (OSError, ValueError): record = {}
    filename = safe_token(str(record.get("filename", "")).removesuffix(".zip"), f"DeltaEarth_{export_id}") + ".zip"
    return FileResponse(zip_path, media_type="application/zip", filename=filename)


@app.get("/api/visualization/{study_id}/raster/{observation_id}/{variable}")
async def visualization_raster(study_id: str, observation_id: str, variable: str,
                               frequency: str = "frequencyA"):
    path, entry = _registered_raster(study_id, observation_id, variable, frequency)
    try:
        with rasterio.open(path) as dataset:
            if dataset.driver != "GTiff" or dataset.count < 1 or dataset.width < 1 or dataset.height < 1:
                raise ValueError("Raster is empty or invalid.")
    except Exception as exc:
        raise HTTPException(status_code=422, detail="The registered GeoTIFF is invalid or corrupted.") from exc
    study_name, _ = _export_study_info(settings.resolved_data_dir, study_id)
    acquired = str(entry.get("acquisitionDate") or "DateUnavailable")[:10]
    polarization = {"HHHH": "HH", "HVHV": "HV", "VHVH": "VH", "VVVV": "VV"}.get(variable, variable)
    filename = "_".join(("DeltaEarth", safe_token(study_name, study_id), safe_token(acquired),
                         safe_token(observation_id), safe_token(frequency.replace("frequency", "Frequency")),
                         safe_token(polarization))) + ".tif"
    return FileResponse(path, media_type="image/tiff", filename=filename)


@app.get("/api/visualization/{study_id}/preview/{observation_id}/{variable}")
async def visualization_raster_preview(study_id: str, observation_id: str, variable: str,
                                       palette: str = "viridis", stretch: str = "linear",
                                       lower_percentile: float = Query(default=2, ge=0, le=100),
                                       upper_percentile: float = Query(default=98, ge=0, le=100),
                                       bands: int = Query(default=0, ge=0, le=64),
                                       style: str | None = None,
                                       max_dimension: int = Query(default=1024, ge=32, le=2048),
                                       minimum: float | None = None, maximum: float | None = None,
                                       normalization_scale: float | None = Query(default=None, gt=0),
                                       frequency: str = "frequencyA"):
    path, entry = _registered_raster(study_id, observation_id, variable, frequency)
    if style is not None:
        palette = {"gray": "grayscale", "red": "red"}.get(style, style)
    if palette not in PALETTE_ANCHORS:
        raise HTTPException(status_code=400, detail=f"Unsupported palette. Choose from: {', '.join(PALETTE_ANCHORS)}.")
    if stretch not in {"linear", "log"}:
        raise HTTPException(status_code=400, detail="Stretch must be linear or log.")
    try:
        with rasterio.open(path) as dataset:
            scale = min(1.0, max_dimension / max(dataset.width, dataset.height))
            width, height = max(1, int(dataset.width * scale)), max(1, int(dataset.height * scale))
            sample = dataset.read(1, out_shape=(height, width), masked=True, resampling=Resampling.average)
            actual_scale = (normalization_scale if normalization_scale is not None else
                            log_normalization_scale(sample) if stretch == "log" else None)
            rgba_last, low, high = colorize_values(sample, palette=palette, minimum=minimum,
                maximum=maximum, lower_percentile=lower_percentile,
                upper_percentile=upper_percentile, stretch=stretch, bands=bands,
                normalization_scale=actual_scale)
            rgba = rgba_last.transpose(2, 0, 1)
            bounds = list(transform_bounds(dataset.crs, "EPSG:4326", *dataset.bounds, densify_pts=21))
        with MemoryFile(ext=".png") as memory:
            with memory.open(driver="PNG", width=width, height=height, count=4, dtype="uint8") as png:
                png.write(rgba)
            content = memory.read()
    except HTTPException:
        raise
    except (OSError, rasterio.errors.RasterioError, ValueError) as exc:
        raise HTTPException(status_code=422, detail=f"Could not render stored raster: {exc}") from exc
    return Response(content=content, media_type="image/png", headers={
        "X-Raster-Bounds-WGS84": json.dumps(bounds), "X-Raster-Minimum": str(low),
        "X-Raster-Maximum": str(high), "X-Raster-Units": str(entry.get("raster", {}).get("units") or "unknown"),
        "X-Raster-Legend": json.dumps({**palette_legend(palette, low, high, bands=bands),
            "normalizationScale": actual_scale}),
        "Cache-Control": "private, max-age=300"})


@app.get("/api/visualization/{study_id}/preview/{observation_id}/{variable}/pixel")
async def visualization_preview_pixel(study_id: str, observation_id: str, variable: str,
                                      x: int = Query(ge=0), y: int = Query(ge=0),
                                      palette: str = "viridis", stretch: str = "linear",
                                      lower_percentile: float = Query(default=2, ge=0, le=100),
                                      upper_percentile: float = Query(default=98, ge=0, le=100),
                                      bands: int = Query(default=0, ge=0, le=64),
                                      minimum: float | None = None, maximum: float | None = None,
                                      normalization_scale: float | None = Query(default=None, gt=0),
                                      max_dimension: int = Query(default=1024, ge=32, le=2048),
                                      frequency: str = "frequencyA"):
    path, entry = _registered_raster(study_id, observation_id, variable, frequency)
    if palette not in PALETTE_ANCHORS or stretch not in {"linear", "log"}:
        raise HTTPException(status_code=400, detail="Unsupported palette or intensity stretch.")
    try:
        with rasterio.open(path) as dataset:
            scale = min(1.0, max_dimension / max(dataset.width, dataset.height))
            width, height = max(1, int(dataset.width * scale)), max(1, int(dataset.height * scale))
            if x >= width or y >= height:
                raise HTTPException(status_code=400, detail="Preview pixel lies outside the rendered raster.")
            sample = dataset.read(1, out_shape=(height, width), masked=True, resampling=Resampling.average)
            shared_scale = (normalization_scale if normalization_scale is not None else
                            log_normalization_scale(sample) if stretch == "log" else None)
            _, low, high = colorize_values(sample, palette=palette, minimum=minimum, maximum=maximum,
                lower_percentile=lower_percentile, upper_percentile=upper_percentile,
                stretch=stretch, bands=bands, normalization_scale=shared_scale)
            source_row = min(dataset.height - 1, int((y + .5) * dataset.height / height))
            source_column = min(dataset.width - 1, int((x + .5) * dataset.width / width))
            value = dataset.read(1, window=((source_row, source_row + 1),
                                             (source_column, source_column + 1)), masked=True)[0, 0]
            valid = not np.ma.is_masked(value) and bool(np.isfinite(value))
            xy = dataset.xy(source_row, source_column)
            lon, lat = transform_coordinates(dataset.crs, "EPSG:4326", [xy[0]], [xy[1]])
            color = [0, 0, 0, 0]
            if valid:
                colored, _, _ = colorize_values(np.ma.array([[float(value)]]), palette=palette,
                    minimum=low, maximum=high, lower_percentile=lower_percentile,
                    upper_percentile=upper_percentile, stretch=stretch, bands=bands,
                    normalization_scale=shared_scale)
                color = colored[0, 0].tolist()
        acquisition = entry.get("acquisitionMetadata") or {}
        source_variable = entry.get("sourceVariable", variable)
        polarization = {"HHHH": "HH", "HVHV": "HV", "VHVH": "VH", "VVVV": "VV"}.get(
            source_variable, source_variable)
        return {"studyId": study_id, "observationId": observation_id, "granuleId": observation_id,
            "frequency": frequency, "polarization": polarization,
            "sourceVariable": source_variable,
            "acquisitionDate": entry.get("acquisitionDate") or acquisition.get("acquiredAt"),
            "longitude": lon[0], "latitude": lat[0], "row": source_row, "column": source_column,
            "value": float(value) if valid else None,
            "units": entry.get("raster", {}).get("units") or "unknown",
            "displayColor": f"#{color[0]:02x}{color[1]:02x}{color[2]:02x}" if valid else None,
            "nodata": not valid}
    except HTTPException:
        raise
    except (OSError, rasterio.errors.RasterioError, ValueError) as exc:
        raise HTTPException(status_code=422, detail=f"Could not inspect raster pixel: {exc}") from exc


@app.get("/api/studies/{study_id}/observations/{observation_id}/pixel")
async def local_raster_pixel(study_id: str, observation_id: str, longitude: float, latitude: float,
                             variable: str = "HHHH", frequency: str = "frequencyA"):
    if not np.isfinite(longitude) or not np.isfinite(latitude) or not (-180 <= longitude <= 180) or not (-90 <= latitude <= 90):
        raise HTTPException(status_code=400, detail="Pixel coordinates must be finite WGS84 longitude/latitude values.")
    path, _ = _registered_raster(study_id, observation_id, variable, frequency)
    try:
        with rasterio.open(path) as dataset:
            x, y = transform_coordinates("EPSG:4326", dataset.crs, [longitude], [latitude])
            row, column = dataset.index(x[0], y[0])
            if row < 0 or column < 0 or row >= dataset.height or column >= dataset.width:
                return {"studyId": study_id, "observationId": observation_id, "measurement": variable,
                        "longitude": longitude, "latitude": latitude, "value": None, "nodata": True}
            sample = dataset.read(1, window=((row, row + 1), (column, column + 1)), masked=True)[0, 0]
            valid = not np.ma.is_masked(sample) and bool(np.isfinite(sample))
            return {"studyId": study_id, "observationId": observation_id, "measurement": variable,
                    "longitude": longitude, "latitude": latitude,
                    "value": float(sample) if valid else None, "nodata": not valid}
    except (OSError, rasterio.errors.RasterioError) as exc:
        raise HTTPException(status_code=422, detail="The registered GeoTIFF is invalid or corrupted.") from exc


@app.get("/api/studies/{study_id}/compare")
async def compare_local_rasters(study_id: str, baseline: str, current: str,
                                variable: str = "HHHH", frequency: str = "frequencyA"):
    baseline_path, baseline_entry = _registered_raster(study_id, baseline, variable, frequency)
    current_path, current_entry = _registered_raster(study_id, current, variable, frequency)
    before_units = str(baseline_entry.get("raster", {}).get("units") or "")
    after_units = str(current_entry.get("raster", {}).get("units") or "")
    if before_units and after_units and before_units != after_units:
        raise HTTPException(status_code=409, detail="These acquisitions use incompatible measurement units.")
    try:
        with rasterio.open(baseline_path) as before, rasterio.open(current_path) as after:
            if (before.crs != after.crs or before.transform != after.transform or
                    before.width != after.width or before.height != after.height):
                raise HTTPException(status_code=409, detail="These local rasters are not on the same grid and cannot be compared directly.")
            count, total = 0, 0.0
            minimum = maximum = None
            for _, window in before.block_windows(1):
                first = before.read(1, window=window, masked=True)
                second = after.read(1, window=window, masked=True)
                a, b = np.asarray(first.data, dtype=np.float64), np.asarray(second.data, dtype=np.float64)
                valid = (~np.ma.getmaskarray(first) & ~np.ma.getmaskarray(second) &
                         np.isfinite(a) & np.isfinite(b))
                if not valid.any():
                    continue
                differences = b[valid] - a[valid]
                count += int(differences.size)
                total += float(differences.sum(dtype=np.float64))
                low, high = float(differences.min()), float(differences.max())
                minimum = low if minimum is None else min(minimum, low)
                maximum = high if maximum is None else max(maximum, high)
            if not count:
                raise HTTPException(status_code=422, detail="The aligned rasters have no overlapping finite, valid pixels.")
            return {"studyId": study_id, "baselineObservationId": baseline,
                    "currentObservationId": current, "variable": variable,
                    "validPixelCount": count, "meanDifference": total / count,
                    "minimumDifference": minimum, "maximumDifference": maximum,
                    "note": "Difference is current minus baseline on matching local raster grids."}
    except (OSError, rasterio.errors.RasterioError) as exc:
        raise HTTPException(status_code=422, detail="A comparison GeoTIFF is invalid or corrupted.") from exc


@app.get("/api/data/{relative_path:path}")
async def get_data(relative_path: str):
    root = settings.resolved_data_dir.resolve()
    candidate = (root / relative_path).resolve()
    if not candidate.is_relative_to(root) or not candidate.is_file():
        raise HTTPException(status_code=404, detail="Data file not found.")
    if candidate.suffix.lower() in {".tif", ".tiff"}:
        try:
            with rasterio.open(candidate) as dataset:
                if dataset.driver != "GTiff":
                    raise ValueError("Unexpected raster driver")
        except Exception as exc:
            raise HTTPException(status_code=422, detail="Stored raster failed GeoTIFF validation.") from exc
        return FileResponse(candidate, media_type="image/tiff", filename=candidate.name)
    if candidate.suffix.lower() in {".json", ".geojson"}:
        return FileResponse(candidate, media_type="application/geo+json" if candidate.suffix.lower() == ".geojson" else "application/json")
    raise HTTPException(status_code=404, detail="Unsupported data file type.")

