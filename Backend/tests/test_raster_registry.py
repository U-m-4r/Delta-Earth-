import json

import httpx
import numpy as np
import pytest
import rasterio
from rasterio.transform import from_origin

from app import harmony, main
from app.raster_registry import generate_preview, persist_processed_raster, query_registry, rebuild_registry
from app.settings import Settings


STUDY_ID = "1234567890abcdef"
FEATURE = {"type": "Feature", "properties": {}, "geometry": {"type": "Polygon", "coordinates": [
    [[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]]
]}}


def make_raster(path, values, *, transform=None, nodata=float("nan")):
    path.parent.mkdir(parents=True, exist_ok=True)
    array = np.asarray(values, dtype="float32")
    with rasterio.open(path, "w", driver="GTiff", width=array.shape[1], height=array.shape[0], count=1,
                       dtype="float32", crs="EPSG:4326", transform=transform or from_origin(0, array.shape[0], 1, 1),
                       nodata=nodata, tiled=True, blockxsize=16, blockysize=16) as dataset:
        dataset.write(array, 1)
    return path


@pytest.fixture
def stored_raster(tmp_path):
    source = make_raster(tmp_path / "source.tif", [[1, 2], [3, 4]])
    entry = persist_processed_raster(tmp_path, STUDY_ID, "G123-ASF",
        {"id": "G123-ASF", "title": "NISAR test", "acquiredAt": "2026-10-15T12:00:00Z",
         "productType": "GCOV", "provider": "ASF"}, "HHHH", source, FEATURE)
    return tmp_path, source, entry


def test_persistence_is_atomic_manifest_registered_and_queryable(stored_raster):
    root, _, entry = stored_raster
    observation_dir = root / "studies" / STUDY_ID / "observations" / "G123-ASF"
    raster_path = observation_dir / "rasters" / "HHHH.tif"
    manifest_path = observation_dir / "manifest.json"
    assert raster_path.is_file() and raster_path.stat().st_size > 0
    assert manifest_path.is_file()
    assert not list(observation_dir.rglob("*.tmp"))
    assert entry["rasterPath"] == "studies/1234567890abcdef/observations/G123-ASF/rasters/HHHH.tif"
    assert entry["raster"]["boundsWgs84"] == [0.0, 0.0, 2.0, 2.0]
    manifest = json.loads(manifest_path.read_text())
    assert manifest["studyId"] == STUDY_ID
    assert manifest["observationId"] == "G123-ASF"
    assert manifest["acquisitionDate"].startswith("2026-10-15")
    assert manifest["variables"][0]["rasterAvailable"] is True
    assert len(query_registry(root, STUDY_ID, observation_id="G123-ASF", variable="HHHH")) == 1
    assert len(query_registry(root, STUDY_ID, acquisition_date="2026-10-15", variable="HHHH")) == 1
    assert query_registry(root, STUDY_ID, acquisition_date="2026-10-16") == []


def test_valid_raster_is_not_overwritten_and_registry_rebuild_survives_restart(stored_raster):
    root, _, _ = stored_raster
    destination = root / "studies" / STUDY_ID / "observations" / "G123-ASF" / "rasters" / "HHHH.tif"
    replacement = make_raster(root / "replacement.tif", [[90, 90], [90, 90]])
    first_bytes = destination.read_bytes()
    persist_processed_raster(root, STUDY_ID, "G123-ASF", {"acquiredAt": "2026-10-15"}, "HHHH", replacement, FEATURE)
    assert destination.read_bytes() == first_bytes

    (root / "raster_registry.json").unlink()
    rebuilt = rebuild_registry(root)
    assert len(rebuilt) == 1
    # A fresh registry query reads the on-disk index, not in-memory application state.
    assert query_registry(root, STUDY_ID)[0]["variable"] == "HHHH"
    with rasterio.open(destination) as dataset:
        np.testing.assert_array_equal(dataset.read(1), [[1, 2], [3, 4]])


def test_granule_raster_is_scoped_when_existing_output_belongs_to_another_study(tmp_path):
    granule_dir = tmp_path / "granules" / "G123-ASF"
    shared = make_raster(granule_dir / "measurements" / "HHHH.tif", [[1]])
    other_study = "fedcba0987654321"
    manifest = granule_dir / "metadata.json"
    manifest.write_text(json.dumps({"studyArea": f"study_areas/{other_study}.geojson"}))

    current = harmony._raster_output_path(tmp_path, granule_dir, STUDY_ID, "measurements", "HHHH")
    same_study = harmony._raster_output_path(tmp_path, granule_dir, other_study, "measurements", "HHHH")

    assert current == tmp_path / "studies" / STUDY_ID / "observations" / "G123-ASF" / "rasters" / "HHHH.tif"
    assert same_study == shared


