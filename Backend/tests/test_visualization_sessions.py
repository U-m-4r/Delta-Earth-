import hashlib
import json
from datetime import datetime, timedelta, timezone

import httpx
import numpy as np
import pytest
import rasterio
from rasterio.io import MemoryFile
from rasterio.transform import from_origin

from app import harmony, main
from app.raster_registry import persist_processed_raster
from app.settings import Settings
from app.visualization_sessions import cleanup_expired_sessions


STUDY_ID = "aabbccddeeff0011"
RETRIEVAL_ID = "11111111111111111111111111111111"
FEATURE = {"type": "Feature", "properties": {}, "geometry": {"type": "Polygon", "coordinates": [
    [[10, 10], [12, 10], [12, 12], [10, 12], [10, 10]]
]}}
VARIABLES = ("HHHH", "HVHV", "VVVV", "VHVH")


def create_raster(path, values, *, transform=None):
    path.parent.mkdir(parents=True, exist_ok=True)
    array = np.asarray(values, dtype="float32")
    with rasterio.open(path, "w", driver="GTiff", width=array.shape[1], height=array.shape[0], count=1,
                       dtype="float32", crs="EPSG:4326", transform=transform or from_origin(10, 12, 0.0625, 0.0625),
                       nodata=float("nan"), tiled=True, blockxsize=16, blockysize=16) as dataset:
        dataset.write(array, 1)
    return path


def add_observation(data_root, observation_id, date, offset=0, *, shifted_variable=None):
    base = np.arange(32 * 32, dtype="float32").reshape(32, 32) * (1 + offset / 100) + 1 + offset
    base[0, 0] = np.nan
    for index, variable in enumerate(VARIABLES):
        values = base + index
        transform = from_origin(10.02, 12.02, 0.0625, 0.0625) if variable == shifted_variable else None
        source = create_raster(data_root / "incoming" / observation_id / f"{variable}.tif", values,
                               transform=transform)
        metadata = {"id": observation_id, "title": f"NISAR {observation_id}",
                    "provider": "NASA ASF DAAC", "productType": "GCOV", "acquiredAt": date}
        persist_processed_raster(data_root, STUDY_ID, observation_id, metadata, variable, source, FEATURE,
                                 retrieval_session_id=RETRIEVAL_ID)


@pytest.fixture
def configured_data(tmp_path, monkeypatch):
    data_root = tmp_path / "persistent-data"
    sessions_root = tmp_path / "tmp" / "delta-earth" / "sessions"
    cfg = Settings(data_dir=data_root, visualization_temp_dir=sessions_root,
                   visualization_session_ttl_seconds=3600, visualization_max_sessions=8,
                   visualization_max_storage_bytes=8 * 1024 * 1024,
                   visualization_max_dimension=1024)
    monkeypatch.setattr(main, "settings", cfg)
    add_observation(data_root, "G111-ASF", "2026-01-01T00:00:00Z", 0)
    add_observation(data_root, "G112-ASF", "2026-01-01T08:00:00Z", 10)
    add_observation(data_root, "G221-ASF", "2026-02-01T00:00:00Z", 20, shifted_variable="HVHV")

    async def forbidden(*args, **kwargs):
        raise AssertionError("visualization must not invoke Harmony or ASF discovery")

    monkeypatch.setattr(main, "refresh_job_status", forbidden)
    monkeypatch.setattr(main, "extract_granule", forbidden)
    monkeypatch.setattr(main, "search_granules", forbidden)
    monkeypatch.setattr(harmony, "_submit_variable", forbidden)
    return cfg


async def create_session(client, retrieval_session_id=RETRIEVAL_ID):
    response = await client.post("/api/visualization/sessions", json={"studyId": STUDY_ID,
        "retrievalSessionId": retrieval_session_id})
    assert response.status_code == 200
    return response.json()


def auth(session):
    return {"X-Visualization-Session-Token": session["sessionToken"]}


