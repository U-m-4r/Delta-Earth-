import type { GeoJsonFeature } from '../types/geojson';
import { isValidPolygon } from '../utils/geometry';

export type SubmissionResult = { ok: boolean; message: string; payload?: GeoJsonFeature };

export function submitStudyArea(geoJson: GeoJsonFeature): SubmissionResult {
  if (!isValidPolygon(geoJson.geometry.coordinates[0])) {
    return { ok: false, message: 'Polygon needs at least three valid vertices.' };
  }
  const payload = JSON.parse(JSON.stringify(geoJson)) as GeoJsonFeature;
  console.info('[Dancing With SAR] Frontend-only study area payload', payload);
  return { ok: true, message: 'Polygon validated. Payload is ready for backend integration.', payload };
}
