import type { GeoJsonPolygon, Position } from './types.js';

const EARTH_RADIUS_KM = 6371.0088;

export class GeometryValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GeometryValidationError';
  }
}

function isPosition(value: unknown): value is Position {
  return Array.isArray(value)
    && value.length >= 2
    && Number.isFinite(value[0])
    && Number.isFinite(value[1])
    && value[0] >= -180
    && value[0] <= 180
    && value[1] >= -90
    && value[1] <= 90;
}

function validateRing(ring: unknown, name: string): Position[] {
  if (!Array.isArray(ring) || ring.length < 4 || !ring.every(isPosition)) {
    throw new GeometryValidationError(`${name} must contain at least four [longitude, latitude] positions.`);
  }
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) {
    throw new GeometryValidationError(`${name} must be closed by repeating its first position.`);
  }
  const unique = new Set(ring.slice(0, -1).map(([longitude, latitude]) => `${longitude},${latitude}`));
  if (unique.size < 3) throw new GeometryValidationError(`${name} must contain at least three unique vertices.`);
  return ring;
}

export function validatePolygon(value: unknown): GeoJsonPolygon {
  if (!value || typeof value !== 'object') throw new GeometryValidationError('A GeoJSON Polygon Feature is required.');
  const feature = value as Partial<GeoJsonPolygon>;
  if (feature.type !== 'Feature' || !feature.geometry || feature.geometry.type !== 'Polygon') {
    throw new GeometryValidationError('Input must be a GeoJSON Feature with Polygon geometry.');
  }
  if (!Array.isArray(feature.geometry.coordinates) || feature.geometry.coordinates.length === 0) {
    throw new GeometryValidationError('Polygon geometry must contain an exterior ring.');
  }
  const coordinates = feature.geometry.coordinates.map((ring, index) => validateRing(ring, index === 0 ? 'Exterior ring' : `Interior ring ${index}`));
  const area = polygonAreaKm2(coordinates[0]);
  if (!Number.isFinite(area) || area <= 0) throw new GeometryValidationError('Polygon must enclose a non-zero area.');
  if (area > 10_000_000) throw new GeometryValidationError('Polygon is too large; requests are limited to 10,000,000 km².');
  return { type: 'Feature', geometry: { type: 'Polygon', coordinates }, properties: feature.properties ?? null };
}

export function polygonBounds(ring: Position[]): [number, number, number, number] {
  const vertices = ring.slice(0, -1);
  return [
    Math.min(...vertices.map(([longitude]) => longitude)),
    Math.min(...vertices.map(([, latitude]) => latitude)),
    Math.max(...vertices.map(([longitude]) => longitude)),
    Math.max(...vertices.map(([, latitude]) => latitude)),
  ];
}

export function polygonCentroid(ring: Position[]): Position {
  const vertices = ring.slice(0, -1);
  return [
    vertices.reduce((sum, [longitude]) => sum + longitude, 0) / vertices.length,
    vertices.reduce((sum, [, latitude]) => sum + latitude, 0) / vertices.length,
  ];
}

export function polygonAreaKm2(ring: Position[]): number {
  let area = 0;
  for (let index = 0; index < ring.length - 1; index += 1) {
    const [lon1, lat1] = ring[index];
    const [lon2, lat2] = ring[index + 1];
    area += (lon2 - lon1) * Math.PI / 180
      * (2 + Math.sin(lat1 * Math.PI / 180) + Math.sin(lat2 * Math.PI / 180));
  }
  return Math.abs(area * EARTH_RADIUS_KM ** 2 / 2);
}
