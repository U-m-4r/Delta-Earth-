import json

import httpx
import numpy as np
import pytest
import rasterio
from rasterio.transform import from_origin
from pydantic import SecretStr

from app import harmony, main
from app.settings import Settings


@pytest.mark.parametrize("value", [float("nan"), float("inf"), float("-inf")])
def test_json_safe_maps_non_finite_values_to_null(value):
    converted = harmony.json_safe({"outer": [{"nodata": value}]})
    assert converted == {"outer": [{"nodata": None}]}
    json.dumps(converted, allow_nan=False)


def test_json_safe_preserves_finite_nodata():
    assert harmony.json_safe({"nodata": -9999.0}) == {"nodata": -9999.0}


def test_raster_metadata_preserves_nan_nodata_fact_without_changing_pixels(tmp_path):
    path = tmp_path / "nan-nodata.tif"
    pixels = np.array([[1.0, 2.0], [3.0, 4.0]], dtype="float32")
    with rasterio.open(path, "w", driver="GTiff", width=2, height=2, count=1,
                       dtype="float32", crs="EPSG:4326", transform=from_origin(0, 2, 1, 1),
                       nodata=float("nan")) as dataset:
        dataset.write(pixels, 1)

    metadata = harmony._validate_raster(path)
    assert metadata["nodata"] is None
    assert metadata["nodataNonFinite"] == "nan"
    with rasterio.open(path) as dataset:
        np.testing.assert_array_equal(dataset.read(1), pixels)
        assert np.isnan(dataset.nodata)


@pytest.mark.asyncio
async def test_extraction_api_response_serializes_nested_raster_metadata_strictly(monkeypatch, tmp_path):
    cfg = Settings(edl_token=SecretStr("test-token"), data_dir=tmp_path)
    monkeypatch.setattr(main, "settings", cfg)

    async def extraction(*args, **kwargs):
        return {"granuleId": "G123-ASF", "variables": [{"variable": "HHHH", "status": "downloaded",
                "raster": {"nodata": float("nan"), "bounds": [0.0, float("inf"), 2.0, 3.0],
                           "nodataNonFinite": "nan"}}]}

    monkeypatch.setattr(main, "extract_granule", extraction)
    payload = {"granuleId": "G123-ASF", "studyArea": {"type": "Feature", "properties": {},
               "geometry": {"type": "Polygon", "coordinates": [[[0, 0], [1, 0], [1, 1], [0, 0]]] }},
               "variables": ["HHHH"], "frequency": "frequencyA"}
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=main.app), base_url="http://test") as client:
        response = await client.post("/api/nisar/extractions", json=payload)

    assert response.status_code == 200
    result = response.json()
    assert result["variables"][0]["raster"] == {
        "nodata": None, "bounds": [0.0, None, 2.0, 3.0], "nodataNonFinite": "nan"
    }
    json.dumps(result, allow_nan=False)


@pytest.mark.asyncio
async def test_retry_reuses_existing_raster_without_submitting_or_downloading(monkeypatch, tmp_path):
    cfg = Settings(edl_token=SecretStr("test-token"), data_dir=tmp_path)
    monkeypatch.setattr(harmony, "get_settings", lambda: cfg)

    async def capabilities():
        return {"variableSubset": True, "spatialSubsetMode": "bbox"}

    monkeypatch.setattr(harmony, "inspect_capabilities", capabilities)
    async def forbidden_submit(*args, **kwargs):
        raise AssertionError("existing output must not submit a new Harmony job")

    monkeypatch.setattr(harmony, "_submit_variable", forbidden_submit)
    feature = {"type": "Feature", "properties": {}, "geometry": {"type": "Polygon", "coordinates": [
        [[0, 0], [1, 0], [1, 1], [0, 0]]
    ]}}
    granule_dir = tmp_path / "granules" / "G123-ASF"
    measurement_dir = granule_dir / "measurements"
    measurement_dir.mkdir(parents=True)
    output = measurement_dir / "HHHH.tif"
    with rasterio.open(output, "w", driver="GTiff", width=2, height=2, count=1,
                       dtype="float32", crs="EPSG:4326", transform=from_origin(0, 2, 1, 1),
                       nodata=float("nan")) as dataset:
        dataset.write(np.array([[1, 2], [3, 4]], dtype="float32"), 1)
    (granule_dir / "metadata.json").write_text(json.dumps({"variables": [{"variable": "HHHH", "jobId": "existing-job"}]}))

    result = await harmony.extract_granule("G123-ASF", feature, ["HHHH"])

    assert result["variables"][0]["status"] == "already_present"
    assert result["variables"][0]["jobId"] == "existing-job"
    assert result["variables"][0]["raster"]["nodata"] is None
    persisted = json.loads((granule_dir / "metadata.json").read_text())
    json.dumps(persisted, allow_nan=False)
