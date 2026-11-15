"""Build two researched flood stories in the shared SK sequence format.

Australia Manning May 2025: Sentinel-1 RTC (NISAR public GCOV starts mid-2026).
USA White River Aug 2026: NISAR provisional GCOV on a single ascending track.
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np
import rasterio
import requests
from rasterio.enums import Resampling
from rasterio.windows import Window, from_bounds
from rasterio.warp import transform_bounds
from shapely.geometry import shape, box

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'Backend'))
from app.cmr import search_granules  # noqa: E402
from app.geometry import validate_geojson  # noqa: E402
from app.harmony import extract_granule  # noqa: E402
import importlib.util

spec = importlib.util.spec_from_file_location('skbuilder', Path(__file__).with_name('build-sk-sequences.py'))
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)

AU = dict(
    slug='australia-manning-2025',
    title='Record Water on the Manning',
    location='Taree–Wingham, Manning River, New South Wales, Australia',
    continent='Oceania',
    bbox=[152.35, -32.05, 152.55, -31.85],
    dates=['2025-05-09', '2025-05-21', '2025-06-02', '2025-06-26'],
    orbit=74,
    references=[
        dict(title='NSW SES: Highest flood on record for Taree (21 May 2025)', url='https://www.ses.nsw.gov.au/news/highest-flood-record-taree-rescues-underway-people-trapped-floodwater'),
        dict(title='ABC News: Manning River rises past 96-year record at Taree', url='https://www.abc.net.au/news/2025-05-21/manning-river-rises-past-96-year-record-at-taree/105317780'),
        dict(title='Wikipedia: 2025 New South Wales floods', url='https://en.wikipedia.org/wiki/2025_New_South_Wales_floods'),
        dict(title='Sentinel-1 calibrated RTC data collection', url='https://planetarycomputer.microsoft.com/dataset/sentinel-1-rtc'),
    ],
    intro=(
        'From 20–25 May 2025 a slow-moving trough produced a documented 1-in-500-year flood on the NSW Mid North Coast. '
        'The Manning River at Taree peaked near 6.4 m on 21 May, above the 1929 record, with major flooding at Wingham and widespread rescues. '
        'These four Sentinel-1 radar visits follow a focused Manning corridor around Taree and Wingham from before the crest through late June.'
    ),
    conclusion=(
        'The 21 May acquisition falls on the documented crest day at Taree; it is still a radar brightness map, not a measured water depth or validated inundation polygon. '
        'Later frames show follow-up landscape response and must not be read as a full recovery certificate. '
        'Standing water, wet soil, crops and viewing geometry all affect brightness. No flood-area accuracy or damage estimate is claimed.'
    ),
)

US = dict(
    slug='usa-white-river-2026',
    title='When the White River Broke Its Century Mark',
    location='Noblesville corridor, White River, Indiana, USA',
    continent='North America',
    bbox=[-86.15, 39.95, -85.95, 40.15],
    geometry_token='047_A_022',
    dates=['2026-07-23', '2026-08-16', '2026-08-28', '2026-09-09'],
    references=[
        dict(title='NWS Indianapolis: Record Flooding of August 2026', url='https://www.weather.gov/ind/august2026flooding'),
        dict(title='IndyStar: How high did Indiana rivers get? (17 Aug 2026)', url='https://www.indystar.com/story/weather/2026/08/17/how-high-did-indiana-rivers-get-see-new-records-during-floods/91337753007/'),
        dict(title='CBS News: Indiana White River breaks 1913 flooding record', url='https://www.cbsnews.com/news/indiana-white-river-flooding-record-emergency/'),
    ],
    intro=(
        'From 11–17 August 2026 repeated thunderstorms dropped more than a foot of rain across parts of central Indiana. '
        'The White River set new records at Anderson and Noblesville, exceeding crests not seen since 1913, and Indianapolis declared a local disaster emergency. '
        'These four NISAR observations follow a focused corridor near Noblesville from late July through early September on one ascending track.'
    ),
    conclusion=(
        'The 16 August acquisition falls during the documented crest window; it measures radar response on a common grid and does not itself prove flood depth or mapped inundation extent. '
        'Later acquisitions provide follow-up views only. Vegetation, wet soil, urban surfaces and geometry also change brightness. '
        'This story does not estimate flooded area, damage or evacuation needs.'
    ),
)


def polygon_for(cfg):
    w, s, e, n = cfg['bbox']
    return dict(
        type='Feature',
        properties=dict(owner='sk', name=cfg['location'], scope='Focused river corridor, not the entire disaster'),
        geometry=dict(type='Polygon', coordinates=[[[w, s], [e, s], [e, n], [w, n], [w, s]]]),
    )


def rediscover_australia():
    folder = builder.SK / AU['slug']
    folder.mkdir(parents=True, exist_ok=True)
    payload = dict(
        collections=['sentinel-1-rtc'],
        bbox=[152.30, -32.10, 152.60, -31.80],
        datetime='2025-04-15T00:00:00Z/2025-07-15T23:59:59Z',
        limit=100,
    )
    response = requests.post('https://planetarycomputer.microsoft.com/api/stac/v1/search', json=payload, timeout=60)
    response.raise_for_status()
    data = response.json()
    (folder / 'radar-discovery.json').write_text(json.dumps(dict(query=payload, response=data), indent=2) + '\n', encoding='utf-8')
    return data


def retrieve_sentinel(cfg, item):
    props = item['properties']
    href = item['assets']['vv']['href']
    dest = builder.CACHE / cfg['slug']
    dest.mkdir(parents=True, exist_ok=True)
    path = dest / f"{item['id']}.tif"
    if not path.exists():
        parts = href.split('/')
        account = parts[2].split('.')[0]
        container = parts[3]
        token = requests.get(f'https://planetarycomputer.microsoft.com/api/sas/v1/token/{account}/{container}', timeout=25)
        token.raise_for_status()
        signed = href + '?' + token.json()['token']
        print('Reading radar subset', cfg['slug'], props['datetime'], flush=True)
        with rasterio.Env(GDAL_DISABLE_READDIR_ON_OPEN='EMPTY_DIR', GDAL_HTTP_TIMEOUT=60, GDAL_HTTP_MAX_RETRY=3):
            with rasterio.open(signed) as src:
                bounds = transform_bounds('EPSG:4326', src.crs, *cfg['bbox'], densify_pts=21)
                win = from_bounds(*bounds, transform=src.transform).round_offsets().round_lengths().intersection(Window(0, 0, src.width, src.height))
                height = max(1, int(win.height / 2))
                width = max(1, int(win.width / 2))
                arr = src.read(1, window=win, out_shape=(height, width), masked=True, resampling=Resampling.average)
                valid = ~np.ma.getmaskarray(arr) & np.isfinite(arr.data) & (arr.data > 0)
                if valid.mean() < 0.90:
                    raise ValueError(f"Less than 90% valid coverage for {props['datetime']}")
                profile = src.profile.copy()
                profile.update(
                    driver='GTiff', height=height, width=width,
                    transform=src.window_transform(win) * rasterio.Affine.scale(win.width / width, win.height / height),
                    nodata=np.nan, dtype='float32', count=1, compress='deflate',
                )
                for key in ('blockxsize', 'blockysize', 'tiled'):
                    profile.pop(key, None)
                with rasterio.open(path, 'w', **profile) as out:
                    out.write(np.where(valid, arr.data, np.nan).astype('float32'), 1)
                    out.update_tags(
                        units='1', measurement='VV', product='Sentinel-1 RTC gamma naught',
                        relativeOrbit=props['sat:relative_orbit'], orbitPassDirection=props['sat:orbit_state'],
                        acquiredAt=props['datetime'],
                    )
    with rasterio.open(path) as src:
        arr = src.read(1, masked=True)
        coverage = float((~np.ma.getmaskarray(arr) & np.isfinite(arr.data) & (arr.data > 0)).mean())
    print('Verified radar', cfg['slug'], props['datetime'][:10], round(coverage * 100, 2), flush=True)
    return dict(
        path=str(path), id=item['id'], date=props['datetime'],
        productId=props.get('s1:product_identifier', item['id']), sourceUrl=href,
        measurement='VV', frequency='C-band', orbit=props['sat:relative_orbit'],
        direction=props['sat:orbit_state'], validSourceCoverage=coverage, stacProperties=props,
    )


def build_australia():
    data = rediscover_australia()
    aoi = box(*AU['bbox'])
    items = []
    for date in AU['dates']:
        matches = [
            feature for feature in data['features']
            if feature['properties']['datetime'].startswith(date)
            and feature['properties']['sat:relative_orbit'] == AU['orbit']
            and feature['properties']['sat:orbit_state'] == 'descending'
            and 'vv' in feature['assets']
            and shape(feature['geometry']).covers(aoi)
        ]
        if len(matches) != 1:
            raise ValueError(f"Need exactly one AU scene for {date}, found {len(matches)}")
        items.append(matches[0])
    with ThreadPoolExecutor(max_workers=3) as pool:
        records = list(pool.map(lambda item: retrieve_sentinel(AU, item), items))
    feature = polygon_for(AU)
    builder.render(AU['slug'], AU['title'], AU['location'], records, feature, AU['references'], AU['intro'], AU['conclusion'], 'Sentinel-1 RTC')
    folder = builder.OUT / AU['slug']
    result = builder.read(folder / 'result.json')
    result['continent'] = AU['continent']
    result['changeType'] = 'Documented river flood · radar observations'
    result['eventEvidence'] = 'Documented by NSW SES, ABC News and the 2025 NSW floods summary; radar observations are not a validated flood classification.'
    builder.save(folder / 'result.json', result)
    builder.save(folder / 'sequence-data.json', result)
    builder.save(builder.SK / AU['slug'] / 'result.json', result)
    builder.save(builder.SK / AU['slug'] / 'research.json', dict(
        eventVerified=True, scope=AU['location'], references=AU['references'], selectedDates=AU['dates'],
        dateGapsDisclosed=True,
        source='Public Sentinel-1 C-band VV RTC; NISAR provisional GCOV public release begins mid-2026, after this May 2025 flood',
        independentPixelAccuracy='not established',
    ))
    builder.save(builder.SK / AU['slug'] / 'sequence-content.json', {k: v for k, v in result.items() if k != 'observations'})
    index = builder.read(builder.OUT / 'index.json')
    entry = next(row for row in index if row['slug'] == AU['slug'])
    entry.update(continent=AU['continent'], changeType='Documented river flood · radar observations', description=AU['conclusion'])
    builder.save(builder.OUT / 'index.json', index)
    print('Australia story ready', flush=True)


async def build_usa_nisar():
    folder = builder.SK / US['slug']
    folder.mkdir(parents=True, exist_ok=True)
    feature = polygon_for(US)
    builder.save(folder / 'study-area.geojson', feature)
    polygon, area, bounds, _ = validate_geojson(feature)
    from datetime import date as date_cls
    discovery = await search_granules(polygon, start_date=date_cls(2026, 7, 20), end_date=date_cls(2026, 9, 20), all_pages=True)
    discovery['areaKm2'] = area
    discovery['bounds'] = bounds
    builder.save(folder / 'discovery.json', discovery)
    selected = []
    for date in US['dates']:
        matches = [
            row for row in discovery['observations']
            if row['acquiredAt'].startswith(date) and f"_{US['geometry_token']}_" in row['title']
        ]
        if len(matches) != 1:
            raise ValueError(f"Need exactly one NISAR scene for {date} / {US['geometry_token']}, found {len(matches)}")
        selected.append(matches[0])
    records = []
    gate = asyncio.Semaphore(2)

    async def retrieve(row):
        async with gate:
            print('Retrieving NISAR', US['slug'], row['acquiredAt'], row['id'], flush=True)
            result = await extract_granule(row['id'], feature, ['HHHH'], 'frequencyA', row)
            layer = result['variables'][0]
            if layer['status'] not in {'downloaded', 'already_present'}:
                raise RuntimeError(layer.get('error', layer['status']))
            records.append(dict(
                path=layer['path'], id=row['id'], date=row['acquiredAt'], productId=row['title'],
                sourceUrl=row['downloadUrl'], measurement='HHHH', frequency='frequencyA',
            ))
            builder.save(folder / 'retrieved-radar.json', records)
            print('Retrieved', row['id'], flush=True)

    await asyncio.gather(*(retrieve(row) for row in selected))
    records = sorted(records, key=lambda row: row['date'])
    builder.render(US['slug'], US['title'], US['location'], records, feature, US['references'], US['intro'], US['conclusion'], 'NISAR')
    out = builder.OUT / US['slug']
    result = builder.read(out / 'result.json')
    result['continent'] = US['continent']
    result['changeType'] = 'Documented river flood · radar observations'
    result['eventEvidence'] = 'Documented by NWS Indianapolis and contemporaneous Indiana reporting; radar observations are not a validated flood classification.'
    builder.save(out / 'result.json', result)
    builder.save(out / 'sequence-data.json', result)
    builder.save(folder / 'result.json', result)
    builder.save(folder / 'research.json', dict(
        eventVerified=True, scope=US['location'], references=US['references'], selectedDates=US['dates'],
        geometry=US['geometry_token'], source='NISAR provisional GCOV frequency-A HHHH via Harmony extraction',
        independentPixelAccuracy='not established',
    ))
    builder.save(folder / 'sequence-content.json', {k: v for k, v in result.items() if k != 'observations'})
    index = builder.read(builder.OUT / 'index.json')
    entry = next(row for row in index if row['slug'] == US['slug'])
    entry.update(continent=US['continent'], changeType='Documented river flood · radar observations', description=US['conclusion'])
    builder.save(builder.OUT / 'index.json', index)
    print('USA story ready', flush=True)


def main():
    only = set(sys.argv[1:])
    if not only or 'australia-manning-2025' in only:
        build_australia()
    if not only or 'usa-white-river-2026' in only:
        asyncio.run(build_usa_nisar())


if __name__ == '__main__':
    main()
