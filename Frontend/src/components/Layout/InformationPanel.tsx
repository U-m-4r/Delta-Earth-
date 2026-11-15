import { ArrowRight, BarChart3, Check, CircleAlert, Copy, Database, MapPinned, Trash2 } from 'lucide-react';
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
  onOpenStory?: (slug: string | null) => void;
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
      <div className={`panel-title${selection ? '' : ' welcome-reveal'}`}>
        <div>
          <h1>{selection ? 'Selected region' : 'Welcome to Delta Earth'}</h1>
        </div>
        <span className="panel-orbit"><MapPinned size={17} /></span>
      </div>

      {!selection && (
        <div className="intro-content welcome">
          <p className="welcome-reveal">
            See floods spread and reservoirs fill through radar from the NASA–ISRO <strong>NISAR</strong> satellite, which sees through clouds and darkness.
          </p>

          <div className="welcome-reveal">
            {onOpenStory ? <HomeStoriesStrip onOpenStory={onOpenStory} /> : null}
          </div>

          <div className="welcome-own welcome-reveal">
            <span className="section-kicker">Your own area</span>
            <button className="nasa-link" onClick={onStart}>Analyse any place on Earth <ArrowRight className="nasa-arrow" size={14} /></button>
          </div>
        </div>
      )}

      {selection && ring && (
        <>
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
              <p>Next: open <strong>Data</strong> to choose acquisitions and retrieve measurements. After processing, use <strong>View Visualization</strong> to explore the saved rasters.</p>
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
          {draftVertexCount} point{draftVertexCount === 1 ? '' : 's'} placed. Add {Math.max(0, 3 - draftVertexCount)} more to form a polygon.
          <button onClick={onFinish}>Finish selection</button>
        </div>
      )}
    </aside>
  );
}
