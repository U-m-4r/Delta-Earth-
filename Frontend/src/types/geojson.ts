export type Position = [number, number];

export type GeoJsonFeature = {
  type: 'Feature';
  geometry: { type: 'Polygon'; coordinates: [Position[]] };
  properties: { name: string; coordinateSystem: 'EPSG:4326' };
};
