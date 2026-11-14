import json

import httpx
import respx
import pytest
from pydantic import SecretStr

from app import harmony, main
from app.geometry import study_id_for_feature
from app.settings import Settings


@pytest.mark.asyncio
async def test_processed_observations_resumes_persisted_job_and_returns_stac_metadata(monkeypatch, tmp_path):
    cfg = Settings(harmony_base_url="https://harmony.earthdata.nasa.gov", edl_token=SecretStr("test-secret"), data_dir=tmp_path)
    monkeypatch.setattr(main, "settings", cfg)
    monkeypatch.setattr(harmony, "get_settings", lambda: cfg)
    feature = {"type": "Feature", "properties": {"name": "Selected Study Area"}, "geometry": {"type": "Polygon", "coordinates": [[
        [-1, 2], [3, 2], [3, 5], [-1, 5], [-1, 2],
    ]]}}
    study_id = study_id_for_feature(feature)
    study_dir = cfg.resolved_data_dir / "study_areas"
    study_dir.mkdir(parents=True)
    (study_dir / f"{study_id}.geojson").write_text(json.dumps(feature))

    jobs_dir = cfg.resolved_data_dir / "harmony_jobs"
    jobs_dir.mkdir(parents=True)
    record_path = jobs_dir / "request.json"
    record_path.write_text(json.dumps({
        "state": "running", "jobId": "job-123", "granuleId": "G123-ASF",
        "variablePath": "/science/LSAR/GCOV/grids/frequencyA/HHHH",
        "parameters": [["subset", "lat(2.0:5.0)"], ["subset", "lon(-1.0:3.0)"]],
        "observation": {"id": "G123-ASF", "title": "NISAR test granule", "provider": "ASF"},
    }))

    catalog_url = "https://harmony.earthdata.nasa.gov/stac/job-123"
    item_url = f"{catalog_url}/0"
    with respx.mock(assert_all_called=True) as router:
        router.get("https://harmony.earthdata.nasa.gov/jobs/job-123").mock(return_value=httpx.Response(200, json={
            "jobID": "job-123", "status": "successful", "progress": 100,
            "message": "The job has completed successfully", "updatedAt": "2026-11-15T00:00:00Z",
        }))
        router.get(catalog_url).mock(return_value=httpx.Response(200, json={
            "type": "Catalog", "links": [{"rel": "item", "href": "./0"}],
        }))
        router.get(item_url).mock(return_value=httpx.Response(200, json={
            "type": "Feature", "assets": {"data": {
                "href": "https://harmony-prod-staging/public/job-123/result.tif", "type": "image/tiff",
            }},
        }))
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=main.app), base_url="http://test") as api:
            response = await api.get(f"/api/studies/{study_id}/processed-observations")

    assert response.status_code == 200
    body = response.json()
    assert body["studyId"] == study_id
    assert body["observations"][0]["id"] == "G123-ASF"
    assert body["observations"][0]["processingStatus"] == "ready"
    assert body["observations"][0]["harmonyJobs"][0]["harmonyStatus"] == "successful"
    assert body["observations"][0]["harmonyJobs"][0]["outputAssetCount"] == 1
    persisted = json.loads(record_path.read_text())
    assert persisted["studyId"] == study_id
    assert persisted["jobStatus"]["progress"] == 100
    assert persisted["stacAssets"][0]["mediaType"] == "image/tiff"
