import { useRef, useState } from 'react';
import { BarChart3, BookOpen, Crosshair, Database, Home, Map, MousePointer2, PanelRight, Search, Settings, Undo2, X } from 'lucide-react';
import type { GlobeCameraState } from './components/Globe/EarthGlobe';
import { useStoryCatalog } from './services/storyCatalog';
import { EarthGlobe } from './components/Globe/EarthGlobe';
import { LocationSearch } from './components/Globe/LocationSearch';
import { InformationPanel } from './components/Layout/InformationPanel';
import { submitStudyArea } from './services/studyAreaService';
import type { GeoJsonFeature } from './types/geojson';
import type { LocationResult } from './services/locationSearchService';
import { VisualizationPage } from './components/visualizations/VisualizationPage';
import { NisarDataPanel } from './components/Layout/NisarDataPanel';
import { StoriesPage } from './components/stories/StoriesPage';
import type { RasterOverlay } from './types/visualization';

function App() {
  const { items: stories, loading: storiesLoading, error: storiesError } = useStoryCatalog();
  const [storiesVisible, setStoriesVisible] = useState(true);
  const globeCamera = useRef<GlobeCameraState | null>(null);
  const initialQuery = new URLSearchParams(window.location.search);
  const [selectionActive, setSelectionActive] = useState(false);
  const [panelOpen, setPanelOpen] = useState(() => !window.matchMedia('(max-width: 700px)').matches);
  const [searchOpen, setSearchOpen] = useState(false);
  const [location, setLocation] = useState<LocationResult | undefined>();
  const [selection, setSelection] = useState<GeoJsonFeature | null>(null);
  const [draftVertexCount, setDraftVertexCount] = useState(0);
  const [cursor, setCursor] = useState<[number, number] | null>(null);
  const [submitMessage, setSubmitMessage] = useState<string | null>(null);
  const [submitLoading, setSubmitLoading] = useState(false);
  const [analysisReady, setAnalysisReady] = useState(false);
  const [clearSignal, setClearSignal] = useState(0);
  const [undoSignal, setUndoSignal] = useState(0);
  const [homeSignal, setHomeSignal] = useState(0);
  const [focusRequest, setFocusRequest] = useState<{ selection: GeoJsonFeature; id: number } | null>(null);
  const [dataOpen, setDataOpen] = useState(false);
  const [visualizationsOpen, setVisualizationsOpen] = useState(Boolean(initialQuery.get('retrievalSessionId')));
  const [retrievalSessionId, setRetrievalSessionId] = useState(initialQuery.get('retrievalSessionId') ?? '');
  const [retrievalStudyId, setRetrievalStudyId] = useState(initialQuery.get('studyId') ?? '');
  const [storiesOpen, setStoriesOpen] = useState(false);
  const [storySlug, setStorySlug] = useState<string | null>(null);
  const [rasterOverlay, setRasterOverlay] = useState<RasterOverlay | null>(null);
  const clearRetrievalUrl = () => window.history.replaceState({}, '', window.location.pathname);

  const startSelection = () => {
    clearRetrievalUrl();
    setSubmitMessage(null);
    setSubmitLoading(false);
    setAnalysisReady(false);
    setSelection(null);
    setDraftVertexCount(0);
    setSelectionActive(true);
    setStoriesOpen(false);
  };

  const clearSelection = () => {
    setSelection(null);
    setRasterOverlay(null);
    setDraftVertexCount(0);
    setSelectionActive(false);
    setSubmitMessage(null);
    setSubmitLoading(false);
    setAnalysisReady(false);
    setClearSignal((signal) => signal + 1);
  };

  const submit = async () => {
    if (!selection || submitLoading) return;
    setSubmitLoading(true);
    setAnalysisReady(false);
    setSubmitMessage('Searching NASA for satellite records over this area…');
    const result = await submitStudyArea(selection);
    setSubmitMessage(result.message);
    setSubmitLoading(false);
    setAnalysisReady(result.ok);
    if (result.ok) setFocusRequest({ selection, id: Date.now() });
  };

  const openStories = (slug: string | null = null) => {
    clearRetrievalUrl();
    setDataOpen(false);
    setVisualizationsOpen(false);
    setStorySlug(slug);
    setStoriesOpen(true);
  };

  const openVisualizations = (sessionId = retrievalSessionId, studyId = retrievalStudyId) => {
    if (!sessionId || !studyId) return;
    setDataOpen(false);
    setStoriesOpen(false);
    setRetrievalSessionId(sessionId);
    setRetrievalStudyId(studyId);
    setVisualizationsOpen(true);
    const query = new URLSearchParams({ retrievalSessionId: sessionId, studyId });
    window.history.replaceState({}, '', `${window.location.pathname}?${query.toString()}`);
  };

  const openData = async () => {
    if (!selection) return;
    clearRetrievalUrl();
    setVisualizationsOpen(false);
    setStoriesOpen(false);
    setDataOpen(true);
  };

  return (
    <div className="earth-app">
      <header className="top-navigation">
        <div className="wordmark"><span className="wordmark-orbit" /><div><strong>DELTA <em>EARTH</em></strong><small>NISAR CHANGE EXPLORER</small></div></div>
        <div className="top-center">
          <button className={`mode-pill ${selectionActive ? 'active' : ''}`} onClick={startSelection}><span className="mode-dot" />{selectionActive ? 'Polygon selection active' : 'Explore mode'}</button>
          <button className="top-search-button" aria-label="Search anywhere on Earth" onClick={() => setSearchOpen((open) => !open)}><Search size={16} /><span>Search anywhere on Earth</span><kbd>⌘ K</kbd></button>
        </div>
        <div className="top-actions"><button className="top-icon"><Settings size={17} /></button><div className="user-badge">DE</div></div>
      </header>

      {storiesOpen ? (
        <StoriesPage initialSlug={storySlug} onBack={() => { setStoriesOpen(false); setStorySlug(null); }} />
      ) : dataOpen && selection ? (
        <NisarDataPanel selection={selection} onBack={() => setDataOpen(false)} onViewVisualization={(sessionId, studyId) => openVisualizations(sessionId, studyId)} />
      ) : visualizationsOpen && selection ? (
        <VisualizationPage selection={selection} retrievalSessionId={retrievalSessionId} studyId={retrievalStudyId} onRasterOverlayChange={setRasterOverlay} onBack={() => { setRasterOverlay(null); setVisualizationsOpen(false); clearRetrievalUrl(); }} />
      ) : visualizationsOpen && retrievalSessionId && retrievalStudyId ? (
        <VisualizationPage retrievalSessionId={retrievalSessionId} studyId={retrievalStudyId} onRasterOverlayChange={setRasterOverlay} onBack={() => { setRasterOverlay(null); setVisualizationsOpen(false); window.history.replaceState({}, '', window.location.pathname); }} />
      ) : (
        <div className="workspace">
          <aside className="floating-toolbar" aria-label="Globe tools">
            <button className={!selectionActive ? 'active' : ''} onClick={() => setSelectionActive(false)} title="Navigate"><MousePointer2 size={18} /><span>Navigate</span></button>
            <button className={selectionActive ? 'active' : ''} onClick={startSelection} title="Select polygon"><Map size={18} /><span>Select polygon</span></button>
            <div className="toolbar-divider" />
            <button onClick={() => openStories()} title="Stories"><BookOpen size={18} /><span>Stories</span></button>
            <button className={dataOpen ? 'active' : ''} onClick={() => void openData()} disabled={!selection} title="Data"><Database size={18} /><span>Data</span></button>
            <button className={visualizationsOpen ? 'active' : ''} onClick={() => void openVisualizations()} disabled={!retrievalSessionId || !retrievalStudyId} title="Visualizations"><BarChart3 size={18} /><span>Visualizations</span></button>
            <button onClick={() => setUndoSignal((signal) => signal + 1)} disabled={!selectionActive || draftVertexCount === 0} title="Undo last point"><Undo2 size={18} /><span>Undo point</span></button>
            <button onClick={clearSelection} disabled={!selection && !selectionActive} title="Clear selection"><X size={18} /><span>Clear</span></button>
            <div className="toolbar-bottom">          <button title="Home view" onClick={() => { setLocation(undefined); setHomeSignal((signal) => signal + 1); }}><Home size={18} /></button><button title="Toggle panel" onClick={() => setPanelOpen((open) => !open)}><PanelRight size={18} /></button></div>
          </aside>

          <main className="globe-workspace">
            <EarthGlobe stories={stories} storiesVisible={storiesVisible} onOpenStory={openStories} cameraMemory={globeCamera} selectionActive={selectionActive} draftVertexCount={draftVertexCount} location={location} clearSignal={clearSignal} undoSignal={undoSignal} homeSignal={homeSignal} focusRequest={focusRequest} rasterOverlay={rasterOverlay} onRasterClick={() => {}} onDraftChange={setDraftVertexCount} onSelectionChange={setSelection} onCursorChange={setCursor} />
            <div className="globe-story-controls"><button className="globe-stories-toggle" aria-label="Show story markers" aria-pressed={storiesVisible}
              onClick={() => setStoriesVisible(visible => !visible)}><BookOpen size={14} /> Stories <i className={storiesVisible ? 'on' : ''} /></button>
              {storiesVisible && <span>{storiesLoading ? 'Loading stories…' : storiesError ? 'Story markers unavailable' : `${stories.filter(story => story.markerLocation).length} stories around the world`}</span>}
            </div>
            <div className="globe-hint"><Crosshair size={14} /> {selectionActive ? 'Click the globe to add polygon vertices' : 'Click and drag to rotate · Pinch or two-finger scroll to zoom · Right-drag to pan'}</div>
            <div className="bottom-status"><span className="status-live" /> <strong>{selectionActive ? 'SELECTING AREA' : 'GLOBE NAVIGATION'}</strong><i /> {draftVertexCount} {draftVertexCount === 1 ? 'vertex' : 'vertices'}<i /> {cursor ? `${cursor[1].toFixed(4)}°, ${cursor[0].toFixed(4)}°` : 'Move cursor over globe'}</div>
          </main>

          {panelOpen && (
            <InformationPanel
              selection={selection}
              draftVertexCount={draftVertexCount}
              selectionActive={selectionActive}
              onStart={startSelection}
              onFinish={() => setSelectionActive(false)}
              onClear={clearSelection}
              onSubmit={() => void submit()}
              submitMessage={submitMessage}
              submitLoading={submitLoading}
              analysisReady={analysisReady}
              onOpenData={() => void openData()}
              onOpenVisualizations={retrievalSessionId && retrievalStudyId ? () => void openVisualizations() : undefined}
              onOpenStory={(slug) => openStories(slug)}
            />
          )}
        </div>
      )}

      {searchOpen && <LocationSearch onSelect={(result) => { setLocation(result); setSearchOpen(false); }} onClose={() => setSearchOpen(false)} />}
    </div>
  );
}

export default App;
