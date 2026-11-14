import { polygonAreaKm2, polygonBounds, polygonCentroid, validatePolygon } from './geometry.js';
import { searchCatalogs } from './providers.js';
import type { AnalysisResponse, AvailabilityReport, GeoJsonPolygon, ProcessingStatus } from './types.js';

type StudyRecord = {
  id: string;
  polygon: GeoJsonPolygon;
  analysis: AnalysisResponse;
  createdAt: string;
  processing: ProcessingStatus;
};

const studies = new Map<string, StudyRecord>();

function createStudyId(): string {
  return `study_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export async function analyzeStudyArea(input: unknown, config: { baseUrl: string; timeoutMs: number; pageSize: number }): Promise<AnalysisResponse & { studyId: string }> {
  const polygon = validatePolygon(input);
  const catalog = await searchCatalogs(polygon, config);
  const observations = catalog.observations;
  const analysis: AnalysisResponse = {
    area: {
      areaKm2: Number(polygonAreaKm2(polygon.geometry.coordinates[0]).toFixed(3)),
      centroid: polygonCentroid(polygon.geometry.coordinates[0]),
      bbox: polygonBounds(polygon.geometry.coordinates[0]),
    },
    observations,
    acquisitions: catalog.acquisitions,
    collections: catalog.collections,
    acquisitionDates: catalog.acquisitions.map((item) => item.acquiredAt?.slice(0, 10)).filter((date): date is string => Boolean(date)).sort(),
    frequencies: [...new Set(observations.flatMap((item) => item.frequencies))].sort(),
    polarizations: [...new Set(observations.flatMap((item) => item.polarizations))].sort(),
    warnings: catalog.warnings,
  };
  const studyId = createStudyId();
  studies.set(studyId, {
    id: studyId,
    polygon,
    analysis,
    createdAt: new Date().toISOString(),
    processing: { studyId, status: 'discovered', progress: 0, processedObservationIds: [], failedObservationIds: [], errors: ['Raster processing is not configured: no HDF5/GDAL processing worker is installed.'] },
  });
  return { ...analysis, studyId };
}

export function getAvailability(studyId: string): AvailabilityReport | undefined {
  const study = studies.get(studyId);
  if (!study) return undefined;
  const datedAcquisitions = study.analysis.acquisitions.filter((item) => item.acquiredAt);
  const dates = datedAcquisitions.map((item) => item.acquiredAt as string).sort();
  const maturitySummary: Record<string, number> = { BETA: 0, PROVISIONAL: 0, VALIDATED: 0 };
  const acquisitionIdsByMaturity = new Map<string, Set<string>>();
  study.analysis.observations.forEach((observation) => {
    const maturity = observation.processingMaturity ?? 'UNKNOWN';
    const ids = acquisitionIdsByMaturity.get(maturity) ?? new Set<string>();
    ids.add(observation.acquisitionKey);
    acquisitionIdsByMaturity.set(maturity, ids);
  });
  acquisitionIdsByMaturity.forEach((ids, maturity) => { maturitySummary[maturity] = ids.size; });
  const acquisitionsByYear: Record<string, number> = {};
  const acquisitionsByMonth: Record<string, number> = {};
  datedAcquisitions.forEach((acquisition) => {
    const date = new Date(acquisition.acquiredAt as string);
    const year = String(date.getUTCFullYear());
    const month = `${year}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
    acquisitionsByYear[year] = (acquisitionsByYear[year] ?? 0) + 1;
    acquisitionsByMonth[month] = (acquisitionsByMonth[month] ?? 0) + 1;
  });
  return {
    studyArea: { areaKm2: study.analysis.area.areaKm2, boundingBox: study.analysis.area.bbox },
    availability: {
      earliestAcquisition: dates[0] ?? null,
      latestAcquisition: dates.at(-1) ?? null,
      totalAcquisitions: study.analysis.acquisitions.length,
      totalGranules: study.analysis.observations.length,
    },
    maturitySummary,
    collections: study.analysis.collections,
    acquisitionsByYear,
    acquisitionsByMonth,
    productsAvailable: [...new Set(study.analysis.observations.map((item) => item.productShortName))].sort(),
    polarizationsAvailable: [...new Set(study.analysis.observations.flatMap((item) => item.polarizations))].sort(),
    frequenciesAvailable: [...new Set(study.analysis.observations.flatMap((item) => item.frequencies))].sort(),
    warnings: study.analysis.warnings,
  };
}

export function getStudy(studyId: string): StudyRecord | undefined {
  return studies.get(studyId);
}

export function getProcessingStatus(studyId: string): ProcessingStatus | undefined {
  return studies.get(studyId)?.processing;
}

export function getProcessedObservations(studyId: string): Array<Record<string, unknown>> | undefined {
  const study = studies.get(studyId);
  if (!study) return undefined;
  return study.analysis.observations.map((observation) => ({
    ...observation,
    processingStatus: 'not_processed',
    layers: [],
    statistics: null,
    methodology: null,
  }));
}
