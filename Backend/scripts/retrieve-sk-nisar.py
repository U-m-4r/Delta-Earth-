from pathlib import Path
import asyncio,json,sys,importlib.util
import numpy as np
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from app.harmony import extract_granule,_sanitize_text
R=Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('skbuild',Path(__file__).with_name('build-sk-sequences.py'));b=importlib.util.module_from_spec(spec);spec.loader.exec_module(b)
gate=asyncio.Semaphore(2)

async def build(slug):
    folder=R/'Backend/Stories/sk'/slug;discovery=b.read(folder/'discovery.json');feature=b.read(folder/'study-area.geojson')
    candidates=[c for c in discovery['candidateComparisons'] if c['variable']=='HHHH' and c['frequency']=='frequencyA' and len(c['dates'])>=3]
    if 'tarbela' in slug:candidates.sort(key=lambda c:not c['geometry'].startswith('164_D_071'))
    c=candidates[0];dates=c['dates'];chosen=[dates[i] for i in np.linspace(0,len(dates)-1,min(4,len(dates)),dtype=int)]
    rows=[next(r for r in discovery['observations'] if r['acquiredAt']==d and f"_{c['geometry']}_" in r['title']) for d in chosen]
    records=[]
    async def retrieve(row):
        print(slug,'requesting',row['id'],row['acquiredAt'],flush=True)
        try:
            async with gate:
                result=await extract_granule(row['id'],feature,['HHHH'],'frequencyA',row)
            layer=result['variables'][0]
            if layer['status'] not in ['downloaded','already_present']:raise RuntimeError(layer.get('error',layer['status']))
            records.append(dict(path=layer['path'],id=row['id'],date=row['acquiredAt'],productId=row['title'],sourceUrl=row['downloadUrl'],measurement='HHHH',frequency='frequencyA'))
            b.save(folder/'retrieved-radar.json',records)
            print(slug,'retrieved',row['id'],flush=True)
        except Exception as ex:
            b.save(folder/'radar-retrieval-error.json',dict(status='failed',granuleId=row['id'],error=_sanitize_text(ex)))
            print(slug,'FAILED',_sanitize_text(ex),flush=True);raise
    try:
        await asyncio.gather(*(retrieve(row) for row in rows))
    except Exception:
        return
    if 'nepal' in slug:
        title='Nepal: four radar visits to the mountain river corridor';location='Rasuwa–Trishuli corridor, Nepal'
        refs=b.read(R/'stories/sk'/slug/'sources.json');intro='Four actual NISAR observations of the mountain river corridor. The dates below are verified acquisitions, independent of the unresolved year on the separate published ESA optical preview.';conclusion='Radar in steep terrain is affected by shadow, layover, snow and ice. This sequence does not confirm a glacier-collapse cause or map the full debris-flow corridor. The optical evidence year conflict remains unresolved.'
    else:
        title='Tarbela: four radar views across the season';location='Tarbela Reservoir, Pakistan';old=b.read(R/'stories/sk'/slug/'result.json');refs=old.get('references',[]);intro='Four comparable NISAR HHHH acquisitions show the reservoir landscape at actual repeat-pass dates.';conclusion='Compare shoreline patterns and surrounding terrain. Brightness and apparent area do not measure storage volume or independently confirm a flood. Wind, vegetation and geometry can affect the signal.'
    b.render(slug,title,location,records,feature,refs,intro,conclusion,'NISAR')

async def main():
    await asyncio.gather(*(build(slug) for slug in ['nepal-glacier-flood-2026','pakistan-tarbela-2026']))
asyncio.run(main())
