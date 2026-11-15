import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { ArrowLeft, ChevronLeft, ChevronRight, Layers3, LoaderCircle, Satellite, TriangleAlert } from 'lucide-react';
import type { GeoJsonFeature } from '../../types/geojson';
import type { RasterOverlay } from '../../types/visualization';

type Props = { selection?: GeoJsonFeature; retrievalSessionId: string; studyId: string;
  onRasterOverlayChange: (overlay: RasterOverlay | null) => void; onBack: () => void };
type Raster = { studyId: string; observationId: string; granuleId: string; acquisitionDate?: string;
  variable: string; sourceVariable: string; frequency: string; raster: Record<string, unknown>;
  rasterUrl: string; bytes?: number; acquisitionMetadata?: Record<string, unknown> };
type RasterMetadata = { units?: string; minimum?: number | null; maximum?: number | null;
  boundsWgs84?: [number, number, number, number]; width?: number; height?: number;
  crs?: string; calibration?: string; [key: string]: unknown };
type DisplayLegend = { palette: string; stops: string[]; ticks: number[]; minimum: number; maximum: number;
  bands?: number; bandColors?: string[] | null };
type DisplaySettings = { palette: string; minimum: string; maximum: string; lowerPercentile: string;
  upperPercentile: string; stretch: 'linear' | 'log'; bands: string };
type RasterSnapshot = { id: string; raster: Raster; imageUrl: string; legend: DisplayLegend; settings: DisplaySettings };
type PixelInfo = { longitude: number; latitude: number; value: number | null; units: string;
  displayColor: string | null; polarization: string; sourceVariable: string; acquisitionDate?: string; nodata: boolean };
type Timeline = { frames: Raster[]; settings: DisplaySettings; index: number };
type TimelinePreview = { key: string; raster: Raster; imageUrl: string; legend: DisplayLegend };
type Retrieval = { status: string };
type LocalCatalog = { observations: Array<{ observationId: string; granuleId?: string; acquisitionDate?: string;
  acquiredAt?: string; [key: string]: unknown; variables: Array<{ name: string; sourceVariable: string; frequency: string;
    raster: RasterMetadata; rasterUrl: string; bytes?: number }> }> };

const baseUrl = import.meta.env.VITE_BACKEND_URL ?? 'http://localhost:8787';
const PALETTES = [
  ['grayscale', 'Grayscale'], ['red', 'Red'], ['viridis', 'Viridis'], ['plasma', 'Plasma'],
  ['inferno', 'Inferno'], ['magma', 'Magma'], ['turbo', 'Turbo'], ['jet', 'Jet / Rainbow (legacy)'],
  ['terrain', 'Terrain'], ['custom', 'Custom intensity palette'],
] as const;
const sourceLabel = (source: string) => ({ HHHH: 'HH', HVHV: 'HV', VHVH: 'VH', VVVV: 'VV' } as Record<string, string>)[source] ?? source;
const boundsOf = (raster: Raster): [number, number, number, number] | null => {
  const bounds = raster.raster.boundsWgs84;
  return Array.isArray(bounds) && bounds.length === 4 && bounds.every((value) => typeof value === 'number')
    ? bounds as [number, number, number, number] : null;
};
const legendGradient = (legend: DisplayLegend) => legend.bands && legend.bandColors?.length
  ? `linear-gradient(90deg, ${legend.bandColors.map((color, index) => `${color} ${index * 100 / legend.bandColors!.length}%, ${color} ${(index + 1) * 100 / legend.bandColors!.length}%`).join(', ')})`
  : `linear-gradient(90deg, ${legend.stops.join(', ')})`;
const formatDate = (value?: string) => value ? new Date(value).toLocaleString() : 'Acquisition time unavailable';
const displayLabel = (raster: Raster) => `${raster.frequency.replace('frequency', '')} · ${sourceLabel(raster.sourceVariable)} (${raster.sourceVariable})`;
const snapshotId = (raster: Raster) => `${raster.studyId}/${raster.observationId}/${raster.frequency}/${raster.sourceVariable}`;
const checkpointLabel = (value?: string) => value
  ? new Date(value).toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' }) : 'Date unavailable';

function requestUrl(raster: Raster, settings: DisplaySettings, pixel = false, maxDimension?: number, x?: number, y?: number) {
  const query = new URLSearchParams({ palette: settings.palette, stretch: settings.stretch,
    lower_percentile: settings.lowerPercentile, upper_percentile: settings.upperPercentile,
    bands: settings.bands, frequency: raster.frequency });
  if (settings.minimum.trim()) query.set('minimum', settings.minimum);
  if (settings.maximum.trim()) query.set('maximum', settings.maximum);
  if (maxDimension) query.set('max_dimension', String(maxDimension));
  if (pixel) { query.set('x', String(x)); query.set('y', String(y)); }
  const suffix = pixel ? '/pixel' : '';
  return `${baseUrl}/api/visualization/${raster.studyId}/preview/${encodeURIComponent(raster.observationId)}/${encodeURIComponent(raster.sourceVariable)}${suffix}?${query}`;
}

