import { useState } from 'react';
import { BarChart3, Crosshair, Database, Home, Map, MousePointer2, PanelRight, Search, Settings, Undo2, X } from 'lucide-react';
import { EarthGlobe } from './components/Globe/EarthGlobe';
import { LocationSearch } from './components/Globe/LocationSearch';
import { InformationPanel } from './components/Layout/InformationPanel';
import { submitStudyArea } from './services/studyAreaService';
import type { GeoJsonFeature } from './types/geojson';
import type { LocationResult } from './services/locationSearchService';
import { analyzeStudyArea } from './services/visualizationApi';
import { VisualizationPage } from './components/visualizations/VisualizationPage';
import { NisarDataPanel } from './components/Layout/NisarDataPanel';
import type { AnalysisResult, RasterOverlay } from './types/visualization';

function App() {
  const [selectionActive, setSelectionActive] = useState(false);
  const [panelOpen, setPanelOpen] = useState(true);
  const [searchOpen, setSearchOpen] = useState(false);
  const [location, setLocation] = useState<LocationResult | undefined>();
  const [selection, setSelection] = useState<GeoJsonFeature | null>(null);
  const [draftVertexCount, setDraftVertexCount] = useState(0);
  const [cursor, setCursor] = useState<[number, number] | null>(null);
  const [submitMessage, setSubmitMessage] = useState<string | null>(null);
  const [clearSignal, setClearSignal] = useState(0);
  const [undoSignal, setUndoSignal] = useState(0);
  const [homeSignal, setHomeSignal] = useState(0);
  const [focusRequest, setFocusRequest] = useState<{ selection: GeoJsonFeature; id: number } | null>(null);
  const [dataOpen, setDataOpen] = useState(false);
  const [visualizationsOpen, setVisualizationsOpen] = useState(false);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [rasterOverlay, setRasterOverlay] = useState<RasterOverlay | null>(null);
  const [rasterClick, setRasterClick] = useState<[number, number] | null>(null);

  const startSelection = () => {
    setSubmitMessage(null);
    setSelection(null);
    setDraftVertexCount(0);
    setSelectionActive(true);
  };

  const clearSelection = () => {
    setSelection(null);
    setRasterOverlay(null);
    setRasterClick(null);
    setDraftVertexCount(0);
    setSelectionActive(false);
    setSubmitMessage(null);
    setClearSignal((signal) => signal + 1);
  };

  const submit = async () => {
    if (!selection) return;
    const result = await submitStudyArea(selection);
    setSubmitMessage(result.message);
    if (result.ok) setFocusRequest({ selection, id: Date.now() });
  };

  const openVisualizations = async () => {
    if (!selection) return;
    setDataOpen(false);
    setVisualizationsOpen(true);
    if (analysis) return;
    setAnalysisLoading(true);
    setAnalysisError(null);
    try {
      setAnalysis(await analyzeStudyArea(selection));
    } catch (error) {
      setAnalysisError(error instanceof Error ? error.message : 'Unable to load visualization data.');
    } finally {
      setAnalysisLoading(false);
    }
  };

  const openData = async () => {
    if (!selection) return;
    setVisualizationsOpen(false);
    setDataOpen(true);
  };

  return (
    <div className="earth-app">
      <header className="top-navigation">
        <div className="wordmark"><span className="wordmark-orbit" /><div><strong>DANCING <em>WITH</em> SAR</strong><small>EARTH OBSERVATION EXPLORER</small></div></div>
        <div className="top-center">
          <button className={`mode-pill ${selectionActive ? 'active' : ''}`} onClick={startSelection}><span className="mode-dot" />{selectionActive ? 'Polygon selection active' : 'Explore mode'}</button>
          <button className="top-search-button" onClick={() => setSearchOpen((open) => !open)}><Search size={16} /><span>Search anywhere on Earth</span><kbd>⌘ K</kbd></button>
        </div>
        <div className="top-actions"><button className="top-icon"><Settings size={17} /></button><div className="user-badge">DW</div></div>
      </header>

      <div className="workspace">
        <aside className="floating-toolbar" aria-label="Globe tools">
          <button className={!selectionActive ? 'active' : ''} onClick={() => setSelectionActive(false)} title="Navigate"><MousePointer2 size={18} /><span>Navigate</span></button>
          <button className={selectionActive ? 'active' : ''} onClick={startSelection} title="Select polygon"><Map size={18} /><span>Select polygon</span></button>
          <div className="toolbar-divider" />
          <button className={dataOpen ? 'active' : ''} onClick={() => void openData()} disabled={!selection} title="Data"><Database size={18} /><span>Data</span></button>
          <button className={visualizationsOpen ? 'active' : ''} onClick={() => void openVisualizations()} disabled={!selection} title="Visualizations"><BarChart3 size={18} /><span>Visualizations</span></button>
          <button onClick={() => setUndoSignal((signal) => signal + 1)} disabled={!selectionActive || draftVertexCount === 0} title="Undo last point"><Undo2 size={18} /><span>Undo point</span></button>
          <button onClick={clearSelection} disabled={!selection && !selectionActive} title="Clear selection"><X size={18} /><span>Clear</span></button>
          <div className="toolbar-bottom">          <button title="Home view" onClick={() => { setLocation(undefined); setHomeSignal((signal) => signal + 1); }}><Home size={18} /></button><button title="Toggle panel" onClick={() => setPanelOpen((open) => !open)}><PanelRight size={18} /></button></div>
        </aside>

        <main className="globe-workspace">
          <EarthGlobe selectionActive={selectionActive} draftVertexCount={draftVertexCount} location={location} clearSignal={clearSignal} undoSignal={undoSignal} homeSignal={homeSignal} focusRequest={focusRequest} rasterOverlay={rasterOverlay} onRasterClick={setRasterClick} onDraftChange={setDraftVertexCount} onSelectionChange={setSelection} onCursorChange={setCursor} />
          <div className="globe-hint"><Crosshair size={14} /> {selectionActive ? 'Click the globe to add polygon vertices' : 'Click and drag to rotate · Pinch or two-finger scroll to zoom · Right-drag to pan'}</div>
          <div className="bottom-status"><span className="status-live" /> <strong>{selectionActive ? 'SELECTING AREA' : 'GLOBE NAVIGATION'}</strong><i /> {draftVertexCount} {draftVertexCount === 1 ? 'vertex' : 'vertices'}<i /> {cursor ? `${cursor[1].toFixed(4)}°, ${cursor[0].toFixed(4)}°` : 'Move cursor over globe'}</div>
        </main>

        {panelOpen && !dataOpen && !visualizationsOpen && <InformationPanel selection={selection} draftVertexCount={draftVertexCount} selectionActive={selectionActive} onStart={startSelection} onFinish={() => setSelectionActive(false)} onClear={clearSelection} onSubmit={submit} submitMessage={submitMessage} />}
      </div>

      {searchOpen && <LocationSearch onSelect={(result) => { setLocation(result); setSearchOpen(false); }} onClose={() => setSearchOpen(false)} />}
      {dataOpen && selection && <NisarDataPanel selection={selection} onBack={() => setDataOpen(false)} />}
      {visualizationsOpen && selection && <VisualizationPage selection={selection} analysis={analysis} loading={analysisLoading} error={analysisError} rasterClick={rasterClick} onRasterOverlayChange={setRasterOverlay} onBack={() => { setRasterOverlay(null); setVisualizationsOpen(false); }} />}
    </div>
  );
}

export default App;
