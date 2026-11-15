import type { GeoJsonFeature } from '../types/geojson';
import type { AnalysisResult, Observation } from '../types/visualization';

const baseUrl = import.meta.env.VITE_BACKEND_URL ?? 'http://localhost:8787';

export type ExtractionVariable = { variable: string; variablePath?: string; status: string; error?: string; url?: string; bytes?: number };
export type ExtractionManifest = { granuleId: string; variables: ExtractionVariable[] };
export type RetrievalCombination = {
  granuleId: string; frequency: string; variable: string;
  acquisitionMetadata?: Observation;
  status?: string; jobId?: string | null; error?: string | null;
  bytes?: number; alreadyPresent?: boolean;
};
export type RetrievalSession = {
  retrievalSessionId: string; studyId: string; status: string;
  selectedGranuleCount: number; completedCount: number; failedCount: number;
  currentGranuleId?: string | null; currentVariable?: string | null;
  combinations: RetrievalCombination[]; startDate?: string | null; endDate?: string | null;
};

export async function searchNisarScenes(studyArea: GeoJsonFeature, startDate?: string, endDate?: string): Promise<AnalysisResult> {
  const response = await fetch(`${baseUrl}/api/nisar/scenes/search`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ studyArea, startDate: startDate || undefined, endDate: endDate || undefined }),
  });
  const body = await response.json() as AnalysisResult & { detail?: string };
  if (!response.ok) throw new Error(body.detail ?? 'NISAR discovery failed.');
  return body;
}

export async function extractNisarVariables(studyArea: GeoJsonFeature, granule: Observation, variables: string[], frequency: string): Promise<ExtractionManifest> {
  const response = await fetch(`${baseUrl}/api/nisar/extractions`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ studyArea, granuleId: granule.id, variables, frequency, acquisitionMetadata: granule }),
  });
  const body = await response.json() as ExtractionManifest & { detail?: string };
  if (!response.ok) throw new Error(body.detail ?? 'NISAR extraction failed.');
  return body;
}

export async function startNisarBatch(studyArea: GeoJsonFeature, studyId: string,
  startDate: string, endDate: string, combinations: RetrievalCombination[]): Promise<RetrievalSession> {
  const response = await fetch(`${baseUrl}/api/nisar/extractions/batch`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ studyArea, studyId, startDate: startDate || undefined,
      endDate: endDate || undefined, combinations }),
  });
  const body = await response.json() as RetrievalSession & { detail?: string };
  if (!response.ok) throw new Error(body.detail ?? 'Unable to start retrieval batch.');
  return body;
}

export async function getRetrievalSession(sessionId: string): Promise<RetrievalSession> {
  const response = await fetch(`${baseUrl}/api/retrieval-sessions/${encodeURIComponent(sessionId)}`);
  const body = await response.json() as RetrievalSession & { detail?: string };
  if (!response.ok) throw new Error(body.detail ?? 'Unable to load retrieval session.');
  return body;
}

export type Scene = Observation;
