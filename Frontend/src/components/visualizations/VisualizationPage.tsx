import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, CalendarDays, Layers3, LoaderCircle, Satellite, TriangleAlert } from 'lucide-react';
import type { GeoJsonFeature } from '../../types/geojson';
import type { RasterOverlay } from '../../types/visualization';

type Props = { selection?: GeoJsonFeature; retrievalSessionId: string; studyId: string;
  onRasterOverlayChange: (overlay: RasterOverlay | null) => void; onBack: () => void };
type Raster = { studyId: string; observationId: string; acquisitionDate?: string; variable: string;
  sourceVariable: string; frequency: string; raster: Record<string, unknown>; rasterUrl: string; bytes?: number };
type Observation = { observationId: string; granuleId: string; acquisitionDate?: string; title: string;
  frequencies: string[]; variables: string[]; polarizations: string[]; processingStatus: string };
type Catalog = { studyId: string; retrievalSessionId?: string; observations: Observation[];
  timeline: Array<{ date?: string; granuleCount: number; granuleIds: string[]; polarizations: string[] }> };
type VizSession = { sessionId: string; sessionToken: string; studyId: string };
type Retrieval = { status: string; selectedGranuleCount: number; completedCount: number; failedCount: number;
  startDate?: string; endDate?: string; combinations: Array<{ status: string }> };
type CompareResult = { productUrl: string; legend: string[]; boundsWgs84: [number, number, number, number]; statistics: Record<string, unknown> };
type DisplayLegend = { palette: string; stops: string[]; ticks: number[]; minimum: number; maximum: number;
  bands?: number; bandColors?: string[] | null };
type PixelInfo = { longitude: number; latitude: number; value: number | null; units: string;
  displayColor: string | null; sourceVariable: string; acquisitionDate?: string; nodata: boolean };

const baseUrl = import.meta.env.VITE_BACKEND_URL ?? 'http://localhost:8787';
const PALETTES = [
  ['grayscale', 'Grayscale'], ['red', 'Red'], ['viridis', 'Viridis'], ['plasma', 'Plasma'],
  ['inferno', 'Inferno'], ['magma', 'Magma'], ['turbo', 'Turbo'], ['jet', 'Jet / Rainbow (legacy)'],
  ['terrain', 'Terrain'], ['custom', 'Custom intensity palette'],
] as const;
const label = (variable: string) => {
  if (variable.startsWith('RATIO:')) { const [, frequency, n, d] = variable.split(':'); return `${frequency.replace('frequency', '')} · ${n}/${d} ratio`; }
  const [frequency, source] = variable.split(':', 2);
  const channel = ({ HHHH: 'HH', HVHV: 'HV', VHVH: 'VH', VVVV: 'VV' } as Record<string, string>)[source] ?? source;
  return `${frequency.replace('frequency', '')} · ${channel} (${source})`;
};
const headersFor = (session: VizSession) => ({ 'X-Visualization-Session-Token': session.sessionToken });
const legendGradient = (legend: DisplayLegend) => legend.bands && legend.bandColors?.length
  ? `linear-gradient(90deg, ${legend.bandColors.map((color, index) => `${color} ${index * 100 / legend.bandColors!.length}%, ${color} ${(index + 1) * 100 / legend.bandColors!.length}%`).join(', ')})`
  : `linear-gradient(90deg, ${legend.stops.join(', ')})`;

