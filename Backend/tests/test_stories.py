"""Offline story integration checks against the curated local observations."""
import json
from pathlib import Path

import numpy as np
import pytest
import rasterio
from fastapi.testclient import TestClient

from app import stories
from app.main import app
from app.raster_display import colorize_values
from app.raster_exports import _difference_rgba

client = TestClient(app)


def test_catalogue_preserves_active_stories_and_keeps_sukkur_archived():
    catalogue = client.get('/api/stories').json()
    slugs = {item['slug'] for item in catalogue}
    assert {'bhagalpur-flood-2026', 'bangalore-sequence-2026', 'jeddah-sequence-2026',
            'pakistan-tarbela-2026', 'assam-brahmaputra-2026',
            'nepal-glacier-flood-2026', 'punjab-floods-2025', 'pakistan-floods-2022'} <= slugs
    assert 'pakistan-indus-2026' not in slugs
    assert 'pakistan-manchar-2026' not in slugs
    for item in catalogue:
        response = client.get(f"/api/stories/{item['slug']}")
        assert response.status_code == 200
        if item.get('preview'):
            assert client.get(f"/case-studies/{item['slug']}/{item['preview']}").status_code == 200


def test_discovery_dates_metadata_and_cwd(monkeypatch, tmp_path):
    monkeypatch.chdir(tmp_path)
    story = client.get('/api/stories/bhagalpur-flood-2026').json()
    chapters = story['chapters']
    assert len(chapters) == 8
    assert [c['date'] for c in chapters] == ['2026-06-20','2026-07-07','2026-08-12','2026-08-21','2026-09-02','2026-09-17','2026-10-06','2026-10-20']
    assert all(c['available'] and c['acquisitionDate'].startswith(c['date']) for c in chapters)
    assert all(c['raster']['crs'] == 'EPSG:32645' and c['raster']['noData'] == 'NAN' for c in chapters)
    assert chapters[4]['observation'] == 'Not yet classified by the user.'
    assert story['displayRange'] == {'min': .00272371, 'max': .0954112}


def test_fixed_color_and_actual_subtraction():
    story = stories.flood_story()
    baseline = stories.source_file(story['chapters'][0]['observationId'])
    current = stories.source_file(story['chapters'][3]['observationId'])  # 20 m vs 10 m
    after, valid = stories.aligned_values(current)
    before, before_valid = stories.aligned_values(baseline)
    with rasterio.open(baseline) as src:
        assert after.shape == src.shape
    expected, _, _ = colorize_values(np.ma.array(after, mask=~valid), palette='turbo',
        minimum=.00272371, maximum=.0954112, stretch='log', normalization_scale=story['normalizationScale'])
    preview = stories.preview(stories.SLUG, story['chapters'][3]['observationId'])
    with rasterio.open(preview.path) as src:
        np.testing.assert_array_equal(src.read().transpose(1,2,0), expected)
    expected_delta = _difference_rgba(np.ma.array(after-before, mask=~(valid & before_valid)),story['changeRange'])
    delta = stories.preview(stories.SLUG, story['chapters'][3]['observationId'], changes=True)
    with rasterio.open(delta.path) as src:
        np.testing.assert_array_equal(src.read().transpose(1,2,0), expected_delta)
    result = stories.pixel(stories.SLUG,story['chapters'][3]['observationId'],x=.5,y=.5,changes=True)
    row,col=int(.5*after.shape[0]),int(.5*after.shape[1])
    assert result['value'] == pytest.approx(after[row,col]-before[row,col])


def test_unknown_and_traversal_are_rejected():
    assert client.get('/api/stories/unknown').status_code == 404
    assert client.get('/api/stories/bhagalpur-flood-2026/observations/not-a-granule/preview').status_code == 404
    with pytest.raises(Exception) as error:
        stories.local_file(stories.ROOT/'case-studies', '../definitions.json')
    assert error.value.status_code == 404
    assert client.get('/api/stories/bhagalpur-flood-2026/observations/G4244915959-ASF/pixel?x=1&y=0').status_code == 422


def test_missing_acquisition_is_nan(monkeypatch, tmp_path):
    (tmp_path/'Bagalpur').mkdir()
    (tmp_path/'Bagalpur'/'story.json').write_text(json.dumps(json.loads((stories.ROOT/'Bagalpur'/'story.json').read_text())))
    monkeypatch.setattr(stories,'ROOT',tmp_path)
    story = stories.flood_story()
    assert all(not c['available'] and c['raster']=='NAN' for c in story['chapters'])
    assert client.get('/api/stories/bhagalpur-flood-2026/observations/G4244915959-ASF/preview').status_code == 404
