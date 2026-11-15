from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
from collections import defaultdict
import requests,json
from shapely.geometry import shape,box
R=Path(__file__).resolve().parents[2];O=R/'Backend/Stories/sk'
jobs=[dict(slug='australia-murray-2022',bbox=[144.6,-36.2,144.9,-35.9],window='2022-09-20T00:00:00Z/2022-11-15T23:59:59Z'),dict(slug='usa-arkansas-2019',bbox=[-93.3,35.15,-93.05,35.35],window='2019-05-01T00:00:00Z/2019-06-30T23:59:59Z')]
def discover(job):
    folder=O/job['slug'];folder.mkdir(exist_ok=True);payload=dict(collections=['sentinel-1-rtc'],bbox=job['bbox'],datetime=job['window'],limit=100)
    r=requests.post('https://planetarycomputer.microsoft.com/api/stac/v1/search',json=payload,timeout=40);r.raise_for_status();d=r.json();(folder/'radar-discovery.json').write_text(json.dumps(dict(query=payload,response=d),indent=2)+'\n');groups=defaultdict(list)
    for f in d['features']:
        p=f['properties']
        if 'vv' not in f['assets'] or not shape(f['geometry']).covers(box(*job['bbox'])):continue
        key=(p['platform'],p['sat:relative_orbit'],p['sat:orbit_state'],p['proj:epsg'],p['s1:slice_number']);groups[key].append(f)
    groups=[dict(group=list(k),dates=sorted({f['properties']['datetime'] for f in v})) for k,v in groups.items()]
    groups.sort(key=lambda x:len(x['dates']),reverse=True);(folder/'compatible-groups.json').write_text(json.dumps(groups,indent=2)+'\n');print(json.dumps(dict(slug=job['slug'],features=len(d['features']),groups=groups[:3])),flush=True)
with ThreadPoolExecutor(2) as pool:list(pool.map(discover,jobs))
