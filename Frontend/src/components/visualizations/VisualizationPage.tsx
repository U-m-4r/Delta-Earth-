import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { ArrowLeft, ChevronLeft, ChevronRight, CirclePause, CirclePlay, Image, Info, Layers3, SlidersHorizontal, TriangleAlert } from 'lucide-react';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { GeoJsonFeature } from '../../types/geojson';
import type { AnalysisResult, ProcessedObservation, RasterOverlay } from '../../types/visualization';

type Props = {
  selection: GeoJsonFeature;
  analysis: AnalysisResult | null;
  loading: boolean;
  error: string | null;
  rasterClick: [number, number] | null;
  onRasterOverlayChange: (overlay: RasterOverlay | null) => void;
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

function rasterPlacement(bounds: [number, number, number, number] | undefined,
                         studyBounds: [number, number, number, number] | undefined): CSSProperties {
  if (!bounds || !studyBounds) return { display: 'none' };
  const [minX, minY, maxX, maxY] = studyBounds;
  const width = Math.max(maxX - minX, 0.000001);
  const height = Math.max(maxY - minY, 0.000001);
  const [rasterMinX, rasterMinY, rasterMaxX, rasterMaxY] = bounds;
  return {
    left: `${8 + ((rasterMinX - minX) / width) * 84}%`,
    top: `${8 + ((maxY - rasterMaxY) / height) * 84}%`,
    width: `${Math.max(0, ((rasterMaxX - rasterMinX) / width) * 84)}%`,
    height: `${Math.max(0, ((rasterMaxY - rasterMinY) / height) * 84)}%`,
  };
}

export function VisualizationPage({ selection, analysis, loading, error, rasterClick, onRasterOverlayChange, onBack }: Props) {
  const [processed, setProcessed] = useState<ProcessedObservation[]>([]);
  const [processedLoading, setProcessedLoading] = useState(false);
  const [selectedVariable, setSelectedVariable] = useState('');
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [pixel, setPixel] = useState<Record<string, unknown> | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [comparisonIndex, setComparisonIndex] = useState<number | null>(null);
  const [layer, setLayer] = useState<Layer>('coverage');
  const [playing, setPlaying] = useState(false);
  const [comparisonStats, setComparisonStats] = useState<Record<string, unknown> | null>(null);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [pollError, setPollError] = useState<string | null>(null);
  const observations = processed;
  const acquisitions = useMemo(() => {
    const grouped = new Map<string, ProcessedObservation[]>();
    for (const observation of processed) {
      const key = observation.acquiredAt ?? 'undated';
      grouped.set(key, [...(grouped.get(key) ?? []), observation]);
    }
    return [...grouped.entries()].map(([acquiredAt, items]) => ({
      id: acquiredAt,
      acquiredAt: acquiredAt === 'undated' ? undefined : acquiredAt,
      observationIds: items.map((item) => item.id), mission: 'NISAR',
      productTypes: [...new Set(items.map((item) => item.productType ?? 'GCOV'))],
    })).sort((a, b) => (a.acquiredAt ?? '').localeCompare(b.acquiredAt ?? ''));
  }, [processed]);

  useEffect(() => {
    setSelectedIndex(0);
    setComparisonIndex(null);
    setPlaying(false);
    setProcessed([]);
    setSelectedVariable('');
    setPreviewError(null);
    setPixel(null);
    setComparisonStats(null);
  }, [analysis?.studyId]);

  useEffect(() => {
    const firstProcessed = processed.findIndex((item) => item.processingStatus === 'processed');
    if (firstProcessed >= 0) setSelectedIndex((index) => processed.some((item) => item.id === acquisitions[index]?.observationIds[0] && item.processingStatus === 'processed') ? index : Math.max(0, acquisitions.findIndex((acquisition) => acquisition.observationIds.includes(processed[firstProcessed].id))));
  }, [processed, acquisitions]);

  useEffect(() => {
    const studyId = analysis?.studyId;
    if (!studyId) return undefined;
    let cancelled = false;
    const load = async () => {
      setProcessedLoading(true);
      try {
        const response = await fetch(`${import.meta.env.VITE_BACKEND_URL ?? 'http://localhost:8787'}/api/study-areas/${encodeURIComponent(studyId)}/processed-observations`);
        if (!response.ok) throw new Error(`Saved raster lookup returned HTTP ${response.status}.`);
        const body = await response.json() as { observations?: ProcessedObservation[] };
        if (!cancelled) { setPollError(null); setProcessed(body.observations ?? []); }
      } catch (pollingError) {
        if (!cancelled) setPollError(pollingError instanceof Error ? pollingError.message : 'Unable to poll processing status.');
      } finally { if (!cancelled) setProcessedLoading(false); }
    };
    void load();
    return () => { cancelled = true; };
  }, [analysis?.studyId]);

  useEffect(() => {
    if (!playing || acquisitions.length < 2) return undefined;
    const timer = window.setInterval(() => {
      setSelectedIndex((index) => {
        const next = acquisitions.findIndex((acquisition, offset) => offset > index && acquisition.observationIds.some((id) => processed.some((item) => item.id === id && item.processingStatus === 'processed')));
        return next >= 0 ? next : index;
      });
    }, 1800 / playbackSpeed);
    return () => window.clearInterval(timer);
  }, [playing, acquisitions, playbackSpeed, processed]);

  const selectedAcquisition = acquisitions[selectedIndex];
  const selectedObservation = observations.find((item) => item.id === selectedAcquisition?.observationIds[0]);
  const availableVariables = selectedObservation?.variables ?? [];
  const activeVariable = availableVariables.some((item) => item.name === selectedVariable) ? selectedVariable : availableVariables[0]?.name ?? '';
  const selectedLayer = availableVariables.find((item) => item.name === activeVariable);
  const selectedProcessed = useMemo(() => selectedObservation ? { ...selectedObservation, raster: selectedLayer ? {
    ...selectedLayer.raster, measurement: selectedLayer.name, previewUrl: selectedLayer.previewUrl, url: selectedLayer.rasterUrl,
  } : selectedObservation.raster } : undefined, [selectedObservation, selectedLayer]);
  const comparisonAcquisition = comparisonIndex === null ? undefined : acquisitions[comparisonIndex];
  const selectedDate = selectedAcquisition?.acquiredAt;
  const comparisonDate = comparisonAcquisition?.acquiredAt;
  const displayPreviewUrl = layer === 'change' && comparisonIndex !== null && comparisonAcquisition && selectedObservation && activeVariable
    ? `/api/visualization/${encodeURIComponent(analysis?.studyId ?? '')}/difference/${encodeURIComponent(comparisonAcquisition.observationIds[0])}/${encodeURIComponent(selectedObservation.id)}/${encodeURIComponent(activeVariable)}`
    : selectedProcessed?.raster?.previewUrl;
  useEffect(() => {
    setPreviewError(null);
    setPreviewLoading(Boolean(selectedProcessed?.raster?.previewUrl));
    if (!displayPreviewUrl || !selectedProcessed?.raster?.boundsWgs84) {
      onRasterOverlayChange(null);
      return;
    }
    onRasterOverlayChange({
      url: `${import.meta.env.VITE_BACKEND_URL ?? 'http://localhost:8787'}${displayPreviewUrl}`,
      boundsWgs84: selectedProcessed.raster.boundsWgs84,
      opacity: layer === 'coverage' ? 0.7 : 0.9,
    });
  }, [layer, selectedProcessed, displayPreviewUrl, onRasterOverlayChange]);
  useEffect(() => {
    if (!rasterClick || !selectedProcessed?.raster || !analysis) return;
    const [longitude, latitude] = rasterClick;
    const url = `${import.meta.env.VITE_BACKEND_URL ?? 'http://localhost:8787'}/api/studies/${analysis.studyId}/observations/${selectedProcessed.id}/pixel?variable=${encodeURIComponent(activeVariable)}&longitude=${longitude}&latitude=${latitude}`;
    void fetch(url).then((response) => response.ok ? response.json() as Promise<Record<string, unknown>> : null).then((value) => setPixel(value));
  }, [rasterClick, selectedProcessed, analysis]);
  useEffect(() => {
    const baseline = comparisonIndex === null ? undefined : acquisitions[comparisonIndex];
    if (!analysis?.studyId || !baseline || !selectedAcquisition) {
      setComparisonStats(null);
      return undefined;
    }
    const baselineObservation = baseline.observationIds[0];
    const currentObservation = selectedAcquisition.observationIds[0];
    const url = `${import.meta.env.VITE_BACKEND_URL ?? 'http://localhost:8787'}/api/studies/${analysis.studyId}/compare?baseline=${encodeURIComponent(baselineObservation)}&current=${encodeURIComponent(currentObservation)}&variable=${encodeURIComponent(activeVariable)}`;
    let cancelled = false;
    void fetch(url).then((response) => response.ok ? response.json() as Promise<Record<string, unknown>> : null).then((value) => { if (!cancelled) setComparisonStats(value); });
    return () => { cancelled = true; };
  }, [analysis?.studyId, comparisonIndex, selectedAcquisition, acquisitions, activeVariable]);
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
  const savedRasterCount = processed.reduce((total, observation) => total + (observation.variables?.length ?? 0), 0);

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
    {pollError && <div className="visual-warning"><Info size={15} /> Saved raster lookup failed: {pollError}</div>}
    <div className="visual-scroll">
      <section className="visual-page-hero">
        <div className="visual-page-icon"><Layers3 size={24} /></div>
        <div><span className="section-kicker">Evidence-first analysis</span><h2>Explore the observed acquisition record</h2><p>Choose an acquisition date to inspect its footprint and metadata. Pixel layers become available when the backend has processed a raster asset.</p></div>
      </section>

      <section className="visual-card map-analysis-card">
        <div className="visual-card-heading"><div><span className="section-kicker">Locally saved raster · {activeVariable || 'no layer selected'}</span><h2>{selectedDate ? formatDate(selectedDate) : 'No processed acquisition selected'}</h2></div><div className="layer-controls">{availableVariables.length > 1 && <label className="raster-variable-select">Variable <select value={activeVariable} onChange={(event) => { setSelectedVariable(event.target.value); setPixel(null); }} aria-label="Raster variable">{availableVariables.map((item) => <option key={item.name} value={item.name}>{item.name}</option>)}</select></label>}{(['coverage', 'observation', 'backscatter', 'change'] as Layer[]).map((item) => <button key={item} className={layer === item ? 'filter-chip active' : 'filter-chip'} disabled={(item !== 'coverage' && selectedProcessed?.processingStatus !== 'processed') || (item === 'change' && comparisonIndex === null)} onClick={() => setLayer(item)}>{item === 'backscatter' ? `${activeVariable || 'Raster'} values` : item === 'coverage' ? 'Valid Data Coverage' : item}</button>)}</div></div>
        {processedLoading && <div className="visual-warning"><Info size={15} /> Loading locally saved rasters…</div>}
        {!processedLoading && !pollError && processed.length === 0 && <div className="visual-empty">No processed rasters are saved for this study area yet. Run an extraction from NISAR data retrieval first.</div>}
        <div className="analysis-map">
            <svg viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label="Selected study polygon and processing coverage">
            <defs><pattern id="map-grid" width="10" height="10" patternUnits="userSpaceOnUse"><path d="M 10 0 L 0 0 0 10" fill="none" stroke="#35616a" strokeWidth=".25" /></pattern></defs>
            <rect width="100" height="100" fill="url(#map-grid)" />
            {points && <polygon points={points} fill={layer === 'coverage' ? '#65d6ca24' : '#6f879018'} stroke="#65d6ca" strokeWidth=".8" />}
            {points && <polyline points={points} fill="none" stroke="#b3eee5" strokeWidth=".25" strokeDasharray="1 1" />}
          </svg>
          {displayPreviewUrl && <img className="raster-preview" style={rasterPlacement(selectedProcessed?.raster?.boundsWgs84, analysis?.area.bbox)} src={`${import.meta.env.VITE_BACKEND_URL ?? 'http://localhost:8787'}${displayPreviewUrl}`} alt={`${layer === 'change' ? 'Difference' : 'Processed'} ${selectedProcessed?.raster?.measurement ?? activeVariable}`} onLoad={() => setPreviewLoading(false)} onError={() => { setPreviewLoading(false); setPreviewError(layer === 'change' ? 'These rasters cannot be compared on a common grid.' : 'Saved raster preview could not be loaded.'); }} />}
          <div className="map-overlay-label"><span className="status-live" /> {selectedProcessed?.processingStatus === 'processed' ? `${selectedProcessed.raster?.measurement ?? 'Raster'} · ${formatDate(selectedDate)} · click for pixel value` : 'Choose an acquisition with a saved raster'}</div>
          <div className="map-legend"><span><i className="legend-swatch polygon-swatch" />Study polygon</span><span><i className="legend-swatch nodata-swatch" />No processed pixels</span></div>
        </div>
        {previewLoading && <div className="visual-warning"><Info size={15} /> Preparing cached raster preview…</div>}
        {previewError && <div className="visual-error"><TriangleAlert size={16} /> {previewError}</div>}
        <div className="pixel-unavailable"><Image size={16} /><span><strong>{pixel ? `${String(pixel.measurement ?? selectedProcessed?.raster?.measurement ?? 'Pixel measurement')} · ${formatDate(selectedDate)}` : selectedProcessed?.processingStatus === 'processed' ? 'Click the processed raster on the globe to inspect a pixel' : 'Pixel inspection is waiting for processed raster data.'}</strong><small>{pixel ? `${String(pixel.value ?? 'NoData')} · ${String(pixel.longitude)}°, ${String(pixel.latitude)}°${comparisonStats ? ` · Δ ${String(comparisonStats.meanDifference ?? 'N/A')}` : ''}` : selectedProcessed?.processingError ?? 'NoData remains transparent and is never interpreted as zero change.'}</small></span></div>
      </section>

      <section className="visual-card timeline-card">
        <div className="visual-card-heading"><div><span className="section-kicker">Temporal observation timeline</span><h2>{acquisitions.length ? `${selectedIndex + 1} of ${acquisitions.length} acquisitions` : 'No acquisitions available'}</h2></div><div className="timeline-actions"><button className="icon-action" disabled={!acquisitions.length} onClick={() => moveSelection(-1)} title="Previous acquisition"><ChevronLeft size={16} /></button><button className="icon-action play-action" disabled={acquisitions.length < 2} onClick={() => setPlaying((value) => !value)} title={playing ? 'Pause playback' : 'Play acquisitions'}>{playing ? <CirclePause size={18} /> : <CirclePlay size={18} />}</button><button className="icon-action" disabled={!acquisitions.length} onClick={() => moveSelection(1)} title="Next acquisition"><ChevronRight size={16} /></button></div></div>
        {acquisitions.length ? <div className="observation-timeline">{acquisitions.map((acquisition, index) => { const item = processed.find((candidate) => acquisition.observationIds.includes(candidate.id)); const status = item?.processingStatus ?? 'missing'; return <button key={acquisition.id} className={`timeline-observation ${index === selectedIndex ? 'selected' : ''} status-${status}`} onClick={() => { setSelectedIndex(index); setPlaying(false); setPixel(null); }} title={`${formatDate(acquisition.acquiredAt)} · ${item?.variables?.length ?? 0} saved variables`}><i /><span>{formatDate(acquisition.acquiredAt)}</span><small>{item?.variables?.length ?? 0} layers</small></button>; })}</div> : <div className="visual-empty">No acquisition dates are available from locally saved raster manifests.</div>}
        <div className="comparison-controls"><span className="section-kicker">Compare dates</span><select value={comparisonIndex ?? ''} onChange={(event) => { setComparisonIndex(event.target.value === '' ? null : Number(event.target.value)); setLayer(event.target.value === '' ? 'observation' : 'change'); }}><option value="">Select a baseline acquisition</option>{acquisitions.map((acquisition, index) => <option key={acquisition.id} value={index} disabled={index === selectedIndex || !acquisition.observationIds.some((id) => processed.some((item) => item.id === id && item.processingStatus === 'processed'))}>{formatDate(acquisition.acquiredAt)}</option>)}</select><span className="comparison-arrow">→</span><strong>{comparisonDate ? formatDate(comparisonDate) : 'Current date'}</strong>{comparisonStats && <small className="comparison-result">mean Δ {String(comparisonStats.meanDifference ?? 'N/A')}</small>}<label>Speed <select value={playbackSpeed} onChange={(event) => setPlaybackSpeed(Number(event.target.value))}><option value={0.5}>0.5×</option><option value={1}>1×</option><option value={2}>2×</option><option value={4}>4×</option></select></label></div>
      </section>

      <div className="visual-two-column">
        <section className="visual-card">        <div className="visual-card-heading"><div><span className="section-kicker">Raster statistics</span><h2>Coverage and measurements</h2></div><SlidersHorizontal size={18} /></div><div className="metric-list"><div><span>Polygon area</span><strong>{analysis ? `${analysis.area.areaKm2.toLocaleString()} km²` : 'N/A'}</strong></div><div><span>Mean / median</span><strong>{selectedProcessed?.raster ? `${selectedProcessed.raster.mean.toPrecision(5)} / ${selectedProcessed.raster.median.toPrecision(5)}` : 'Unavailable'}</strong></div><div><span>Minimum / maximum</span><strong>{selectedProcessed?.raster ? `${selectedProcessed.raster.minimum.toPrecision(5)} / ${selectedProcessed.raster.maximum.toPrecision(5)}` : 'Unavailable'}</strong></div><div><span>Valid / NoData</span><strong>{selectedProcessed?.raster ? `${selectedProcessed.raster.validPixelCount.toLocaleString()} / ${selectedProcessed.raster.nodataPixelCount.toLocaleString()}` : 'Unavailable'}</strong></div></div><p className="data-note">Values are calculated from the clipped GeoTIFF; the map layer is a transparent display stretch of the same pixels.</p></section>
        <section className="visual-card"><div className="visual-card-heading"><div><span className="section-kicker">Selected source</span><h2>{selectedObservation?.productShortName ?? selectedObservation?.productType ?? 'No source selected'}</h2></div></div>{selectedObservation ? <dl className="metadata-list"><div><dt>Provider</dt><dd>{selectedObservation.provider}</dd></div><div><dt>Polarization</dt><dd>{selectedObservation.polarizations.join(', ') || 'Not reported'}</dd></div><div><dt>Frequency</dt><dd>{selectedObservation.frequencies.join(', ') || 'Not reported'}</dd></div><div><dt>Maturity</dt><dd>{selectedObservation.processingMaturity ?? 'Unknown'}</dd></div></dl> : <div className="visual-empty">Select a dated acquisition to inspect source metadata.</div>}</section>
      </div>

      <section className="visual-card"><div className="visual-card-heading"><div><span className="section-kicker">Saved raster record</span><h2>Locally available acquisitions</h2></div></div>{chartData.length ? <ResponsiveContainer width="100%" height={220}><LineChart data={chartData} onClick={(event) => { const index = event.activeTooltipIndex; if (typeof index === 'number') setSelectedIndex(index); }}><CartesianGrid stroke="#23414b" strokeDasharray="3 3" /><XAxis dataKey="date" stroke="#719198" tick={{ fontSize: 10 }} /><YAxis allowDecimals={false} stroke="#719198" tick={{ fontSize: 10 }} /><Tooltip contentStyle={{ background: '#0b2431', border: '1px solid #315764', color: '#d9eeeb' }} /><Line type="monotone" dataKey="granules" name="Saved observations" stroke="#65d6ca" strokeWidth={2} dot={{ fill: '#65d6ca', r: 3 }} /></LineChart></ResponsiveContainer> : <div className="visual-empty">No saved raster dates yet.</div>}<p className="data-note">Dates appear here only when at least one valid raster is persisted locally for this study area.</p></section>

      <section className="visual-card"><div className="visual-card-heading"><div><span className="section-kicker">Processing boundary</span><h2>What can be concluded now?</h2></div></div><div className="evidence-grid"><div><strong>Observed</strong><p>{acquisitions.length ? `${acquisitions.length} locally processed acquisition${acquisitions.length === 1 ? '' : 's'} are available.` : 'No saved raster acquisitions are available.'}</p></div><div><strong>Raster comparison</strong><p>Pixel differences are calculated only for matching grids and available same-variable inputs. No environmental event classification is inferred.</p></div><div><strong>Quality context</strong><p>Maturity counts: {Object.entries(maturityCounts).map(([name, count]) => `${name} ${count}`).join(' · ') || 'No quality metadata returned'}.</p></div></div></section>
    </div>
    <div className="download-progress" role="status" aria-label="Saved raster availability"><div className="download-progress-copy"><span className="section-kicker">Persistent local storage</span><strong>{savedRasterCount} raster layer{savedRasterCount === 1 ? '' : 's'} available</strong></div><span className="download-progress-state">Visualization reads saved outputs only</span></div>
  </main>;
}
