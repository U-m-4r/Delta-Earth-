import type { GeoJsonFeature } from './geojson';

export type Observation = {
  id: string;
  provider: string;
  title: string;
  acquiredAt?: string;
  productType?: string;
  processingMaturity?: string;
  frequencies: string[];
  polarizations: string[];
  downloadUrl?: string;
  metadataUrl?: string;
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

export type VisualizationWorkspaceProps = {
  selection: GeoJsonFeature;
  analysis: AnalysisResult | null;
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
  onBack: () => void;
};
