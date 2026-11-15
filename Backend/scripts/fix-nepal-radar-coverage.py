from pathlib import Path
import sys,json,asyncio,importlib.util
import numpy as np,rasterio
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from app.harmony import extract_granule,_sanitize_text
R=Path(__file__).resolve().parents[2];folder=R/'Backend/Stories/sk/nepal-glacier-flood-2026'
spec=importlib.util.spec_from_file_location('skbuilder',Path(__file__).with_name('build-sk-sequences.py'));b=importlib.util.module_from_spec(spec);spec.loader.exec_module(b)
async def main():
    ranking=b.read(folder/'footprint-ranking.json');candidate=ranking[0]
    assert candidate['minimumCoverage']>.95
    discovery=b.read(folder/'discovery.json');feature=b.read(folder/'study-area.geojson');rows=[]
    for date in ['2026-08-19','2026-08-31','2026-10-06']:
        matches=[r for r in discovery['observations'] if r['acquiredAt'].startswith(date) and f"_{candidate['geometry']}_" in r['title']]
        matches.sort(key=lambda r:'_P05023_' not in r['title']);rows.append(matches[0])
    gate=asyncio.Semaphore(2)
    async def retrieve(row):
        async with gate:
            print('Retrieving full Nepal footprint',row['id'],row['acquiredAt'],flush=True)
            result=await extract_granule(row['id'],feature,['HHHH'],'frequencyA',row)
            layer=result['variables'][0]
            if layer['status'] not in ['downloaded','already_present']:raise RuntimeError(_sanitize_text(layer.get('error',layer['status'])))
            path=Path(layer['path'])
            with rasterio.open(path) as src:
                sample=src.read(1,masked=True);coverage=float((~np.ma.getmaskarray(sample)&np.isfinite(sample.data)&(sample.data>0)).mean())
            if coverage<.80:raise ValueError('Full-footprint candidate still has insufficient valid raster coverage: '+str(coverage))
            record=dict(path=str(path),id=row['id'],date=row['acquiredAt'],productId=row['title'],sourceUrl=row['downloadUrl'],measurement='HHHH',frequency='frequencyA',validSourceCoverage=coverage)
            b.save(folder/(row['id']+'-coverage.json'),record);print('Nepal coverage verified',row['id'],round(coverage*100,2),flush=True);return record
    records=await asyncio.gather(*(retrieve(r) for r in rows))
    old=b.read(R/'Backend/Stories/case-studies/nepal-glacier-flood-2026/result.json')
    b.render(old['slug'],old['title'],old['location'],records,feature,old['references'],'Three NISAR observations show the Rasuwa–Trishuli study area on 19 August, 31 August and 6 October 2026. These frames use track 098, frame 016, selected after checking the actual satellite footprints and valid raster masks across the requested area.',old['conclusion'],'NISAR')
    b.save(folder/'coverage-fix.json',dict(status='passed',oldFrame='015',oldValidFraction=[.0864,.1085,.1058],newFrame='016',catalogMinimumCoverage=candidate['minimumCoverage'],sources=records))
asyncio.run(main())
