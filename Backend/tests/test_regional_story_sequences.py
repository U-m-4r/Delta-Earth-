"""The European and African stories must be real, reproducible local sequences."""
import hashlib
import json
import math
import struct

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.stories import ROOT


@pytest.mark.parametrize('location,continent', [('po-delta', 'Europe'), ('senegal-river', 'Africa')])
def test_regional_sequence_provenance_and_offline_assets(location, continent, monkeypatch):
    async def forbidden(*args, **kwargs):
        raise AssertionError('Opening a prepared story must not retrieve satellite data')

    monkeypatch.setattr('app.main.search_granules', forbidden)
    monkeypatch.setattr('app.main.extract_granule', forbidden)
    slug = f'{location}-sequence-2026'
    client = TestClient(app)
    catalogue = client.get('/api/stories').json()
    entry = next(row for row in catalogue if row['slug'] == slug)
    response = client.get(f'/api/stories/{slug}')
    assert response.status_code == 200
    story = response.json()
    assert story['continent'] == continent
    assert story['kind'] == 'sequence'
    assert entry['observationCount'] == len(story['observations']) == 5
    assert story['display']['palette'] == 'viridis'
    assert story['display']['minimum'] == -30
    assert story['display']['maximum'] == 5
    assert story['display']['units'] == 'dB'
    dates = [row['date'][:10] for row in story['observations']]
    assert dates == sorted(set(dates)) == story['dates']
    discovery = json.loads((ROOT / 'umar' / location / 'discovery.json').read_text(encoding='utf-8'))
    chosen = discovery['candidateComparisons'][0]
    for frame in story['observations']:
        source = next(row for row in discovery['observations'] if row['id'] == frame['granuleId'])
        assert frame['productId'] == source['title']
        assert frame['date'] == source['acquiredAt']
        assert frame['sourceUrl'] == source['downloadUrl']
        assert f"_{chosen['geometry']}_" in frame['productId']
        assert frame['measurement'] == 'HHHH' and frame['frequency'] == 'frequencyA'
        assert {'frequency': 'frequencyA', 'variable': 'HHHH'} in source['availableVariables']
        image = client.get(f"/case-studies/{slug}/{frame['image']}")
        assert image.status_code == 200
        assert image.headers['content-type'] == 'image/png'
        assert hashlib.sha256(image.content).hexdigest() == frame['imageSha256']
        assert len(frame['sourceSha256']) == 64
        assert struct.unpack('>II', image.content[16:24]) == (
            story['display']['grid']['width'], story['display']['grid']['height'])
        assert frame['validPixelCount'] > 0
        assert math.isfinite(frame['meanDb']) and math.isfinite(frame['medianDb'])
    assert len({row['imageSha256'] for row in story['observations']}) == 5
