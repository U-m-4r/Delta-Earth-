import { BarChart3, Check, ChevronRight, CircleAlert, Copy, Database, MapPinned, Trash2 } from 'lucide-react';
import type { GeoJsonFeature } from '../../types/geojson';
import { approximateAreaKm2, getBounds, getCenter } from '../../utils/geometry';
import { CoordinateTable } from '../Selection/CoordinateTable';
import { HomeStoriesStrip } from './HomeStoriesStrip';

type Props = {
  selection: GeoJsonFeature | null;
  draftVertexCount: number;
  selectionActive: boolean;
  onStart: () => void;
  onFinish: () => void;
  onClear: () => void;
  onSubmit: () => void;
  submitMessage: string | null;
  submitLoading?: boolean;
  analysisReady?: boolean;
  onOpenData?: () => void;
  onOpenVisualizations?: () => void;
  onOpenStory?: (slug: string) => void;
};

export function InformationPanel({
  selection,
  draftVertexCount,
  selectionActive,
  onStart,
  onFinish,
  onClear,
  onSubmit,
  submitMessage,
  submitLoading = false,
  analysisReady = false,
  onOpenData,
  onOpenVisualizations,
  onOpenStory,
}: Props) {
  const ring = selection?.geometry.coordinates[0];
  const center = ring ? getCenter(ring) : null;
  const bounds = ring ? getBounds(ring) : null;
  const messageTone = submitLoading ? 'info' : submitMessage?.includes('ready') ? 'success' : submitMessage ? 'error' : 'info';

  return (
    <aside className="information-panel">
      <div className="panel-title">
        <div>
          <span className="section-kicker">Study area</span>
          <h1>{selection ? 'Selected region' : 'Explore the Earth'}</h1>
        </div>
        <span className="panel-orbit"><MapPinned size={17} /></span>
      </div>

      {!selection && (
        <div className="intro-content">
          <p>Navigate the globe to explore our planet. When you are ready, define an area of interest with a precise polygon for future satellite analysis.</p>
          <div className="instruction-list">
            <div><span>01</span><b>Explore</b><small>Click and drag once to rotate, pinch or use two-finger scroll to zoom, and right-drag to pan.</small></div>
            <div><span>02</span><b>Search</b><small>Find any country, city, forest, or landmark.</small></div>
            <div><span>03</span><b>Select</b><small>Place at least three points around your study area.</small></div>
          </div>
          <button className="primary-action" onClick={onStart}>Start selecting area <ChevronRight size={16} /></button>
          {onOpenStory ? <HomeStoriesStrip onOpenStory={onOpenStory} /> : null}
        </div>
      )}

      {selection && ring && (
        <>
          <div className="selection-state"><span className="status-live" /> Polygon ready for review</div>
          <div className="summary-grid">
            <div><span>AREA</span><strong>{approximateAreaKm2(ring).toLocaleString()} <small>km²</small></strong></div>
            <div><span>VERTICES</span><strong>{ring.length - 1}</strong></div>
            <div><span>CENTRE</span><strong>{center?.[1].toFixed(4)}°, {center?.[0].toFixed(4)}°</strong></div>
            <div><span>COORDINATE SYSTEM</span><strong>WGS84 / EPSG:4326</strong></div>
          </div>
          <div className="bounds-box">
            <span>BOUNDING BOX</span>
            <p>{bounds?.minLatitude.toFixed(4)}° to {bounds?.maxLatitude.toFixed(4)}° lat<br />{bounds?.minLongitude.toFixed(4)}° to {bounds?.maxLongitude.toFixed(4)}° lon</p>
          </div>
          <div className="coordinate-heading">
            <span>VERTEX COORDINATES</span>
            <button title="Copy GeoJSON" onClick={() => void navigator.clipboard?.writeText(JSON.stringify(selection))}><Copy size={14} /></button>
          </div>
          <CoordinateTable coordinates={ring} />
          <div className="panel-actions">
            <button className="secondary-action" onClick={onStart} disabled={submitLoading}>Edit</button>
            <button className="secondary-action" onClick={onClear} disabled={submitLoading}><Trash2 size={15} /> Clear</button>
            <button className="primary-action" onClick={onSubmit} disabled={submitLoading}>
              <Check size={15} /> {submitLoading ? 'Searching NASA…' : 'Confirm selection'}
            </button>
          </div>

          {submitLoading && (
            <div className="submit-progress" role="status" aria-live="polite">
              <div className="submit-progress-track" aria-hidden="true" />
              <p>Searching NASA for NISAR radar records over this area. No files are being downloaded yet.</p>
            </div>
          )}

          {submitMessage && (
            <div className={`submit-message ${messageTone}`}>
              <CircleAlert size={14} /> {submitMessage}
            </div>
          )}

          {analysisReady && !submitLoading && (
            <div className="next-steps">
              <p>Next: open <strong>Data</strong> to browse and extract the satellite files, or <strong>Visualizations</strong> to compare dates. You can also use the buttons on the left toolbar.</p>
              <div className="next-steps-actions">
                {onOpenData ? <button className="primary-action" onClick={onOpenData}><Database size={15} /> Open Data</button> : null}
                {onOpenVisualizations ? <button className="secondary-action" onClick={onOpenVisualizations}><BarChart3 size={15} /> Open Visualizations</button> : null}
              </div>
            </div>
          )}

          {onOpenStory ? <HomeStoriesStrip onOpenStory={onOpenStory} /> : null}
        </>
      )}

      {selectionActive && !selection && (
        <div className="draft-callout">
          <span className="status-live" /> {draftVertexCount} point{draftVertexCount === 1 ? '' : 's'} placed. Add {Math.max(0, 3 - draftVertexCount)} more to form a polygon.
          <button onClick={onFinish}>Finish selection</button>
        </div>
      )}
    </aside>
  );
}
