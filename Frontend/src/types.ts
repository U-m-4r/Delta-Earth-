export type StudyArea = {
  id: string;
  name: string;
  subtitle: string;
  coordinates: string;
  lat: number;
  lon: number;
  category: 'Forest' | 'Fire' | 'Agriculture' | 'Ice' | 'Desert';
  color: string;
  area: string;
  vegetation: number;
  change: string;
};

export type Layer = {
  id: string;
  label: string;
  color: string;
  visible: boolean;
  opacity: number;
};
