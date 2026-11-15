import pytest
from fastapi.testclient import TestClient
from app.main import app, frontend_origins, settings

def test_local_frontend_aliases_share_the_configured_port():
    assert frontend_origins('http://localhost:5173/') == ['http://127.0.0.1:5173','http://localhost:5173']
    assert frontend_origins('https://127.0.0.1:4173') == ['https://127.0.0.1:4173','https://localhost:4173']
    assert frontend_origins('https://example.com') == ['https://example.com']

@pytest.mark.parametrize('host',['localhost','127.0.0.1'])
def test_story_catalog_and_images_work_from_both_local_origins(host):
    from urllib.parse import urlsplit
    config=urlsplit(settings.frontend_origin)
    if config.hostname not in {'localhost','127.0.0.1'}:pytest.skip('Configured frontend is not local')
    origin=f'{config.scheme}://{host}'+(f':{config.port}' if config.port else '')
    client=TestClient(app);headers={'Origin':origin}
    response=client.get('/api/stories',headers=headers)
    assert response.status_code==200
    assert response.headers['access-control-allow-origin']==origin
    row=next(r for r in response.json() if r['slug']=='punjab-floods-2025')
    response=client.get(f"/case-studies/{row['slug']}/{row['preview']}",headers=headers)
    assert response.status_code==200 and response.headers['content-type'].startswith('image/')
    assert response.headers['access-control-allow-origin']==origin

def test_unrelated_origins_are_not_enabled():
    response=TestClient(app).get('/api/stories',headers={'Origin':'https://unrelated.example'})
    assert 'access-control-allow-origin' not in response.headers
