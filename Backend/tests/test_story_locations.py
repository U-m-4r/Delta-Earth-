import json
import math

import pytest
from shapely.geometry import Point, shape
from app import stories
from app.story_locations import coordinate, story_location


@pytest.mark.parametrize('point', [None, {}, {'longitude': True, 'latitude': 0}, {'longitude': 181, 'latitude': 0}, {'longitude': 0, 'latitude': -91}, {'longitude': math.nan, 'latitude': 0}])
def test_invalid_coordinates_are_omitted(point):
    assert coordinate(point) is None
    assert story_location({'markerLocation': point}) is None


def test_explicit_coordinates_take_precedence():
    point = story_location({'markerLocation': {'longitude': 12, 'latitude': -4},
                            'bounds': [-10, -10, 10, 10]})
    assert point == {'longitude': 12, 'latitude': -4, 'method': 'explicit'}


def test_bhagalpur_and_antimeridian_bounds():
    result = story_location({'bounds': {'west': 86.90852923933747, 'south': 25.24208520024809, 'east': 87.00820902433779, 'north': 25.361541258819315}})
    assert result['longitude'] == pytest.approx(86.95836913183763)
    assert result['latitude'] == pytest.approx(25.301813229533703)
    result = story_location({'bounds': [170, -5, -170, 5]})
    assert abs(result['longitude']) == 180
    assert result['latitude'] == 0


def test_concave_polygon_and_holes_use_interior_points():
    polygon = {'type': 'Polygon', 'coordinates': [[[0,0],[6,0],[6,1],[1,1],[1,6],[0,6],[0,0]]]}
    result = story_location({'polygon': polygon})
    assert shape(polygon).contains(Point(result['longitude'], result['latitude']))
    polygon = {'type': 'Polygon', 'coordinates': [[[0,0],[10,0],[10,10],[0,10],[0,0]], [[2,2],[8,2],[8,8],[2,8],[2,2]]]}
    result = story_location({'polygon': polygon, 'representativeLocation': {'longitude': 5, 'latitude': 5}})
    assert result['method'] == 'study-area-interior-point'
    assert shape(polygon).contains(Point(result['longitude'], result['latitude']))
    result = story_location({'polygon': polygon, 'representativeLocation': {'longitude': 1, 'latitude': 1}})
    assert result['method'] == 'validated-representative-point'


def test_dateline_polygon_and_multipolygon():
    polygon = {'type': 'Polygon', 'coordinates': [[[170,-10],[-170,-10],[-170,10],[170,10],[170,-10]]]}
    result = story_location({'polygon': polygon})
    assert abs(result['longitude']) >= 170
    result = story_location({'polygon': {'type': 'MultiPolygon', 'coordinates': [polygon['coordinates'], [[[20,0],[21,0],[21,1],[20,1],[20,0]]]]}})
    assert -180 <= result['longitude'] <= 180
    assert -90 <= result['latitude'] <= 90


def test_all_published_stories_have_real_local_locations(monkeypatch):
    monkeypatch.setattr(stories, 'inspect_file', lambda *_: pytest.fail('Catalogue must not inspect rasters'))
    catalogue = stories.list_stories()
    assert len(catalogue) == 7
    assert all(item['markerLocation'] for item in catalogue)
    bhagalpur = next(item for item in catalogue if item['slug'] == stories.SLUG)
    assert bhagalpur['markerLocation']['method'] == 'study-bounds-center'
    assert bhagalpur['markerLocation']['longitude'] == pytest.approx(86.95836913183763)


def test_catalogue_excludes_drafts_and_keeps_unlocated_stories(monkeypatch, tmp_path):
    root = tmp_path/'case-studies'; root.mkdir()
    rows = [{'slug':'draft','title':'Draft','published':False}, {'slug':'hidden','title':'Hidden'},
            {'slug':'unlocated','title':'Still in library'}, {'slug':'located','markerLocation':{'longitude':2,'latitude':3}}]
    (root/'index.json').write_text(json.dumps(rows))
    for row in rows:
        folder=root/row['slug'];folder.mkdir()
        (folder/'result.json').write_text(json.dumps({'status':'draft'} if row['slug']=='hidden' else {}))
    monkeypatch.setattr(stories,'ROOT',tmp_path)
    catalogue=stories.list_stories()
    assert [row['slug'] for row in catalogue]==['unlocated','located']
    assert catalogue[0]['markerLocation'] is None
    assert catalogue[1]['markerLocation']['method']=='explicit'


def test_representative_point_is_validated_against_crossing_bounds():
    story = {'bounds': [170, -5, -170, 5], 'representativeLocation': {'longitude': -175, 'latitude': 1}}
    assert story_location(story)['method'] == 'validated-representative-point'
    story['representativeLocation'] = {'longitude': 0, 'latitude': 0}
    assert story_location(story)['method'] == 'study-bounds-center'
