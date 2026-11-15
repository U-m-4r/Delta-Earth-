import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { ArrowLeft, Layers3, LoaderCircle, Satellite, TriangleAlert } from 'lucide-react';
import { AcquisitionTimeline } from '../timeline/AcquisitionTimeline';
import { useTimelineFrames } from '../timeline/useTimelineFrames';
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
  bands?: number; bandColors?: string[] | null; normalizationScale?: number };
type DisplaySettings = { palette: string; minimum: string; maximum: string; lowerPercentile: string;
  upperPercentile: string; stretch: 'linear' | 'log'; bands: string; normalizationScale?: number };
type RasterSnapshot = { id: string; raster: Raster; imageUrl: string; legend: DisplayLegend; settings: DisplaySettings };
type PixelInfo = { longitude: number; latitude: number; value: number | null; units: string;
  displayColor: string | null; polarization: string; sourceVariable: string; acquisitionDate?: string; nodata: boolean };
type Timeline = { frames: Raster[]; settings: DisplaySettings; index: number };
type VizSession = { sessionId: string; sessionToken: string; studyId: string };
type ChangeResult = { productId: string; productUrl: string; downloadUrl: string; downloadFilename: string;
  statistics: Record<string, number | string | null>; legend: { minimum: number; maximum: number; palette: string; units: string };
  boundsWgs84: [number, number, number, number] };
type TimelinePreview = { key: string; raster: Raster; imageUrl: string; legend: DisplayLegend };
const headersFor = (session: VizSession) => ({ 'X-Visualization-Session-Token': session.sessionToken });
type Retrieval = { status: string };
type LocalCatalog = { observations: Array<{ observationId: string; granuleId?: string; acquisitionDate?: string;
  acquiredAt?: string; [key: string]: unknown; variables: Array<{ name: string; sourceVariable: string; frequency: string;
    raster: RasterMetadata; rasterUrl: string; bytes?: number }> }> };

const EMPTY_TIMELINE: Raster[] = [];
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
const boundsOverlap = (left: Raster, right: Raster) => {
  const a = boundsOf(left), b = boundsOf(right);
  return Boolean(a && b && Math.min(a[2], b[2]) > Math.max(a[0], b[0]) &&
    Math.min(a[3], b[3]) > Math.max(a[1], b[1]));
};
const legendGradient = (legend: DisplayLegend) => legend.bands && legend.bandColors?.length
  ? `linear-gradient(90deg, ${legend.bandColors.map((color, index) => `${color} ${index * 100 / legend.bandColors!.length}%, ${color} ${(index + 1) * 100 / legend.bandColors!.length}%`).join(', ')})`
  : `linear-gradient(90deg, ${legend.stops.join(', ')})`;
const formatDate = (value?: string) => value ? new Date(value).toLocaleString() : 'Acquisition time unavailable';
const displayLabel = (raster: Raster) => `${raster.frequency.replace('frequency', '')} · ${sourceLabel(raster.sourceVariable)} (${raster.sourceVariable})`;
const snapshotId = (raster: Raster) => `${raster.studyId}/${raster.observationId}/${raster.frequency}/${raster.sourceVariable}`;
const checkpointLabel = (value?: string) => value
  ? new Date(value).toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' }) : 'Date unavailable';
const calibrationOf = (raster: Raster) => String(raster.raster.calibration ?? raster.acquisitionMetadata?.calibration ??
  raster.acquisitionMetadata?.productType ?? '').trim().toLowerCase();
function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob), anchor = document.createElement('a');
  anchor.href = url; anchor.download = filename; document.body.appendChild(anchor); anchor.click(); anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function filenameFromResponse(response: Response, fallback: string) {
  const header = response.headers.get('Content-Disposition') ?? '';
  const encoded = header.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  if (encoded) { try { return decodeURIComponent(encoded); } catch { return fallback; } }
  return header.match(/filename="?([^";]+)"?/i)?.[1] ?? fallback;
}

