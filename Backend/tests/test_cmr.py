import json

import httpx
import pytest
import respx
from shapely.geometry import Polygon

from app.cmr import _normalized_geojson, _record, normalize_cmr_polygon, search_granules


def test_cmr_record_keeps_catalog_provenance_without_downloading_source():
    entry = {
        "id": "G123-ASF", "producer_granule_id": "NISAR_L2_GCOV_TEST_frequencyA_HHHH",
        "time_start": "2025-03-01T00:00:00.000Z", "time_end": "2025-03-01T00:01:00.000Z",
        "collection_concept_id": "C2854338529-ASF", "data_center": "ASF DAAC",
        "links": [{"href": "https://example.test/file.h5", "rel": "http://esipfed.org/ns/fedsearch/1.1/data#", "title": "Download file", "type": "application/x-hdf5"}],
    }
    record = _record(entry)
    assert record["id"] == "G123-ASF"
    assert record["productType"] == "GCOV"
    assert record["frequencies"] == ["frequencyA"]
    assert record["polarizations"] == ["HHHH"]
    assert record["downloadUrl"] == "https://example.test/file.h5"
    assert record["assets"][0]["mediaType"] == "application/x-hdf5"


@pytest.mark.asyncio
async def test_scene_search_maps_mocked_cmr_feed():
    url = "https://cmr.earthdata.nasa.gov/search/granules.json"
    payload = {"feed": {"hits": 1, "entry": [{
        "id": "G123-ASF", "producer_granule_id": "NISAR_L2_GCOV_TEST_HHHH",
        "time_start": "2025-03-01T00:00:00.000Z", "links": [],
    }]}}
    with respx.mock(assert_all_called=True) as router:
        route = router.get(url).mock(return_value=httpx.Response(200, json=payload))
        result = await search_granules(Polygon([(-1, 0), (1, 0), (1, 1), (-1, 1), (-1, 0)]), page_size=20)
    assert route.called
    assert route.calls.last.request.url.params["collection_concept_id"] == "C2854338529-ASF"
    assert route.calls.last.request.url.params["polygon"] == "-1.0,0.0,1.0,0.0,1.0,1.0,-1.0,1.0,-1.0,0.0"
    assert result["hits"] == 1
    assert result["observations"][0]["id"] == "G123-ASF"


@pytest.mark.asyncio
async def test_polygon_with_hole_uses_geojson_post_without_dropping_ring():
    polygon = Polygon(
        [(0, 0), (4, 0), (4, 4), (0, 4), (0, 0)],
        [[(1, 1), (1, 2), (2, 2), (2, 1), (1, 1)]],
    )
    url = "https://cmr.earthdata.nasa.gov/search/granules.json"
    payload = {"feed": {"hits": 0, "entry": []}}
    with respx.mock(assert_all_called=True) as router:
        route = router.post(url).mock(return_value=httpx.Response(200, json=payload))
        result = await search_granules(polygon)
    request = route.calls.last.request
    assert request.method == "POST"
    assert b'name="shapefile"' in request.content
    assert b'"coordinates":[[[0.0,0.0],[4.0,0.0],[4.0,4.0],[0.0,4.0],[0.0,0.0]],[[1.0,1.0],[1.0,2.0],[2.0,2.0],[2.0,1.0],[1.0,1.0]]]' in request.content
    assert "polygon" not in request.url.params
    assert result["hits"] == 0


FAILING_RING = [
    [71.65981178392747, 22.383520704011396],
    [71.7606124306173, 22.38402197291803],
    [71.71632270846362, 22.317057304725115],
    [71.65981178392747, 22.383520704011396],
]


def test_failing_polygon_serializes_as_closed_ccw_comma_sequence():
    polygon = Polygon(FAILING_RING)
    normalized = normalize_cmr_polygon(polygon)
    values = [float(value) for value in normalized.split(",")]
    points = list(zip(values[::2], values[1::2]))

    assert points[0] == points[-1]
    assert Polygon(points).exterior.is_ccw
    assert " " not in normalized
    assert len(points) == 4


def test_clockwise_input_is_normalized_to_counter_clockwise_without_mutation():
    ccw = Polygon(list(Polygon(FAILING_RING).exterior.coords)[::-1])
    cw = Polygon(FAILING_RING)
    original = list(cw.exterior.coords)
    normalized = normalize_cmr_polygon(cw)
    values = [float(value) for value in normalized.split(",")]

    assert not cw.exterior.is_ccw
    assert Polygon(list(zip(values[::2], values[1::2]))).exterior.is_ccw
    assert list(cw.exterior.coords) == original


def test_counter_clockwise_input_stays_counter_clockwise_and_closed():
    polygon = Polygon(list(Polygon(FAILING_RING).exterior.coords)[::-1])
    assert polygon.exterior.is_ccw
    serialized = normalize_cmr_polygon(polygon)
    values = [float(value) for value in serialized.split(",")]
    points = list(zip(values[::2], values[1::2]))
    assert points[0] == points[-1]
    assert Polygon(points).exterior.is_ccw


def test_unclosed_ring_is_closed_by_geometry_normalization():
    polygon = Polygon(FAILING_RING[:-1])
    serialized = normalize_cmr_polygon(polygon)
    values = [float(value) for value in serialized.split(",")]
    points = list(zip(values[::2], values[1::2]))
    assert points[0] == points[-1]


@pytest.mark.parametrize("ring", [
    [[0, 0], [float("nan"), 1], [1, 1], [0, 0]],
    [[0, 0], [181, 0], [1, 1], [0, 0]],
    [[0, 0], [1, 91], [1, 1], [0, 0]],
])
def test_invalid_cmr_coordinates_are_rejected(ring):
    with pytest.raises(ValueError):
        normalize_cmr_polygon(Polygon(ring))


def test_polygon_holes_are_preserved_using_documented_geojson_request_body():
    polygon = Polygon(
        [(0, 0), (4, 0), (4, 4), (0, 4), (0, 0)],
        [[(1, 1), (1, 2), (2, 2), (2, 1), (1, 1)]],
    )
    geojson = json.loads(_normalized_geojson(polygon))
    assert len(geojson["geometry"]["coordinates"]) == 2
