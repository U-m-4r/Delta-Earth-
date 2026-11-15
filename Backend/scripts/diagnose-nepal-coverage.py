from pathlib import Path
import json,numpy as np,rasterio,re
from shapely.geometry import Polygon,shape
R=Path(__file__).resolve().parents[2];folder=R/'Backend/Stories/sk/nepal-glacier-flood-2026';d=json.loads((folder/'discovery.json').read_text());aoi=shape(json.loads((folder/'study-area.geojson').read_text())['geometry'])
for row in json.loads((folder/'radar-sources.json').read_text()):
    with rasterio.open(row['path']) as src:
        a=src.read(1,masked=True).compressed();vals,counts=np.unique(a,return_counts=True);order=np.argsort(counts)[-4:]
        print('SOURCE',row['id'],'nodata',src.nodata,'quantiles',np.percentile(a,[0,10,50,90,100]).tolist(),'common',[(float(vals[i]),int(counts[i])) for i in order],flush=True)
raw=json.loads((R/'stories/sk/nepal-glacier-flood-2026/discovery.json').read_text())['observations']
print('raw keys',list(raw[0]),flush=True)
for row in d['observations']:
    props={k:row[k] for k in ['id','title','bbox'] if k in row}
    print('CATALOG',json.dumps(props),flush=True)
