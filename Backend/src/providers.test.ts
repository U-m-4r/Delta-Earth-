import assert from 'node:assert/strict';
import test from 'node:test';
import { parseGranule } from './providers.js';

test('extracts official CMR granule metadata and ASF assets', () => {
  const observation = parseGranule({
    id: 'G123-ASF',
    producer_granule_id: 'NISAR_L2_PR_GCOV_023_113_A_012_4005_DHDH_A_20260622T003523_20260622T003557_P05023_N_F_J_001',
    time_start: '2026-06-22T00:35:23.000Z',
    time_end: '2026-06-22T00:35:57.999Z',
    dataset_id: 'NISAR Provisional Geocoded Polarimetric Covariance Product (Version 1)',
    collection_concept_id: 'C2854338529-ASF',
    data_center: 'ASF',
    coordinate_system: 'CARTESIAN',
    granule_size: '5534.4',
    polygons: [['20.04668 74.2634 22.1266 73.71329 21.53741 71.31309 19.47038 71.90104 20.04668 74.2634']],
    links: [
      { rel: 'http://esipfed.org/ns/fedsearch/1.1/data#', href: 'https://example.test/granule.h5', title: 'Download granule.h5' },
      { rel: 'http://esipfed.org/ns/fedsearch/1.1/browse#', href: 'https://example.test/HHHV.png', title: 'granule_NATIVE_A_HHHH.png' },
      { rel: 'http://esipfed.org/ns/fedsearch/1.1/browse#', href: 'https://example.test/HVHV.png', title: 'granule_NATIVE_A_HVHV.png' },
    ],
  });
  assert.equal(observation.acquiredAt, '2026-06-22T00:35:23.000Z');
  assert.equal(observation.productShortName, 'GCOV');
  assert.equal(observation.productType?.startsWith('GCOV'), true);
  assert.deepEqual(observation.polarizations, ['HH', 'HV']);
  assert.deepEqual(observation.frequencies, ['L-band']);
  assert.deepEqual(observation.bbox, [19.47038, 71.31309, 22.1266, 74.2634]);
  assert.equal(observation.assets.length, 3);
  assert.equal(observation.sourceMetadata.dataCenter, 'ASF');
});
