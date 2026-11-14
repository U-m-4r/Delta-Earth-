import numpy as np
import httpx
import rasterio
import pytest
import respx
import json
from pydantic import SecretStr
from rasterio.transform import from_origin

from app import harmony
from app.harmony import _clip_raster_to_polygon
from app.settings import Settings


@pytest.mark.asyncio
async def test_bbox_mode_submits_supported_axes_with_bearer_auth(monkeypatch, tmp_path):
    cfg = Settings(
        harmony_base_url="https://harmony.earthdata.nasa.gov",
        nisar_gcov_collection="C2854338529-ASF",
        edl_token=SecretStr("test-secret"),
    )
    monkeypatch.setattr(harmony, "get_settings", lambda: cfg)
    endpoint = "https://harmony.earthdata.nasa.gov/C2854338529-ASF/ogc-api-coverages/1.0.0/collections/%2Fscience%2FLSAR%2FGCOV%2Fgrids%2FfrequencyA%2FHHHH/coverage/rangeset"
    feature = {"type": "Feature", "geometry": {"type": "Polygon", "coordinates": [[
        [-1, 2], [3, 2], [3, 5], [-1, 5], [-1, 2],
    ]]}}
    record_path = tmp_path / "submitted-job.json"
    with respx.mock(assert_all_called=True) as router:
        route = router.get(endpoint).mock(return_value=httpx.Response(303, headers={"Location": f"{cfg.harmony_base_url}/jobs/test-job"}))
        async with httpx.AsyncClient(follow_redirects=True) as client:
            job_id, immediate, error = await harmony._submit_variable(
                client, cfg.nisar_gcov_collection, "G123-ASF", "/science/LSAR/GCOV/grids/frequencyA/HHHH", feature, "bbox", record_path=record_path
            )
    request = route.calls.last.request
    assert job_id == "test-job"
    assert immediate is None and error is None
    assert request.headers["Authorization"] == "Bearer test-secret"
    assert request.url.params.get_list("subset") == ["lat(2.0:5.0)", "lon(-1.0:3.0)"]
    assert request.url.params.get("granuleId") == "G123-ASF"
    assert request.url.params.get("variable") is None
    record = json.loads(record_path.read_text())
    assert record["state"] == "submitted"
    assert record["jobId"] == "test-job"
    assert record["httpStatus"] == 303
    assert record["durationSeconds"] >= 0
    assert len(route.calls) == 1
    record_path.unlink()


@pytest.mark.asyncio
async def test_ambiguous_submission_timeout_is_persisted_and_never_retried(monkeypatch, tmp_path):
    cfg = Settings(harmony_base_url="https://harmony.earthdata.nasa.gov", edl_token=SecretStr("test-secret"))
    monkeypatch.setattr(harmony, "get_settings", lambda: cfg)
    feature = {"type": "Feature", "geometry": {"type": "Polygon", "coordinates": [[
        [-1, 2], [3, 2], [3, 5], [-1, 5], [-1, 2],
    ]]}}
    record_path = tmp_path / "job.json"
    calls = 0

    def handler(request):
        nonlocal calls
        calls += 1
        raise httpx.ReadTimeout("timed out", request=request)

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        with pytest.raises(harmony.HarmonySubmissionUnknownError, match="was not resubmitted"):
            await harmony._submit_variable(client, "C2854338529-ASF", "G123-ASF", "/science/LSAR/GCOV/grids/frequencyA/HHHH", feature, "bbox", record_path=record_path)
        with pytest.raises(harmony.HarmonySubmissionUnknownError, match="was not resubmitted"):
            await harmony._submit_variable(client, "C2854338529-ASF", "G123-ASF", "/science/LSAR/GCOV/grids/frequencyA/HHHH", feature, "bbox", record_path=record_path)

    record = json.loads(record_path.read_text())
    assert calls == 1
    assert record["state"] == "submission_unknown"
    assert record["retryAllowed"] is False
    assert record["errorType"] == "ReadTimeout"


@pytest.mark.asyncio
async def test_stac_catalog_resolves_relative_item_and_asset_links(monkeypatch):
    cfg = Settings(harmony_base_url="https://harmony.earthdata.nasa.gov", edl_token=SecretStr("test-secret"))
    monkeypatch.setattr(harmony, "get_settings", lambda: cfg)
    catalog_url = f"{cfg.harmony_base_url}/stac/job-123"
    item_url = f"{cfg.harmony_base_url}/stac/job-123/0"
    with respx.mock(assert_all_called=True) as router:
        router.get(catalog_url).mock(return_value=httpx.Response(200, json={
            "type": "Catalog", "links": [{"rel": "item", "href": "./0"}],
        }))
        router.get(item_url).mock(return_value=httpx.Response(200, json={
            "type": "Feature", "assets": {"data": {"href": "./result.tif", "type": "image/tiff"}},
        }))
        async with httpx.AsyncClient() as client:
            assets = await harmony._stac_assets(client, "job-123")
    assert assets == [{"href": f"{cfg.harmony_base_url}/stac/job-123/result.tif", "title": None, "mediaType": "image/tiff"}]


@pytest.mark.asyncio
async def test_s3_stac_asset_uses_https_job_data_link(monkeypatch):
    cfg = Settings(harmony_base_url="https://harmony.earthdata.nasa.gov", edl_token=SecretStr("test-secret"))
    monkeypatch.setattr(harmony, "get_settings", lambda: cfg)
    catalog_url = f"{cfg.harmony_base_url}/stac/job-123"
    item_url = f"{catalog_url}/0"
    result_url = f"{cfg.harmony_base_url}/service-results/harmony-prod-staging/public/job-123/456/result.tif"
    with respx.mock(assert_all_called=True) as router:
        router.get(catalog_url).mock(return_value=httpx.Response(200, json={
            "type": "Catalog", "links": [{"rel": "item", "href": "./0"}],
        }))
        router.get(item_url).mock(return_value=httpx.Response(200, json={
            "type": "Feature", "assets": {"data": {
                "href": "s3://harmony-prod-staging/public/job-123/456/result.tif",
                "title": "result.tif", "type": "image/tiff",
            }},
        }))
        async with httpx.AsyncClient() as client:
            assets = await harmony._stac_assets(client, "job-123", job_response={"links": [
                {"rel": "data", "href": result_url, "title": "result.tif", "type": "image/tiff"},
            ]})
    assert assets[0]["href"] == result_url
    assert assets[0]["mediaType"] == "image/tiff"


def test_local_polygon_clip_keeps_inside_values_and_masks_outside(tmp_path):
    source = tmp_path / "bbox.tif"
    output = tmp_path / "polygon.tif"
    values = np.arange(1, 17, dtype="float32").reshape((4, 4))
    with rasterio.open(
        source, "w", driver="GTiff", width=4, height=4, count=1,
        dtype="float32", crs="EPSG:4326", transform=from_origin(0, 4, 1, 1),
    ) as dataset:
        dataset.write(values, 1)

    feature = {"type": "Feature", "properties": {}, "geometry": {"type": "Polygon", "coordinates": [[
        [0.1, 0.1], [2.1, 0.1], [2.1, 2.1], [0.1, 2.1], [0.1, 0.1],
    ]]}}
    _clip_raster_to_polygon(source, feature, output)

    with rasterio.open(output) as dataset:
        clipped = dataset.read(1, masked=True)
        assert dataset.crs.to_string() == "EPSG:4326"
        assert clipped.count() > 0
        assert np.ma.getmaskarray(clipped).any()
        assert set(clipped.compressed()).issubset(set(values.ravel()))