function requestUrl(raster: Raster, settings: DisplaySettings, pixel = false, maxDimension?: number, x?: number, y?: number) {
  const query = new URLSearchParams({ palette: settings.palette, stretch: settings.stretch,
    lower_percentile: settings.lowerPercentile, upper_percentile: settings.upperPercentile,
    bands: settings.bands, frequency: raster.frequency });
  if (settings.minimum.trim()) query.set('minimum', settings.minimum);
  if (settings.maximum.trim()) query.set('maximum', settings.maximum);
  if (settings.normalizationScale !== undefined && Number.isFinite(settings.normalizationScale))
    query.set('normalization_scale', String(settings.normalizationScale));
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
  const [vizSession, setVizSession] = useState<VizSession | null>(null);
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
  const [timelineExportBusy, setTimelineExportBusy] = useState(false);
  const [timelineExportStatus, setTimelineExportStatus] = useState('');
  const [tiffDownloadBusy, setTiffDownloadBusy] = useState(false);
  const [changeBusy, setChangeBusy] = useState(false);
  const [changeResult, setChangeResult] = useState<ChangeResult | null>(null);
  const [changeImageUrl, setChangeImageUrl] = useState('');
  const [changeDownloadBusy, setChangeDownloadBusy] = useState(false);
  const snapshotUrls = useRef(new Set<string>());


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
  const changeCompatibilityError = comparison.length < 2 ? 'Add two raster snapshots first.' :
    comparison[0].raster.sourceVariable !== comparison[1].raster.sourceVariable ? 'Changes require the same polarization / measurement in both snapshots.' :
    comparison[0].raster.frequency !== comparison[1].raster.frequency ? 'Changes require the same frequency in both snapshots.' :
    !String(comparison[0].raster.raster.units ?? '').trim() ||
      String(comparison[0].raster.raster.units).toLowerCase() !== String(comparison[1].raster.raster.units ?? '').toLowerCase() ? 'Changes require matching known measurement units.' :
    !calibrationOf(comparison[0].raster) || calibrationOf(comparison[0].raster) !== calibrationOf(comparison[1].raster) ? 'Changes require matching calibration or product metadata.' :
    !boundsOverlap(comparison[0].raster, comparison[1].raster) ? 'Changes require overlapping geographic coverage.' : null;

  useEffect(() => {
    let cancelled = false;
    let sessionValue: VizSession | null = null;
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
        const sessionResponse = await fetch(`${baseUrl}/api/visualization/sessions`, { method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ studyId, retrievalSessionId }) });
        if (!sessionResponse.ok) throw new Error('A temporary visualization session could not be opened for exports.');
        sessionValue = await sessionResponse.json() as VizSession;
        if (cancelled) {
          void fetch(`${baseUrl}/api/visualization/sessions/${sessionValue.sessionId}`, { method: 'DELETE',
            headers: { 'X-Visualization-Session-Token': sessionValue.sessionToken }, keepalive: true });
          return;
        }
        setVizSession(sessionValue);
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
    return () => {
      cancelled = true;
      if (sessionValue) void fetch(`${baseUrl}/api/visualization/sessions/${sessionValue.sessionId}`, {
        method: 'DELETE', headers: { 'X-Visualization-Session-Token': sessionValue.sessionToken }, keepalive: true,
      }).catch(() => {});
    };
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

  const timelineFrames = timeline?.frames ?? EMPTY_TIMELINE;
  const timelineSettings = timeline?.settings;
  const timelineLoader = useCallback((frame: Raster, signal: AbortSignal) =>
    loadTimelinePreview(frame, timelineSettings!, signal), [timelineSettings]);
  const { displayed: displayedTimeline, incoming: incomingTimeline,
    transitionStarted: timelineTransitionStarted, loading: timelineLoading,
    error: timelineError, retry: retryTimeline } = useTimelineFrames({
      frames: timelineFrames, index: timeline?.index ?? 0,
      version: JSON.stringify(timelineSettings), loader: timelineLoader, keyOf: snapshotId,
    });

  useEffect(() => () => {
    snapshotUrls.current.forEach((url) => URL.revokeObjectURL(url));
    snapshotUrls.current.clear();
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
    const response = await fetch(requestUrl(raster, { ...currentSettings,
      normalizationScale: displayLegend?.normalizationScale }, true,
      Math.max(image.naturalWidth, image.naturalHeight), x, y));
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
      const next: RasterSnapshot = { id: snapshotId(raster), raster, imageUrl, legend,
        settings: { ...currentSettings, normalizationScale: legend.normalizationScale } };
      setComparison((current) => current.length < 2 ? [...current, next] : current);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Comparison snapshot failed.'); }
    finally { setComparisonBusy(false); }
  };

  const clearComparison = () => {
    comparison.forEach((snapshot) => { URL.revokeObjectURL(snapshot.imageUrl); snapshotUrls.current.delete(snapshot.imageUrl); });
    if (changeImageUrl) URL.revokeObjectURL(changeImageUrl);
    setChangeImageUrl(''); setChangeResult(null);
    setComparison([]);
  };

  const downloadCurrentTiff = async () => {
    if (!raster || tiffDownloadBusy) return;
    setTiffDownloadBusy(true); setError(null);
    try {
      const response = await fetch(`${baseUrl}${raster.rasterUrl}`);
      if (!response.ok) throw new Error('Saved GeoTIFF could not be downloaded.');
      saveBlob(await response.blob(), filenameFromResponse(response, `${raster.granuleId}_${raster.sourceVariable}.tif`));
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'GeoTIFF download failed.'); }
    finally { setTiffDownloadBusy(false); }
  };

  const calculateChanges = async () => {
    if (!vizSession || comparison.length !== 2 || changeCompatibilityError || changeBusy) return;
    setChangeBusy(true); setError(null);
    if (changeImageUrl) URL.revokeObjectURL(changeImageUrl);
    setChangeImageUrl(''); setChangeResult(null);
    const rasterRef = (item: RasterSnapshot) => ({ observationId: item.raster.observationId,
      sourceVariable: item.raster.sourceVariable, frequency: item.raster.frequency });
    try {
      const response = await fetch(`${baseUrl}/api/visualization/sessions/${vizSession.sessionId}/changes`, {
        method: 'POST', headers: { ...headersFor(vizSession), 'Content-Type': 'application/json' },
        body: JSON.stringify({ left: rasterRef(comparison[0]), right: rasterRef(comparison[1]) }),
      });
      const body = await response.json() as ChangeResult & { detail?: string };
      if (!response.ok) throw new Error(body.detail ?? 'Change calculation failed.');
      const imageResponse = await fetch(`${baseUrl}${body.productUrl}`, { headers: headersFor(vizSession) });
      if (!imageResponse.ok) throw new Error('Change image could not be loaded.');
      setChangeResult(body); setChangeImageUrl(URL.createObjectURL(await imageResponse.blob()));
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Change calculation failed.'); }
    finally { setChangeBusy(false); }
  };

  const downloadChanges = async () => {
    if (!vizSession || !changeResult || changeDownloadBusy) return;
    setChangeDownloadBusy(true); setError(null);
    try {
      const response = await fetch(`${baseUrl}${changeResult.downloadUrl}`, { headers: headersFor(vizSession) });
      if (!response.ok) throw new Error((await response.json()).detail ?? 'Change export could not be downloaded.');
      saveBlob(await response.blob(), filenameFromResponse(response, changeResult.downloadFilename));
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Change download failed.'); }
    finally { setChangeDownloadBusy(false); }
  };

  const downloadTimeline = async () => {
    if (!vizSession || !timeline || timelineExportBusy) return;
    setTimelineExportBusy(true); setTimelineExportStatus('Preparing GIF, report, and metadata…'); setError(null);
    try {
      const body = { frames: timeline.frames.map((frame) => ({ observationId: frame.observationId,
        sourceVariable: frame.sourceVariable, frequency: frame.frequency })),
        settings: { palette: timeline.settings.palette, minimum: Number(timeline.settings.minimum),
          maximum: Number(timeline.settings.maximum), lowerPercentile: Number(timeline.settings.lowerPercentile),
          upperPercentile: Number(timeline.settings.upperPercentile), stretch: timeline.settings.stretch,
          bands: Number(timeline.settings.bands), normalizationScale: timeline.settings.normalizationScale } };
      const started = await fetch(`${baseUrl}/api/visualization/sessions/${vizSession.sessionId}/timeline/exports`, {
        method: 'POST', headers: { ...headersFor(vizSession), 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      const startedBody = await started.json() as { exportId?: string; detail?: string };
      if (!started.ok || !startedBody.exportId) throw new Error(startedBody.detail ?? 'Timeline export could not be started.');
      const completion: { value: { status: string; filename?: string; downloadUrl?: string; error?: string } | null } = { value: null };
      for (let attempt = 0; attempt < 600; attempt += 1) {
        const statusResponse = await fetch(`${baseUrl}/api/visualization/sessions/${vizSession.sessionId}/timeline/exports/${startedBody.exportId}`, { headers: headersFor(vizSession) });
        const status = await statusResponse.json() as typeof completed & { detail?: string };
        if (!statusResponse.ok) throw new Error(status.detail ?? 'Timeline export status could not be read.');
        if (status.status === 'completed' || status.status === 'failed') { completion.value = status; break; }
        setTimelineExportStatus(status.status === 'processing' ? 'Rendering frames and calculating changes…' : 'Queued for export…');
        await new Promise((resolve) => window.setTimeout(resolve, 1000));
      }
      const completed = completion.value;
      if (!completed) throw new Error('Timeline export is taking longer than expected; retry from the Timeline section.');
      if (completed.status !== 'completed' || !completed.downloadUrl) throw new Error(completed.error ?? 'Timeline export failed.');
      setTimelineExportStatus('Downloading GIF, PDF report, and JSON metadata…');
      const download = await fetch(`${baseUrl}${completed.downloadUrl}`, { headers: headersFor(vizSession) });
      if (!download.ok) throw new Error((await download.json()).detail ?? 'Timeline export file could not be downloaded.');
      saveBlob(await download.blob(), filenameFromResponse(download, completed.filename ?? 'DeltaEarth_Timeline.zip'));
      setTimelineExportStatus('Timeline export downloaded.');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Timeline export failed.'); setTimelineExportStatus(''); }
    finally { setTimelineExportBusy(false); }
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
      minimum: String(displayLegend.minimum), maximum: String(displayLegend.maximum),
      normalizationScale: displayLegend.normalizationScale };
    setTimeline({ frames: matching, settings: fixedSettings,
      index: Math.max(0, matching.findIndex((item) => item.observationId === raster.observationId && item.sourceVariable === raster.sourceVariable)) });
    setActionMessage(null);
  };

  const clearTimeline = () => setTimeline(null);
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
            <button className="secondary-action" onClick={createTimeline} disabled={!raster || !displayLegend}>Create Timeline</button>
            <button className="secondary-action" onClick={() => void downloadCurrentTiff()} disabled={!raster || tiffDownloadBusy}>{tiffDownloadBusy ? 'Preparing TIFF…' : 'Download TIFF'}</button></div>
        </section>

        {comparison.length > 0 && <section className="visual-card comparison-snapshots">
          <div className="visual-card-heading"><div><span className="section-kicker">Comparison</span><h2>Saved display snapshots</h2></div>
            <div className="comparison-actions"><button className="primary-action" onClick={() => void calculateChanges()} disabled={Boolean(changeCompatibilityError) || changeBusy} title={changeCompatibilityError ?? 'Calculate right raster minus left raster'}>{changeBusy ? 'Calculating…' : 'Changes'}</button><button className="secondary-action" onClick={clearComparison}>Clear Comparison</button></div></div>
          {comparison.length === 2 && changeCompatibilityError && <p className="data-note">Changes unavailable: {changeCompatibilityError}</p>}
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
          {changeResult && <div className="change-result-panel"><div className="visual-card-heading"><div><span className="section-kicker">Scientific raster difference</span><h3>Right − Left</h3></div><button className="secondary-action" onClick={() => void downloadChanges()} disabled={changeDownloadBusy}>{changeDownloadBusy ? 'Preparing ZIP…' : 'Download Changes'}</button></div>
            <p>Positive values mean the right raster is higher; negative values mean lower values. Near-zero changes are within {String(changeResult.statistics.unchangedTolerance)} {changeResult.legend.units}. This measurement difference alone does not confirm an environmental event.</p>
            {changeImageUrl && <img className="change-result-image" src={changeImageUrl} alt="Right raster minus left raster" />}
            <div className="change-result-legend"><span>−{Math.abs(changeResult.legend.minimum).toPrecision(4)} {changeResult.legend.units}</span><i /><span>0</span><i /><span>+{changeResult.legend.maximum.toPrecision(4)} {changeResult.legend.units}</span></div>
            <div className="change-stat-grid">{[['Mean', 'meanDifference'], ['Median', 'medianDifference'], ['Minimum', 'minimumDifference'], ['Maximum', 'maximumDifference'], ['Valid overlapping pixels', 'validOverlappingPixelCount'], ['Valid overlapping area (km²)', 'validOverlappingAreaKm2'], ['Increased', 'percentageIncreased'], ['Decreased', 'percentageDecreased'], ['Unchanged', 'percentageUnchanged']].map(([labelText, key]) => <div key={key}><small>{labelText}</small><strong>{changeResult.statistics[key] == null ? 'Unavailable' : Number(changeResult.statistics[key]).toLocaleString(undefined, { maximumFractionDigits: 4 })}{key.startsWith('percentage') ? '%' : ''}</strong></div>)}</div>
          </div>}
        </section>}

        {timeline && <section className="visual-card timeline-snapshot">
          <div className="visual-card-heading"><div><span className="section-kicker">Timeline</span><h2>Compatible processed acquisitions</h2></div>
            <div className="comparison-actions"><button className="primary-action" onClick={() => void downloadTimeline()} disabled={timelineExportBusy || !vizSession}>{timelineExportBusy ? 'Exporting…' : 'Download Timeline'}</button><button className="secondary-action" onClick={clearTimeline}>Clear Timeline</button></div></div>
          {timelineExportStatus && <p className="timeline-export-status">{timelineExportStatus}</p>}
          {timelineRaster && <>
            <div className="timeline-frame-heading"><div><span>Currently displayed</span><strong>{formatDate(displayedTimeline?.raster.acquisitionDate)}</strong>
              <small>{displayedTimeline ? `${displayedTimeline.raster.granuleId} · ${displayLabel(displayedTimeline.raster)}` : 'Loading first frame…'}</small></div>
              {timeline.index !== timeline.frames.findIndex((frame) => snapshotId(frame) === displayedTimeline?.key) && <span className="timeline-request-status">{timelineLoading ? `Loading ${checkpointLabel(timelineRaster.acquisitionDate)} · ${timelineRaster.granuleId}` : timelineError ? `Could not display ${checkpointLabel(timelineRaster.acquisitionDate)}` : ''}</span>}
            </div>
            <div className="timeline-raster-frame" aria-live="polite">
              {displayedTimeline && <img className="timeline-frame-image timeline-frame-visible" src={displayedTimeline.imageUrl} alt={`Currently displayed acquisition ${checkpointLabel(displayedTimeline.raster.acquisitionDate)}`} />}
              {incomingTimeline && <img className={`timeline-frame-image timeline-frame-incoming ${timelineTransitionStarted ? 'timeline-frame-retiring' : ''}`} src={incomingTimeline.imageUrl} alt={timelineTransitionStarted ? `Previous acquisition ${checkpointLabel(incomingTimeline.raster.acquisitionDate)}` : `Preparing acquisition ${checkpointLabel(incomingTimeline.raster.acquisitionDate)}`} />}
              {!displayedTimeline && timelineLoading && <LoaderCircle className="spin" size={22} />}
              {timelineLoading && <span className="timeline-loading-indicator"><LoaderCircle className="spin" size={13} /> Loading selected frame</span>}
            </div>
            {displayedTimeline && <Legend legend={displayedTimeline.legend} units={String(displayedTimeline.raster.raster.units ?? 'units unavailable')} />}
            {timelineError && <div className="timeline-load-error" role="status">{timelineError} The last successfully displayed frame remains visible. <button className="filter-chip" onClick={retryTimeline}>Retry selected frame</button></div>}
            <AcquisitionTimeline frames={timeline.frames.map(frame => ({ id: snapshotId(frame),
              label: checkpointLabel(frame.acquisitionDate), detail: frame.granuleId }))}
              index={timeline.index} onSelect={index => setTimeline(current => current ? { ...current, index } : current)} />
          </>}
        </section>}
      </div>}
  </main>;
}