@pytest.mark.asyncio
async def test_catalog_is_session_scoped_and_does_not_use_open_data_registry(configured_data):
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=main.app), base_url="http://test") as client:
        session = await create_session(client, "22222222222222222222222222222222")
        response = await client.get(f"/api/visualization/sessions/{session['sessionId']}/catalog", headers=auth(session))
        automatic_start = await client.post("/api/visualization/start", json={"studyArea": FEATURE})
    assert response.status_code == 200
    assert automatic_start.status_code == 404
    body = response.json()
    assert body["observations"] == []
    assert body["timeline"] == []


@pytest.mark.asyncio
async def test_rgb_is_aligned_cached_and_kept_only_in_session(configured_data):
    cfg = configured_data
    source_paths = [cfg.resolved_data_dir / "studies" / STUDY_ID / "observations" / "G221-ASF" / "rasters" / f"{v}.tif" for v in VARIABLES]
    before_hashes = [hashlib.sha256(path.read_bytes()).hexdigest() for path in source_paths]
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=main.app), base_url="http://test") as client:
        session = await create_session(client)
        url = f"/api/visualization/sessions/{session['sessionId']}/rgb/G221-ASF?red=frequencyA%3AHHHH&green=frequencyA%3AHVHV&blue=frequencyA%3AVVVV&max_dimension=64"
        first = await client.get(url, headers=auth(session))
        second = await client.get(url, headers=auth(session))
    assert first.status_code == 200
    assert first.headers["content-type"] == "image/png"
    assert json.loads(first.headers["X-RGB-Channel-Legend"]) == ["A · HH (HHHH) → R", "A · HV (HVHV) → G", "A · VV (VVVV) → B"]
    assert first.content == second.content
    with MemoryFile(first.content) as memory, memory.open() as image:
        assert image.count == 4 and max(image.width, image.height) <= 64
        rgba = image.read()
        assert rgba[3, 0, 0] == 0
        assert rgba[3, 8, 8] > 0
    session_dir = cfg.resolved_visualization_temp_dir / session["sessionId"]
    assert len(list((session_dir / "rgb").glob("*.png"))) == 1
    assert not list(cfg.resolved_data_dir.rglob("*.png"))
    assert before_hashes == [hashlib.sha256(path.read_bytes()).hexdigest() for path in source_paths]


@pytest.mark.asyncio
async def test_persisted_raster_preview_is_georeferenced_and_handles_nodata(configured_data):
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=main.app), base_url="http://test") as client:
        response = await client.get(f"/api/visualization/{STUDY_ID}/preview/G221-ASF/HHHH?style=red")
    assert response.status_code == 200
    assert response.headers["content-type"] == "image/png"
    assert response.content.startswith(b"\x89PNG\r\n\x1a\n")
    assert json.loads(response.headers["X-Raster-Bounds-WGS84"]) == pytest.approx([10, 10, 12, 12])
    assert response.headers["X-Raster-Units"] == "unknown"


@pytest.mark.asyncio
async def test_side_by_side_and_difference_products_are_temporary(configured_data):
    cfg = configured_data
    source_paths = [cfg.resolved_data_dir / "studies" / STUDY_ID / "observations" / observation / "rasters" / "HHHH.tif"
                    for observation in ("G111-ASF", "G221-ASF")]
    before_hashes = [hashlib.sha256(path.read_bytes()).hexdigest() for path in source_paths]
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=main.app), base_url="http://test") as client:
        session = await create_session(client)
        headers = auth(session)
        params = {"baseline": "G111-ASF", "current": "G221-ASF", "variable": "frequencyA:HHHH",
                  "mode": "side_by_side", "include_difference": "true", "max_dimension": "64"}
        side = await client.get(f"/api/visualization/sessions/{session['sessionId']}/compare", params=params, headers=headers)
        assert side.status_code == 200
        result = side.json()
        image_response = await client.get(result["productUrl"], headers=headers)
        diff = await client.get(f"/api/visualization/sessions/{session['sessionId']}/compare",
            params={**params, "mode": "difference", "include_difference": "false"}, headers=headers)
        diff_image = await client.get(diff.json()["productUrl"], headers=headers)
    assert image_response.status_code == 200 and diff_image.status_code == 200
    assert result["statistics"]["positivePixelCount"] > 0
    assert result["statistics"]["negativePixelCount"] == 0
    assert result["statistics"]["nearZeroPixelCount"] > 0
    with MemoryFile(image_response.content) as memory, memory.open() as image:
        assert image.width == 32 * 3
        assert image.height == 32
    with MemoryFile(diff_image.content) as memory, memory.open() as image:
        rgba = image.read()
        assert image.width == 32 and image.count == 4
        assert np.any(rgba[0] > rgba[2])
    products = list((cfg.resolved_visualization_temp_dir / session["sessionId"] / "comparisons").glob("*.png"))
    assert len(products) == 2
    assert not list(cfg.resolved_data_dir.rglob("*.png"))
    assert before_hashes == [hashlib.sha256(path.read_bytes()).hexdigest() for path in source_paths]


