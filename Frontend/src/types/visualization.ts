import type { GeoJsonFeature } from './geojson';

export type Observation = {
  id: string;
  provider: string;
  title: string;
  mission?: string;
  productShortName?: string;
  acquiredAt?: string;
  startAt?: string;
  endAt?: string;
  productType?: string;
  processingMaturity?: string;
  acquisitionKey?: string;
  frequencies: string[];
  polarizations: string[];
  bbox?: [number, number, number, number];
  downloadUrl?: string;
  metadataUrl?: string;
  browseUrl?: string;
  assets?: Array<{ type: 'data' | 'browse' | 'metadata'; url: string; title?: string; mediaType?: string }>;
  sourceMetadata?: {
    datasetId?: string;
    collectionConceptId?: string;
    dataCenter?: string;
    coordinateSystem?: string;
    granuleSizeMb?: number;
    updatedAt?: string;
    orbitDirection?: string;
    relativeOrbit?: string;
  };
};

export type Acquisition = {
  id: string;
  acquiredAt?: string;
  observationIds: string[];
  mission: string;
  productTypes: string[];
};

export type CollectionSummary = {
  id: string;
  shortName: string;
  title: string;
  maturity: string;
  productType?: string;
  temporalStart?: string;
  granuleCount: number;
};

export type AnalysisResult = {
  studyId?: string;
  area: {
    areaKm2: number;
    centroid: [number, number];
    bbox: [number, number, number, number];
  };
  observations: Observation[];
  acquisitions: Acquisition[];
  collections: CollectionSummary[];
  acquisitionDates: string[];
  frequencies: string[];
  polarizations: string[];
  warnings: string[];
};

export type ProcessedObservation = Observation & {
  processingStatus: 'downloaded' | 'processing' | 'processed' | 'failed' | 'unsupported_product_format';
  processingError?: string;
  raster?: {
    url?: string;
    previewUrl?: string;
    bounds: [number, number, number, number];
    crs?: string;
    width: number;
    height: number;
    resolution: [number, number];
    measurement: string;
    units?: string;
    validPixelCount: number;
    nodataPixelCount: number;
  };
};

export type VisualizationWorkspaceProps = {
  selection: GeoJsonFeature;
  analysis: AnalysisResult | null;
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
  onBack: () => void;
};
