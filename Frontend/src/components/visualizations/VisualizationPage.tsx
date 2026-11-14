import { ArrowLeft, BarChart3, Image, SlidersHorizontal } from 'lucide-react';
import type { GeoJsonFeature } from '../../types/geojson';
import type { AnalysisResult } from '../../types/visualization';

type Props = {
  selection: GeoJsonFeature;
  analysis: AnalysisResult | null;
  loading: boolean;
  error: string | null;
  onBack: () => void;
};

export function VisualizationPage({ selection, analysis, loading, error, onBack }: Props) {
  const center = selection.geometry.coordinates[0][0];
  const acquisitions = analysis?.acquisitions ?? [];
  const maturityCounts = acquisitions.reduce<Record<string, number>>((counts, acquisition) => {
    const observation = analysis?.observations.find((item) => item.id === acquisition.observationIds[0]);
    const maturity = observation?.processingMaturity ?? 'UNKNOWN';
    counts[maturity] = (counts[maturity] ?? 0) + 1;
    return counts;
  }, {});
  const dates = acquisitions.map((item) => item.acquiredAt).filter((date): date is string => Boolean(date)).sort();
  return <main className="visualization-workspace">
    <header className="visualization-header">
      <button className="visual-back" onClick={onBack}><ArrowLeft size={16} /> Globe</button>
      <div><span className="section-kicker">Satellite storytelling</span><h1>Visualizations</h1><p>{selection.properties?.name ?? 'Selected study area'} · {center[1].toFixed(4)}°, {center[0].toFixed(4)}°</p></div>
    </header>
    {loading && <div className="visual-warning">Loading complete catalogue coverage…</div>}
    {error && <div className="visual-error">{error}</div>}
    <div className="visual-scroll">
      <section className="visual-page-hero">
        <div className="visual-page-icon"><BarChart3 size={24} /></div>
        <div><span className="section-kicker">Visualization workspace</span><h2>Turn processed SAR data into insight</h2><p>Compare satellite measurements, inspect change over time, and build an evidence-based story for this study area.</p></div>
      </section>
      <section className="visual-card temporal-coverage-card"><div className="visual-card-heading"><div><span className="section-kicker">Complete catalogue period</span><h2>Temporal coverage</h2></div></div><div className="temporal-summary"><div><span>EARLIEST</span><strong>{dates[0] ? new Date(dates[0]).toLocaleDateString() : 'N/A'}</strong></div><div><span>LATEST</span><strong>{dates.at(-1) ? new Date(dates.at(-1) as string).toLocaleDateString() : 'N/A'}</strong></div><div><span>UNIQUE ACQUISITIONS</span><strong>{analysis ? acquisitions.length : 'N/A'}</strong></div></div>{acquisitions.length ? <div className="maturity-timeline">{acquisitions.map((acquisition) => { const observation = analysis?.observations.find((item) => item.id === acquisition.observationIds[0]); const maturity = observation?.processingMaturity ?? 'UNKNOWN'; return <div className={`timeline-marker ${maturity.toLowerCase()}`} title={`${acquisition.acquiredAt ?? 'Unknown date'} · ${maturity}`} key={acquisition.id}><span>{new Date(acquisition.acquiredAt ?? '').toLocaleDateString(undefined, { month: 'short', year: '2-digit' })}</span></div>; })}</div> : <div className="visual-empty">No catalogue acquisitions are available for this study area.</div>}<div className="maturity-legend">{['BETA', 'PROVISIONAL', 'VALIDATED'].map((maturity) => <span key={maturity}><i className={`legend-dot ${maturity.toLowerCase()}`} />{maturity} · {maturityCounts[maturity] ?? 0}</span>)}</div><p className="data-note">Catalogue availability is not an environmental measurement. Products from different maturity levels remain explicitly identified.</p></section>
      <div className="visual-two-column">
        <section className="visual-card visualization-feature-card"><Image size={20} /><h2>Image comparisons</h2><p>Before-and-after imagery, polarization layers, and change masks will appear here when processed raster assets are available.</p><span className="feature-status">Awaiting processed layers</span></section>
        <section className="visual-card visualization-feature-card"><SlidersHorizontal size={20} /><h2>Interactive analysis</h2><p>Explore compatible dates, frequency bands, and measurement units without mixing incompatible sensors or products.</p><span className="feature-status">Awaiting measurement data</span></section>
      </div>
      <section className="visual-card"><div className="visual-card-heading"><div><span className="section-kicker">Data boundary</span><h2>Visualization inputs</h2></div></div><div className="evidence-grid"><div><strong>Selected area</strong><p>Using the polygon selected on the globe.</p></div><div><strong>Source</strong><p>Only backend-provided raster measurements will be visualized.</p></div><div><strong>Scientific guardrail</strong><p>No synthetic values or unsupported environmental conclusions.</p></div></div></section>
    </div>
  </main>;
}
