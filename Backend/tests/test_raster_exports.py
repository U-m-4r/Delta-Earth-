import json
import zipfile

import numpy as np
import rasterio
from rasterio.transform import from_origin

from app.raster_exports import RasterExportError, create_change_export, create_timeline_export


STUDY = "0123456789abcdef"


def _fixture(tmp_path):
    data_root = tmp_path / "data"
    session = tmp_path / "session"
    session.mkdir()
    (session / "exports").mkdir()
    (session / "comparisons").mkdir()
    entries = []
    transform = from_origin(500000, 4100000, 30, 30)
    for index, (granule, date, value) in enumerate((
        ("G0000000001-ASF", "2026-10-15T00:00:00Z", 2.0),
        ("G0000000002-ASF", "2026-10-24T00:00:00Z", 5.0),
    )):
        relative = f"rasters/{granule}.tif"
        path = data_root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        values = np.full((8, 10), value, dtype="float32")
        values[0, 0] = -9999
        with rasterio.open(path, "w", driver="GTiff", width=10, height=8, count=1,
                           dtype="float32", crs="EPSG:32643", transform=transform, nodata=-9999) as ds:
            ds.write(values, 1)
            ds.update_tags(1, units="dB", calibration="gamma0")
        entries.append({"studyId": STUDY, "observationId": granule, "variable": "HVHV",
            "sourceVariable": "HVHV", "frequency": "frequencyA", "acquisitionDate": date,
            "acquisitionMetadata": {"productType": "GCOV"}, "rasterPath": relative,
            "raster": {"units": "dB", "calibration": "gamma0"}})
    data_root.mkdir(parents=True, exist_ok=True)
    (data_root / "raster_registry.json").write_text(json.dumps({"version": 1, "rasters": entries}))
    return data_root, session, entries


def _ref(entry):
    return {"observationId": entry["observationId"], "sourceVariable": entry["sourceVariable"],
            "frequency": entry["frequency"]}


def test_change_export_is_right_minus_left_and_preserves_nodata(tmp_path):
    data_root, session, entries = _fixture(tmp_path)
    result = create_change_export(data_root, session, STUDY, _ref(entries[0]), _ref(entries[1]),
                                  20_000_000, 1024)
    assert result["statistics"]["operation"] == "right_minus_left"
    assert result["statistics"]["meanDifference"] == 3.0
    assert result["statistics"]["validOverlappingPixelCount"] == 79
    assert "2026_10_15_vs_2026_10_24" in result["downloadFilename"]
    with zipfile.ZipFile(session / "exports" / f"{result['downloadId']}.zip") as archive:
        assert set(archive.namelist()) == {"difference.tif", "change.png", "change_statistics.json"}
        archive.extract("difference.tif", tmp_path / "unpacked")
        stats = json.loads(archive.read("change_statistics.json"))
        assert stats["leftGranuleId"] == entries[0]["observationId"]
        assert stats["rightGranuleId"] == entries[1]["observationId"]
    with rasterio.open(tmp_path / "unpacked/difference.tif") as ds:
        values = ds.read(1, masked=True)
        assert ds.crs.to_string() == "EPSG:32643"
        assert values[1, 1] == 3
        assert values.mask[0, 0]


def test_timeline_export_contains_gif_pdf_and_metadata(tmp_path):
    data_root, session, entries = _fixture(tmp_path)
    result = create_timeline_export(data_root, session, STUDY, [_ref(item) for item in entries],
        {"palette": "viridis", "minimum": 0, "maximum": 10, "lowerPercentile": 2,
         "upperPercentile": 98, "stretch": "linear", "bands": 0}, 20_000_000, 1024)
    with zipfile.ZipFile(result["path"]) as archive:
        assert set(archive.namelist()) == {"timeline.gif", "timeline_report.pdf", "timeline_metadata.json"}
        gif = archive.read("timeline.gif")
        assert gif[:6] == b"GIF89a"
        assert gif[-1:] == b";"
        gif_path = tmp_path / "timeline.gif"
        gif_path.write_bytes(gif)
        with rasterio.open(gif_path) as animation:
            assert animation.width >= 320
            assert animation.height == 44
            assert animation.count == 2
            assert animation.read(1).size > 0
        assert archive.read("timeline_report.pdf").startswith(b"%PDF-1.4")
        metadata = json.loads(archive.read("timeline_metadata.json"))
        assert metadata["changeStatistics"][0]["meanDifference"] == 3.0
        assert metadata["changeStatistics"][0]["validOverlappingPixelCount"] == 79


def test_change_export_rejects_incompatible_units(tmp_path):
    data_root, session, entries = _fixture(tmp_path)
    entries[1]["raster"]["units"] = "linear power"
    (data_root / "raster_registry.json").write_text(json.dumps({"version": 1, "rasters": entries}))
    try:
        create_change_export(data_root, session, STUDY, _ref(entries[0]), _ref(entries[1]),
                             20_000_000, 1024)
    except RasterExportError as error:
        assert "matching, known measurement units" in str(error)
    else:
        raise AssertionError("Incompatible measurement units must be rejected")

