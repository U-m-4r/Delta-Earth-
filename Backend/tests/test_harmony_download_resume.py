import httpx
import numpy as np
import pytest
from rasterio.io import MemoryFile
from rasterio.transform import from_origin
from app import harmony

def tiff_bytes():
    with MemoryFile() as mem:
        with mem.open(driver='GTiff',width=2,height=2,count=1,dtype='float32',crs='EPSG:4326',transform=from_origin(0,2,1,1)) as src:
            src.write(np.ones((2,2),dtype='float32'),1)
        return mem.read()

@pytest.mark.asyncio
async def test_complete_partial_is_validated_and_reused_after_416(tmp_path):
    target=tmp_path/'result.tif';partial=target.with_suffix('.tif.part');data=tiff_bytes();partial.write_bytes(data)
    def handle(request):
        assert request.headers['Range']==f'bytes={len(data)}-'
        return httpx.Response(416,headers={'Content-Range':f'bytes */{len(data)}'})
    async with httpx.AsyncClient(transport=httpx.MockTransport(handle)) as client:
        assert await harmony._download(client,'https://results.example/result.tif',target)==partial
    assert partial.read_bytes()==data

@pytest.mark.asyncio
async def test_corrupt_partial_restarts_instead_of_reusing_416(tmp_path):
    target=tmp_path/'result.tif';partial=target.with_suffix('.tif.part');partial.write_bytes(b'corrupt');data=tiff_bytes();calls=[]
    def handle(request):
        calls.append(request.headers.get('Range'))
        return httpx.Response(416,headers={'Content-Range':'bytes */7'}) if len(calls)==1 else httpx.Response(200,content=data)
    async with httpx.AsyncClient(transport=httpx.MockTransport(handle)) as client:
        result=await harmony._download(client,'https://results.example/result.tif',target)
    assert calls==['bytes=7-',None]
    assert result.read_bytes()==data

@pytest.mark.asyncio
async def test_completed_partial_still_obeys_storage_limit(tmp_path):
    target=tmp_path/'result.tif';partial=target.with_suffix('.tif.part');data=tiff_bytes();partial.write_bytes(data)
    async with httpx.AsyncClient(transport=httpx.MockTransport(lambda r:httpx.Response(416,headers={'Content-Range':f'bytes */{len(data)}'}))) as client:
        with pytest.raises(RuntimeError,match='storage limit'):
            await harmony._download(client,'https://results.example/result.tif',target,max_bytes=10)
    assert not partial.exists()
