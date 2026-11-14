import type { Position } from '../../types/geojson';
export function CoordinateTable({ coordinates }: { coordinates: Position[] }) {
  return <div className="coordinate-table"><div className="coordinate-header"><span>POINT</span><span>LATITUDE</span><span>LONGITUDE</span></div>{coordinates.slice(0, -1).map(([longitude, latitude], index) => <div className="coordinate-row" key={`${longitude}-${latitude}-${index}`}><span>{String(index + 1).padStart(2, '0')}</span><span>{latitude.toFixed(6)}°</span><span>{longitude.toFixed(6)}°</span></div>)}</div>;
}
