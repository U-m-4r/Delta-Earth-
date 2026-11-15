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

const baseUrl = import.meta.env.VITE_BACKEND_URL ?? 'http://localhost:8787';
const label = (variable: string) => {
  if (variable.startsWith('RATIO:')) { const [, frequency, n, d] = variable.split(':'); return `${frequency.replace('frequency', '')} · ${n}/${d} ratio`; }
  const [frequency, source] = variable.split(':', 2);
  const channel = ({ HHHH: 'HH', HVHV: 'HV', VHVH: 'VH', VVVV: 'VV' } as Record<string, string>)[source] ?? source;
  return `${frequency.replace('frequency', '')} · ${channel} (${source})`;
};
const headersFor = (session: VizSession) => ({ 'X-Visualization-Session-Token': session.sessionToken });

export function VisualizationPage({ selection, retrievalSessionId, studyId, onRasterOverlayChange, onBack }: Props) {
  const [retrieval, setRetrieval] = useState<Retrieval | null>(null);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [rasters, setRasters] = useState<Raster[]>([]);
  const [vizSession, setVizSession] = useState<VizSession | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState('');
  const [observationId, setObservationId] = useState('');
  const [variable, setVariable] = useState('');
  const [style, setStyle] = useState<'gray' | 'red'>('gray');
  const [rangeMinimum, setRangeMinimum] = useState('');
  const [rangeMaximum, setRangeMaximum] = useState('');
  const [previewUrl, setPreviewUrl] = useState('');
  const [rgbUrl, setRgbUrl] = useState('');
  const [rgbLegend, setRgbLegend] = useState<string[]>([]);
  const [rgbChannels, setRgbChannels] = useState<[string, string, string]>(['', '', '']);
  const [compareMode, setCompareMode] = useState<'original_rgb' | 'polarization' | 'acquisitions'>('original_rgb');
  const [otherVariable, setOtherVariable] = useState('');
  const [baselineId, setBaselineId] = useState('');
  const [comparisonUrl, setComparisonUrl] = useState('');
  const [comparisonLegend, setComparisonLegend] = useState<string[]>([]);
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
    if (!raster) { setPreviewUrl(''); onRasterOverlayChange(null); return; }
    const range = new URLSearchParams({ style });
    if (rangeMinimum && Number.isFinite(Number(rangeMinimum))) range.set('minimum', rangeMinimum);
    if (rangeMaximum && Number.isFinite(Number(rangeMaximum))) range.set('maximum', rangeMaximum);
    range.set('frequency', raster.frequency ?? raster.variable.split(':', 1)[0]);
    const url = `${baseUrl}/api/visualization/${studyId}/preview/${encodeURIComponent(raster.observationId)}/${encodeURIComponent(raster.sourceVariable)}?${range}`;
    setPreviewUrl(url);
    const bounds = raster.raster.boundsWgs84 as [number, number, number, number] | undefined;
    onRasterOverlayChange(bounds ? { url, boundsWgs84: bounds, opacity: .88 } : null);
  }, [raster?.rasterUrl, raster?.variable, style, rangeMinimum, rangeMaximum, studyId]);

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
    if (comparisonUrl.startsWith('blob:')) URL.revokeObjectURL(comparisonUrl);
    setRgbUrl(''); setRgbLegend([]); setComparisonUrl(''); setComparisonLegend([]);
  }, [observation?.observationId, variable]);

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
    if (comparisonUrl.startsWith('blob:')) URL.revokeObjectURL(comparisonUrl);
    setError(null); setComparisonUrl(''); setComparisonLegend([]);
    if (compareMode === 'polarization' && otherVariable) {
      const other = rasters.find((item) => item.observationId === observation?.observationId && item.variable === otherVariable);
      setComparisonUrl(other ? `${baseUrl}/api/visualization/${studyId}/preview/${encodeURIComponent(other.observationId)}/${encodeURIComponent(other.sourceVariable)}?style=red&frequency=${other.frequency}` : '');
      return;
    }
    if (compareMode !== 'acquisitions' || !vizSession || !baselineId || !observation) return;
    const params = new URLSearchParams({ baseline: baselineId, current: observation.observationId,
      variable, mode: 'side_by_side', include_difference: String(includeDifference) });
    const response = await fetch(`${baseUrl}/api/visualization/sessions/${vizSession.sessionId}/compare?${params}`, { headers: headersFor(vizSession) });
    const body = await response.json() as CompareResult & { detail?: string };
    if (!response.ok) { setError(body.detail ?? 'Acquisition comparison failed.'); return; }
    const imageResponse = await fetch(`${baseUrl}${body.productUrl}`, { headers: headersFor(vizSession) });
    if (!imageResponse.ok) { setError('Comparison image could not be retrieved.'); return; }
    if (comparisonUrl.startsWith('blob:')) URL.revokeObjectURL(comparisonUrl);
    setComparisonUrl(URL.createObjectURL(await imageResponse.blob())); setComparisonLegend(body.legend);
  };

  const rasterCountForDate = (day?: string) => rasters.filter((item) => (item.acquisitionDate ?? '').slice(0, 10) === day).length;

  return <main className="visualization-workspace">
    <header className="visualization-header"><button className="visual-back" onClick={onBack}><ArrowLeft size={16} /> Data</button><div><span className="section-kicker">Saved retrieval · {retrievalSessionId.slice(0, 8)}</span><h1>Raster visualization</h1><p>{selection?.properties?.name ?? `Study ${studyId}`} · data is read from the completed retrieval session</p></div><span className="data-status"><span className="status-live" /> {retrieval?.status ?? 'Loading collection'}</span></header>
    {error && <div className="visual-error"><TriangleAlert size={16} /> {error}</div>}
    {loading ? <div className="visual-empty"><LoaderCircle className="spin" size={18} /> Loading saved rasters…</div> : !rasters.length ? <div className="visual-empty"><Satellite size={20} /> No successful GeoTIFFs were saved in this retrieval session. Return to Data Retrieval and process a selection first.</div> : <div className="visual-scroll">
      <section className="visual-stat-grid"><div className="visual-stat"><span>RETRIEVAL SESSION</span><strong>{retrievalSessionId.slice(0, 8)}</strong><small>{retrieval?.status}</small></div><div className="visual-stat"><span>GRANULES</span><strong>{new Set(rasters.map((item) => item.observationId)).size}</strong><small>successfully processed</small></div><div className="visual-stat"><span>ACQUISITIONS</span><strong>{dates.length}</strong><small>{retrieval?.startDate ?? 'All'} — {retrieval?.endDate ?? 'All'}</small></div><div className="visual-stat"><span>RASTER OUTPUTS</span><strong>{rasters.length}</strong><small>persistent GeoTIFFs</small></div></section>
      <section className="visual-card"><div className="visual-card-heading"><div><span className="section-kicker">Acquisition timeline</span><h2>Processed dates and channels</h2></div><CalendarDays size={18} /></div><div className="timeline-controls"><button className="filter-chip" onClick={() => { const i = dates.findIndex((item) => item.date === selectedDate); const next = dates[Math.max(0, i - 1)]; setSelectedDate(next?.date ?? ''); setObservationId(observations.find((row) => (row.acquisitionDate ?? '').slice(0, 10) === (next?.date ?? ''))?.observationId ?? ''); }} disabled={!dates.length}>Previous</button><button className="filter-chip" onClick={() => setPlaying((value) => !value)} disabled={!dates.length}>{playing ? 'Pause playback' : 'Play timeline'}</button><button className="filter-chip" onClick={() => { const i = dates.findIndex((item) => item.date === selectedDate); const next = dates[Math.min(dates.length - 1, i + 1)]; setSelectedDate(next?.date ?? ''); setObservationId(observations.find((row) => (row.acquisitionDate ?? '').slice(0, 10) === (next?.date ?? ''))?.observationId ?? ''); }} disabled={!dates.length}>Next</button></div><div className="filter-row">{dates.map((item) => <button key={item.date ?? 'undated'} className={`filter-chip ${selectedDate === item.date ? 'active' : ''}`} onClick={() => { setSelectedDate(item.date ?? ''); const next = observations.find((row) => (row.acquisitionDate ?? '').slice(0, 10) === (item.date ?? '')); setObservationId(next?.observationId ?? ''); }}>{item.date ?? 'Date unavailable'} · {item.granuleCount} granules · {rasterCountForDate(item.date)} rasters · {item.polarizations.map((pol) => pol).join(', ')}</button>)}</div></section>
      <section className="visual-card"><div className="visual-card-heading"><div><span className="section-kicker">Individual raster</span><h2>Measurement viewer</h2></div><Layers3 size={18} /></div><div className="nisar-extract-controls"><label>Acquisition<select value={observation?.observationId ?? ''} onChange={(event) => setObservationId(event.target.value)}>{sameDateObservations.map((item) => <option key={item.observationId} value={item.observationId}>{item.granuleId}</option>)}</select></label><label>Measurement<select value={variable} onChange={(event) => setVariable(event.target.value)}>{variables.map((item) => <option key={item} value={item}>{label(item)}</option>)}</select></label><label>Rendering<select value={style} onChange={(event) => setStyle(event.target.value as 'gray' | 'red')}><option value="gray">Grayscale</option><option value="red">Red intensity pseudocolor</option></select></label><label>Stretch minimum<input type="number" value={rangeMinimum} onChange={(event) => setRangeMinimum(event.target.value)} placeholder="2nd percentile" /></label><label>Stretch maximum<input type="number" value={rangeMaximum} onChange={(event) => setRangeMaximum(event.target.value)} placeholder="98th percentile" /></label></div>{previewUrl && <div className="visual-raster-display"><img src={previewUrl} alt={`${label(variable)} raster preview`} /><p>{label(variable)} · units {String(raster?.raster.units ?? 'not reported')} · {String(raster?.raster.width)} × {String(raster?.raster.height)} px · NoData transparent · bounds WGS84 {JSON.stringify(raster?.raster.boundsWgs84 ?? null)} · stretch {rangeMinimum || String(raster?.raster.minimum ?? 'auto')}–{rangeMaximum || String(raster?.raster.maximum ?? 'auto')}</p><a href={`${baseUrl}${raster?.rasterUrl}`} target="_blank" rel="noreferrer">Download source GeoTIFF</a></div>}</section>
      <section className="visual-card"><div className="visual-card-heading"><div><span className="section-kicker">False-color composite</span><h2>Configure RGB channels</h2></div></div><div className="nisar-extract-controls">{(['R', 'G', 'B'] as const).map((channel, index) => <label key={channel}>{channel} channel<select value={rgbChannels[index]} onChange={(event) => setRgbChannels((current) => current.map((value, i) => i === index ? event.target.value : value) as [string, string, string])}>{rgbOptions.map((item) => <option key={item} value={item}>{label(item)}</option>)}</select></label>)}<button className="primary-action" onClick={() => void makeRgb()} disabled={!rgbOptions.length}>Generate RGB</button></div>{rgbUrl && <div className="visual-raster-display"><img src={rgbUrl} alt="RGB false-color composite" /><p>{rgbLegend.join(' · ')}. False-color radar display, not natural color or a universal land-cover classification. Color mixing depends on channel intensity; black areas indicate masked NoData.</p></div>}</section>
      <section className="visual-card"><div className="visual-card-heading"><div><span className="section-kicker">Comparison</span><h2>Compare saved measurements</h2></div></div><div className="nisar-extract-controls"><label>Mode<select value={compareMode} onChange={(event) => setCompareMode(event.target.value as typeof compareMode)}><option value="original_rgb">Original vs RGB</option><option value="polarization">Different polarizations</option><option value="acquisitions">Different acquisitions</option></select></label>{compareMode === 'polarization' && <label>Right channel<select value={otherVariable} onChange={(event) => setOtherVariable(event.target.value)}>{otherPolarizationOptions.map((item) => <option key={item} value={item}>{label(item)}</option>)}</select></label>}{compareMode === 'acquisitions' && <><label>Earlier acquisition<select value={baselineId} onChange={(event) => setBaselineId(event.target.value)}>{earlierOptions.map((item) => <option key={item.observationId} value={item.observationId}>{item.granuleId} · {item.acquisitionDate}</option>)}</select></label><label><input type="checkbox" checked={includeDifference} onChange={(event) => setIncludeDifference(event.target.checked)} /> Include difference layer</label></>}<button className="primary-action" onClick={() => void makeComparison()} disabled={compareMode === 'acquisitions' && (!baselineId || !earlierOptions.length) || compareMode === 'polarization' && !otherPolarizationOptions.length}>Update comparison</button><label>Shared zoom<input type="range" min="100" max="250" value={zoom} onChange={(event) => setZoom(Number(event.target.value))} /></label><span>{zoom}%</span></div>{compareMode === 'original_rgb' && rgbUrl && <div className="comparison-panels"><figure><figcaption>Original · {label(variable)}</figcaption><img style={{ transform: `scale(${zoom / 100})` }} src={previewUrl} alt="Original raster" /></figure><figure><figcaption>RGB · {rgbLegend.join(' / ')}</figcaption><img style={{ transform: `scale(${zoom / 100})` }} src={rgbUrl} alt="RGB composite" /></figure></div>}{compareMode === 'polarization' && comparisonUrl && <div className="comparison-panels"><figure><figcaption>Left · {label(variable)}</figcaption><img style={{ transform: `scale(${zoom / 100})` }} src={previewUrl} alt="First polarization" /></figure><figure><figcaption>Right · {label(otherVariable)}</figcaption><img style={{ transform: `scale(${zoom / 100})` }} src={comparisonUrl} alt="Second polarization" /></figure></div>}{compareMode === 'acquisitions' && comparisonUrl && <div className="visual-raster-display"><img style={{ transform: `scale(${zoom / 100})` }} src={comparisonUrl} alt="Earlier, later, and optional difference comparison" /><p>{comparisonLegend.join(' · ')}</p></div>}{compareMode === 'acquisitions' && <p className="data-note">Only the same stored measurement is compared on an aligned grid. Difference is later minus earlier; radar changes alone do not establish an environmental event.</p>}</section>
      <section className="visual-card"><div className="visual-card-heading"><div><span className="section-kicker">Saved collection</span><h2>Raster inventory</h2></div></div><div className="observation-table-wrap"><table className="observation-table"><thead><tr><th>Acquisition</th><th>Granule</th><th>Frequency / polarization</th><th>Dimensions</th><th>CRS</th><th>Size</th></tr></thead><tbody>{rasters.map((item) => <tr key={`${item.observationId}-${item.variable}`}><td>{item.acquisitionDate ? new Date(item.acquisitionDate).toLocaleString() : 'Unknown acquisition date'}</td><td>{item.observationId}</td><td>{label(item.variable)}</td><td>{String(item.raster.width)} × {String(item.raster.height)}</td><td>{String(item.raster.crs ?? 'Unknown')}</td><td>{((item.bytes ?? 0) / 1024 / 1024).toFixed(2)} MB</td></tr>)}</tbody></table></div></section>
    </div>}
  </main>;
}