@pytest.mark.asyncio
async def test_sessions_are_owner_scoped_and_delete_only_their_workspace(configured_data):
    cfg = configured_data
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=main.app), base_url="http://test") as client:
        first = await create_session(client)
        second = await create_session(client)
        denied = await client.delete(f"/api/visualization/sessions/{first['sessionId']}", headers=auth(second))
        assert denied.status_code == 403
        first_dir = cfg.resolved_visualization_temp_dir / first["sessionId"]
        second_dir = cfg.resolved_visualization_temp_dir / second["sessionId"]
        (first_dir / "rgb" / "scratch.tmp").write_bytes(b"first")
        (second_dir / "rgb" / "scratch.tmp").write_bytes(b"second")
        deleted = await client.delete(f"/api/visualization/sessions/{first['sessionId']}", headers=auth(first))
    assert deleted.status_code == 200
    assert not first_dir.exists()
    assert (second_dir / "rgb" / "scratch.tmp").read_bytes() == b"second"
    assert (cfg.resolved_data_dir / "studies" / STUDY_ID / "study.geojson").is_file()


def test_ttl_cleanup_removes_only_abandoned_session_workspaces(configured_data):
    cfg = configured_data
    root = cfg.resolved_visualization_temp_dir
    from app.visualization_sessions import create_session
    expired = create_session(root, STUDY_ID, 3600, 8)
    active = create_session(root, STUDY_ID, 3600, 8)
    expired_dir = root / expired["sessionId"]
    metadata_path = expired_dir / "session.json"
    metadata = json.loads(metadata_path.read_text())
    metadata["lastActivityAt"] = (datetime.now(timezone.utc) - timedelta(hours=2)).isoformat()
    metadata_path.write_text(json.dumps(metadata))
    assert cleanup_expired_sessions(root, 3600) == 1
    assert not expired_dir.exists()
    assert (root / active["sessionId"]).exists()
    assert (cfg.resolved_data_dir / "studies" / STUDY_ID / "study.geojson").is_file()


@pytest.mark.asyncio
async def test_invalid_layer_is_rejected_and_catalog_needs_no_processing_session(configured_data):
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=main.app), base_url="http://test") as client:
        session = await create_session(client)
        result = await client.get(f"/api/visualization/sessions/{session['sessionId']}/rgb/G111-ASF?red=HHHH&green=ABSENT&blue=VVVV", headers=auth(session))
    assert result.status_code == 422


@pytest.mark.asyncio
async def test_session_and_storage_limits_are_enforced(configured_data):
    cfg = configured_data
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=main.app), base_url="http://test") as client:
        first = await create_session(client)
        cfg.visualization_max_sessions = 1
        over_limit = await client.post("/api/visualization/sessions", json={"studyId": STUDY_ID})
        assert over_limit.status_code == 429

        cfg.visualization_max_storage_bytes = 1
        image = await client.get(
            f"/api/visualization/sessions/{first['sessionId']}/rgb/G111-ASF?red=frequencyA%3AHHHH&green=frequencyA%3AHVHV&blue=frequencyA%3AVVVV",
            headers=auth(first),
        )
    assert image.status_code == 413
    session_dir = cfg.resolved_visualization_temp_dir / first["sessionId"]
    assert not list((session_dir / "rgb").glob("*.png"))
