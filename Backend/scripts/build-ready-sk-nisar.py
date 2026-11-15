"""Publish three compatible observations where those already satisfy the requested 3–4 dates."""
from pathlib import Path
import sys,importlib.util,json,hashlib
import numpy as np
import rasterio
spec=importlib.util.spec_from_file_location('skbuild',Path(__file__).with_name('build-sk-sequences.py'));b=importlib.util.module_from_spec(spec);spec.loader.exec_module(b)
R=b.R
for slug in ['nepal-glacier-flood-2026','pakistan-tarbela-2026']:
    folder=R/'Backend/Stories/sk'/slug;records=b.read(folder/'retrieved-radar.json')
    if 'tarbela' in slug:
        cfg=b.read(R/'Backend/data/pakistan-tarbela-2026.case-study.json');old=cfg['observations'][1];source=Path(old['tif']);dest=b.CACHE/slug;dest.mkdir(exist_ok=True);path=dest/(old['id']+'-restored-linear.tif')
        if not path.exists():
            with rasterio.open(source) as src:
                assert src.tags()['units']=='dB' and src.tags()['measurement']=='HHHH'
                profile=src.profile.copy();profile.update(dtype='float32',nodata=np.nan,compress='deflate')
                with rasterio.open(path,'w',**profile) as out:
                    for _,window in src.block_windows(1):
                        a=src.read(1,window=window,masked=True);linear=np.power(10.,a.astype('float32')/10).filled(np.nan);out.write(linear.astype('float32'),1,window=window)
                    out.update_tags(**{**src.tags(),'units':'1','derivedFromUnits':'dB','operation':'10**(dB/10), restoring calibrated linear GCOV power before common-grid resampling'})
        records=[r for r in records if r['id']!=old['id']]
        records.append(dict(path=str(path),originalDbRaster=str(source),originalDbSha256=hashlib.sha256(source.read_bytes()).hexdigest(),id=old['id'],date=old['date'],productId=old['granuleId'],sourceUrl=old['sourceUrl'],measurement='HHHH',frequency='frequencyA'))
        title='Tarbela: three radar views across the season';location='Tarbela Reservoir, Pakistan';refs=cfg.get('references',[]);intro='Three compatible NISAR frequency-A HHHH observations show the reservoir landscape on 25 June, 19 July and 12 August 2026. The saved calibrated August dB raster is restored to linear power before common-grid resampling, so all three frames use the same processing order.';conclusion='Compare the shoreline and neighboring terrain through the actual acquisition dates. Radar response does not measure stored water volume or establish a flood. Wind, vegetation, roughness and geometry can influence brightness.'
    else:
        title='Nepal: three radar visits to a mountain river corridor';location='Rasuwa–Trishuli corridor, Nepal';refs=b.read(R/'stories/sk'/slug/'sources.json');intro='Three actual NISAR acquisitions on 19 August, 31 August and 6 October 2026 show the selected mountain river corridor. These catalogued radar dates are separate from the unresolved year printed on the older ESA optical preview.';conclusion='Use the baseline comparison to inspect persistent river-corridor and mountain-surface patterns. Shadow, layover, snow and ice complicate mountain radar. These views do not independently confirm a collapse mechanism or delineate the full debris-flow footprint.'
    unique={r['id']:r for r in records};records=sorted(unique.values(),key=lambda r:r['date'])
    assert 3<=len(records)<=4
    b.render(slug,title,location,records,b.read(folder/'study-area.geojson'),refs,intro,conclusion,'NISAR')
    b.save(folder/'retrieval-selection.json',dict(status='complete',selection='Three compatible actual acquisitions meet the requested 3–4 dates. Additional remote jobs are not required for this sequence.',dates=[r['date'] for r in records]))
