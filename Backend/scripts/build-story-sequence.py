"""Retrieve five real acquisitions and render aligned, consistently colored story frames."""
import argparse
import asyncio
import hashlib
import json
from pathlib import Path

import numpy as np
import rasterio
from rasterio.enums import Resampling
from rasterio.vrt import WarpedVRT

from app.geometry import study_id_for_feature
from app.harmony import extract_granule
from app.raster_display import colorize_values
from app.raster_exports import _write_png


async def build(location):
    folder = Path('stories/umar') / location
    discovery = json.loads((folder / 'discovery.json').read_text())
    feature = json.loads((folder / 'study-area.geojson').read_text(encoding='utf-8'))
    candidate = discovery['candidateComparisons'][0]
    content = json.loads((folder / 'sequence-content.json').read_text(encoding='utf-8'))
    dates = candidate['dates']
    if not 3 <= len(content['dates']) <= 6 or len(content['dates']) != len(content['chapters']):
        raise ValueError('Provide 3–6 explicit acquisition dates with one chapter per date.')
    chosen_dates = [next(date for date in dates if date.startswith(target)) for target in content['dates']]
    if chosen_dates != sorted(set(chosen_dates)):
        raise ValueError('Story dates must be unique and chronological.')
    records = [next(row for row in discovery['observations']
                    if row['acquiredAt'] == date and f"_{candidate['geometry']}_" in row['title'])
               for date in chosen_dates]
    output = Path('Frontend/public/case-studies') / f'{location}-sequence-2026'
    output.mkdir(parents=True, exist_ok=True)
    async def retrieve(row):
        print(f"Retrieving {location} {row['acquiredAt']} {row['id']}", flush=True)
        result = await extract_granule(row['id'], feature, ['HHHH'], 'frequencyA', row)
        layer = result['variables'][0]
        if layer['status'] not in {'downloaded', 'already_present'}:
            raise RuntimeError(f"{row['id']}: {layer.get('error', layer['status'])}")
        return Path(layer['path'])
    # Limit concurrent upstream jobs while reusing existing extracted endpoints.
    gate = asyncio.Semaphore(2)
    async def limited(row):
        async with gate:
            return await retrieve(row)
    paths = await asyncio.gather(*(limited(row) for row in records))
    frames = []
    previous = previous_valid = None
    with rasterio.open(paths[0]) as grid:
        width, height, transform, crs = grid.width, grid.height, grid.transform, grid.crs
        for index, (row, path) in enumerate(zip(records, paths)):
            with rasterio.open(path) as source:
                if source.tags(1).get('units') not in {'1', 'linear', 'power'}:
                    raise ValueError('Expected linear-power units before conversion to dB.')
                with WarpedVRT(source, crs=crs, transform=transform, width=width, height=height,
                               resampling=Resampling.bilinear, nodata=np.nan) as aligned:
                    sample = aligned.read(1, masked=True)
            values = np.asarray(sample.data)
            valid = ~np.ma.getmaskarray(sample) & np.isfinite(values) & (values > 0)
            if not valid.any():
                raise ValueError(f"{row['id']} has no valid positive-power pixels on the common grid.")
            db = np.full(values.shape, np.nan, dtype=np.float32)
            db[valid] = 10 * np.log10(values[valid])
            rgba, _, _ = colorize_values(np.ma.array(db, mask=~valid), palette='viridis', minimum=-30, maximum=5)
            name = f"frame-{index + 1}.png"
            _write_png(rgba, output / name)
            frame = {'key': f'frame-{index + 1}', 'date': row['acquiredAt'], 'image': name,
                     **content['chapters'][index],
                     'granuleId': row['id'], 'productId': row['title'], 'sourceUrl': row['downloadUrl'],
                     'measurement': 'HHHH', 'frequency': 'frequencyA',
                     'validPixelCount': int(valid.sum()), 'meanDb': float(db[valid].mean()),
                     'medianDb': float(np.median(db[valid])),
                     'sourceSha256': hashlib.sha256(path.read_bytes()).hexdigest(),
                     'imageSha256': hashlib.sha256((output / name).read_bytes()).hexdigest()}
            if previous is not None:
                shared = valid & previous_valid
                if not shared.any():
                    raise ValueError('Consecutive story frames have no shared valid pixels.')
                delta = db[shared] - previous[shared]
                frame['changeFromPrevious'] = {'meanDb': float(delta.mean()), 'medianDb': float(np.median(delta)),
                    'validPixelCount': int(shared.sum()), 'note': 'Later minus earlier in dB, aligned common valid pixels. Not a flood classification.'}
            frames.append(frame)
            previous, previous_valid = db, valid
    result = {'kind': 'sequence', 'slug': output.name, **{k: v for k, v in content.items() if k != 'chapters'},
              'observations': frames, 'studyId': study_id_for_feature(feature), 'polygon': feature,
              'display': {'palette': 'viridis', 'minimum': -30, 'maximum': 5, 'units': 'dB',
                          'grid': {'width': width, 'height': height, 'crs': str(crs), 'transform': list(transform)}},
              'method': 'Individual frequency-A HHHH GeoTIFFs retrieved with the application Harmony extraction pipeline. Bilinear alignment to the first raster grid, nonpositive and NoData pixels masked, 10*log10(linear power), one fixed palette/range for every frame.'}
    (output / 'sequence-data.json').write_text(json.dumps(result, indent=2, allow_nan=False) + '\n', encoding='utf-8')
    (output / 'result.json').write_text(json.dumps(result, indent=2, allow_nan=False) + '\n', encoding='utf-8')
    print(f"Prepared {location}: {len(frames)} aligned frames at {output}", flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('location', choices=['bangalore', 'jeddah'])
    asyncio.run(build(parser.parse_args().location))
