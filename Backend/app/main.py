import logging
import json
import re
from datetime import date
from pathlib import Path
from typing import Any

import rasterio
import httpx
from shapely.geometry import shape
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from .cmr import CMRRequestError, search_granules
from .geometry import PolygonInputError, study_id_for_feature, validate_geojson
from .harmony import HarmonyConfigurationError, extract_granule, inspect_capabilities, refresh_job_status, _sanitize_text, _write_job_record
from .settings import get_settings

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
logging.getLogger("httpx").setLevel(logging.WARNING)
log = logging.getLogger(__name__)
settings = get_settings()


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

app = FastAPI(title="Dancing with SAR — NISAR Data API", version="0.1.0")
app.add_middleware(CORSMiddleware, allow_origins=[settings.frontend_origin], allow_credentials=True,
                   allow_methods=["GET", "POST"], allow_headers=["*"])


class ExtractRequest(BaseModel):
    granuleId: str = Field(min_length=3, max_length=300)
    studyArea: dict[str, Any]
    variables: list[str] = Field(min_length=1, max_length=8)
    frequency: str = "frequencyA"
    acquisitionMetadata: dict[str, Any] = Field(default_factory=dict)


@app.get("/api/health")
async def health():
    return {"status": "ok", "service": "dancing-with-sar", "collectionId": settings.nisar_gcov_collection}


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
        results = await search_granules(polygon, start, end, int(payload.get("pageSize", 100)))
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
        return result
    except PolygonInputError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except HarmonyConfigurationError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:
        safe_error = _sanitize_text(exc)
        log.error("Extraction request failed %s", json.dumps({"failure_reason": safe_error}))
        raise HTTPException(status_code=502, detail=f"NISAR extraction failed: {safe_error}") from exc


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

