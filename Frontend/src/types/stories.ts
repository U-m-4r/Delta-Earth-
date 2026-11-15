export type StoryIndexItem = {
  slug: string;
  title: string;
  location: string;
  changeType: string;
  preview?: string;
  previewSha256?: string;
  kind?: string;
  period?: string;
  observationCount?: number;
  description?: string;
  subtitle?: string;
  markerLocation?: { longitude: number; latitude: number; method?: string } | null;
};

export type StoryObservation = {
  key: string;
  label: string;
  date: string;
  image: string;
  imageSha256?: string;
  measurement?: string;
  bytesRead?: number | null;
  fileSizeMb?: number | null;
};

export type StoryWater = {
  waterBeforeKm2: number;
  waterAfterKm2: number;
  newWaterKm2: number;
  recededWaterKm2: number;
  stableWaterKm2: number;
  netWaterChangeKm2: number;
  validAreaKm2: number;
  thresholdDb: number;
  thresholdMethod: string;
  note?: string;
  colors?: Record<string, string>;
  classes?: Record<string, string>;
  analysisZone?: { rule: string; reason: string; areaKm2: number };
  reference?: {
    dataset?: string;
    comparedAreaKm2?: number;
    permanentWaterDetectedBefore?: number;
    newWaterOutsideUsualWaterShare?: number;
    beforeAgreement?: { recall?: number };
    afterAgreement?: { recall?: number };
  };
};

export type StoryPair = {
  from: string;
  to: string;
  water: StoryWater;
  waterImage: string;
  differenceImage: string;
};

export type StoryResult = {
  slug: string;
  title: string;
  location: string;
  changeType: string;
  headline: string;
  event: string;
  threshold: { valueDb: number; method: string; speckleFilter: string };
  observations: StoryObservation[];
  pairs: StoryPair[];
  references?: { title: string; url: string }[];
  areaKm2?: number;
};

export type SequenceStoryResult = {
  kind: 'sequence';
  mission?: string;
  slug: string;
  title: string;
  location: string;
  changeType: string;
  headline: string;
  introduction: string;
  conclusion: string;
  method: string;
  display: { palette: string; minimum: number; maximum: number; units: string };
  references: { title: string; url: string }[];
  observations: {
    key: string; date: string; image: string; label: string; caption: string;
    imageSha256?: string;
    granuleId: string; productId: string; sourceUrl: string;
    meanDb: number; medianDb: number; validPixelCount: number;
    changeFromPrevious?: { meanDb: number; medianDb: number; validPixelCount: number };
  }[];
};

export type DocumentaryStory = {
  kind: 'documentary'; slug: string; title: string; subtitle: string; location: string;
  interpretation: string;
  description?: string; introduction?: string; kicker?: string; introTitle?: string; introEmphasis?: string;
  summary?: string; method?: string; palette?: string; stretch?: string;
  displayRange?: { min: number; max: number }; changeRange?: number;
  chapters: { date: string; acquisitionDate: string; observationId: string; available: boolean;
    title: string; headline: string; narrative: string; observation: string; badge: string; stage: string;
    raster: { crs: string } | 'NAN'; }[];
};
