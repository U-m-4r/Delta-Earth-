import type { Position } from '../types/geojson';

export function isValidPolygon(ring: Position[]): boolean {
  if (ring.length < 4 || ring[0][0] !== ring[ring.length - 1][0] || ring[0][1] !== ring[ring.length - 1][1]) return false;
  return new Set(ring.slice(0, -1).map(([longitude, latitude]) => `${longitude.toFixed(7)},${latitude.toFixed(7)}`)).size >= 3;
}

export function getBounds(ring: Position[]) {
  const vertices = ring.slice(0, -1);
  return { minLongitude: Math.min(...vertices.map(([longitude]) => longitude)), maxLongitude: Math.max(...vertices.map(([longitude]) => longitude)), minLatitude: Math.min(...vertices.map(([, latitude]) => latitude)), maxLatitude: Math.max(...vertices.map(([, latitude]) => latitude)) };
}

export function getCenter(ring: Position[]): Position {
  const vertices = ring.slice(0, -1);
  return [vertices.reduce((sum, [longitude]) => sum + longitude, 0) / vertices.length, vertices.reduce((sum, [, latitude]) => sum + latitude, 0) / vertices.length];
}

export function approximateAreaKm2(ring: Position[]): number {
  const radius = 6371;
  let area = 0;
  const vertices = ring.slice(0, -1);
  for (let index = 0; index < vertices.length; index += 1) {
    const [lon1, lat1] = vertices[index];
    const [lon2, lat2] = vertices[(index + 1) % vertices.length];
    area += ((lon2 - lon1) * Math.PI / 180) * (2 + Math.sin(lat1 * Math.PI / 180) + Math.sin(lat2 * Math.PI / 180));
  }
  return Math.round(Math.abs(area * radius * radius / 2));
}
