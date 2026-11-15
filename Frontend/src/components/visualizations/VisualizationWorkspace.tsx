import { useMemo, useState } from 'react';
import { ArrowLeft, BarChart3, CalendarDays, Database, Download, Layers3, RefreshCw, Satellite, TriangleAlert } from 'lucide-react';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { VisualizationWorkspaceProps } from '../../types/visualization';

const chartColor = '#65d6ca';

function formatDate(value?: string): string {
  return value ? new Date(value).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : 'N/A';
}

function EmptyState({ children }: { children: string }) {
  return <div className="visual-empty">{children}</div>;
}

export function VisualizationWorkspace({ selection, analysis, loading, error, onRefresh, onBack }: VisualizationWorkspaceProps) {
  const [polarization, setPolarization] = useState('all');
  const [selectedObservation, setSelectedObservation] = useState<string | null>(null);
  const observations = analysis?.observations ?? [];
  const dates = analysis?.acquisitionDates ?? [];
  const chartData = useMemo(() => dates.map((date) => ({
    date,
    observations: observations.filter((item) => item.acquiredAt?.startsWith(date)).length,
  })), [dates, observations]);
  const selected = observations.find((item) => item.id === selectedObservation);
  const bounds = analysis?.area.bbox;

  return <main className="visualization-workspace">
    <header className="visualization-header">
      <button className="visual-back" onClick={onBack}><ArrowLeft size={16} /> Globe</button>
      <div><span className="section-kicker">Earth observation analytics</span><h1>Visualizations</h1><p>{selection.properties?.name ?? 'Selected study area'} · {analysis ? `${analysis.area.centroid[1].toFixed(4)}°, ${analysis.area.centroid[0].toFixed(4)}°` : 'Loading study area'}</p></div>
      <div className="visual-header-actions">{error ? <span className="data-status offline">Data unavailable</span> : null}<button className="secondary-action" onClick={onRefresh} disabled={loading}><RefreshCw size={14} /> Refresh</button></div>
    </header>

    {error && <div className="visual-error"><TriangleAlert size={16} /> {error}</div>}
    {analysis?.warnings.map((warning) => <div className="visual-warning" key={warning}><TriangleAlert size={15} /> {warning}</div>)}

    <div className="visual-scroll">
      <section className="visual-stat-grid">
        <div className="visual-stat"><span>STUDY AREA</span><strong>{analysis ? `${analysis.area.areaKm2.toLocaleString()} km²` : 'N/A'}</strong><small>validated polygon</small></div>
        <div className="visual-stat"><span>OBSERVATIONS</span><strong>{analysis ? observations.length : 'N/A'}</strong><small>catalog granules</small></div>
        <div className="visual-stat"><span>ACQUISITION DATES</span><strong>{analysis ? dates.length : 'N/A'}</strong><small>{dates.length ? `${formatDate(dates[0])} — ${formatDate(dates.at(-1))}` : 'No dates returned'}</small></div>
        <div className="visual-stat"><span>FREQUENCIES</span><strong>{analysis?.frequencies.length ? analysis.frequencies.join(', ') : 'N/A'}</strong><small>from provider metadata</small></div>
        <div className="visual-stat"><span>POLARIZATIONS</span><strong>{analysis?.polarizations.length ? analysis.polarizations.join(', ') : 'N/A'}</strong><small>from provider metadata</small></div>
      </section>

      <section className="visual-card time-series-card"><div className="visual-card-heading"><div><span className="section-kicker">Temporal coverage</span><h2>Acquisitions over time</h2></div><CalendarDays size={18} /></div>{chartData.length ? <ResponsiveContainer width="100%" height={230}><LineChart data={chartData}><CartesianGrid stroke="#23414b" strokeDasharray="3 3" /><XAxis dataKey="date" stroke="#719198" tick={{ fontSize: 10 }} /><YAxis allowDecimals={false} stroke="#719198" tick={{ fontSize: 10 }} label={{ value: 'Observations', angle: -90, position: 'insideLeft', fill: '#719198', fontSize: 10 }} /><Tooltip contentStyle={{ background: '#0b2431', border: '1px solid #315764', color: '#d9eeeb' }} /><Line type="monotone" dataKey="observations" name="Catalog observations" stroke={chartColor} strokeWidth={2} dot={{ fill: chartColor, r: 3 }} /></LineChart></ResponsiveContainer> : <EmptyState>{loading ? 'Loading acquisition dates…' : 'No acquisition dates were returned for this polygon.'}</EmptyState>}<p className="data-note">This chart counts real catalog observations by acquisition date; it does not represent backscatter or environmental change.</p></section>

      <div className="visual-two-column">
        <section className="visual-card"><div className="visual-card-heading"><div><span className="section-kicker">Signal metadata</span><h2>Polarization analysis</h2></div><BarChart3 size={18} /></div>{analysis?.polarizations.length ? <><div className="filter-row">{analysis.polarizations.map((item) => <button className={polarization === item ? 'filter-chip active' : 'filter-chip'} key={item} onClick={() => setPolarization(item)}>{item}</button>)}</div><p className="analysis-copy">Showing catalog observations tagged with <strong>{polarization === 'all' ? 'all available channels' : polarization}</strong>. Measurement values and raster layers are only shown when processing assets are supplied by the backend.</p></> : <EmptyState>{loading ? 'Loading polarization metadata…' : 'Polarization metadata is not available from the current provider response.'}</EmptyState>}</section>
        <section className="visual-card"><div className="visual-card-heading"><div><span className="section-kicker">Spatial context</span><h2>Study polygon</h2></div><Layers3 size={18} /></div>{bounds ? <div className="mini-map"><div className="map-grid" /><div className="map-polygon" /><span className="map-label">{bounds[1].toFixed(2)}°N — {bounds[3].toFixed(2)}°N</span></div> : <EmptyState>Map geometry is unavailable.</EmptyState>}<p className="data-note">Raster layers will appear here when the backend exposes GeoTIFF, COG, or tile-service assets.</p></section>
      </div>

      <section className="visual-card explorer-card"><div className="visual-card-heading"><div><span className="section-kicker">Source records</span><h2>Observation explorer</h2></div><Database size={18} /></div>{observations.length ? <div className="observation-table-wrap"><table className="observation-table"><thead><tr><th>Date</th><th>Mission / provider</th><th>Product</th><th>Frequency</th><th>Polarization</th><th>Assets</th></tr></thead><tbody>{observations.map((observation) => <tr className={selectedObservation === observation.id ? 'selected' : ''} key={observation.id} onClick={() => setSelectedObservation(observation.id)}><td>{formatDate(observation.acquiredAt)}</td><td>{observation.provider}</td><td title={observation.title}>{observation.productType || observation.title}</td><td>{observation.frequencies.join(', ') || 'N/A'}</td><td>{observation.polarizations.join(', ') || 'N/A'}</td><td>{observation.downloadUrl || observation.metadataUrl ? <a href={observation.downloadUrl ?? observation.metadataUrl} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()}><Download size={14} /></a> : 'N/A'}</td></tr>)}</tbody></table></div> : <EmptyState>{loading ? 'Loading observation records…' : 'No observations intersect this study polygon.'}</EmptyState>}{selected && <div className="selected-record"><Satellite size={15} /><span><strong>{selected.title}</strong><small>{formatDate(selected.acquiredAt)} · {selected.provider} · Processing visualization assets are not available.</small></span></div>}</section>

      <section className="visual-card change-summary"><div className="visual-card-heading"><div><span className="section-kicker">Evidence boundary</span><h2>What is changing here?</h2></div></div><div className="evidence-grid"><div><strong>Observed</strong><p>{observations.length ? `${observations.length} catalog observation${observations.length === 1 ? '' : 's'} intersect the selected polygon.` : 'No satellite observations are currently available.'}</p></div><div><strong>Context</strong><p>No vegetation, population, agriculture, or water datasets are connected yet.</p></div><div><strong>Possible explanation</strong><p>Not assessed. The current backend provides discovery metadata, not change measurements or causal evidence.</p></div></div></section>
    </div>
  </main>;
}