export function VisualizationPage({ selection, retrievalSessionId, studyId, onRasterOverlayChange, onBack }: Props) {
  const [retrieval, setRetrieval] = useState<Retrieval | null>(null);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [rasters, setRasters] = useState<Raster[]>([]);
  const [vizSession, setVizSession] = useState<VizSession | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState('');
  const [observationId, setObservationId] = useState('');
  const [variable, setVariable] = useState('');
  const [palette, setPalette] = useState('viridis');
  const [rangeMinimum, setRangeMinimum] = useState('');
  const [rangeMaximum, setRangeMaximum] = useState('');
  const [lowerPercentile, setLowerPercentile] = useState('2');
  const [upperPercentile, setUpperPercentile] = useState('98');
  const [stretch, setStretch] = useState<'linear' | 'log'>('linear');
  const [displayBands, setDisplayBands] = useState('0');
  const [displayLegend, setDisplayLegend] = useState<DisplayLegend | null>(null);
  const [pixelInfo, setPixelInfo] = useState<PixelInfo | null>(null);
  const [previewUrl, setPreviewUrl] = useState('');
  const [rgbUrl, setRgbUrl] = useState('');
  const [rgbLegend, setRgbLegend] = useState<string[]>([]);
  const [rgbChannels, setRgbChannels] = useState<[string, string, string]>(['', '', '']);
  const [compareMode, setCompareMode] = useState<'original_rgb' | 'polarization' | 'acquisitions'>('original_rgb');
  const [otherVariable, setOtherVariable] = useState('');
  const [baselineId, setBaselineId] = useState('');
  const [comparisonLegend, setComparisonLegend] = useState<string[]>([]);
  const [comparisonLeftUrl, setComparisonLeftUrl] = useState('');
  const [comparisonRightUrl, setComparisonRightUrl] = useState('');
  const [differenceUrl, setDifferenceUrl] = useState('');
  const [leftPalette, setLeftPalette] = useState('viridis');
  const [rightPalette, setRightPalette] = useState('viridis');
  const [lockColorScale, setLockColorScale] = useState(true);
  const [includeDifference, setIncludeDifference] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [zoom, setZoom] = useState(100);
  const [loading, setLoading] = useState(true);

  const observations = catalog?.observations ?? [];
  const dates = catalog?.timeline ?? [];
  const sameDateObservations = observations.filter((item) => (item.acquisitionDate ?? '').slice(0, 10) === selectedDate);
  const observation = sameDateObservations.find((item) => item.observationId === observationId) ?? sameDateObservations[0];
  const variables = observation?.variables ?? [];
  const raster = rasters.find((item) => item.observationId === observation?.observationId && item.variable === variable) ??
    rasters.find((item) => item.observationId === observation?.observationId);
  const earlierOptions = observations.filter((item) => item.observationId !== observation?.observationId &&
    (item.acquisitionDate ?? '').slice(0, 10) < (observation?.acquisitionDate ?? '').slice(0, 10) && item.variables.includes(variable));
  const frequencies = [...new Set(variables.map((item) => item.split(':', 1)[0]))];
  const activeFrequency = variable.includes(':') ? variable.split(':', 1)[0] : frequencies[0];
  const rgbOptions = useMemo(() => {
    const result = variables.filter((item) => item.startsWith(`${activeFrequency}:`));
    if (result.includes(`${activeFrequency}:VVVV`) && result.includes(`${activeFrequency}:VHVH`))
      result.push(`RATIO:${activeFrequency}:VVVV:VHVH`);
    return result;
  }, [variables.join('|'), activeFrequency]);
  const otherPolarizationOptions = variables.filter((item) => item !== variable &&
    item.split(':', 1)[0] === activeFrequency);

  useEffect(() => {
    let cancelled = false;
    let sessionValue: VizSession | null = null;
    let objectUrl = '';
    const load = async () => {
      setLoading(true); setError(null);
      try {
        const [retrievalResponse, rastersResponse] = await Promise.all([
          fetch(`${baseUrl}/api/retrieval-sessions/${encodeURIComponent(retrievalSessionId)}`),
          fetch(`${baseUrl}/api/retrieval-sessions/${encodeURIComponent(retrievalSessionId)}/rasters`),
        ]);
        if (!retrievalResponse.ok || !rastersResponse.ok) throw new Error('Saved retrieval session could not be loaded.');
        const retrievalBody = await retrievalResponse.json() as Retrieval;
        const rasterBody = await rastersResponse.json() as { rasters: Raster[] };
        if (cancelled) return;
        setRetrieval(retrievalBody); setRasters(rasterBody.rasters);
        const response = await fetch(`${baseUrl}/api/visualization/sessions`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ studyId, retrievalSessionId }),
        });
        const body = await response.json() as VizSession & { detail?: string };
        if (!response.ok) throw new Error(body.detail ?? 'Could not open the saved raster collection.');
        sessionValue = body;
        if (cancelled) { void fetch(`${baseUrl}/api/visualization/sessions/${body.sessionId}`, { method: 'DELETE', headers: headersFor(body), keepalive: true }); return; }
        setVizSession(body);
        const catalogResponse = await fetch(`${baseUrl}/api/visualization/sessions/${body.sessionId}/catalog`, { headers: headersFor(body) });
        if (!catalogResponse.ok) throw new Error('Saved raster catalog could not be loaded.');
        const nextCatalog = await catalogResponse.json() as Catalog;
        if (cancelled) return;
        setCatalog(nextCatalog);
        setSelectedDate(nextCatalog.timeline.at(-1)?.date ?? '');
        const latest = nextCatalog.observations.at(-1);
        setObservationId(latest?.observationId ?? '');
        setVariable(latest?.variables[0] ?? '');
      } catch (reason) { if (!cancelled) setError(reason instanceof Error ? reason.message : 'Visualization data could not be loaded.'); }
      finally { if (!cancelled) setLoading(false); }
    };
    void load();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      if (sessionValue) void fetch(`${baseUrl}/api/visualization/sessions/${sessionValue.sessionId}`, {
        method: 'DELETE', headers: headersFor(sessionValue), keepalive: true,
      }).catch(() => {});
    };
  }, [retrievalSessionId, studyId]);

  useEffect(() => {
    setRgbChannels((current) => {
      const preferred = rgbOptions.find((item) => item.includes('VVVV')) ?? rgbOptions[0] ?? '';
      const second = rgbOptions.find((item) => item.includes('VHVH')) ?? rgbOptions[1] ?? preferred;
      const third = rgbOptions.find((item) => item.startsWith('RATIO:')) ?? rgbOptions[2] ?? preferred;
      return current.every((item) => rgbOptions.includes(item)) && current.every(Boolean)
        ? current : [preferred, second, third];
    });
    if (!variables.includes(variable) && variables.length) setVariable(variables[0]);
  }, [observation?.observationId, variables.join('|')]);

  useEffect(() => {
    let objectUrl = '';
    let cancelled = false;
    if (!raster) { setPreviewUrl(''); setDisplayLegend(null); onRasterOverlayChange(null); return; }
    const query = new URLSearchParams({ palette, stretch, lower_percentile: lowerPercentile,
      upper_percentile: upperPercentile, bands: displayBands,
      frequency: raster.frequency ?? raster.variable.split(':', 1)[0] });
    if (rangeMinimum.trim()) query.set('minimum', rangeMinimum);
    if (rangeMaximum.trim()) query.set('maximum', rangeMaximum);
    const path = `/api/visualization/${studyId}/preview/${encodeURIComponent(raster.observationId)}/${encodeURIComponent(raster.sourceVariable)}`;
    void fetch(`${baseUrl}${path}?${query}`).then(async (response) => {
      if (!response.ok) throw new Error((await response.json()).detail ?? 'Raster preview could not be rendered.');
      const bounds = JSON.parse(response.headers.get('X-Raster-Bounds-WGS84') ?? 'null') as [number, number, number, number] | null;
      const legend = JSON.parse(response.headers.get('X-Raster-Legend') ?? 'null') as DisplayLegend | null;
      const blob = await response.blob();
      if (cancelled) return;
      objectUrl = URL.createObjectURL(blob); setPreviewUrl(objectUrl); setDisplayLegend(legend);
      onRasterOverlayChange(bounds ? { url: objectUrl, boundsWgs84: bounds, opacity: .88 } : null);
    }).catch((reason) => { if (!cancelled) { setError(reason instanceof Error ? reason.message : 'Raster preview failed.'); setPreviewUrl(''); onRasterOverlayChange(null); } });
    return () => { cancelled = true; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [raster?.rasterUrl, raster?.variable, palette, stretch, lowerPercentile, upperPercentile, displayBands,
      rangeMinimum, rangeMaximum, studyId]);

  useEffect(() => {
    if (!playing || !dates.length) return;
    const timer = window.setInterval(() => setSelectedDate((current) => {
      const index = dates.findIndex((item) => item.date === current);
      const next = dates[(index + 1) % dates.length];
      const nextObservation = observations.find((item) => (item.acquisitionDate ?? '').slice(0, 10) === (next?.date ?? ''));
      setObservationId(nextObservation?.observationId ?? '');
      return next?.date ?? '';
    }), 1400);
    return () => window.clearInterval(timer);
  }, [playing, dates, observations]);

  useEffect(() => {
    if (!otherVariable || otherVariable === variable || !variables.includes(otherVariable))
      setOtherVariable(variables.find((item) => item !== variable) ?? '');
    if (!earlierOptions.some((item) => item.observationId === baselineId))
      setBaselineId(earlierOptions.at(-1)?.observationId ?? '');
  }, [variable, observation?.observationId, variables.join('|'), earlierOptions.map((item) => item.observationId).join('|')]);

  useEffect(() => {
    if (rgbUrl.startsWith('blob:')) URL.revokeObjectURL(rgbUrl);
    setRgbUrl(''); setRgbLegend([]); setComparisonLegend([]); setPixelInfo(null);
  }, [observation?.observationId, variable]);

  const inspectPixel = async (event: React.MouseEvent<HTMLImageElement>) => {
    if (!raster) return;
    const image = event.currentTarget;
    const rect = image.getBoundingClientRect();
    const fit = Math.min(rect.width / image.naturalWidth, rect.height / image.naturalHeight);
    const renderedWidth = image.naturalWidth * fit, renderedHeight = image.naturalHeight * fit;
    const offsetX = (rect.width - renderedWidth) / 2, offsetY = (rect.height - renderedHeight) / 2;
    const x = Math.floor((event.clientX - rect.left - offsetX) / fit);
    const y = Math.floor((event.clientY - rect.top - offsetY) / fit);
    if (x < 0 || y < 0 || x >= image.naturalWidth || y >= image.naturalHeight) return;
    const query = new URLSearchParams({ x: String(x), y: String(y), palette, stretch,
      lower_percentile: lowerPercentile, upper_percentile: upperPercentile, bands: displayBands,
      max_dimension: String(Math.max(image.naturalWidth, image.naturalHeight)),
      frequency: raster.frequency ?? raster.variable.split(':', 1)[0] });
    if (rangeMinimum.trim()) query.set('minimum', rangeMinimum);
    if (rangeMaximum.trim()) query.set('maximum', rangeMaximum);
    const path = `/api/visualization/${studyId}/preview/${encodeURIComponent(raster.observationId)}/${encodeURIComponent(raster.sourceVariable)}/pixel`;
    const response = await fetch(`${baseUrl}${path}?${query}`);
    const body = await response.json() as PixelInfo & { detail?: string };
    if (!response.ok) { setError(body.detail ?? 'Pixel inspection failed.'); return; }
    setPixelInfo(body);
  };

  const makeRgb = async () => {
    if (!vizSession || rgbChannels.some((item) => !item)) return;
    setError(null);
    const query = new URLSearchParams({ red: rgbChannels[0], green: rgbChannels[1], blue: rgbChannels[2] });
    const response = await fetch(`${baseUrl}/api/visualization/sessions/${vizSession.sessionId}/rgb/${encodeURIComponent(observation?.observationId ?? '')}?${query}`, { headers: headersFor(vizSession) });
    if (!response.ok) { setError((await response.json()).detail ?? 'RGB composite generation failed.'); return; }
    const blob = await response.blob();
    if (rgbUrl.startsWith('blob:')) URL.revokeObjectURL(rgbUrl);
    setRgbUrl(URL.createObjectURL(blob)); setRgbLegend(JSON.parse(response.headers.get('X-RGB-Channel-Legend') ?? '[]'));
  };

  const makeComparison = async () => {
    setError(null); setComparisonLegend([]);
    setComparisonLeftUrl(''); setComparisonRightUrl(''); setDifferenceUrl('');
    const previewFor = (item: Raster, selectedPalette: string, min?: number, max?: number) => {
      const query = new URLSearchParams({ palette: selectedPalette, stretch, lower_percentile: lowerPercentile,
        upper_percentile: upperPercentile, bands: displayBands, frequency: item.frequency });
      if (min !== undefined && Number.isFinite(min)) query.set('minimum', String(min));
      if (max !== undefined && Number.isFinite(max)) query.set('maximum', String(max));
      return `${baseUrl}/api/visualization/${studyId}/preview/${encodeURIComponent(item.observationId)}/${encodeURIComponent(item.sourceVariable)}?${query}`;
    };
    if (compareMode === 'polarization') {
      const first = rasters.find((item) => item.observationId === observation?.observationId && item.variable === variable);
      const second = rasters.find((item) => item.observationId === observation?.observationId && item.variable === otherVariable);
      if (!first || !second) return;
      const low = lockColorScale ? Math.min(Number(first.raster.minimum), Number(second.raster.minimum)) : undefined;
      const high = lockColorScale ? Math.max(Number(first.raster.maximum), Number(second.raster.maximum)) : undefined;
      setComparisonLeftUrl(previewFor(first, leftPalette, low, high));
      setComparisonRightUrl(previewFor(second, lockColorScale ? leftPalette : rightPalette, low, high));
      return;
    }
    if (compareMode !== 'acquisitions' || !vizSession || !baselineId || !observation) return;
    const first = rasters.find((item) => item.observationId === baselineId && item.variable === variable);
    const second = rasters.find((item) => item.observationId === observation.observationId && item.variable === variable);
    if (!first || !second) { setError('The selected measurement is not saved for both acquisitions.'); return; }
    const low = lockColorScale ? Math.min(Number(first.raster.minimum), Number(second.raster.minimum)) : undefined;
    const high = lockColorScale ? Math.max(Number(first.raster.maximum), Number(second.raster.maximum)) : undefined;
    setComparisonLeftUrl(previewFor(first, leftPalette, low, high));
    setComparisonRightUrl(previewFor(second, lockColorScale ? leftPalette : rightPalette, low, high));
    if (!includeDifference) return;
    const params = new URLSearchParams({ baseline: baselineId, current: observation.observationId,
      variable, mode: 'difference', include_difference: 'false' });
    const response = await fetch(`${baseUrl}/api/visualization/sessions/${vizSession.sessionId}/compare?${params}`, { headers: headersFor(vizSession) });
    const body = await response.json() as CompareResult & { detail?: string };
    if (!response.ok) { setError(body.detail ?? 'Acquisition comparison failed.'); return; }
    setDifferenceUrl(`${baseUrl}${body.productUrl}`); setComparisonLegend(body.legend);
  };

  const rasterCountForDate = (day?: string) => rasters.filter((item) => (item.acquisitionDate ?? '').slice(0, 10) === day).length;

  return <main className="visualization-workspace">
    <header className="visualization-header"><button className="visual-back" onClick={onBack}><ArrowLeft size={16} /> Data</button><div><span className="section-kicker">Saved retrieval · {retrievalSessionId.slice(0, 8)}</span><h1>Raster visualization</h1><p>{selection?.properties?.name ?? `Study ${studyId}`} · data is read from the completed retrieval session</p></div></header>
    {error && <div className="visual-error"><TriangleAlert size={16} /> {error}</div>}
    {loading ? <div className="visual-empty"><LoaderCircle className="spin" size={18} /> Loading saved rasters…</div> : !rasters.length ? <div className="visual-empty"><Satellite size={20} /> No successful GeoTIFFs were saved in this retrieval session. Return to Data Retrieval and process a selection first.</div> : <div className="visual-scroll">
      <section className="visual-stat-grid"><div className="visual-stat"><span>RETRIEVAL SESSION</span><strong>{retrievalSessionId.slice(0, 8)}</strong><small>{retrieval?.status}</small></div><div className="visual-stat"><span>GRANULES</span><strong>{new Set(rasters.map((item) => item.observationId)).size}</strong><small>successfully processed</small></div><div className="visual-stat"><span>ACQUISITIONS</span><strong>{dates.length}</strong><small>{retrieval?.startDate ?? 'All'} — {retrieval?.endDate ?? 'All'}</small></div><div className="visual-stat"><span>RASTER OUTPUTS</span><strong>{rasters.length}</strong><small>persistent GeoTIFFs</small></div></section>
      <section className="visual-card"><div className="visual-card-heading"><div><span className="section-kicker">Acquisition timeline</span><h2>Processed dates and channels</h2></div><CalendarDays size={18} /></div><div className="timeline-controls"><button className="filter-chip" onClick={() => { const i = dates.findIndex((item) => item.date === selectedDate); const next = dates[Math.max(0, i - 1)]; setSelectedDate(next?.date ?? ''); setObservationId(observations.find((row) => (row.acquisitionDate ?? '').slice(0, 10) === (next?.date ?? ''))?.observationId ?? ''); }} disabled={!dates.length}>Previous</button><button className="filter-chip" onClick={() => setPlaying((value) => !value)} disabled={!dates.length}>{playing ? 'Pause playback' : 'Play timeline'}</button><button className="filter-chip" onClick={() => { const i = dates.findIndex((item) => item.date === selectedDate); const next = dates[Math.min(dates.length - 1, i + 1)]; setSelectedDate(next?.date ?? ''); setObservationId(observations.find((row) => (row.acquisitionDate ?? '').slice(0, 10) === (next?.date ?? ''))?.observationId ?? ''); }} disabled={!dates.length}>Next</button></div><div className="filter-row">{dates.map((item) => <button key={item.date ?? 'undated'} className={`filter-chip ${selectedDate === item.date ? 'active' : ''}`} onClick={() => { setSelectedDate(item.date ?? ''); const next = observations.find((row) => (row.acquisitionDate ?? '').slice(0, 10) === (item.date ?? '')); setObservationId(next?.observationId ?? ''); }}>{item.date ?? 'Date unavailable'} · {item.granuleCount} granules · {rasterCountForDate(item.date)} rasters · {item.polarizations.map((pol) => pol).join(', ')}</button>)}</div></section>
      <section className="visual-card"><div className="visual-card-heading"><div><span className="section-kicker">Individual raster</span><h2>Measurement viewer</h2></div><Layers3 size={18} /></div><div className="nisar-extract-controls"><label>Acquisition<select value={observation?.observationId ?? ''} onChange={(event) => setObservationId(event.target.value)}>{sameDateObservations.map((item) => <option key={item.observationId} value={item.observationId}>{item.granuleId}</option>)}</select></label><label>Measurement<select value={variable} onChange={(event) => setVariable(event.target.value)}>{variables.map((item) => <option key={item} value={item}>{label(item)}</option>)}</select></label><label>Palette<select value={palette} onChange={(event) => setPalette(event.target.value)}>{PALETTES.map(([value, title]) => <option key={value} value={value}>{title}</option>)}</select></label><label>Stretch<select value={stretch} onChange={(event) => setStretch(event.target.value as 'linear' | 'log')}><option value="linear">Linear</option><option value="log">Signed logarithmic</option></select></label><label>Display bands<select value={displayBands} onChange={(event) => setDisplayBands(event.target.value)}><option value="0">Continuous</option><option value="5">5 discrete bands</option><option value="10">10 discrete bands</option><option value="20">20 discrete bands</option></select></label><label><input type="checkbox" checked={!rangeMinimum && !rangeMaximum} onChange={(event) => { if (event.target.checked) { setRangeMinimum(''); setRangeMaximum(''); } else { setRangeMinimum(String(raster?.raster.minimum ?? '')); setRangeMaximum(String(raster?.raster.maximum ?? '')); } }} /> Automatic intensity range</label><label>Stretch minimum<input type="number" disabled={!rangeMinimum && !rangeMaximum} value={rangeMinimum} onChange={(event) => setRangeMinimum(event.target.value)} placeholder="2nd percentile" /></label><label>Stretch maximum<input type="number" disabled={!rangeMinimum && !rangeMaximum} value={rangeMaximum} onChange={(event) => setRangeMaximum(event.target.value)} placeholder="98th percentile" /></label><label>Lower percentile<input type="number" min="0" max="100" value={lowerPercentile} onChange={(event) => setLowerPercentile(event.target.value)} /></label><label>Upper percentile<input type="number" min="0" max="100" value={upperPercentile} onChange={(event) => setUpperPercentile(event.target.value)} /></label><button className="filter-chip" onClick={() => { setRangeMinimum(''); setRangeMaximum(''); setLowerPercentile('2'); setUpperPercentile('98'); setStretch('linear'); setPalette('viridis'); setDisplayBands('0'); }}>Reset to default</button></div>{previewUrl && <div className="visual-raster-display"><img src={previewUrl} alt={`${label(variable)} raster preview`} onClick={(event) => void inspectPixel(event)} title="Click a pixel to inspect its value" /><p>{label(variable)} · units {String(raster?.raster.units ?? 'not reported')} · {String(raster?.raster.width)} × {String(raster?.raster.height)} px · click a pixel to inspect · NoData shown transparent</p>{displayLegend && <div className="raster-legend"><strong>{displayLegend.palette} · {String(raster?.raster.units ?? 'unknown')}</strong><div className="raster-colorbar" style={{ background: legendGradient(displayLegend) }} /><div className="raster-legend-ticks">{displayLegend.ticks.map((tick, index) => <span key={index}>{Number(tick).toPrecision(4)}</span>)}</div><small>NoData: transparent · displayed range {displayLegend.minimum.toPrecision(5)}–{displayLegend.maximum.toPrecision(5)}</small></div>}{pixelInfo && <p className="pixel-inspection">{pixelInfo.nodata ? 'NoData' : `${pixelInfo.value} ${pixelInfo.units}`} · {pixelInfo.latitude.toFixed(6)}°, {pixelInfo.longitude.toFixed(6)}° · displayed {pixelInfo.displayColor ?? 'transparent'} · {label(variable)} · {observation?.acquisitionDate ?? 'date unavailable'}</p>}<a href={`${baseUrl}${raster?.rasterUrl}`} target="_blank" rel="noreferrer">Download source GeoTIFF</a></div>}</section>
      <section className="visual-card"><div className="visual-card-heading"><div><span className="section-kicker">False-color composite</span><h2>Configure RGB channels</h2></div></div><div className="nisar-extract-controls">{(['R', 'G', 'B'] as const).map((channel, index) => <label key={channel}>{channel} channel<select value={rgbChannels[index]} onChange={(event) => setRgbChannels((current) => current.map((value, i) => i === index ? event.target.value : value) as [string, string, string])}>{rgbOptions.map((item) => <option key={item} value={item}>{label(item)}</option>)}</select></label>)}<button className="primary-action" onClick={() => void makeRgb()} disabled={!rgbOptions.length}>Generate RGB</button></div>{rgbUrl && <div className="visual-raster-display"><img src={rgbUrl} alt="RGB false-color composite" /><p>{rgbLegend.join(' · ')}. False-color radar display, not natural color or a universal land-cover classification. Color mixing depends on channel intensity; black areas indicate masked NoData.</p></div>}</section>
      <section className="visual-card"><div className="visual-card-heading"><div><span className="section-kicker">Comparison</span><h2>Compare saved measurements</h2></div></div><div className="nisar-extract-controls"><label>Mode<select value={compareMode} onChange={(event) => setCompareMode(event.target.value as typeof compareMode)}><option value="original_rgb">Original vs RGB</option><option value="polarization">Different polarizations</option><option value="acquisitions">Different acquisitions</option></select></label>{compareMode === 'polarization' && <label>Right channel<select value={otherVariable} onChange={(event) => setOtherVariable(event.target.value)}>{otherPolarizationOptions.map((item) => <option key={item} value={item}>{label(item)}</option>)}</select></label>}{compareMode !== 'original_rgb' && <><label><input type="checkbox" checked={lockColorScale} onChange={(event) => { const locked = event.target.checked; setLockColorScale(locked); if (locked) setRightPalette(leftPalette); }} /> Lock color scale</label><label>Left palette<select value={leftPalette} onChange={(event) => { setLeftPalette(event.target.value); if (lockColorScale) setRightPalette(event.target.value); }}>{PALETTES.map(([value, title]) => <option key={value} value={value}>{title}</option>)}</select></label><label>Right palette<select value={lockColorScale ? leftPalette : rightPalette} disabled={lockColorScale} onChange={(event) => setRightPalette(event.target.value)}>{PALETTES.map(([value, title]) => <option key={value} value={value}>{title}</option>)}</select></label></>}{compareMode === 'acquisitions' && <><label>Earlier acquisition<select value={baselineId} onChange={(event) => setBaselineId(event.target.value)}>{earlierOptions.map((item) => <option key={item.observationId} value={item.observationId}>{item.granuleId} · {item.acquisitionDate}</option>)}</select></label><label><input type="checkbox" checked={includeDifference} onChange={(event) => setIncludeDifference(event.target.checked)} /> Include difference layer</label></>}<button className="primary-action" onClick={() => void makeComparison()} disabled={compareMode === 'acquisitions' && (!baselineId || !earlierOptions.length) || compareMode === 'polarization' && !otherPolarizationOptions.length}>Update comparison</button><label>Shared zoom<input type="range" min="100" max="250" value={zoom} onChange={(event) => setZoom(Number(event.target.value))} /></label><span>{zoom}%</span></div>{compareMode === 'original_rgb' && rgbUrl && <div className="comparison-panels"><figure><figcaption>Original · {label(variable)}</figcaption><img style={{ transform: `scale(${zoom / 100})` }} src={previewUrl} alt="Original raster" /></figure><figure><figcaption>RGB · {rgbLegend.join(' / ')}</figcaption><img style={{ transform: `scale(${zoom / 100})` }} src={rgbUrl} alt="RGB composite" /></figure></div>}{compareMode === 'polarization' && comparisonLeftUrl && comparisonRightUrl && <div className="comparison-panels"><figure><figcaption>Left · {label(variable)} · {leftPalette}</figcaption><img style={{ transform: `scale(${zoom / 100})` }} src={comparisonLeftUrl} alt="First polarization" /></figure><figure><figcaption>Right · {label(otherVariable)} · {lockColorScale ? leftPalette : rightPalette}</figcaption><img style={{ transform: `scale(${zoom / 100})` }} src={comparisonRightUrl} alt="Second polarization" /></figure></div>}{compareMode === 'acquisitions' && comparisonLeftUrl && comparisonRightUrl && <div className="comparison-panels"><figure><figcaption>Earlier · {label(variable)} · {leftPalette}</figcaption><img style={{ transform: `scale(${zoom / 100})` }} src={comparisonLeftUrl} alt="Earlier acquisition" /></figure><figure><figcaption>Later · {label(variable)} · {lockColorScale ? leftPalette : rightPalette}</figcaption><img style={{ transform: `scale(${zoom / 100})` }} src={comparisonRightUrl} alt="Later acquisition" /></figure>{includeDifference && differenceUrl && <figure><figcaption>Difference · {comparisonLegend.join(' · ')}</figcaption><img style={{ transform: `scale(${zoom / 100})` }} src={differenceUrl} alt="Difference layer" /></figure>}</div>}{compareMode === 'acquisitions' && <p className="data-note">Only the same stored measurement is compared on an aligned grid. Difference is later minus earlier; radar changes alone do not establish an environmental event.</p>}</section>
      <section className="visual-card"><div className="visual-card-heading"><div><span className="section-kicker">Saved collection</span><h2>Raster inventory</h2></div></div><div className="observation-table-wrap"><table className="observation-table"><thead><tr><th>Acquisition</th><th>Granule</th><th>Frequency / polarization</th><th>Dimensions</th><th>CRS</th><th>Size</th></tr></thead><tbody>{rasters.map((item) => <tr key={`${item.observationId}-${item.variable}`}><td>{item.acquisitionDate ? new Date(item.acquisitionDate).toLocaleString() : 'Unknown acquisition date'}</td><td>{item.observationId}</td><td>{label(item.variable)}</td><td>{String(item.raster.width)} × {String(item.raster.height)}</td><td>{String(item.raster.crs ?? 'Unknown')}</td><td>{((item.bytes ?? 0) / 1024 / 1024).toFixed(2)} MB</td></tr>)}</tbody></table></div></section>
    </div>}
  </main>;
}
