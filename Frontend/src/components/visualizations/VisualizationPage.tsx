import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ChevronLeft, ChevronRight, CirclePause, CirclePlay, Image, Info, Layers3, SlidersHorizontal, TriangleAlert } from 'lucide-react';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { GeoJsonFeature } from '../../types/geojson';
import type { AnalysisResult, ProcessedObservation } from '../../types/visualization';

type Props = {
  selection: GeoJsonFeature;
  analysis: AnalysisResult | null;
  loading: boolean;
  error: string | null;
  onBack: () => void;
};

type Layer = 'coverage' | 'observation' | 'backscatter' | 'change';

function formatDate(value?: string): string {
  return value ? new Date(value).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : 'Unknown date';
}

function polygonPoints(selection: GeoJsonFeature, bounds?: [number, number, number, number]): string {
  const coordinates = selection.geometry.coordinates[0];
  if (!bounds) return '';
  const [minX, minY, maxX, maxY] = bounds;
  const width = Math.max(maxX - minX, 0.000001);
  const height = Math.max(maxY - minY, 0.000001);
  return coordinates.map(([longitude, latitude]) => `${8 + ((longitude - minX) / width) * 84},${92 - ((latitude - minY) / height) * 84}`).join(' ');
}

export function VisualizationPage({ selection, analysis, loading, error, onBack }: Props) {
  const acquisitions = useMemo(() => [...(analysis?.acquisitions ?? [])].filter((item) => item.acquiredAt).sort((a, b) => (a.acquiredAt ?? '').localeCompare(b.acquiredAt ?? '')), [analysis]);
  const observations = analysis?.observations ?? [];
  const [processed, setProcessed] = useState<ProcessedObservation[]>([]);
  const [pixel, setPixel] = useState<Record<string, unknown> | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [comparisonIndex, setComparisonIndex] = useState<number | null>(null);
  const [layer, setLayer] = useState<Layer>('coverage');
  const [playing, setPlaying] = useState(false);
  const [comparisonStats, setComparisonStats] = useState<Record<string, unknown> | null>(null);

  useEffect(() => {
    setSelectedIndex(0);
    setComparisonIndex(null);
    setPlaying(false);
    setProcessed([]);
    setPixel(null);
    setComparisonStats(null);
  }, [analysis?.studyId]);

  useEffect(() => {
    if (!analysis?.studyId) return undefined;
    let cancelled = false;
    const load = async () => {
      const response = await fetch(`${import.meta.env.VITE_BACKEND_URL ?? 'http://localhost:8787'}/api/studies/${analysis.studyId}/processed-observations`);
      if (!response.ok || cancelled) return;
      const body = await response.json() as { observations?: ProcessedObservation[] };
      if (!cancelled) setProcessed(body.observations ?? []);
    };
    void load();
    const timer = window.setInterval(() => void load(), 2500);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [analysis?.studyId]);

  useEffect(() => {
    if (!playing || acquisitions.length < 2) return undefined;
    const timer = window.setInterval(() => {
      setSelectedIndex((index) => (index + 1) % acquisitions.length);
    }, 1800);
    return () => window.clearInterval(timer);
  }, [playing, acquisitions.length]);

  const selectedAcquisition = acquisitions[selectedIndex];
  const selectedObservation = observations.find((item) => item.id === selectedAcquisition?.observationIds[0]);
  const selectedProcessed = processed.find((item) => item.id === selectedObservation?.id);
  const comparisonAcquisition = comparisonIndex === null ? undefined : acquisitions[comparisonIndex];
  const selectedDate = selectedAcquisition?.acquiredAt;
  const comparisonDate = comparisonAcquisition?.acquiredAt;
  useEffect(() => {
    const baseline = comparisonIndex === null ? undefined : acquisitions[comparisonIndex];
    if (!analysis?.studyId || !baseline || !selectedAcquisition) {
      setComparisonStats(null);
      return undefined;
    }
    const baselineObservation = baseline.observationIds[0];
    const currentObservation = selectedAcquisition.observationIds[0];
    const url = `${import.meta.env.VITE_BACKEND_URL ?? 'http://localhost:8787'}/api/studies/${analysis.studyId}/compare?baseline=${encodeURIComponent(baselineObservation)}&current=${encodeURIComponent(currentObservation)}`;
    let cancelled = false;
    void fetch(url).then((response) => response.ok ? response.json() as Promise<Record<string, unknown>> : null).then((value) => { if (!cancelled) setComparisonStats(value); });
    return () => { cancelled = true; };
  }, [analysis?.studyId, comparisonIndex, selectedAcquisition, acquisitions]);
  const chartData = acquisitions.map((acquisition) => ({
    date: acquisition.acquiredAt?.slice(0, 10),
    granules: acquisition.observationIds.length,
    acquisitionId: acquisition.id,
  }));
  const maturityCounts = acquisitions.reduce<Record<string, number>>((counts, acquisition) => {
    const maturity = observations.find((item) => item.id === acquisition.observationIds[0])?.processingMaturity ?? 'UNKNOWN';
    counts[maturity] = (counts[maturity] ?? 0) + 1;
    return counts;
  }, {});
  const points = polygonPoints(selection, analysis?.area.bbox);

  const moveSelection = (direction: -1 | 1) => {
    if (!acquisitions.length) return;
    setSelectedIndex((index) => (index + direction + acquisitions.length) % acquisitions.length);
  };

  return <main className="visualization-workspace">
    <header className="visualization-header">
      <button className="visual-back" onClick={onBack}><ArrowLeft size={16} /> Globe</button>
      <div><span className="section-kicker">Satellite storytelling</span><h1>Visualizations</h1><p>{selection.properties?.name ?? 'Selected study area'} · {analysis ? `${analysis.area.centroid[1].toFixed(4)}°, ${analysis.area.centroid[0].toFixed(4)}°` : 'Loading study area'}</p></div>
      <div className="visual-header-actions"><span className={`data-status ${error ? 'offline' : ''}`}><span className="status-live" /> {error ? 'Data unavailable' : loading ? 'Updating' : 'Live catalog data'}</span></div>
    </header>
    {loading && <div className="visual-warning"><Info size={15} /> Loading complete catalogue coverage…</div>}
    {error && <div className="visual-error"><TriangleAlert size={16} /> {error}</div>}
    <div className="visual-scroll">
      <section className="visual-page-hero">
        <div className="visual-page-icon"><Layers3 size={24} /></div>
        <div><span className="section-kicker">Evidence-first analysis</span><h2>Explore the observed acquisition record</h2><p>Choose an acquisition date to inspect its footprint and metadata. Pixel layers become available when the backend has processed a raster asset.</p></div>
      </section>

      <section className="visual-card map-analysis-card">
        <div className="visual-card-heading"><div><span className="section-kicker">Spatial view</span><h2>{selectedDate ? formatDate(selectedDate) : 'No dated acquisition selected'}</h2></div><div className="layer-controls">{(['coverage', 'observation', 'backscatter', 'change'] as Layer[]).map((item) => <button key={item} className={layer === item ? 'filter-chip active' : 'filter-chip'} disabled={item !== 'coverage' && selectedProcessed?.processingStatus !== 'processed'} onClick={() => setLayer(item)}>{item}</button>)}</div></div>
        <div className="analysis-map" onClick={(event) => {
          if (!selectedProcessed?.raster || !analysis) return;
          const rect = event.currentTarget.getBoundingClientRect();
          const [minX, minY, maxX, maxY] = selectedProcessed.raster.bounds;
          const longitude = minX + ((event.clientX - rect.left) / rect.width) * (maxX - minX);
          const latitude = maxY - ((event.clientY - rect.top) / rect.height) * (maxY - minY);
          const url = `${import.meta.env.VITE_BACKEND_URL ?? 'http://localhost:8787'}/api/studies/${analysis.studyId}/observations/${selectedProcessed.id}/pixel?longitude=${longitude}&latitude=${latitude}`;
          void fetch(url).then((response) => response.ok ? response.json() as Promise<Record<string, unknown>> : null).then((value) => setPixel(value));
        }}>
          <svg viewBox="0 0 100 100" role="img" aria-label="Selected study polygon and processing coverage">
            <defs><pattern id="map-grid" width="10" height="10" patternUnits="userSpaceOnUse"><path d="M 10 0 L 0 0 0 10" fill="none" stroke="#35616a" strokeWidth=".25" /></pattern></defs>
            <rect width="100" height="100" fill="url(#map-grid)" />
            {points && <polygon points={points} fill={layer === 'coverage' ? '#65d6ca24' : '#6f879018'} stroke="#65d6ca" strokeWidth=".8" />}
            {points && <polyline points={points} fill="none" stroke="#b3eee5" strokeWidth=".25" strokeDasharray="1 1" />}
          </svg>
          {selectedProcessed?.raster?.previewUrl && <img className="raster-preview" src={`${import.meta.env.VITE_BACKEND_URL ?? 'http://localhost:8787'}${selectedProcessed.raster.previewUrl}`} alt={`Processed ${selectedProcessed.raster.measurement}`} />}
          <div className="map-overlay-label"><span className="status-live" /> {selectedProcessed?.processingStatus === 'processed' ? `${selectedProcessed.raster?.measurement ?? 'Raster'} · click for pixel value` : `${selectedProcessed?.processingStatus ?? 'processing'} · catalog footprint`}</div>
          <div className="map-legend"><span><i className="legend-swatch polygon-swatch" />Study polygon</span><span><i className="legend-swatch nodata-swatch" />No processed pixels</span></div>
        </div>
        <div className="pixel-unavailable"><Image size={16} /><span><strong>{pixel ? 'Pixel measurement' : selectedProcessed?.processingStatus === 'processed' ? 'Click the raster to inspect a pixel' : 'Pixel inspection is waiting for processed raster data.'}</strong><small>{pixel ? `${String(pixel.value ?? 'NoData')} · ${String(pixel.longitude)}°, ${String(pixel.latitude)}°` : selectedProcessed?.processingError ?? 'Processed observations are downloaded and clipped on the backend; missing data is not interpreted as zero change.'}</small></span></div>
      </section>

      <section className="visual-card timeline-card">
        <div className="visual-card-heading"><div><span className="section-kicker">Temporal observation timeline</span><h2>{acquisitions.length ? `${selectedIndex + 1} of ${acquisitions.length} acquisitions` : 'No acquisitions available'}</h2></div><div className="timeline-actions"><button className="icon-action" disabled={!acquisitions.length} onClick={() => moveSelection(-1)} title="Previous acquisition"><ChevronLeft size={16} /></button><button className="icon-action play-action" disabled={acquisitions.length < 2} onClick={() => setPlaying((value) => !value)} title={playing ? 'Pause playback' : 'Play acquisitions'}>{playing ? <CirclePause size={18} /> : <CirclePlay size={18} />}</button><button className="icon-action" disabled={!acquisitions.length} onClick={() => moveSelection(1)} title="Next acquisition"><ChevronRight size={16} /></button></div></div>
        {acquisitions.length ? <div className="observation-timeline">{acquisitions.map((acquisition, index) => <button key={acquisition.id} className={`timeline-observation ${index === selectedIndex ? 'selected' : ''}`} onClick={() => { setSelectedIndex(index); setPlaying(false); }} title={`${formatDate(acquisition.acquiredAt)} · ${acquisition.observationIds.length} granule(s)`}><i /><span>{formatDate(acquisition.acquiredAt)}</span><small>{acquisition.observationIds.length} granule{acquisition.observationIds.length === 1 ? '' : 's'}</small></button>)}</div> : <div className="visual-empty">Only actual acquisition dates from NASA CMR appear here.</div>}
        <div className="comparison-controls"><span className="section-kicker">Compare dates</span><select value={comparisonIndex ?? ''} onChange={(event) => setComparisonIndex(event.target.value === '' ? null : Number(event.target.value))}><option value="">Select a baseline acquisition</option>{acquisitions.map((acquisition, index) => <option key={acquisition.id} value={index} disabled={index === selectedIndex}>{formatDate(acquisition.acquiredAt)}</option>)}</select><span className="comparison-arrow">→</span><strong>{comparisonDate ? formatDate(comparisonDate) : 'Current date'}</strong>{comparisonStats && <small className="comparison-result">mean Δ {String(comparisonStats.meanDifference ?? 'N/A')}</small>}</div>
      </section>

      <div className="visual-two-column">
        <section className="visual-card">        <div className="visual-card-heading"><div><span className="section-kicker">Catalog statistics</span><h2>Coverage and quality</h2></div><SlidersHorizontal size={18} /></div><div className="metric-list"><div><span>Polygon area</span><strong>{analysis ? `${analysis.area.areaKm2.toLocaleString()} km²` : 'N/A'}</strong></div><div><span>Valid observed area</span><strong>{selectedProcessed?.raster ? `${selectedProcessed.raster.validPixelCount.toLocaleString()} pixels` : 'Unavailable'}</strong></div><div><span>NoData pixels</span><strong>{selectedProcessed?.raster ? selectedProcessed.raster.nodataPixelCount.toLocaleString() : 'Unavailable'}</strong></div><div><span>Selected granules</span><strong>{selectedAcquisition?.observationIds.length ?? 0}</strong></div></div><p className="data-note">Counts come from the clipped raster when processing succeeds; polygon area and granules come from the catalog response.</p></section>
        <section className="visual-card"><div className="visual-card-heading"><div><span className="section-kicker">Selected source</span><h2>{selectedObservation?.productShortName ?? selectedObservation?.productType ?? 'No source selected'}</h2></div></div>{selectedObservation ? <dl className="metadata-list"><div><dt>Provider</dt><dd>{selectedObservation.provider}</dd></div><div><dt>Polarization</dt><dd>{selectedObservation.polarizations.join(', ') || 'Not reported'}</dd></div><div><dt>Frequency</dt><dd>{selectedObservation.frequencies.join(', ') || 'Not reported'}</dd></div><div><dt>Maturity</dt><dd>{selectedObservation.processingMaturity ?? 'Unknown'}</dd></div></dl> : <div className="visual-empty">Select a dated acquisition to inspect source metadata.</div>}</section>
      </div>

      <section className="visual-card"><div className="visual-card-heading"><div><span className="section-kicker">Historical record</span><h2>Catalog granules over time</h2></div></div>{chartData.length ? <ResponsiveContainer width="100%" height={220}><LineChart data={chartData} onClick={(event) => { const index = event.activeTooltipIndex; if (typeof index === 'number') setSelectedIndex(index); }}><CartesianGrid stroke="#23414b" strokeDasharray="3 3" /><XAxis dataKey="date" stroke="#719198" tick={{ fontSize: 10 }} /><YAxis allowDecimals={false} stroke="#719198" tick={{ fontSize: 10 }} /><Tooltip contentStyle={{ background: '#0b2431', border: '1px solid #315764', color: '#d9eeeb' }} /><Line type="monotone" dataKey="granules" name="Catalog granules" stroke="#65d6ca" strokeWidth={2} dot={{ fill: '#65d6ca', r: 3 }} /></LineChart></ResponsiveContainer> : <div className="visual-empty">No actual acquisition dates were returned for this polygon.</div>}<p className="data-note">This is a catalog availability series, not a backscatter or environmental-change series. Measurement graphs will be added from processed pixels only.</p></section>

      <section className="visual-card"><div className="visual-card-heading"><div><span className="section-kicker">Processing boundary</span><h2>What can be concluded now?</h2></div></div><div className="evidence-grid"><div><strong>Observed</strong><p>{acquisitions.length ? `${acquisitions.length} dated acquisition${acquisitions.length === 1 ? '' : 's'} intersect the selected polygon.` : 'No dated acquisitions intersect the selected polygon.'}</p></div><div><strong>Not measured</strong><p>Backscatter, valid-pixel area, differences, percentages, and environmental events are not available without processed raster measurements.</p></div><div><strong>Quality context</strong><p>Maturity counts: {Object.entries(maturityCounts).map(([name, count]) => `${name} ${count}`).join(' · ') || 'No quality metadata returned'}.</p></div></div></section>
    </div>
  </main>;
}
