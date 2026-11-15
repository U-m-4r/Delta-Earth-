"""Read-only, local story catalogue. No upstream retrieval is performed here."""
from functools import lru_cache
import json
from pathlib import Path
import re

import numpy as np
import rasterio
from rasterio.warp import transform_bounds, transform as project
from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import FileResponse

from .raster_display import colorize_values
from .raster_exports import _difference_rgba, _write_png
from .visualization_sessions import _read_aligned

ROOT = Path(__file__).resolve().parents[1] / 'Stories'
SLUG = 'bhagalpur-flood-2026'
router = APIRouter(prefix='/api/stories', tags=['stories'])


def read_json(path):
    return json.loads(path.read_text(encoding='utf-8'))


def local_file(root, name):
    path = (root / name).resolve()
    if not path.is_relative_to(root.resolve()) or not path.is_file():
        raise HTTPException(404, 'Story asset unavailable: NAN')
    return path


def source_file(observation_id):
    # Match a verified acquisition ID, never a caller-supplied filename.
    if not re.fullmatch(r'G\d+-ASF', observation_id):
        raise HTTPException(404, 'Unknown observation')
    matches = []
    for path in (ROOT / 'Bagalpur').rglob('*.tif'):
        match = re.search(r'(G\d+)_ASF_FrequencyA_HV\.tif$', path.name)
        if match and match[1] + '-ASF' == observation_id:
            matches.append(path)
    if len(matches) != 1:
        raise HTTPException(404, 'Local observation unavailable: NAN')
    return local_file(ROOT / 'Bagalpur', str(matches[0].relative_to(ROOT / 'Bagalpur')))


@lru_cache(maxsize=16)
def inspect_file(filename, modified):
    with rasterio.open(filename) as src:
        sample = src.read(1, masked=True)
        values = sample.compressed()
        values = values[np.isfinite(values)]
        return {'crs': str(src.crs), 'bounds': list(src.bounds),
                'boundsWgs84': list(transform_bounds(src.crs, 'EPSG:4326', *src.bounds)),
                'width': src.width, 'height': src.height, 'noData': 'NAN',
                'units': src.tags(1).get('units', 'NAN'), 'tags': src.tags(), 'bandTags': src.tags(1),
                'statistics': {'minimum': float(values.min()), 'maximum': float(values.max()),
                               'mean': float(values.mean()), 'validPixelCount': int(values.size)}}


def flood_story():
    story = read_json(ROOT / 'Bagalpur' / 'story.json')
    for chapter in story['chapters']:
        try:
            path = source_file(chapter['observationId'])
            chapter['raster'] = inspect_file(str(path), path.stat().st_mtime_ns)
            chapter['available'] = True
        except HTTPException:
            chapter.update(available=False, raster='NAN')
    return story


@router.get('')
def list_stories():
    return read_json(ROOT / 'case-studies' / 'index.json')


@router.get('/{slug}')
def get_story(slug: str):
    if slug == SLUG:
        return flood_story()
    if slug not in {item['slug'] for item in list_stories()}:
        raise HTTPException(404, 'Unknown story')
    return read_json(local_file(ROOT / 'case-studies' / slug, 'result.json'))


@router.get('/{slug}/observations')
def observations(slug: str):
    story = get_story(slug)
    return story.get('chapters', story.get('observations', 'NAN'))


def require_flood(slug, observation_id):
    if slug != SLUG or observation_id not in {c['observationId'] for c in flood_story()['chapters']}:
        raise HTTPException(404, 'Unknown observation')
    return source_file(observation_id)


def aligned_values(path):
    story = read_json(ROOT / 'Bagalpur' / 'story.json')
    baseline = source_file(story['chapters'][0]['observationId'])
    with rasterio.open(baseline) as target:
        return _read_aligned(path, target, target.width, target.height)


@router.get('/{slug}/observations/{observation_id}/preview')
def preview(slug: str, observation_id: str, changes: bool = False):
    path = require_flood(slug, observation_id)
    story = read_json(ROOT / 'Bagalpur' / 'story.json')
    baseline = source_file(story['chapters'][0]['observationId'])
    cache = ROOT / 'Bagalpur' / '.cache'
    cache.mkdir(exist_ok=True)
    signature = f'{path.stat().st_mtime_ns}-{baseline.stat().st_mtime_ns}-v1'
    target = cache / f'{observation_id}-{signature}-{"change" if changes else "turbo"}.png'
    if not target.exists():
        values, valid = aligned_values(path)
        if changes:
            before, before_valid = aligned_values(baseline)
            # Source-unit subtraction, matching raster_exports.create_change_export.
            sample = np.ma.array(values - before, mask=~(valid & before_valid))
            rgba = _difference_rgba(sample, story['changeRange'])
        else:
            rgba, _, _ = colorize_values(np.ma.array(values, mask=~valid), palette='turbo',
                minimum=story['displayRange']['min'], maximum=story['displayRange']['max'],
                stretch='log', normalization_scale=story['normalizationScale'])
        _write_png(rgba, target)
    return FileResponse(target, media_type='image/png', headers={'Cache-Control': 'public, max-age=3600'})


@router.get('/{slug}/observations/{observation_id}/pixel')
def pixel(slug: str, observation_id: str, x: float = Query(ge=0, lt=1), y: float = Query(ge=0, lt=1), changes: bool = False):
    path = require_flood(slug, observation_id)
    values, valid = aligned_values(path)
    row, col = min(int(y * values.shape[0]), values.shape[0]-1), min(int(x * values.shape[1]), values.shape[1]-1)
    baseline = source_file(read_json(ROOT / 'Bagalpur' / 'story.json')['chapters'][0]['observationId'])
    if changes:
        before, before_valid = aligned_values(baseline)
        values = values - before
        valid &= before_valid
    with rasterio.open(baseline) as src:
        easting, northing = src.xy(row, col)
        lon, lat = project(src.crs, 'EPSG:4326', [easting], [northing])
    return {'value': float(values[row, col]) if valid[row, col] else 'NAN',
            'longitude': lon[0], 'latitude': lat[0], 'units': 'linear radar power', 'operation': 'current_minus_baseline' if changes else 'measurement'}


@router.get('/{slug}/observations/{observation_id}/raster')
def raster(slug: str, observation_id: str):
    # These are curated public story assets, separate from private retrieval sessions.
    path = require_flood(slug, observation_id)
    return FileResponse(path, media_type='image/tiff', filename=path.name)
