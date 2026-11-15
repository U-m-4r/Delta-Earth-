import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, CalendarDays, CheckSquare, Download, Eye, LoaderCircle, RefreshCw, Satellite, TriangleAlert } from 'lucide-react';
import type { GeoJsonFeature } from '../../types/geojson';
import type { AnalysisResult, Observation } from '../../types/visualization';
import { getRetrievalSession, searchNisarScenes, startNisarBatch, type RetrievalCombination, type RetrievalSession } from '../../services/nisarApi';

const CHANNELS = [
  { label: 'HH', variable: 'HHHH' }, { label: 'HV', variable: 'HVHV' },
  { label: 'VH', variable: 'VHVH' }, { label: 'VV', variable: 'VVVV' },
];
const keyFor = (id: string, frequency: string, variable: string) => `${id}|${frequency}|${variable}`;
const channelLabel = (variable: string) => CHANNELS.find((item) => item.variable === variable)?.label ?? variable;

type Props = { selection: GeoJsonFeature; onBack: () => void;
  onViewVisualization: (retrievalSessionId: string, studyId: string) => void };

export function NisarDataPanel({ selection, onBack, onViewVisualization }: Props) {
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [loading, setLoading] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [session, setSession] = useState<RetrievalSession | null>(null);

  const search = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const result = await searchNisarScenes(selection, startDate, endDate);
      setAnalysis(result); setSelected(new Set());
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Catalog search failed.'); }
    finally { setLoading(false); }
  }, [selection, startDate, endDate]);
  useEffect(() => { void search(); }, [search]);

  const variablesFor = (scene: Observation) => {
    const known = new Set((scene.availableVariables ?? []).map((item) => `${item.frequency}:${item.variable}`));
    const inferred = new Set(scene.polarizations.filter((value) => CHANNELS.some((item) => item.variable === value)));
    const frequencies = scene.frequencies.length ? scene.frequencies : [...new Set((scene.availableVariables ?? []).map((item) => item.frequency))];
    return frequencies.flatMap((frequency) => CHANNELS.map(({ variable }) => ({ frequency, variable,
      available: scene.availableVariables?.length ? known.has(`${frequency}:${variable}`) : inferred.has(variable) })));
  };
  const selectedCombinations = useMemo(() => {
    const result: RetrievalCombination[] = [];
    for (const scene of analysis?.observations ?? []) {
      for (const available of variablesFor(scene).filter((item) => item.available)) {
        if (selected.has(keyFor(scene.id, available.frequency, available.variable))) result.push({
          granuleId: scene.id, frequency: available.frequency, variable: available.variable, acquisitionMetadata: scene,
        });
      }
    }
    return result;
  }, [analysis, selected]);

  const setGranule = (scene: Observation, checked: boolean) => {
    const next = new Set(selected);
    for (const item of variablesFor(scene).filter((candidate) => candidate.available)) {
      const key = keyFor(scene.id, item.frequency, item.variable);
      if (checked) next.add(key); else next.delete(key);
    }
    setSelected(next);
  };
  const allMatchingSelected = Boolean(analysis?.observations.length) && selectedCombinations.length > 0 &&
    selectedCombinations.length === analysis!.observations.reduce((count, scene) => count + variablesFor(scene).filter((item) => item.available).length, 0);

  const startBatch = async () => {
    if (!analysis?.studyId || !selectedCombinations.length) return;
    setProcessing(true); setError(null);
    try {
      const started = await startNisarBatch(selection, analysis.studyId, startDate, endDate, selectedCombinations);
      setSession(started);
      if (started.status === 'queued') void pollSession(started.retrievalSessionId);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to start extraction batch.');
      setProcessing(false);
    }
  };

  const pollSession = async (id: string) => {
    try {
      const next = await getRetrievalSession(id);
      setSession(next);
      if (['queued', 'processing'].includes(next.status)) window.setTimeout(() => void pollSession(id), 1800);
      else setProcessing(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to read retrieval progress.');
      setProcessing(false);
    }
  };

  const complete = session && ['completed', 'partial', 'failed'].includes(session.status);
  const selectedGranules = new Set(selectedCombinations.map((item) => item.granuleId)).size;
  const granuleChecked = (scene: Observation) => variablesFor(scene).some((item) => item.available) &&
    variablesFor(scene).filter((item) => item.available).every((item) => selected.has(keyFor(scene.id, item.frequency, item.variable)));

  return <main className="visualization-workspace nisar-data-workspace">
    <header className="visualization-header"><button className="visual-back" onClick={onBack}><ArrowLeft size={16} /> Globe</button><div><span className="section-kicker">NASA Earthdata · Harmony</span><h1>NISAR data retrieval</h1><p>Select acquisitions and measurements to retrieve and save.</p></div><div className="visual-header-actions"><button className="secondary-action" onClick={() => void search()} disabled={loading || processing}><RefreshCw size={14} /> Search area</button></div></header>
    {error && <div className="visual-error"><TriangleAlert size={16} /> {error}</div>}
    <div className="visual-scroll">
      <section className="visual-card nisar-search-card">
        <div className="visual-card-heading"><div><span className="section-kicker">Step 1 · Product discovery</span><h2>Choose GCOV granules</h2></div><Satellite size={18} /></div>
        <div className="nisar-date-filters"><label>Start date<input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} disabled={processing} /></label><label>End date<input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} disabled={processing} /></label><span>{analysis ? `${analysis.area.areaKm2.toLocaleString()} km² · ${analysis.observations.length} granules across ${analysis.acquisitionDates.length} acquisition dates` : 'Searching ASF CMR'}</span><button className="filter-chip" onClick={() => { const next = new Set<string>(); if (!allMatchingSelected) analysis?.observations.forEach((scene) => variablesFor(scene).forEach((item) => next.add(keyFor(scene.id, item.frequency, item.variable)))); setSelected(next); }} disabled={!analysis?.observations.length || processing}><CheckSquare size={14} /> {allMatchingSelected ? 'Clear all' : 'Select all matching'}</button></div>
        {analysis?.observations.length ? <div className="observation-table-wrap"><table className="observation-table"><thead><tr><th>Select</th><th>Acquired</th><th>Granule</th><th>Frequency</th><th>Available polarization measurements</th><th>Footprint</th><th>Product</th></tr></thead><tbody>{analysis.observations.map((scene) => {
          const available = variablesFor(scene); const checked = granuleChecked(scene);
          const frequencies = [...new Set(available.map((item) => item.frequency))];
          return <tr key={scene.id} className={checked ? 'selected' : ''}>
            <td><input aria-label={`Select all measurements for ${scene.id}`} type="checkbox" checked={checked} disabled={!available.some((item) => item.available) || processing} onChange={(event) => setGranule(scene, event.target.checked)} /></td>
            <td>{scene.acquiredAt ? new Date(scene.acquiredAt).toLocaleString() : 'Unavailable'}</td><td title={scene.id}>{scene.id}</td>
            <td>{frequencies.map((frequency) => frequency.replace('frequency', '')).join(', ') || '—'}</td>
            <td><div className="nisar-variable-list">{available.map((item) => <label className={!item.available ? 'variable-unavailable' : ''} key={`${item.frequency}:${item.variable}`}><input type="checkbox" checked={selected.has(keyFor(scene.id, item.frequency, item.variable))} disabled={!item.available || processing} onChange={(event) => { const next = new Set(selected); const key = keyFor(scene.id, item.frequency, item.variable); event.target.checked ? next.add(key) : next.delete(key); setSelected(next); }} />{item.frequency.replace('frequency', '')} · {channelLabel(item.variable)}{!item.available && <small> not listed</small>}</label>)}{!available.length && <small>Frequency not reported</small>}</div></td>
            <td>{scene.bbox ? `${scene.bbox.map((value) => value.toFixed(2)).join(', ')}` : 'Not reported'}</td><td>{scene.productType ?? 'GCOV'}</td>
          </tr>;
        })}</tbody></table></div> : <div className="visual-empty">{loading ? 'Searching the ASF catalog…' : 'No GCOV granules intersect this polygon in the selected date range.'}</div>}
        {analysis?.observations.length ? <p className="data-note">Acquisition timestamps and variable availability come from the catalog records. Unsupported or unreported channels are not added automatically.</p> : null}
      </section>

      <section className="visual-card nisar-extract-card">
        <div className="visual-card-heading"><div><span className="section-kicker">Step 2 · Persistent processing</span><h2>Retrieve selected measurements</h2></div><CalendarDays size={18} /></div>
        <div className="nisar-extract-controls"><p>{selectedGranules} granules · {selectedCombinations.length} granule / polarization combinations selected</p><button className="primary-action" onClick={() => void startBatch()} disabled={!selectedCombinations.length || !analysis?.studyId || processing}>{processing ? <><LoaderCircle size={15} className="spin" /> Processing batch…</> : <><Download size={15} /> Process selected data</>}</button></div>
        {session && <div className="nisar-result-list"><h3>Retrieval session · {session.status.replaceAll('_', ' ')}</h3><p>{session.completedCount} successful · {session.failedCount} failed · {session.combinations.length} combinations · {session.startDate ?? 'All dates'} to {session.endDate ?? 'present'}</p>{session.currentGranuleId && <p className="data-note">Current: {session.currentGranuleId} · {session.currentVariable}</p>}{session.combinations.map((item, index) => <div className="nisar-result-row" key={`${item.granuleId}-${item.frequency}-${item.variable}-${index}`}><span className={`nisar-result-status ${item.status ?? 'queued'}`}>{item.status ?? 'queued'}</span><strong>{item.granuleId} · {item.frequency.replace('frequency', '')} · {channelLabel(item.variable)}</strong>{item.error && <small>{item.error}</small>}{item.jobId && <small>Harmony job {item.jobId}</small>}{item.bytes && <small>{(item.bytes / 1024 / 1024).toFixed(2)} MB</small>}</div>)}{complete && session.completedCount > 0 && <button className="primary-action view-visualization-action" onClick={() => onViewVisualization(session.retrievalSessionId, session.studyId)}><Eye size={16} /> View Visualization</button>}</div>}
      </section>
    </div>
  </main>;
}
