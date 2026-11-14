import type { GeoJsonFeature } from '../types/geojson';
import type { AnalysisResult } from '../types/visualization';

const baseUrl = import.meta.env.VITE_BACKEND_URL ?? 'http://localhost:8787';

export async function analyzeStudyArea(geoJson: GeoJsonFeature, signal?: AbortSignal): Promise<AnalysisResult> {
  const response = await fetch(`${baseUrl}/api/study-areas/analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(geoJson),
    signal,
  });
  const body = await response.json() as AnalysisResult & { error?: string; detail?: string };
  if (!response.ok) throw new Error(body.detail ?? body.error ?? 'Study area analysis failed.');
  return body;
}
