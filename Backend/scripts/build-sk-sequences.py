"""Build SK sequences from actual calibrated local NISAR / remote Sentinel-1 RTC rasters."""
from pathlib import Path
import sys,json,hashlib,shutil,requests
from collections import defaultdict
import numpy as np
import rasterio
from rasterio.windows import from_bounds,Window
from rasterio.warp import transform_bounds
from rasterio.vrt import WarpedVRT
from rasterio.enums import Resampling
from shapely.geometry import shape,box
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from app.raster_display import colorize_values
from app.raster_exports import _write_png

R=Path(__file__).resolve().parents[2];LIB=R/'Backend/Stories';SK=LIB/'sk';OUT=LIB/'case-studies';CACHE=R/'data/sk-radar';CACHE.mkdir(exist_ok=True);SK.mkdir(exist_ok=True)
def read(p):return json.loads(p.read_text(encoding='utf-8'))
def save(p,d):p.write_text(json.dumps(d,indent=2,allow_nan=False,ensure_ascii=False)+'\n',encoding='utf-8')
def digest(p):return hashlib.sha256(p.read_bytes()).hexdigest()

def render(slug,title,location,records,polygon,references,intro,conclusion,mission,review=None,publish=True):
    if not 3<=len(records)<=4:raise ValueError('Need three or four real observations')
    records=sorted(records,key=lambda r:r['date']);folder=OUT/slug;folder.mkdir(exist_ok=True)
    frames=[];previous=previous_valid=None
    with rasterio.open(records[0]['path']) as grid:
        crs,transform,width,height=grid.crs,grid.transform,grid.width,grid.height
        factor=max(1,int(np.ceil(max(width,height)/1800)))
        if factor>1:
            new_width,new_height=int(np.ceil(width/factor)),int(np.ceil(height/factor))
            transform=transform*rasterio.Affine.scale(width/new_width,height/new_height)
            width,height=new_width,new_height
    for i,row in enumerate(records):
        with rasterio.open(row['path']) as src:
            units=src.tags().get('units') or src.tags(1).get('units')
            if units not in ('dB','1','linear','power'):raise ValueError('Unrecognized radar source units')
            with WarpedVRT(src,crs=crs,transform=transform,width=width,height=height,nodata=np.nan,resampling=Resampling.bilinear) as aligned:s=aligned.read(1,masked=True)
        v=np.asarray(s.data,dtype=np.float32);valid=~np.ma.getmaskarray(s)&np.isfinite(v)
        if units!='dB':
            valid &= v>0;db=np.full(v.shape,np.nan,dtype=np.float32);db[valid]=10*np.log10(v[valid])
        else:db=v
        if valid.sum()<100:raise ValueError('Insufficient valid raster pixels')
        if slug=='nepal-glacier-flood-2026' and valid.mean()<.80:
            raise ValueError('Nepal source covers less than 80% of the display grid; select a matching full-footprint scene.')
        rgba,_,_=colorize_values(np.ma.array(db,mask=~valid),palette='viridis',minimum=-30,maximum=5)
        name=f'frame-{i+1}.png';_write_png(rgba,folder/name)
        label=['Reference observation','First return','Later landscape','Final observation'][i]
        if len(records)==3:label=['Reference observation','Intermediate observation','Final observation'][i]
        caption=f"{row['date'][:10]}: {mission} {row['measurement']} radar response on the common grid. Compare stable landmarks with the baseline; brightness differences alone do not establish flooding."
        frame=dict(key=f'frame-{i+1}',date=row['date'],image=name,label=label,caption=caption,granuleId=row['id'],productId=row['productId'],sourceUrl=row['sourceUrl'],measurement=row['measurement'],frequency=row['frequency'],mission=mission,sourceSha256=digest(Path(row['path'])),imageSha256=digest(folder/name),meanDb=float(db[valid].mean()),medianDb=float(np.median(db[valid])),validPixelCount=int(valid.sum()),validFraction=float(valid.mean()))
        if previous is not None:
            shared=valid&previous_valid
            if not shared.any():raise ValueError('No common valid overlap')
            delta=db[shared]-previous[shared];frame['changeFromPrevious']=dict(meanDb=float(delta.mean()),medianDb=float(np.median(delta)),validPixelCount=int(shared.sum()))
        frames.append(frame);previous,previous_valid=db,valid
    data=dict(kind='sequence',slug=slug,title=title,location=location,changeType='Multi-date radar observations',mission=mission,headline=f'Follow {location} across {len(frames)} real radar observations',introduction=intro,conclusion=conclusion,references=references,observations=frames,polygon=polygon,display=dict(palette='viridis',minimum=-30,maximum=5,units='dB',grid=dict(width=width,height=height,crs=str(crs),transform=list(transform))),method=f'{mission}, consistent polarization and orbit per story. Source calibrated power converted using 10*log10 where necessary; existing dB sources are not converted again. Bilinear alignment to the first grid, invalid/nonpositive power masked, fixed viridis −30 to +5 dB display. Statistics are radar response, not classified flood area.',review=review)
    save(folder/'result.json',data);save(folder/'sequence-data.json',data)
    owner=SK/slug;owner.mkdir(exist_ok=True);save(owner/'sequence-content.json',{k:v for k,v in data.items() if k not in ['observations']});save(owner/'radar-sources.json',records);save(owner/'result.json',data);save(owner/'study-area.geojson',polygon)
    (owner/'story.md').write_text('# '+title+'\n\nOwner: sk.\n\n'+intro+'\n\n## Actual radar observations\n\n'+''.join('- '+x['date']+' · '+x['productId']+'\n' for x in frames)+'\n## Interpretation\n\n'+conclusion+'\n\n'+data['method']+'\n',encoding='utf-8')
    if publish:
        index=read(OUT/'index.json');item=dict(slug=slug,title=title,location=location,changeType=data['changeType'],preview='frame-2.png',previewSha256=frames[1]['imageSha256'],observationCount=len(frames),period=frames[0]['date'][:10]+' – '+frames[-1]['date'][:10],owner='sk',description=conclusion,mission=mission)
        index=[item if x['slug']==slug else x for x in index]
        if not any(x['slug']==slug for x in index):index.append(item)
        save(OUT/'index.json',index)
    print(json.dumps(dict(story=slug,frames=len(frames),grid=[width,height],dates=[x['date'][:10] for x in frames],mission=mission)),flush=True)

