export type Position = [number, number];

export type PolygonGeometry = {
  type: 'Polygon';
  coordinates: Position[][];
};

export type GeoJsonPolygon = {
  type: 'Feature';
  geometry: PolygonGeometry;
  properties?: Record<string, unknown> | null;
};

export type Observation = {
  id: string;
  provider: string;
  title: string;
  mission: string;
  productShortName: string;
  acquiredAt?: string;
  startAt?: string;
  endAt?: string;
  productType?: string;
  processingMaturity?: string;
  acquisitionKey: string;
  frequencies: string[];
  polarizations: string[];
  bbox?: [number, number, number, number];
  downloadUrl?: string;
  metadataUrl?: string;
  browseUrl?: string;
  assets: ObservationAsset[];
  sourceMetadata: {
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

export type ObservationAsset = {
  type: 'data' | 'browse' | 'metadata';
  url: string;
  title?: string;
  mediaType?: string;
};

export type CatalogSearch = {
  observations: Observation[];
  acquisitions: Acquisition[];
  collections: CollectionSummary[];
  warnings: string[];
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

export type Acquisition = {
  id: string;
  acquiredAt?: string;
  observationIds: string[];
  mission: string;
  productTypes: string[];
};

export type AnalysisResponse = {
  area: {
    areaKm2: number;
    centroid: Position;
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

export type AvailabilityReport = {
  studyArea: {
    areaKm2: number;
    boundingBox: [number, number, number, number];
  };
  availability: {
    earliestAcquisition: string | null;
    latestAcquisition: string | null;
    totalAcquisitions: number;
    totalGranules: number;
  };
  maturitySummary: Record<string, number>;
  collections: CollectionSummary[];
  acquisitionsByYear: Record<string, number>;
  acquisitionsByMonth: Record<string, number>;
  productsAvailable: string[];
  polarizationsAvailable: string[];
  frequenciesAvailable: string[];
  warnings: string[];
};

export type ProcessingStatus = {
  studyId: string;
  status: 'discovered' | 'queued' | 'processing' | 'completed' | 'failed';
  progress: number;
  processedObservationIds: string[];
  failedObservationIds: string[];
  errors: string[];
};

export type ObservationProcessingStatus = 'downloaded' | 'processing' | 'processed' | 'failed' | 'unsupported_product_format';

export type ProcessedObservation = Observation & {
  processingStatus: ObservationProcessingStatus;
  processingError?: string;
  raster?: {
    path?: string;
    previewPath?: string;
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
