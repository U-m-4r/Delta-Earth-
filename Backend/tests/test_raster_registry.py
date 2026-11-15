import json

import numpy as np
import pytest
import rasterio
from rasterio.transform import from_origin

from app import harmony
from app.raster_registry import persist_processed_raster, query_registry, rebuild_registry


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


def test_persistence_is_atomic_manifest_registered_and_queryable(tmp_path):
    source = make_raster(tmp_path / "source.tif", [[1, 2], [3, 4]])
    entry = persist_processed_raster(tmp_path, STUDY_ID, "G123-ASF",
        {"id": "G123-ASF", "title": "NISAR test", "acquiredAt": "2026-10-15T12:00:00Z",
         "productType": "GCOV", "provider": "ASF"}, "HHHH", source, FEATURE)
    observation_dir = tmp_path / "studies" / STUDY_ID / "observations" / "G123-ASF"
    raster_path = observation_dir / "rasters" / "HHHH.tif"
    manifest_path = observation_dir / "manifest.json"
    assert raster_path.is_file() and raster_path.stat().st_size > 0
    assert manifest_path.is_file()
    assert not list(observation_dir.rglob("*.tmp"))
    assert not list(observation_dir.rglob("*.png"))
    assert entry["rasterPath"] == "studies/1234567890abcdef/observations/G123-ASF/rasters/HHHH.tif"
    assert entry["raster"]["boundsWgs84"] == [0.0, 0.0, 2.0, 2.0]
    manifest = json.loads(manifest_path.read_text())
    assert manifest["studyId"] == STUDY_ID
    assert manifest["observationId"] == "G123-ASF"
    assert manifest["acquisitionDate"].startswith("2026-10-15")
    assert manifest["variables"][0]["rasterAvailable"] is True
    assert "previewPath" not in manifest["variables"][0]
    assert len(query_registry(tmp_path, STUDY_ID, observation_id="G123-ASF", variable="HHHH")) == 1
    assert len(query_registry(tmp_path, STUDY_ID, acquisition_date="2026-10-15", variable="HHHH")) == 1
    assert query_registry(tmp_path, STUDY_ID, acquisition_date="2026-10-16") == []


def test_same_polarization_is_persisted_separately_by_frequency(tmp_path):
    for frequency, value in (("frequencyA", 1), ("frequencyB", 2)):
        raster = make_raster(tmp_path / f"{frequency}.tif", [[value, value], [value, value]])
        persist_processed_raster(tmp_path, STUDY_ID, "G123-ASF", {"acquiredAt": "2026-10-15T12:00:00Z",
            "frequency": frequency}, "HHHH", raster, FEATURE, frequency=frequency)
    frequency_a = query_registry(tmp_path, STUDY_ID, observation_id="G123-ASF", variable="HHHH", frequency="frequencyA")[0]
    frequency_b = query_registry(tmp_path, STUDY_ID, observation_id="G123-ASF", variable="HHHH", frequency="frequencyB")[0]
    assert frequency_a["rasterPath"] != frequency_b["rasterPath"]
    assert (tmp_path / frequency_a["rasterPath"]).is_file()
    assert (tmp_path / frequency_b["rasterPath"]).is_file()
    assert len(json.loads((tmp_path / "studies" / STUDY_ID / "observations" / "G123-ASF" / "manifest.json").read_text())["variables"]) == 2


def test_valid_raster_is_not_overwritten_and_registry_rebuild_survives_restart(tmp_path):
    source = make_raster(tmp_path / "source.tif", [[1, 2], [3, 4]])
    persist_processed_raster(tmp_path, STUDY_ID, "G123-ASF", {"acquiredAt": "2026-10-15"}, "HHHH", source, FEATURE)
    destination = tmp_path / "studies" / STUDY_ID / "observations" / "G123-ASF" / "rasters" / "HHHH.tif"
    replacement = make_raster(tmp_path / "replacement.tif", [[90, 90], [90, 90]])
    first_bytes = destination.read_bytes()
    persist_processed_raster(tmp_path, STUDY_ID, "G123-ASF", {"acquiredAt": "2026-10-15"}, "HHHH", replacement, FEATURE)
    assert destination.read_bytes() == first_bytes

    (tmp_path / "raster_registry.json").unlink()
    assert len(rebuild_registry(tmp_path)) == 1
    assert query_registry(tmp_path, STUDY_ID)[0]["variable"] == "HHHH"
    with rasterio.open(destination) as dataset:
        np.testing.assert_array_equal(dataset.read(1), [[1, 2], [3, 4]])


def test_different_studies_receive_isolated_raster_paths(tmp_path):
    first_source = make_raster(tmp_path / "first.tif", [[1]])
    second_source = make_raster(tmp_path / "second.tif", [[2]])
    persist_processed_raster(tmp_path, STUDY_ID, "G123-ASF", {}, "HHHH", first_source, FEATURE)
    other_study = "fedcba0987654321"
    persist_processed_raster(tmp_path, other_study, "G123-ASF", {}, "HHHH", second_source, FEATURE)
    first_path = tmp_path / query_registry(tmp_path, STUDY_ID)[0]["rasterPath"]
    second_path = tmp_path / query_registry(tmp_path, other_study)[0]["rasterPath"]
    assert first_path != second_path
    with rasterio.open(first_path) as first, rasterio.open(second_path) as second:
        assert first.read(1)[0, 0] == 1
        assert second.read(1)[0, 0] == 2


def test_granule_raster_is_scoped_when_existing_output_belongs_to_another_study(tmp_path):
    granule_dir = tmp_path / "granules" / "G123-ASF"
    shared = make_raster(granule_dir / "measurements" / "HHHH.tif", [[1]])
    other_study = "fedcba0987654321"
    (granule_dir / "metadata.json").write_text(json.dumps({"studyArea": f"study_areas/{other_study}.geojson"}))
    current = harmony._raster_output_path(tmp_path, granule_dir, STUDY_ID, "measurements", "HHHH")
    same_study = harmony._raster_output_path(tmp_path, granule_dir, other_study, "measurements", "HHHH")
    assert current == tmp_path / "studies" / STUDY_ID / "observations" / "G123-ASF" / "rasters" / "HHHH.tif"
    assert same_study == shared


def test_empty_or_nonfinite_only_raster_is_not_registered(tmp_path):
    source = make_raster(tmp_path / "empty.tif", [[float("nan"), float("inf")]])
    with pytest.raises(ValueError, match="no finite, valid pixels"):
        persist_processed_raster(tmp_path, STUDY_ID, "GEMPTY-ASF", {}, "HHHH", source, FEATURE)
    assert query_registry(tmp_path, STUDY_ID) == []
