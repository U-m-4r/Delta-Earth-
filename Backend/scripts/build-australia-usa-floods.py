"""Create researched four-date radar stories from public Sentinel-1 RTC COG subsets."""
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
import importlib.util,json,requests,numpy as np,rasterio
from rasterio.windows import Window,from_bounds
from rasterio.warp import transform_bounds
from rasterio.enums import Resampling
R=Path(__file__).resolve().parents[2];spec=importlib.util.spec_from_file_location('skbuilder',Path(__file__).with_name('build-sk-sequences.py'));b=importlib.util.module_from_spec(spec);spec.loader.exec_module(b)
configs=[
dict(slug='australia-murray-2022',title='When the Murray Spread Beyond Its Banks',location='Echuca–Moama, Murray River, Australia',continent='Oceania',bbox=[144.6,-36.2,144.9,-35.9],dates=['2022-09-25','2022-10-07','2022-10-31','2022-11-12'],orbit=118,
references=[dict(title='NASA: Flooding in Eastern Australia (October 2022)',url='https://science.nasa.gov/earth/earth-observatory/flooding-in-eastern-australia-150542/'),dict(title='Murray–Darling Basin Authority: River Murray 2022–23 flood review',url='https://www.mdba.gov.au/sites/default/files/publications/river-murray-2022-2023-flood-review-final-report.pdf'),dict(title='Sentinel-1 calibrated RTC data collection',url='https://planetarycomputer.microsoft.com/dataset/sentinel-1-rtc')],
intro='During the 2022 eastern Australian floods, water moved through the Murray–Darling Basin over weeks rather than a single moment. NASA reported major flooding around Echuca in late October, and the basin authority subsequently reviewed the 2022–23 river flood. These four radar visits follow a defined area around Echuca and Moama across the lead-up and the weeks following the reported crest.',
conclusion='The dates bracket the documented flood period, but there is no compatible 19 October frame in this selected orbit sequence: the record jumps from 7 to 31 October. The 31 October image follows the reported local crest and must not be labelled the peak itself. Radar response can change with standing water, wet soil, crops, flooded woodland and viewing geometry. This story does not calculate flood depth, damage or validated inundation area.'),
dict(slug='usa-arkansas-2019',title='The Arkansas River Under Pressure',location='Dardanelle floodplain, Arkansas, USA',continent='North America',bbox=[-93.3,35.15,-93.05,35.35],dates=['2019-05-17','2019-05-29','2019-06-10','2019-06-22'],orbit=63,
references=[dict(title='NASA: Flooding Along the Arkansas River (May 2019)',url='https://science.nasa.gov/earth/earth-observatory/flooding-along-the-arkansas-river-145108/'),dict(title='National Weather Service: Historic Arkansas River flooding in 2019',url='https://www.weather.gov/lzk/flood2019.htm'),dict(title='Sentinel-1 calibrated RTC data collection',url='https://planetarycomputer.microsoft.com/dataset/sentinel-1-rtc')],
intro='Repeated spring storms and upstream runoff drove historic flooding along the Arkansas River in May and June 2019. The National Weather Service documents record or near-record crests and a levee breach near Dardanelle. Four radar observations follow the selected local floodplain from 17 May through 22 June, with a 29 May acquisition during the documented river-flood emergency.',
conclusion='The 29 May acquisition is during the flood emergency, not a measurement of the eventual river crest. Later observations provide follow-up views; they do not establish that all land or communities had recovered. NASA’s regional optical imagery corroborates the broader disaster, while the NWS report supplies local Dardanelle context. Brightness alone cannot distinguish every wet field, reservoir margin or flooded woodland. No flood-area accuracy, water depth or damage estimate is claimed.')]

