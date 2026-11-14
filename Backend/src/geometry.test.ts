import assert from 'node:assert/strict';
import test from 'node:test';
import { polygonAreaKm2, validatePolygon } from './geometry.js';

const square = {
  type: 'Feature',
  geometry: { type: 'Polygon', coordinates: [[[72.8, 21.1], [73, 21.1], [73, 21.3], [72.8, 21.3], [72.8, 21.1]]] },
};

test('validates a closed GeoJSON polygon and calculates area', () => {
  const polygon = validatePolygon(square);
  assert.equal(polygon.geometry.type, 'Polygon');
  assert.ok(polygonAreaKm2(polygon.geometry.coordinates[0]) > 0);
});

test('rejects unclosed polygons', () => {
  assert.throws(() => validatePolygon({
    ...square,
    geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1]]] },
  }), /closed/);
});
