"""Discover public Sentinel-1 RTC coverage for two researched flood corridors."""
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
from collections import defaultdict
import json
import requests
from shapely.geometry import shape, box

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'Backend' / 'Stories' / 'sk'
jobs = [
    dict(
        slug='australia-manning-2025',
        bbox=[152.35, -32.05, 152.55, -31.85],
        window='2025-05-01T00:00:00Z/2025-06-20T23:59:59Z',
        note='NSW Mid North Coast / Manning River record flood around Taree, 20–25 May 2025',
    ),
    dict(
        slug='usa-white-river-2026',
        bbox=[-86.15, 39.95, -85.95, 40.15],
        window='2026-07-20T00:00:00Z/2026-09-20T23:59:59Z',
        note='Indiana White River record flood near Noblesville, mid-August 2026',
    ),
]


def discover(job):
    folder = OUT / job['slug']
    folder.mkdir(parents=True, exist_ok=True)
    payload = dict(collections=['sentinel-1-rtc'], bbox=job['bbox'], datetime=job['window'], limit=100)
    response = requests.post('https://planetarycomputer.microsoft.com/api/stac/v1/search', json=payload, timeout=60)
    response.raise_for_status()
    data = response.json()
    (folder / 'radar-discovery.json').write_text(json.dumps(dict(query=payload, response=data, note=job['note']), indent=2) + '\n', encoding='utf-8')
    aoi = box(*job['bbox'])
    groups = defaultdict(list)
    for feature in data['features']:
        props = feature['properties']
        if 'vv' not in feature['assets']:
            continue
        if not shape(feature['geometry']).covers(aoi):
            continue
        key = (props['platform'], props['sat:relative_orbit'], props['sat:orbit_state'], props['proj:epsg'], props.get('s1:slice_number'))
        groups[key].append(feature)
    ranked = [
        dict(group=list(key), dates=sorted({item['properties']['datetime'] for item in rows}), count=len({item['properties']['datetime'] for item in rows}))
        for key, rows in groups.items()
    ]
    ranked.sort(key=lambda item: item['count'], reverse=True)
    (folder / 'compatible-groups.json').write_text(json.dumps(ranked, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(dict(slug=job['slug'], features=len(data['features']), coveringGroups=len(ranked), top=ranked[:4]), indent=2), flush=True)


with ThreadPoolExecutor(2) as pool:
    list(pool.map(discover, jobs))
