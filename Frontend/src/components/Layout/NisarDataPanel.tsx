import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, CalendarDays, Download, LoaderCircle, RefreshCw, Satellite, TriangleAlert } from 'lucide-react';
import type { GeoJsonFeature } from '../../types/geojson';
import type { AnalysisResult } from '../../types/visualization';
import { extractNisarVariables, searchNisarScenes, type ExtractionManifest } from '../../services/nisarApi';

const MEASUREMENTS = ['HHHH', 'HVHV', 'VVVV', 'VHVH', 'HHHV', 'HHVH', 'HHVV', 'HVVH', 'HVVV', 'VHVV', 'RHRH', 'RVRV', 'RHRV'];
const AUXILIARY = ['numberOfLooks', 'mask', 'rtcGammaToSigmaFactor'];

export function NisarDataPanel({ selection, onBack }: { selection: GeoJsonFeature; onBack: () => void }) {
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [selectedGranule, setSelectedGranule] = useState('');
  const [selectedVariables, setSelectedVariables] = useState(['HHHH', 'HVHV']);
  const [frequency, setFrequency] = useState('frequencyA');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [loading, setLoading] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [manifest, setManifest] = useState<ExtractionManifest | null>(null);

  const search = useCallback(async () => {
    setLoading(true); setError(null); setManifest(null);
    try {
      const result = await searchNisarScenes(selection, startDate, endDate);
      setAnalysis(result);
      setSelectedGranule((current) => result.observations.some((scene) => scene.id === current) ? current : result.observations[0]?.id ?? '');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Catalog search failed.'); }
    finally { setLoading(false); }
  }, [selection, startDate, endDate]);

  useEffect(() => { void search(); }, [search]);
  const selectedScene = useMemo(() => analysis?.observations.find((scene) => scene.id === selectedGranule), [analysis, selectedGranule]);
  const toggleVariable = (variable: string) => setSelectedVariables((current) => current.includes(variable) ? current.filter((item) => item !== variable) : [...current, variable]);

  const extract = async () => {
    if (!selectedGranule || selectedVariables.length === 0) return;
    setExtracting(true); setError(null); setManifest(null);
    if (!selectedScene) return;
    try { setManifest(await extractNisarVariables(selection, selectedScene, selectedVariables, frequency)); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Harmony extraction failed.'); }
    finally { setExtracting(false); }
  };

  return <main className="visualization-workspace nisar-data-workspace">
    <header className="visualization-header"><button className="visual-back" onClick={onBack}><ArrowLeft size={16} /> Globe</button><div><span className="section-kicker">NASA Earthdata · Harmony</span><h1>NISAR data retrieval</h1><p>Discover GCOV acquisitions and retrieve polygon subsets as GeoTIFFs.</p></div><div className="visual-header-actions"><button className="secondary-action" onClick={() => void search()} disabled={loading}><RefreshCw size={14} /> Search area</button></div></header>
    {error && <div className="visual-error"><TriangleAlert size={16} /> {error}</div>}
    <div className="visual-scroll">
      <section className="visual-card nisar-search-card">
        <div className="visual-card-heading"><div><span className="section-kicker">Step 1 · Product discovery</span><h2>GCOV granules intersecting this area</h2></div><Satellite size={18} /></div>
        <div className="nisar-date-filters"><label>Start date<input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} /></label><label>End date<input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} /></label><span>{analysis ? `${analysis.area.areaKm2.toLocaleString()} km² · ${analysis.observations.length} granules returned` : 'Validating polygon and searching ASF CMR'}</span></div>
        {analysis?.observations.length ? <div className="observation-table-wrap"><table className="observation-table"><thead><tr><th></th><th>Acquired</th><th>Granule</th><th>Frequency</th><th>Polarizations</th></tr></thead><tbody>{analysis.observations.map((scene) => <tr key={scene.id} className={selectedGranule === scene.id ? 'selected' : ''} onClick={() => { setSelectedGranule(scene.id); setManifest(null); }}><td><input aria-label={`Select ${scene.title}`} type="radio" checked={selectedGranule === scene.id} onChange={() => setSelectedGranule(scene.id)} /></td><td>{scene.acquiredAt ? new Date(scene.acquiredAt).toLocaleString() : 'N/A'}</td><td title={scene.id}>{scene.title}</td><td>{scene.frequencies.join(', ') || '—'}</td><td>{scene.polarizations.join(', ') || 'Not in granule name'}</td></tr>)}</tbody></table></div> : <div className="visual-empty">{loading ? 'Searching the ASF catalog…' : 'No GCOV granules intersect this polygon in the selected date range.'}</div>}
        {selectedScene?.assets?.length ? <p className="data-note">Discovery returned {selectedScene.assets.length} metadata/download references. Discovery itself does not download the source HDF5.</p> : null}
      </section>

      <section className="visual-card nisar-extract-card">
        <div className="visual-card-heading"><div><span className="section-kicker">Step 2 · Variable extraction</span><h2>Choose GCOV layer candidates</h2></div><CalendarDays size={18} /></div>
        <p className="analysis-copy">Available datasets vary by acquisition. Each candidate is requested separately from Harmony; returned GeoTIFFs confirm availability, and absent layers are reported as missing. The source HDF5 is never downloaded as a fallback.</p>
        <div className="nisar-variable-groups"><fieldset><legend>Covariance measurements</legend><div className="nisar-variable-list">{MEASUREMENTS.map((name) => <label key={name}><input type="checkbox" checked={selectedVariables.includes(name)} onChange={() => toggleVariable(name)} />{name}</label>)}</div></fieldset><fieldset><legend>Auxiliary quality layers</legend><div className="nisar-variable-list">{AUXILIARY.map((name) => <label key={name}><input type="checkbox" checked={selectedVariables.includes(name)} onChange={() => toggleVariable(name)} />{name}</label>)}</div></fieldset></div>
        <div className="nisar-extract-controls"><label>Frequency<select value={frequency} onChange={(event) => setFrequency(event.target.value)}><option value="frequencyA">Frequency A</option><option value="frequencyB">Frequency B</option></select></label><button className="primary-action" onClick={() => void extract()} disabled={!selectedGranule || !selectedVariables.length || extracting}>{extracting ? <><LoaderCircle size={15} className="spin" /> Processing Harmony jobs…</> : <><Download size={15} /> Extract {selectedVariables.length} layer{selectedVariables.length === 1 ? '' : 's'}</>}</button></div>
        {extracting && <div className="visual-warning"><LoaderCircle size={15} className="spin" /> Harmony submits and monitors a separate job for each selected layer. This can take several minutes.</div>}
        {manifest && <div className="nisar-result-list"><h3>Extraction manifest · {manifest.granuleId}</h3>{manifest.variables.map((result) => <div className="nisar-result-row" key={result.variable}><span className={`nisar-result-status ${result.status}`}>{result.status.replaceAll('_', ' ')}</span><strong>{result.variable}</strong>{result.url ? <a href={`${import.meta.env.VITE_BACKEND_URL ?? 'http://localhost:8787'}${result.url}`} target="_blank" rel="noreferrer">GeoTIFF · {((result.bytes ?? 0) / 1024 / 1024).toFixed(2)} MB <Download size={13} /></a> : <small>{result.error}</small>}</div>)}<p className="data-note">CRS, pixel transform, raster dimensions, resolution, data type, and NoData are stored in the local manifest.</p></div>}
      </section>
    </div>
  </main>;
}