@pytest.mark.asyncio
async def test_processed_observations_and_visualization_read_only_local_outputs(monkeypatch, stored_raster):
    root, source, _ = stored_raster
    monkeypatch.setattr(main, "settings", Settings(data_dir=root))

    async def forbidden_harmony(*args, **kwargs):
        raise AssertionError("visualization must never call Harmony")

    monkeypatch.setattr(main, "refresh_job_status", forbidden_harmony)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=main.app), base_url="http://test") as client:
        response = await client.get(f"/api/study-areas/{STUDY_ID}/processed-observations")
        raster_response = await client.get(f"/api/visualization/{STUDY_ID}/raster/G123-ASF/HHHH")
        preview_response = await client.get(f"/api/visualization/{STUDY_ID}/preview/G123-ASF/HHHH")
        pixel_response = await client.get(f"/api/studies/{STUDY_ID}/observations/G123-ASF/pixel?longitude=0.5&latitude=1.5&variable=HHHH")

    assert response.status_code == 200
    body = response.json()
    assert len(body["observations"]) == 1
    observation = body["observations"][0]
    assert observation["id"] == "G123-ASF"
    assert observation["processingStatus"] == "processed"
    assert observation["variables"][0]["name"] == "HHHH"
    assert observation["raster"]["boundsWgs84"] == [0, 0, 2, 2]
    assert raster_response.status_code == 200 and raster_response.content == source.read_bytes()
    assert preview_response.status_code == 200 and preview_response.content.startswith(b"\x89PNG\r\n\x1a\n")
    assert pixel_response.status_code == 200 and pixel_response.json()["value"] == 1


@pytest.mark.asyncio
async def test_missing_and_corrupt_rasters_are_not_reported_as_available(monkeypatch, stored_raster):
    root, _, _ = stored_raster
    monkeypatch.setattr(main, "settings", Settings(data_dir=root))
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=main.app), base_url="http://test") as client:
        missing = await client.get(f"/api/visualization/{STUDY_ID}/raster/G123-ASF/HVHV")
        corrupt_path = root / "studies" / STUDY_ID / "observations" / "G123-ASF" / "rasters" / "HHHH.tif"
        corrupt_path.unlink()
        corrupt_path.write_bytes(b"not a GeoTIFF")
        listing = await client.get(f"/api/study-areas/{STUDY_ID}/processed-observations")
        corrupt = await client.get(f"/api/visualization/{STUDY_ID}/raster/G123-ASF/HHHH")

    assert missing.status_code == 404
    assert listing.status_code == 200 and listing.json()["observations"] == []
    assert corrupt.status_code == 404


def test_empty_or_nonfinite_only_raster_is_not_registered(tmp_path):
    source = make_raster(tmp_path / "empty.tif", [[float("nan"), float("inf")]])
    with pytest.raises(ValueError, match="no finite, valid pixels"):
        persist_processed_raster(tmp_path, STUDY_ID, "GEMPTY-ASF", {}, "HHHH", source, FEATURE)
    assert query_registry(tmp_path, STUDY_ID) == []


def test_large_raster_preview_is_downsampled_and_cached(tmp_path):
    source = make_raster(tmp_path / "large.tif", np.arange(2048 * 1536, dtype="float32").reshape(1536, 2048))
    preview = generate_preview(tmp_path, source, "preview.png", max_dimension=512)
    first_mtime = preview.stat().st_mtime_ns
    with rasterio.open(preview) as dataset:
        assert max(dataset.width, dataset.height) <= 512
    assert generate_preview(tmp_path, source, "preview.png", max_dimension=512) == preview
    assert preview.stat().st_mtime_ns == first_mtime


@pytest.mark.asyncio
async def test_change_preview_and_comparison_require_compatible_saved_inputs(monkeypatch, stored_raster):
    root, _, _ = stored_raster
    source = make_raster(root / "second.tif", [[2, 4], [6, 8]])
    persist_processed_raster(root, STUDY_ID, "G456-ASF", {"acquiredAt": "2026-10-16"}, "HHHH", source, FEATURE)
    monkeypatch.setattr(main, "settings", Settings(data_dir=root))
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=main.app), base_url="http://test") as client:
        comparison = await client.get(f"/api/studies/{STUDY_ID}/compare?baseline=G123-ASF&current=G456-ASF&variable=HHHH")
        difference = await client.get(f"/api/visualization/{STUDY_ID}/difference/G123-ASF/G456-ASF/HHHH")

    assert comparison.status_code == 200
    assert comparison.json()["meanDifference"] == 2.5
    assert difference.status_code == 200 and difference.content.startswith(b"\x89PNG\r\n\x1a\n")


@pytest.mark.asyncio
async def test_comparison_rejects_different_grids(monkeypatch, stored_raster):
    root, _, _ = stored_raster
    shifted = make_raster(root / "shifted.tif", [[1, 1], [1, 1]], transform=from_origin(1, 2, 1, 1))
    persist_processed_raster(root, STUDY_ID, "G789-ASF", {"acquiredAt": "2026-10-17"}, "HHHH", shifted, FEATURE)
    monkeypatch.setattr(main, "settings", Settings(data_dir=root))
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=main.app), base_url="http://test") as client:
        response = await client.get(f"/api/studies/{STUDY_ID}/compare?baseline=G123-ASF&current=G789-ASF&variable=HHHH")
    assert response.status_code == 409