async function loadTimelinePreview(raster: Raster, settings: DisplaySettings, signal: AbortSignal): Promise<TimelinePreview> {
  const response = await fetch(requestUrl(raster, settings), { signal, cache: 'force-cache' });
  if (!response.ok) throw new Error((await response.json()).detail ?? 'Timeline raster could not be rendered.');
  const legend = JSON.parse(response.headers.get('X-Raster-Legend') ?? 'null') as DisplayLegend | null;
  if (!legend) throw new Error('Timeline raster did not include display metadata.');
  const imageUrl = URL.createObjectURL(await response.blob());
  try {
    const image = new Image();
    image.src = imageUrl;
    await image.decode();
    if (signal.aborted) throw new DOMException('Preview request was superseded.', 'AbortError');
    return { key: snapshotId(raster), raster, imageUrl, legend };
  } catch (error) {
    URL.revokeObjectURL(imageUrl);
    throw error;
  }
}

function Legend({ legend, units }: { legend: DisplayLegend; units: string }) {
  return <div className="raster-legend"><strong>{legend.palette} · {units}</strong>
    <div className="raster-colorbar" style={{ background: legendGradient(legend) }} />
    <div className="raster-legend-ticks">{legend.ticks.map((tick, index) => <span key={index}>{Number(tick).toPrecision(4)}</span>)}</div>
    <small>NoData: transparent · displayed range {legend.minimum.toPrecision(5)}–{legend.maximum.toPrecision(5)}</small>
  </div>;
}

function compatibleTimelineRasters(reference: Raster, collection: Raster[]): Raster[] {
  const referenceBounds = boundsOf(reference);
  if (!referenceBounds) return [reference];
  const referenceUnits = String(reference.raster.units ?? '').trim().toLowerCase();
  const referenceCalibration = String(reference.raster.calibration ?? reference.acquisitionMetadata?.calibration ??
    reference.acquisitionMetadata?.productType ?? '').trim().toLowerCase();
  return collection.filter((candidate) => {
    if (candidate.studyId !== reference.studyId || candidate.frequency !== reference.frequency ||
        candidate.sourceVariable !== reference.sourceVariable) return false;
    const units = String(candidate.raster.units ?? '').trim().toLowerCase();
    if (!referenceUnits || !units || units !== referenceUnits) return false;
    const calibration = String(candidate.raster.calibration ?? candidate.acquisitionMetadata?.calibration ??
      candidate.acquisitionMetadata?.productType ?? '').trim().toLowerCase();
    if (!referenceCalibration || !calibration || calibration !== referenceCalibration) return false;
    const bounds = boundsOf(candidate);
    if (!bounds) return false;
    const overlapWidth = Math.min(bounds[2], referenceBounds[2]) - Math.max(bounds[0], referenceBounds[0]);
    const overlapHeight = Math.min(bounds[3], referenceBounds[3]) - Math.max(bounds[1], referenceBounds[1]);
    const timestamp = Date.parse(candidate.acquisitionDate ?? '');
    const overlapArea = overlapWidth * overlapHeight;
    const smallerFootprintArea = Math.min((referenceBounds[2] - referenceBounds[0]) * (referenceBounds[3] - referenceBounds[1]),
      (bounds[2] - bounds[0]) * (bounds[3] - bounds[1]));
    return overlapWidth > 0 && overlapHeight > 0 && smallerFootprintArea > 0 &&
      overlapArea / smallerFootprintArea >= .5 && Number.isFinite(timestamp);
  }).sort((a, b) => Date.parse(a.acquisitionDate ?? '') - Date.parse(b.acquisitionDate ?? '') ||
    a.granuleId.localeCompare(b.granuleId));
}

