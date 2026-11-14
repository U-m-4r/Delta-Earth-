import type { GeoJsonFeature } from '../types/geojson';
import { isValidPolygon } from '../utils/geometry';

export type SubmissionResult = { ok: boolean; message: string; payload?: GeoJsonFeature };

export async function submitStudyArea(geoJson: GeoJsonFeature): Promise<SubmissionResult> {
  if (!isValidPolygon(geoJson.geometry.coordinates[0])) {
    return { ok: false, message: 'Polygon needs at least three valid vertices.' };
  }
  const payload = JSON.parse(JSON.stringify(geoJson)) as GeoJsonFeature;
  const baseUrl = import.meta.env.VITE_BACKEND_URL ?? 'http://localhost:8787';
  try {
    const response = await fetch(`${baseUrl}/api/study-areas/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const result = await response.json() as { error?: string; observations?: unknown[]; acquisitionDates?: string[] };
    if (!response.ok) return { ok: false, message: result.error ?? 'Study area analysis failed.' };
    const observationCount = result.observations?.length ?? 0;
    const dateCount = result.acquisitionDates?.length ?? 0;
    return {
      ok: true,
      message: `Analysis ready: ${observationCount} observation${observationCount === 1 ? '' : 's'} across ${dateCount} acquisition date${dateCount === 1 ? '' : 's'}.`,
      payload,
    };
  } catch {
    return { ok: false, message: 'Analysis service is unavailable. Start the backend and try again.' };
  }
}
