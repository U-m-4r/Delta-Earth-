import asyncio

import httpx
import numpy as np
import pytest
import rasterio
from rasterio.transform import from_origin

from app import main
from app.geometry import study_id_for_feature
from app.raster_registry import persist_processed_raster
from app.settings import Settings

FEATURE = {"type": "Feature", "properties": {"name": "Test area"}, "geometry": {"type": "Polygon", "coordinates": [
    [[10, 10], [12, 10], [12, 12], [10, 12], [10, 10]]
]}}


def create_raster(path, value=2):
    path.parent.mkdir(parents=True, exist_ok=True)
    with rasterio.open(path, "w", driver="GTiff", width=8, height=8, count=1,
                       dtype="float32", crs="EPSG:4326", transform=from_origin(10, 12, .25, .25),
                       nodata=-9999) as dataset:
        dataset.write(np.full((8, 8), value, dtype="float32"), 1)
        dataset.update_tags(1, units="dB")
    return path


@pytest.fixture
def config(tmp_path, monkeypatch):
    cfg = Settings(data_dir=tmp_path / "data", visualization_temp_dir=tmp_path / "temp",
                   visualization_max_storage_bytes=4 * 1024 * 1024)
    monkeypatch.setattr(main, "settings", cfg)
    return cfg


@pytest.mark.asyncio
async def test_batch_persists_each_combination_and_continues_after_failure(config, monkeypatch):
    calls = []

    async def fake_extract(granule_id, feature, variables, frequency, metadata):
        calls.append((granule_id, variables[0]))
        variable = variables[0]
        if variable == "HVHV":
            return {"variables": [{"variable": variable, "status": "missing_or_rejected", "error": "not present"}]}
        path = create_raster(config.resolved_data_dir / "fake-output" / granule_id / f"{variable}.tif", 3)
        stored = persist_processed_raster(config.resolved_data_dir, study_id_for_feature(feature), granule_id,
            metadata, variable, path, feature, retrieval_session_id=metadata["retrievalSessionId"])
        return {"variables": [{"variable": variable, "status": "downloaded", "registryPersistence": "success",
                               "raster": stored["raster"], "bytes": stored["bytes"]}]}

    async def fake_search(*args, **kwargs):
        return {"observations": [
            {"id": "G111-ASF", "frequencies": ["frequencyA"], "polarizations": ["HHHH", "HVHV"],
             "availableVariables": [{"frequency": "frequencyA", "variable": "HHHH"},
                                    {"frequency": "frequencyA", "variable": "HVHV"}]},
            {"id": "G222-ASF", "frequencies": ["frequencyB"], "polarizations": ["VVVV"],
             "availableVariables": [{"frequency": "frequencyB", "variable": "VVVV"}]},
        ]}

    monkeypatch.setattr(main, "extract_granule", fake_extract)
    monkeypatch.setattr(main, "search_granules", fake_search)
    body = {"studyId": study_id_for_feature(FEATURE), "studyArea": FEATURE,
        "startDate": "2026-01-01", "endDate": "2026-03-31", "combinations": [
            {"granuleId": "G111-ASF", "frequency": "frequencyA", "variable": "HHHH",
             "acquisitionMetadata": {"acquiredAt": "2026-01-01T03:42:00Z"}},
            {"granuleId": "G111-ASF", "frequency": "frequencyA", "variable": "HVHV"},
            {"granuleId": "G222-ASF", "frequency": "frequencyB", "variable": "VVVV",
             "acquisitionMetadata": {"acquiredAt": "2026-03-02T09:15:00Z"}},
        ]}
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=main.app), base_url="http://test") as client:
        response = await client.post("/api/nisar/extractions/batch", json=body)
        assert response.status_code == 202
        session_id = response.json()["retrievalSessionId"]
        task = main._retrieval_tasks.get(session_id)
        if task:
            await task
        state = await client.get(f"/api/retrieval-sessions/{session_id}")
        rasters = await client.get(f"/api/retrieval-sessions/{session_id}/rasters")
    assert state.status_code == 200
    result = state.json()
    assert result["status"] == "partial"
    assert result["completedCount"] == 2 and result["failedCount"] == 1
    assert [row["status"] for row in result["combinations"]] == ["completed", "failed", "completed"]
    assert result["combinations"][0]["acquisitionMetadata"]["acquiredAt"] == "2026-01-01T03:42:00Z"
    assert rasters.status_code == 200 and len(rasters.json()["rasters"]) == 2
    assert all("rasterPath" not in raster for raster in rasters.json()["rasters"])
    assert len(calls) == 3


@pytest.mark.asyncio
async def test_successful_combination_is_not_extracted_again(config, monkeypatch):
    calls = []

    async def fake_extract(granule_id, feature, variables, frequency, metadata):
        calls.append(granule_id)
        path = create_raster(config.resolved_data_dir / "out.tif")
        persist_processed_raster(config.resolved_data_dir, study_id_for_feature(feature), granule_id,
            metadata, variables[0], path, feature, retrieval_session_id=metadata["retrievalSessionId"])
        return {"variables": [{"variable": variables[0], "status": "downloaded", "registryPersistence": "success"}]}

    async def fake_search(*args, **kwargs):
        return {"observations": [{"id": "G333-ASF", "frequencies": ["frequencyA"],
            "polarizations": ["HHHH"], "availableVariables": [{"frequency": "frequencyA", "variable": "HHHH"}]}]}

    monkeypatch.setattr(main, "extract_granule", fake_extract)
    monkeypatch.setattr(main, "search_granules", fake_search)
    body = {"studyId": study_id_for_feature(FEATURE), "studyArea": FEATURE, "combinations": [
        {"granuleId": "G333-ASF", "frequency": "frequencyA", "variable": "HHHH"}]}
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=main.app), base_url="http://test") as client:
        first = await client.post("/api/nisar/extractions/batch", json=body)
        task = main._retrieval_tasks.get(first.json()["retrievalSessionId"])
        if task: await task
        second = await client.post("/api/nisar/extractions/batch", json=body)
        task = main._retrieval_tasks.get(second.json()["retrievalSessionId"])
        if task: await task
        raster_list = await client.get(f"/api/retrieval-sessions/{second.json()['retrievalSessionId']}/rasters")
    assert len(calls) == 1
    assert raster_list.json()["rasters"][0]["retrievalSessionId"] == second.json()["retrievalSessionId"]


@pytest.mark.asyncio
async def test_batch_rejects_unavailable_source_variable_without_substitution(config, monkeypatch):
    async def fake_search(*args, **kwargs):
        return {"observations": [{"id": "G444-ASF", "frequencies": ["frequencyA"],
            "polarizations": ["HHHH"], "availableVariables": [
                {"frequency": "frequencyA", "variable": "HHHH"}]}]}

    async def never_extract(*args, **kwargs):
        raise AssertionError("invalid unavailable variables must be rejected before processing")

    monkeypatch.setattr(main, "search_granules", fake_search)
    monkeypatch.setattr(main, "extract_granule", never_extract)
    body = {"studyId": study_id_for_feature(FEATURE), "studyArea": FEATURE, "combinations": [
        {"granuleId": "G444-ASF", "frequency": "frequencyA", "variable": "HVHV"}]}
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=main.app), base_url="http://test") as client:
        response = await client.post("/api/nisar/extractions/batch", json=body)
    assert response.status_code == 422
    assert "not listed as available" in response.json()["detail"]