export function VisualizationPage({ selection, retrievalSessionId, studyId, onRasterOverlayChange, onBack }: Props) {
  const [retrieval, setRetrieval] = useState<Retrieval | null>(null);
  const [rasters, setRasters] = useState<Raster[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [acquisitionDate, setAcquisitionDate] = useState('');
  const [observationId, setObservationId] = useState('');
  const [frequency, setFrequency] = useState('');
  const [sourceVariable, setSourceVariable] = useState('');
  const [palette, setPalette] = useState('viridis');
  const [rangeMinimum, setRangeMinimum] = useState('');
  const [rangeMaximum, setRangeMaximum] = useState('');
  const [lowerPercentile, setLowerPercentile] = useState('2');
  const [upperPercentile, setUpperPercentile] = useState('98');
  const [stretch, setStretch] = useState<'linear' | 'log'>('linear');
  const [bands, setBands] = useState('0');
  const [previewUrl, setPreviewUrl] = useState('');
  const [displayLegend, setDisplayLegend] = useState<DisplayLegend | null>(null);
  const [pixelInfo, setPixelInfo] = useState<PixelInfo | null>(null);
  const [comparison, setComparison] = useState<RasterSnapshot[]>([]);
  const [comparisonBusy, setComparisonBusy] = useState(false);
  const [timeline, setTimeline] = useState<Timeline | null>(null);
  const [displayedTimeline, setDisplayedTimeline] = useState<TimelinePreview | null>(null);
  const [incomingTimeline, setIncomingTimeline] = useState<TimelinePreview | null>(null);
  const [timelineTransitionStarted, setTimelineTransitionStarted] = useState(false);
  const [timelineLoading, setTimelineLoading] = useState(false);
  const [timelineError, setTimelineError] = useState<string | null>(null);
  const [timelineRetry, setTimelineRetry] = useState(0);
  const snapshotUrls = useRef(new Set<string>());
  const timelineCache = useRef(new Map<string, TimelinePreview>());
  const timelineCacheSignature = useRef('');
  const displayedTimelineRef = useRef<TimelinePreview | null>(null);
  const requestSequence = useRef(0);
  const transitionTimer = useRef<number | null>(null);
  const transitionFrame = useRef<number | null>(null);

  const dates = useMemo(() => [...new Set(rasters.map((item) => (item.acquisitionDate ?? '').slice(0, 10)).filter(Boolean))].sort(), [rasters]);
  const dateRasters = rasters.filter((item) => (item.acquisitionDate ?? '').slice(0, 10) === acquisitionDate);
  const granules = [...new Map(dateRasters.map((item) => [item.observationId, item])).values()];
  const granuleRasters = rasters.filter((item) => item.observationId === observationId);
  const frequencies = [...new Set(granuleRasters.map((item) => item.frequency))].sort();
  const polarizationRasters = granuleRasters.filter((item) => item.frequency === frequency);
  const polarizations = [...new Set(polarizationRasters.map((item) => item.sourceVariable))];
  const raster = rasters.find((item) => item.observationId === observationId && item.frequency === frequency && item.sourceVariable === sourceVariable);
  const currentSettings: DisplaySettings = { palette, minimum: rangeMinimum, maximum: rangeMaximum,
    lowerPercentile, upperPercentile, stretch, bands };
  const comparisonColorsDiffer = comparison.length === 2 && (
    comparison[0].settings.palette !== comparison[1].settings.palette ||
    comparison[0].settings.stretch !== comparison[1].settings.stretch ||
    comparison[0].settings.bands !== comparison[1].settings.bands ||
    comparison[0].settings.lowerPercentile !== comparison[1].settings.lowerPercentile ||
    comparison[0].settings.upperPercentile !== comparison[1].settings.upperPercentile ||
    comparison[0].legend.minimum !== comparison[1].legend.minimum ||
    comparison[0].legend.maximum !== comparison[1].legend.maximum);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true); setError(null);
      try {
        const [catalogResponse, retrievalResponse] = await Promise.all([
          fetch(`${baseUrl}/api/study-areas/${encodeURIComponent(studyId)}/processed-observations`),
          fetch(`${baseUrl}/api/retrieval-sessions/${encodeURIComponent(retrievalSessionId)}`),
        ]);
        if (!catalogResponse.ok) throw new Error('Locally processed raster catalog could not be loaded.');
        const catalog = await catalogResponse.json() as LocalCatalog;
        const retrievalValue = retrievalResponse.ok ? await retrievalResponse.json() as Retrieval : null;
        const flattened: Raster[] = catalog.observations.flatMap((observation) => observation.variables.map((item) => ({
          studyId, observationId: observation.observationId, granuleId: observation.granuleId ?? observation.observationId,
          acquisitionDate: observation.acquisitionDate ?? observation.acquiredAt, variable: item.name,
          sourceVariable: item.sourceVariable, frequency: item.frequency, raster: item.raster,
          rasterUrl: item.rasterUrl, bytes: item.bytes, acquisitionMetadata: observation,
        }))).filter((item) => item.raster && item.rasterUrl);
        if (cancelled) return;
        flattened.sort((a, b) => Date.parse(a.acquisitionDate ?? '') - Date.parse(b.acquisitionDate ?? '') ||
          a.granuleId.localeCompare(b.granuleId));
        setRasters(flattened); setRetrieval(retrievalValue);
        const latest = flattened.at(-1);
        if (latest) {
          setAcquisitionDate((latest.acquisitionDate ?? '').slice(0, 10));
          setObservationId(latest.observationId); setFrequency(latest.frequency); setSourceVariable(latest.sourceVariable);
        }
      } catch (reason) { if (!cancelled) setError(reason instanceof Error ? reason.message : 'Visualization data could not be loaded.'); }
      finally { if (!cancelled) setLoading(false); }
    };
    void load();
    return () => { cancelled = true; };
  }, [retrievalSessionId, studyId]);

  useEffect(() => {
    if (!dateRasters.length) return;
    if (!dateRasters.some((item) => item.observationId === observationId)) setObservationId(dateRasters[0].observationId);
  }, [acquisitionDate, rasters]);
  useEffect(() => {
    if (!granuleRasters.length) return;
    if (!frequencies.includes(frequency)) setFrequency(frequencies[0]);
  }, [observationId, rasters]);
  useEffect(() => {
    if (!polarizationRasters.length) return;
    if (!polarizations.includes(sourceVariable)) setSourceVariable(polarizations[0]);
  }, [frequency, observationId, rasters]);

  useEffect(() => {
    let cancelled = false;
    let objectUrl = '';
    if (!raster) { setPreviewUrl(''); setDisplayLegend(null); onRasterOverlayChange(null); return; }
    setPreviewUrl(''); setDisplayLegend(null); setPixelInfo(null);
    void fetch(requestUrl(raster, currentSettings)).then(async (response) => {
      if (!response.ok) throw new Error((await response.json()).detail ?? 'Raster preview could not be rendered.');
      const bounds = JSON.parse(response.headers.get('X-Raster-Bounds-WGS84') ?? 'null') as [number, number, number, number] | null;
      const legend = JSON.parse(response.headers.get('X-Raster-Legend') ?? 'null') as DisplayLegend | null;
      const blob = await response.blob();
      if (cancelled) return;
      objectUrl = URL.createObjectURL(blob); setPreviewUrl(objectUrl); setDisplayLegend(legend);
      onRasterOverlayChange(bounds ? { url: objectUrl, boundsWgs84: bounds, opacity: .88 } : null);
    }).catch((reason) => { if (!cancelled) { setError(reason instanceof Error ? reason.message : 'Raster preview failed.'); setPreviewUrl(''); onRasterOverlayChange(null); } });
    return () => { cancelled = true; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [raster?.rasterUrl, palette, rangeMinimum, rangeMaximum, lowerPercentile, upperPercentile, stretch, bands, studyId]);

  useEffect(() => { displayedTimelineRef.current = displayedTimeline; }, [displayedTimeline]);

  useEffect(() => {
    const signature = timeline ? `${timeline.frames.map(snapshotId).join('|')}::${JSON.stringify(timeline.settings)}` : '';
    if (signature !== timelineCacheSignature.current) {
      const displayedUrl = displayedTimelineRef.current?.imageUrl;
      timelineCache.current.forEach((preview) => {
        if (preview.imageUrl !== displayedUrl) URL.revokeObjectURL(preview.imageUrl);
      });
      timelineCache.current.clear();
      timelineCacheSignature.current = signature;
      if (!timeline) {
        if (displayedUrl) URL.revokeObjectURL(displayedUrl);
        setDisplayedTimeline(null); displayedTimelineRef.current = null;
      }
    }
    if (!timeline) return;

    const requestId = ++requestSequence.current;
    const activeController = new AbortController();
    const neighborControllers = new Map<string, AbortController>();
    let cancelled = false;
    setTimelineLoading(true); setTimelineError(null); setIncomingTimeline(null); setTimelineTransitionStarted(false);
    if (transitionTimer.current !== null) window.clearTimeout(transitionTimer.current);
    if (transitionFrame.current !== null) window.cancelAnimationFrame(transitionFrame.current);

    const frame = timeline.frames[timeline.index];
    const key = snapshotId(frame);
    const load = async (target: Raster, signal: AbortSignal) => {
      const targetKey = snapshotId(target);
      const cached = timelineCache.current.get(targetKey);
      if (cached) return cached;
      const preview = await loadTimelinePreview(target, timeline.settings, signal);
      if (signal.aborted || cancelled || requestId !== requestSequence.current) {
        URL.revokeObjectURL(preview.imageUrl);
        throw new DOMException('Preview request was superseded.', 'AbortError');
      }
      timelineCache.current.set(targetKey, preview);
      return preview;
    };

    const preload = (index: number) => {
      if (index < 0 || index >= timeline.frames.length) return;
      const neighbor = timeline.frames[index], neighborKey = snapshotId(neighbor);
      if (timelineCache.current.has(neighborKey)) return;
      const controller = new AbortController(); neighborControllers.set(neighborKey, controller);
      void loadTimelinePreview(neighbor, timeline.settings, controller.signal).then((preview) => {
        if (controller.signal.aborted || cancelled || requestId !== requestSequence.current) {
          URL.revokeObjectURL(preview.imageUrl); return;
        }
        const old = timelineCache.current.get(neighborKey);
        if (old) URL.revokeObjectURL(preview.imageUrl);
        else timelineCache.current.set(neighborKey, preview);
      }).catch(() => {});
    };

    void load(frame, activeController.signal).then((preview) => {
      if (cancelled || requestId !== requestSequence.current) return;
      const previous = displayedTimelineRef.current;
      if (!previous) {
        setDisplayedTimeline(preview); displayedTimelineRef.current = preview;
        setTimelineLoading(false);
      } else if (previous.key === key) {
        if (previous.imageUrl !== preview.imageUrl) URL.revokeObjectURL(preview.imageUrl);
        timelineCache.current.delete(key);
        setTimelineLoading(false);
      } else {
        setIncomingTimeline(preview);
        const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        if (reducedMotion) {
          setDisplayedTimeline(preview); displayedTimelineRef.current = preview;
          if (previous.imageUrl !== preview.imageUrl && !timelineCache.current.has(previous.key)) URL.revokeObjectURL(previous.imageUrl);
          setIncomingTimeline(null); setTimelineLoading(false);
        } else {
          transitionFrame.current = window.requestAnimationFrame(() => setTimelineTransitionStarted(true));
          transitionTimer.current = window.setTimeout(() => {
            if (cancelled || requestId !== requestSequence.current) return;
            setDisplayedTimeline(preview); displayedTimelineRef.current = preview;
            if (previous.imageUrl !== preview.imageUrl && !timelineCache.current.has(previous.key)) URL.revokeObjectURL(previous.imageUrl);
            setIncomingTimeline(null); setTimelineTransitionStarted(false); setTimelineLoading(false);
            const keep = new Set([timeline.frames[timeline.index - 1], timeline.frames[timeline.index],
              timeline.frames[timeline.index + 1]].filter((item): item is Raster => Boolean(item)).map(snapshotId));
            timelineCache.current.forEach((entry, entryKey) => {
              if (!keep.has(entryKey)) { URL.revokeObjectURL(entry.imageUrl); timelineCache.current.delete(entryKey); }
            });
          }, 220);
        }
      }
      preload(timeline.index - 1); preload(timeline.index + 1);
    }).catch((reason) => {
      if (!cancelled && requestId === requestSequence.current && (reason as Error).name !== 'AbortError') {
        setTimelineError(reason instanceof Error ? reason.message : 'Timeline raster failed to load.');
        setTimelineLoading(false);
      }
    });

    return () => {
      cancelled = true; activeController.abort(); neighborControllers.forEach((controller) => controller.abort());
      if (requestId === requestSequence.current) requestSequence.current += 1;
      if (transitionTimer.current !== null) window.clearTimeout(transitionTimer.current);
      if (transitionFrame.current !== null) window.cancelAnimationFrame(transitionFrame.current);
    };
  }, [timeline?.index, timeline?.frames, timeline?.settings, timelineRetry]);

  useEffect(() => () => {
    snapshotUrls.current.forEach((url) => URL.revokeObjectURL(url));
    snapshotUrls.current.clear();
    timelineCache.current.forEach((preview) => URL.revokeObjectURL(preview.imageUrl));
    timelineCache.current.clear();
    if (displayedTimelineRef.current) URL.revokeObjectURL(displayedTimelineRef.current.imageUrl);
    onRasterOverlayChange(null);
  }, []);

  const inspectPixel = async (event: MouseEvent<HTMLImageElement>) => {
    if (!raster) return;
    const image = event.currentTarget, rect = image.getBoundingClientRect();
    const fit = Math.min(rect.width / image.naturalWidth, rect.height / image.naturalHeight);
    const renderedWidth = image.naturalWidth * fit, renderedHeight = image.naturalHeight * fit;
    const x = Math.floor((event.clientX - rect.left - (rect.width - renderedWidth) / 2) / fit);
    const y = Math.floor((event.clientY - rect.top - (rect.height - renderedHeight) / 2) / fit);
    if (x < 0 || y < 0 || x >= image.naturalWidth || y >= image.naturalHeight) return;
    const response = await fetch(requestUrl(raster, currentSettings, true, Math.max(image.naturalWidth, image.naturalHeight), x, y));
    const body = await response.json() as PixelInfo & { detail?: string };
    if (!response.ok) { setError(body.detail ?? 'Pixel inspection failed.'); return; }
    setPixelInfo(body);
  };

  const addToComparison = async () => {
    if (!raster || comparison.length >= 2 || comparisonBusy) return;
    setComparisonBusy(true); setError(null);
    try {
      const response = await fetch(requestUrl(raster, currentSettings));
      if (!response.ok) throw new Error((await response.json()).detail ?? 'Could not capture this raster configuration.');
      const legend = JSON.parse(response.headers.get('X-Raster-Legend') ?? 'null') as DisplayLegend;
      const imageUrl = URL.createObjectURL(await response.blob());
      snapshotUrls.current.add(imageUrl);
      const next: RasterSnapshot = { id: snapshotId(raster), raster, imageUrl, legend, settings: { ...currentSettings } };
      setComparison((current) => current.length < 2 ? [...current, next] : current);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Comparison snapshot failed.'); }
    finally { setComparisonBusy(false); }
  };

  const clearComparison = () => {
    comparison.forEach((snapshot) => { URL.revokeObjectURL(snapshot.imageUrl); snapshotUrls.current.delete(snapshot.imageUrl); });
    setComparison([]);
  };

  const createTimeline = () => {
    setActionMessage(null); setError(null);
    if (!raster || !displayLegend) { setActionMessage('Wait for the selected raster and its intensity range to finish rendering.'); return; }
    const matching = compatibleTimelineRasters(raster, rasters);
    if (matching.length < 2) {
      setTimeline(null);
      setActionMessage('A multi-date timeline needs at least two locally processed rasters with this frequency, polarization, compatible units, and overlapping coverage.');
      return;
    }
    const fixedSettings: DisplaySettings = { ...currentSettings,
      minimum: String(displayLegend.minimum), maximum: String(displayLegend.maximum) };
    setTimeline({ frames: matching, settings: fixedSettings,
      index: Math.max(0, matching.findIndex((item) => item.observationId === raster.observationId && item.sourceVariable === raster.sourceVariable)) });
    setActionMessage(null);
  };

  const clearTimeline = () => { setTimeline(null); setTimelineError(null); setTimelineLoading(false); setIncomingTimeline(null); };
  const retryTimeline = () => { setTimelineError(null); setTimelineRetry((value) => value + 1); };
  const moveTimeline = (step: number) => setTimeline((current) => current
    ? { ...current, index: Math.max(0, Math.min(current.frames.length - 1, current.index + step)) } : current);
  const timelineRaster = timeline?.frames[timeline.index];
  const comparisonDescription = (snapshot: RasterSnapshot) => `${snapshot.legend.minimum.toPrecision(5)} to ${snapshot.legend.maximum.toPrecision(5)} ${String(snapshot.raster.raster.units ?? 'unknown')}`;

  return <main className="visualization-workspace">
    <header className="visualization-header"><button className="visual-back" onClick={onBack}><ArrowLeft size={16} /> Data</button><div>
      <span className="section-kicker">Locally processed NISAR data · {retrievalSessionId.slice(0, 8)}</span>
      <h1>Delta-Earth Visualization</h1><p>{selection?.properties?.name ?? `Study ${studyId}`} · saved rasters only · retrieval {retrieval?.status ?? 'available'}</p>
    </div></header>
    {error && <div className="visual-error"><TriangleAlert size={16} /> {error}</div>}
    {actionMessage && <div className="visual-info-message">{actionMessage}</div>}
    {loading ? <div className="visual-empty"><LoaderCircle className="spin" size={18} /> Loading locally processed rasters…</div> : !rasters.length
      ? <div className="visual-empty"><Satellite size={20} /> No successful processed rasters are available for this study. Retrieve and process data from Data Retrieval first.</div>
      : <div className="visual-scroll visualization-restructured">
        <section className="visual-card main-raster-card">
          <div className="visual-card-heading"><div><span className="section-kicker">Main Raster Viewer</span><h2>Configure a processed measurement</h2></div><Layers3 size={18} /></div>
          <div className="nisar-extract-controls">
            <label>Acquisition date<select value={acquisitionDate} onChange={(event) => {
              const day = event.target.value; setAcquisitionDate(day);
              const first = rasters.find((item) => (item.acquisitionDate ?? '').slice(0, 10) === day);
              if (first) { setObservationId(first.observationId); setFrequency(first.frequency); setSourceVariable(first.sourceVariable); }
            }}>{dates.map((day) => <option key={day} value={day}>{day}</option>)}</select></label>
            <label>Granule<select value={observationId} onChange={(event) => {
              const first = rasters.find((item) => item.observationId === event.target.value);
              setObservationId(event.target.value);
              if (first) { setFrequency(first.frequency); setSourceVariable(first.sourceVariable); }
            }}>{granules.map((item) => <option key={item.observationId} value={item.observationId}>{item.granuleId}</option>)}</select></label>
            <label>Frequency<select value={frequency} onChange={(event) => {
              setFrequency(event.target.value);
              const first = granuleRasters.find((item) => item.frequency === event.target.value);
              if (first) setSourceVariable(first.sourceVariable);
            }}>{frequencies.map((item) => <option key={item} value={item}>{item.replace('frequency', '')}</option>)}</select></label>
            <label>Polarization<select value={sourceVariable} onChange={(event) => setSourceVariable(event.target.value)}>{polarizationRasters.map((item) => <option key={item.sourceVariable} value={item.sourceVariable}>{sourceLabel(item.sourceVariable)} ({item.sourceVariable})</option>)}</select></label>
            <label>Color palette<select value={palette} onChange={(event) => setPalette(event.target.value)}>{PALETTES.map(([value, title]) => <option key={value} value={value}>{title}</option>)}</select></label>
            <label>Normalization<select value={stretch} onChange={(event) => setStretch(event.target.value as 'linear' | 'log')}><option value="linear">Linear</option><option value="log">Signed logarithmic</option></select></label>
            <label>Display bands<select value={bands} onChange={(event) => setBands(event.target.value)}><option value="0">Continuous</option><option value="5">5 discrete bands</option><option value="10">10 discrete bands</option><option value="20">20 discrete bands</option></select></label>
            <label><input type="checkbox" checked={!rangeMinimum && !rangeMaximum} onChange={(event) => {
              if (event.target.checked) { setRangeMinimum(''); setRangeMaximum(''); }
              else { setRangeMinimum(String(raster?.raster.minimum ?? '')); setRangeMaximum(String(raster?.raster.maximum ?? '')); }
            }} /> Automatic intensity range</label>
            <label>Intensity minimum<input type="number" disabled={!rangeMinimum && !rangeMaximum} value={rangeMinimum} onChange={(event) => setRangeMinimum(event.target.value)} placeholder="2nd percentile" /></label>
            <label>Intensity maximum<input type="number" disabled={!rangeMinimum && !rangeMaximum} value={rangeMaximum} onChange={(event) => setRangeMaximum(event.target.value)} placeholder="98th percentile" /></label>
            <label>Lower percentile<input type="number" min="0" max="100" value={lowerPercentile} onChange={(event) => setLowerPercentile(event.target.value)} /></label>
            <label>Upper percentile<input type="number" min="0" max="100" value={upperPercentile} onChange={(event) => setUpperPercentile(event.target.value)} /></label>
            <button className="filter-chip" onClick={() => { setRangeMinimum(''); setRangeMaximum(''); setLowerPercentile('2'); setUpperPercentile('98'); setStretch('linear'); setPalette('viridis'); setBands('0'); }}>Reset display</button>
          </div>
          {raster && <div className="visual-raster-display">
            {previewUrl ? <img src={previewUrl} alt={`${displayLabel(raster)} raster`} onClick={(event) => void inspectPixel(event)} title="Click a pixel to inspect its value" /> : <LoaderCircle className="spin" size={20} />}
            <p>{raster.granuleId} · {formatDate(raster.acquisitionDate)} · {displayLabel(raster)} · {String(raster.raster.width)} × {String(raster.raster.height)} px · {String(raster.raster.crs ?? 'CRS unavailable')} · NoData transparent · click a pixel to inspect</p>
            {displayLegend && <Legend legend={displayLegend} units={String(raster.raster.units ?? 'units unavailable')} />}
            {pixelInfo && <p className="pixel-inspection">{pixelInfo.nodata ? 'NoData' : `${pixelInfo.value} ${pixelInfo.units}`} · {pixelInfo.latitude.toFixed(6)}°, {pixelInfo.longitude.toFixed(6)}° · displayed {pixelInfo.displayColor ?? 'transparent'} · {pixelInfo.polarization} ({pixelInfo.sourceVariable}) · {formatDate(pixelInfo.acquisitionDate)}</p>}
            <a href={`${baseUrl}${raster.rasterUrl}`} target="_blank" rel="noreferrer">Open saved source GeoTIFF</a>
          </div>}
          <div className="viewer-actions"><button className="primary-action" onClick={() => void addToComparison()} disabled={!raster || comparison.length >= 2 || comparisonBusy || !displayLegend}>{comparisonBusy ? 'Capturing…' : 'Add to Comparison'}</button>
            <button className="secondary-action" onClick={createTimeline} disabled={!raster || !displayLegend}>Create Timeline</button></div>
        </section>

        {comparison.length > 0 && <section className="visual-card comparison-snapshots">
          <div className="visual-card-heading"><div><span className="section-kicker">Comparison</span><h2>Saved display snapshots</h2></div>
            <button className="secondary-action" onClick={clearComparison}>Clear Comparison</button></div>
          {comparisonColorsDiffer && <div className="visual-info-message">These images use different palettes, normalization, or intensity ranges. Their colors are not directly comparable.</div>}
          <div className="comparison-panels">{[0, 1].map((index) => {
            const snapshot = comparison[index];
            return <figure className={`comparison-slot ${snapshot ? '' : 'comparison-slot-empty'}`} key={index}>
              {snapshot ? <><figcaption>Image {index + 1} · {snapshot.raster.granuleId} · {formatDate(snapshot.raster.acquisitionDate)}</figcaption>
                <img src={snapshot.imageUrl} alt={`Comparison snapshot ${index + 1}`} />
                <p>{displayLabel(snapshot.raster)} · {snapshot.settings.palette} · {snapshot.settings.stretch} · {comparisonDescription(snapshot)}</p>
                <Legend legend={snapshot.legend} units={String(snapshot.raster.raster.units ?? 'units unavailable')} />
                <small>Footprint WGS84: {JSON.stringify(boundsOf(snapshot.raster) ?? 'unavailable')}</small></>
                : <div className="comparison-empty-slot">{index === 0 ? 'Image 1 slot' : 'Image 2 slot'}<small>Select a raster configuration in the Main Viewer and add it.</small></div>}
            </figure>;
          })}</div>
        </section>}

        {timeline && <section className="visual-card timeline-snapshot">
          <div className="visual-card-heading"><div><span className="section-kicker">Timeline</span><h2>Compatible processed acquisitions</h2></div>
            <button className="secondary-action" onClick={clearTimeline}>Clear Timeline</button></div>
          {timelineRaster && <>
            <div className="timeline-frame-heading"><div><span>Currently displayed</span><strong>{formatDate(displayedTimeline?.raster.acquisitionDate)}</strong>
              <small>{displayedTimeline ? `${displayedTimeline.raster.granuleId} · ${displayLabel(displayedTimeline.raster)}` : 'Loading first frame…'}</small></div>
              {timeline.index !== timeline.frames.findIndex((frame) => snapshotId(frame) === displayedTimeline?.key) && <span className="timeline-request-status">{timelineLoading ? `Loading ${checkpointLabel(timelineRaster.acquisitionDate)} · ${timelineRaster.granuleId}` : timelineError ? `Could not display ${checkpointLabel(timelineRaster.acquisitionDate)}` : ''}</span>}
            </div>
            <div className="timeline-raster-frame" aria-live="polite">
              {displayedTimeline && <img className={`timeline-frame-image ${incomingTimeline && timelineTransitionStarted ? 'timeline-frame-outgoing' : ''}`} src={displayedTimeline.imageUrl} alt={`Currently displayed acquisition ${checkpointLabel(displayedTimeline.raster.acquisitionDate)}`} />}
              {incomingTimeline && <img className={`timeline-frame-image timeline-frame-incoming ${timelineTransitionStarted ? 'is-visible' : ''}`} src={incomingTimeline.imageUrl} alt={`Loading acquisition ${checkpointLabel(incomingTimeline.raster.acquisitionDate)}`} />}
              {!displayedTimeline && timelineLoading && <LoaderCircle className="spin" size={22} />}
              {timelineLoading && <span className="timeline-loading-indicator"><LoaderCircle className="spin" size={13} /> Loading selected frame</span>}
            </div>
            {displayedTimeline && <Legend legend={displayedTimeline.legend} units={String(displayedTimeline.raster.raster.units ?? 'units unavailable')} />}
            {timelineError && <div className="timeline-load-error" role="status">{timelineError} The last successfully displayed frame remains visible. <button className="filter-chip" onClick={retryTimeline}>Retry selected frame</button></div>}
            <div className="timeline-checkpoint-scroll" aria-label="Acquisition date checkpoints">
              <div className="timeline-checkpoint-track" style={{ width: `max(100%, ${Math.max(680, timeline.frames.length * 150)}px)` }}>
                <div className="timeline-checkpoint-dates">{timeline.frames.map((frame, index) => <span key={`date-${snapshotId(frame)}`} className={timeline.index === index ? 'active' : ''} style={{ left: `${index / (timeline.frames.length - 1) * 100}%` }}><strong>{checkpointLabel(frame.acquisitionDate)}</strong><small>{frame.granuleId}</small></span>)}</div>
                <div className="timeline-range-wrap"><input aria-label="Select acquisition checkpoint" aria-valuetext={`${checkpointLabel(timelineRaster.acquisitionDate)}, ${timelineRaster.granuleId}`} type="range" min="0" max={timeline.frames.length - 1} step="1" value={timeline.index} onChange={(event) => setTimeline((current) => current ? { ...current, index: Number(event.target.value) } : current)} />
                  <div className="timeline-checkpoint-dots" aria-hidden="true">{timeline.frames.map((frame, index) => <i key={`point-${snapshotId(frame)}`} className={timeline.index === index ? 'active' : ''} style={{ left: `${index / (timeline.frames.length - 1) * 100}%` }} />)}</div></div>
                <div className="timeline-checkpoint-indexes" aria-hidden="true">{timeline.frames.map((frame, index) => <small key={`index-${snapshotId(frame)}`} className={timeline.index === index ? 'active' : ''} style={{ left: `${index / (timeline.frames.length - 1) * 100}%` }}>{index}</small>)}</div>
              </div>
            </div>
            <div className="timeline-navigation"><button className="filter-chip" disabled={timeline.index === 0} onClick={() => moveTimeline(-1)}><ChevronLeft size={15} /> Previous</button><span>{timeline.index + 1} / {timeline.frames.length} observations</span><button className="filter-chip" disabled={timeline.index === timeline.frames.length - 1} onClick={() => moveTimeline(1)}>Next <ChevronRight size={15} /></button></div>
          </>}
        </section>}
      </div>}
  </main>;
}
