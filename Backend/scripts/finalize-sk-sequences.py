from pathlib import Path
import json,hashlib,shutil
import numpy as np
import rasterio
from rasterio.vrt import WarpedVRT
from rasterio.enums import Resampling
from affine import Affine
from PIL import Image
R=Path(__file__).resolve().parents[2];LIB=R/'Backend/Stories';SK=LIB/'sk';P=LIB/'case-studies'
slugs=['assam-brahmaputra-2026','pakistan-indus-2026','pakistan-tarbela-2026','nepal-glacier-flood-2026','punjab-floods-2025','pakistan-floods-2022'];checks=[]
for slug in slugs:
    d=json.loads((P/slug/'result.json').read_text());sources=json.loads((SK/slug/'radar-sources.json').read_text())
    assert d['kind']=='sequence' and 3<=len(d['observations'])<=4
    assert [o['date'] for o in d['observations']]==sorted(o['date'] for o in d['observations'])
    grid=d['display']['grid'];prior=prior_valid=None
    for obs in d['observations']:
        row=next(r for r in sources if r['id']==obs['granuleId']);path=Path(row['path'])
        assert hashlib.sha256(path.read_bytes()).hexdigest()==obs['sourceSha256']
        assert hashlib.sha256((P/slug/obs['image']).read_bytes()).hexdigest()==obs['imageSha256']
        with Image.open(P/slug/obs['image']) as im:assert im.size==(grid['width'],grid['height']);im.verify()
        with rasterio.open(path) as src:
            units=src.tags().get('units') or src.tags(1).get('units')
            with WarpedVRT(src,crs=grid['crs'],transform=Affine(*grid['transform'][:6]),width=grid['width'],height=grid['height'],resampling=Resampling.bilinear,nodata=np.nan) as aligned:s=aligned.read(1,masked=True)
        v=s.data;valid=~np.ma.getmaskarray(s)&np.isfinite(v)
        if units!='dB':valid&=v>0;v=np.where(valid,10*np.log10(np.maximum(v,1e-30)),np.nan)
        assert int(valid.sum())==obs['validPixelCount']
        assert np.isclose(v[valid].mean(),obs['meanDb'],atol=1e-5)
        assert np.isclose(np.median(v[valid]),obs['medianDb'],atol=1e-5)
        if prior is not None:
            common=valid&prior_valid;delta=v[common]-prior[common];change=obs['changeFromPrevious']
            assert int(common.sum())==change['validPixelCount']
            assert np.isclose(delta.mean(),change['meanDb'],atol=1e-5)
        prior,prior_valid=v,valid
    checks.append(dict(slug=slug,frames=len(d['observations']),mission=d['mission'],dates=[o['date'][:10] for o in d['observations']],sourceUnitsChecked=True,sourceAndImageHashes=True,imageDimensions=True,validCountsAndDbStatistics=True,commonValidDifferences=True,grid=grid))
index=json.loads((P/'index.json').read_text());index=[x for x in index if x['slug']!='pakistan-indus-2026']
(P/'index.json').write_text(json.dumps(index,indent=2,ensure_ascii=False)+'\n')
(SK/'verification.json').write_text(json.dumps(dict(status='passed',stories=checks,activeCatalogCount=len(index),archived=['pakistan-indus-2026']),indent=2)+'\n')
(SK/'README.md').write_text('# SK radar stories\n\nCanonical location after the Story-design pull: Backend/Stories/sk. These six story definitions use the same sequence format and the same shared StoryViewer and AcquisitionTimeline as Umar\'s Bangalore and Jeddah stories. Actual rendered frames are served from the adjacent case-studies/<slug> folders, as for Umar. Raw calibrated GeoTIFF subsets are retained under data/ and referenced by radar-sources.json with exact source IDs, dates and file hashes.\n\n'+''.join('- '+x['slug']+' — '+str(x['frames'])+' observations; '+x['mission']+'; '+', '.join(x['dates'])+(' (archived from showcase)' if x['slug']=='pakistan-indus-2026' else '')+'\n' for x in checks)+'\nThe older optical research and independent flood evidence remain preserved in the original stories/sk directory. They are not substituted for these real radar frames. Nepal\'s old optical year conflict is separate from these catalogued NISAR acquisition timestamps. The 2022 and 2025 stories use Sentinel-1 C-band VV terrain-corrected data, not NISAR. Those two stories focus on explicitly defined subregions, not the entire country or province.\n\nEach sequence uses a common grid and fixed viridis −30 to +5 dB display. NISAR source dB values are not converted a second time; linear GCOV / Sentinel-1 gamma-naught power uses 10*log10. Preview grids are resampled to at most roughly 1800 pixels per side for practical viewing; statistics refer to that grid. Do not compare different missions or polarization channels as equivalent measurements. These are measured radar sequences, not validated flood classification, flood depth or storage estimates.\n\nReproduction: use dw Python, run Backend/scripts/build-sk-sequences.py for local/historical cases, Backend/scripts/retrieve-sk-nisar.py for the two NASA extractions, then Backend/scripts/finalize-sk-sequences.py. Historical subset selection uses the saved public STAC discovery under .local-run/sk-radar. Full originals are not downloaded; calibrated COG windows are read and saved locally. No signed access token is recorded in the story manifests.\n\nThe pull completed at e1603b7. Prior local tracked edits are retained in Git stash and .local-run/before-story-design-pull.\n',encoding='utf-8')
old=R/'stories/sk/README.md'
old.write_text(old.read_text()+'\n## New canonical radar stories\n\nThe latest radar sequences now live in Backend/Stories/sk, alongside Backend/Stories/umar, following the pulled Story-design architecture. This directory retains earlier research and verification evidence. See Backend/Stories/sk/README.md for dates, missions and active/archive status.\n')
print(json.dumps(dict(status='passed',sequences=len(checks),frames=sum(x['frames'] for x in checks),activeCatalogCount=len(index))))