def retrieve(job):
    cfg,item=job;p=item['properties'];href=item['assets']['vv']['href'];dest=b.CACHE/cfg['slug'];dest.mkdir(exist_ok=True);path=dest/(item['id']+'.tif')
    if not path.exists():
        parts=href.split('/');account=parts[2].split('.')[0];container=parts[3];response=requests.get(f'https://planetarycomputer.microsoft.com/api/sas/v1/token/{account}/{container}',timeout=25);response.raise_for_status();signed=href+'?'+response.json()['token']
        print('Reading radar subset',cfg['slug'],p['datetime'],flush=True)
        try:
            with rasterio.Env(GDAL_DISABLE_READDIR_ON_OPEN='EMPTY_DIR',GDAL_HTTP_TIMEOUT=45,GDAL_HTTP_MAX_RETRY=2):
                with rasterio.open(signed) as src:
                    bounds=transform_bounds('EPSG:4326',src.crs,*cfg['bbox'],densify_pts=21);win=from_bounds(*bounds,transform=src.transform).round_offsets().round_lengths().intersection(Window(0,0,src.width,src.height));h,w=max(1,int(win.height/2)),max(1,int(win.width/2));a=src.read(1,window=win,out_shape=(h,w),masked=True,resampling=Resampling.average);valid=~np.ma.getmaskarray(a)&np.isfinite(a.data)&(a.data>0)
                    if valid.mean()<.90:raise ValueError('Less than 90% actual valid source coverage')
                    profile=src.profile.copy();profile.update(driver='GTiff',height=h,width=w,transform=src.window_transform(win)*rasterio.Affine.scale(win.width/w,win.height/h),nodata=np.nan,dtype='float32',count=1,compress='deflate');profile.pop('blockxsize',None);profile.pop('blockysize',None);profile.pop('tiled',None)
                    with rasterio.open(path,'w',**profile) as out:
                        out.write(np.where(valid,a.data,np.nan).astype('float32'),1);out.update_tags(units='1',measurement='VV',product='Sentinel-1 RTC gamma naught',relativeOrbit=p['sat:relative_orbit'],orbitPassDirection=p['sat:orbit_state'],acquiredAt=p['datetime'])
        except Exception as ex:raise RuntimeError(cfg['slug']+' radar download failed: '+type(ex).__name__) from None
    with rasterio.open(path) as src:a=src.read(1,masked=True);coverage=float((~np.ma.getmaskarray(a)&np.isfinite(a.data)&(a.data>0)).mean())
    print('Verified radar',cfg['slug'],p['datetime'][:10],round(coverage*100,2),flush=True)
    return cfg['slug'],dict(path=str(path),id=item['id'],date=p['datetime'],productId=p.get('s1:product_identifier',item['id']),sourceUrl=href,measurement='VV',frequency='C-band',orbit=p['sat:relative_orbit'],direction=p['sat:orbit_state'],validSourceCoverage=coverage,stacProperties=p)

jobs=[]
for cfg in configs:
    folder=b.SK/cfg['slug'];data=b.read(folder/'radar-discovery.json')['response'];items=data['features']
    for date in cfg['dates']:
        matches=[f for f in items if f['properties']['datetime'].startswith(date) and f['properties']['sat:relative_orbit']==cfg['orbit']]
        if len(matches)!=1:raise ValueError('Ambiguous date selection for '+cfg['slug']+' '+date)
        jobs.append((cfg,matches[0]))
records={cfg['slug']:[] for cfg in configs}
with ThreadPoolExecutor(max_workers=3) as pool:
    for slug,row in pool.map(retrieve,jobs):records[slug].append(row)
for cfg in configs:
    w,s,e,n=cfg['bbox'];polygon=dict(type='Feature',properties=dict(owner='sk',name=cfg['location'],scope='Focused river corridor, not the entire disaster'),geometry=dict(type='Polygon',coordinates=[[[w,s],[e,s],[e,n],[w,n],[w,s]]]))
    b.render(cfg['slug'],cfg['title'],cfg['location'],records[cfg['slug']],polygon,cfg['references'],cfg['intro'],cfg['conclusion'],'Sentinel-1 RTC')
    folder=b.OUT/cfg['slug'];d=b.read(folder/'result.json');d['continent']=cfg['continent'];d['eventEvidence']='Documented by the linked NASA and national/regional authority reports; radar observations are not a validated flood classification.'
    b.save(folder/'result.json',d);b.save(folder/'sequence-data.json',d);b.save(b.SK/cfg['slug']/'result.json',d)
    index=b.read(b.OUT/'index.json');entry=next(r for r in index if r['slug']==cfg['slug']);entry.update(continent=cfg['continent'],changeType='Documented river flood · radar observations');b.save(b.OUT/'index.json',index)
    b.save(b.SK/cfg['slug']/'research.json',dict(eventVerified=True,scope=cfg['location'],references=cfg['references'],selectedDates=cfg['dates'],dateGapsDisclosed=True,source='Public Sentinel-1 C-band VV RTC; no NISAR existed for these historical dates',independentPixelAccuracy='not established'))
