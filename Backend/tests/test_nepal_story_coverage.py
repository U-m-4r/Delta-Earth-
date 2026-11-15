import json
from pathlib import Path
import numpy as np
from PIL import Image

def test_nepal_frames_cover_the_study_grid_instead_of_a_thin_edge():
    folder=Path(__file__).resolve().parents[1]/'Stories/case-studies/nepal-glacier-flood-2026'
    story=json.loads((folder/'result.json').read_text())
    assert len(story['observations'])>=3
    for frame in story['observations']:
        assert frame['validFraction']>=.80, f"{frame['date']} has insufficient study-area coverage"
        with Image.open(folder/frame['image']) as image:
            alpha=np.asarray(image.convert('RGBA'))[...,3]
        assert float((alpha>0).mean())>=.80, 'The displayed frame must show the actual study area'
