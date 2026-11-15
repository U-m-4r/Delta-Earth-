from pathlib import Path
import json,re,requests
from shapely.geometry import shape,Polygon
from shapely.ops import unary_union
from collections import defaultdict
R=Path(__file__).resolve().parents[2];folder=R/'Backend/Stories/sk/nepal-glacier-flood-2026';aoi=shape(json.loads((folder/'study-area.geojson').read_text())['geometry'])
r=requests.get('https://cmr.earthdata.nasa.gov/search/granules.json',params=dict(collection_concept_id='C2854338529-ASF',bounding_box=','.join(map(str,aoi.bounds)),temporal='2026-08-01T00:00:00Z,2026-10-15T23:59:59Z',page_size=100),timeout=35);r.raise_for_status();raw=r.json();(folder/'footprint-discovery.json').write_text(json.dumps(raw,indent=2)+'\n');groups=defaultdict(list)
for row in raw['feed']['entry']:
    polys=[]
    for rings in row.get('polygons',[]):
        for text in rings:
            coords=list(map(float,text.split()));p=Polygon([(coords[i+1],coords[i]) for i in range(0,len(coords),2)])
            if p.is_valid:polys.append(p)
    m=re.search(r'GCOV_\d+_(\d+_[AD]_\d+_[A-Z0-9]+_[A-Z0-9]+_[AB])_',row['title'])
    if not m or not polys:continue
    coverage=unary_union(polys).intersection(aoi).area/aoi.area
    groups[m[1]].append(dict(id=row['id'],date=row['time_start'],coverage=coverage,title=row['title']))
summary=sorted([dict(geometry=k,minimumCoverage=min(r['coverage'] for r in rows),rows=rows) for k,rows in groups.items()],key=lambda x:x['minimumCoverage'],reverse=True)
(folder/'footprint-ranking.json').write_text(json.dumps(summary,indent=2)+'\n')
print(json.dumps([dict(geometry=x['geometry'],minimumCoverage=x['minimumCoverage'],dates=len(x['rows'])) for x in summary],indent=2))