def local(slug):
    cfg=read(R/'Backend/data'/f'{slug}.case-study.json');data=read(OUT/slug/'result.json')
    records=[dict(path=o['tif'],id=o['id'],date=o['date'],productId=o['granuleId'],sourceUrl=o['sourceUrl'],measurement=data['observations'][0].get('measurement','HHHH'),frequency='frequencyA') for o in cfg['observations']]
    for row in records:
        with rasterio.open(row['path']) as src:
            row['measurement']=src.tags()['measurement'];row['frequency']=src.tags()['frequency']
    data['event']=data.get('event',data.get('introduction','')).replace('2.12 lakh people displaced','2.12 lakh people affected')
    return cfg,data,records

def sentinel(slug,location,bbox,window):
    saved=R/'.local-run/sk-radar'/('punjab-2025-stac.json' if '2025' in slug else 'pakistan-2022-stac.json')
    items=read(saved)['features'];aoi=box(*bbox);groups=defaultdict(list)
    for item in items:
        p=item['properties']
        if shape(item['geometry']).covers(aoi) and 'vv' in item['assets']:
            key=(p['platform'],p['sat:relative_orbit'],p['sat:orbit_state'],p['proj:epsg'],p['s1:slice_number']);groups[key].append(item)
    candidates=[(k,sorted({i['properties']['datetime']:i for i in v}.values(),key=lambda x:x['properties']['datetime'])) for k,v in groups.items()]
    candidates=[x for x in candidates if len(x[1])>=3]
    if not candidates:raise ValueError('No group with three acquisitions covering the study area')
    key,items=max(candidates,key=lambda x:(len(x[1]),x[1][-1]['properties']['datetime']))
    items=[items[i] for i in np.linspace(0,len(items)-1,min(4,len(items)),dtype=int)]
    records=[];dest=CACHE/slug;dest.mkdir(exist_ok=True)
    for item in items:
        p=item['properties'];href=item['assets']['vv']['href'];path=dest/(item['id']+'.tif')
        if not path.exists():
            parts=href.split('/');account=parts[2].split('.')[0];container=parts[3]
            response=requests.get(f'https://planetarycomputer.microsoft.com/api/sas/v1/token/{account}/{container}',timeout=30);response.raise_for_status();signed=href+'?'+response.json()['token']
            print('Reading calibrated Sentinel-1 subset',item['id'],flush=True)
            try:
                with rasterio.Env(GDAL_DISABLE_READDIR_ON_OPEN='EMPTY_DIR',GDAL_HTTP_MAX_RETRY=2,GDAL_HTTP_TIMEOUT=45):
                    with rasterio.open(signed) as src:
                        bounds=transform_bounds('EPSG:4326',src.crs,*bbox,densify_pts=21);win=from_bounds(*bounds,transform=src.transform).round_offsets().round_lengths().intersection(Window(0,0,src.width,src.height))
                        height,width=max(1,int(win.height/2)),max(1,int(win.width/2));arr=src.read(1,window=win,out_shape=(height,width),masked=True,resampling=Resampling.average)
                        transform=src.window_transform(win)*rasterio.Affine.scale(win.width/width,win.height/height);profile=src.profile.copy();profile.update(driver='GTiff',height=height,width=width,transform=transform,nodata=np.nan,dtype='float32',count=1,compress='deflate');profile.pop('blockxsize',None);profile.pop('blockysize',None);profile.pop('tiled',None)
                        with rasterio.open(path,'w',**profile) as out:
                            out.write(arr.astype('float32').filled(np.nan),1);out.update_tags(units='1',measurement='VV',product='Sentinel-1 RTC',relativeOrbit=key[1],orbitPassDirection=key[2],acquiredAt=p['datetime'])
            except Exception as ex:raise RuntimeError('Remote radar subset failed: '+type(ex).__name__) from None
        records.append(dict(path=str(path),id=item['id'],date=p['datetime'],productId=p.get('s1:product_identifier',item['id']),sourceUrl=href,measurement='VV',frequency='C-band',orbit=key[1],direction=key[2],stacProperties=p))
    polygon=dict(type='Feature',properties=dict(owner='sk',name=location,scope='Focused subregion, not the full national event'),geometry=dict(type='Polygon',coordinates=[[[bbox[0],bbox[1]],[bbox[2],bbox[1]],[bbox[2],bbox[3]],[bbox[0],bbox[3]],[bbox[0],bbox[1]]]]))
    old=read(R/'stories/sk'/slug/'sequence-content.json')
    render(slug,old['title'],location,records,polygon,old['references'],f'{len(records)} calibrated Sentinel-1 C-band VV radar acquisitions over this focused study area. The image dates are actual acquisitions from {records[0]["date"][:10]} to {records[-1]["date"][:10]}. These historical observations are not NISAR data.', 'This sequence shows terrain-corrected radar response across the event period. Moisture, vegetation and surface roughness also affect brightness. This is not a validated water classification or a national flood-area estimate. The processed area is the explicitly mapped local subregion.', 'Sentinel-1 RTC')

if __name__=='__main__':
    mode=sys.argv[1]
    if mode=='local':
        for slug in ['assam-brahmaputra-2026','pakistan-indus-2026']:
            cfg,d,records=local(slug)
            render(slug,d['title'],d['location'],records,d['polygon'],d.get('references',[]),d['event'],'Follow the actual radar observations across the season. Differences are measured radar response, not proof of flooding. Independent flood evidence and classification limits remain applicable.','NISAR',publish=slug!='pakistan-indus-2026')
    elif mode=='historical':
        for slug,location,bbox in [('punjab-floods-2025','Lower Chenab near Multan, Punjab, Pakistan',[71.25,29.8,71.55,30.05]),('pakistan-floods-2022','Manchar Lake margin, Sindh, Pakistan',[67.4,26.4,67.8,26.8])]:
            try:sentinel(slug,location,bbox,None)
            except Exception as ex:print(slug,'FAILED',type(ex).__name__,str(ex)[:140],flush=True)
