import pytest

from app.geometry import PolygonInputError, validate_geojson


def feature(coords=None, crs="EPSG:4326"):
    return {"type": "Feature", "properties": {"coordinateSystem": crs}, "geometry": {
        "type": "Polygon", "coordinates": [coords or [[-1, 0], [1, 0], [1, 1], [-1, 1], [-1, 0]]]}}


def test_valid_polygon_returns_area_bounds_and_centroid():
    polygon, area, bounds, centroid = validate_geojson(feature())
    assert polygon.geom_type == "Polygon"
    assert area > 20_000
    assert bounds == [-1.0, 0.0, 1.0, 1.0]
    assert centroid == [0.0, 0.5]


@pytest.mark.parametrize("geojson", [
    {"type": "Feature", "properties": {"coordinateSystem": "EPSG:3857"}, "geometry": feature()["geometry"]},
    {"type": "Feature", "properties": {}, "geometry": {"type": "Point", "coordinates": [0, 0]}},
    feature([[0, 0], [2, 2], [0, 2], [2, 0], [0, 0]]),
    feature([[181, 0], [182, 0], [182, 1], [181, 1], [181, 0]]),
])
def test_rejects_invalid_geojson_polygons(geojson):
    with pytest.raises(PolygonInputError):
        validate_geojson(geojson)
