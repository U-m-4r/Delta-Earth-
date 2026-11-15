import { useEffect, useRef, useState } from 'react';
import { BarChart3, BookOpen, Database, Info, Home, Map, MapPin, Moon, MousePointer2, PanelRight, Search, Settings, Sun, Undo2, X } from 'lucide-react';
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
  const { items: stories } = useStoryCatalog();
  const [storiesVisible, setStoriesVisible] = useState(true);
  const [infoOpen, setInfoOpen] = useState(false);
  const globeCamera = useRef<GlobeCameraState | null>(null);
  const initialQuery = new URLSearchParams(window.location.search);
  const [selectionActive, setSelectionActive] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [theme, setTheme] = useState<'dark' | 'light'>(() => { try { return localStorage.getItem('theme') === 'light' ? 'light' : 'dark'; } catch { return 'dark'; } });
  useEffect(() => { document.documentElement.dataset.theme = theme; try { localStorage.setItem('theme', theme); } catch { /* storage blocked */ } }, [theme]);
  const [panelOpen, setPanelOpen] = useState(() => !window.matchMedia('(max-width: 700px)').matches);
  const [searchOpen, setSearchOpen] = useState(false);
  const [location, setLocation] = useState<LocationResult | undefined>();
  const [selection, setSelection] = useState<GeoJsonFeature | null>(null);
  const [draftVertexCount, setDraftVertexCount] = useState(0);
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
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); setSearchOpen((open) => !open); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
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
        <div className="wordmark"><span className="wordmark-orbit" /><div><strong>Delta <em>Earth</em></strong><small>NISAR Change Explorer</small></div></div>
        <div className="top-center">
          <button className="top-search-button" aria-label="Search anywhere on Earth" onClick={() => setSearchOpen((open) => !open)}><Search size={16} /><span>Search anywhere on Earth</span><kbd>⌘ K</kbd></button>
        </div>
        <div className="top-actions">
          <button className="top-icon" aria-label="Settings" aria-expanded={settingsOpen} onClick={() => setSettingsOpen((open) => !open)}><Settings size={17} /></button>
          <div className={`settings-menu${settingsOpen ? ' open' : ''}`} role="group" aria-label="Theme">
              <button className={theme === 'dark' ? 'active' : ''} onClick={() => setTheme('dark')}><Moon size={14} />Dark</button>
              <button className={theme === 'light' ? 'active' : ''} onClick={() => setTheme('light')}><Sun size={14} />Light</button>
          </div>
        </div>
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
            <button className={!selectionActive ? 'active' : ''} onClick={() => setSelectionActive(false)}><MousePointer2 size={18} /><span>Navigate</span></button>
            <button className={selectionActive ? 'active' : ''} onClick={startSelection}><Map size={18} /><span>Select area</span></button>
            <div className="toolbar-divider" />
            <button onClick={() => openStories()}><BookOpen size={18} /><span>Stories</span></button>
            <button className={storiesVisible ? 'active' : ''} aria-label="Show story markers" aria-pressed={storiesVisible} onClick={() => setStoriesVisible((visible) => !visible)}><MapPin size={18} /><span>Markers</span></button>
            <button className={dataOpen ? 'active' : ''} onClick={() => void openData()} disabled={!selection}><Database size={18} /><span>Data</span></button>
            <button className={visualizationsOpen ? 'active' : ''} onClick={() => void openVisualizations()} disabled={!retrievalSessionId || !retrievalStudyId}><BarChart3 size={18} /><span>Visualize</span></button>
            <button onClick={() => setUndoSignal((signal) => signal + 1)} disabled={!selectionActive || draftVertexCount === 0}><Undo2 size={18} /><span>Undo</span></button>
            <button onClick={clearSelection} disabled={!selection && !selectionActive}><X size={18} /><span>Clear</span></button>
            <div className="toolbar-divider" />
            <button onClick={() => { setLocation(undefined); setHomeSignal((signal) => signal + 1); }}><Home size={18} /><span>Home</span></button><button onClick={() => setPanelOpen((open) => !open)}><PanelRight size={18} /><span>Panel</span></button>
          </aside>

          <main className="globe-workspace">
            <EarthGlobe stories={stories} storiesVisible={storiesVisible} onOpenStory={openStories} cameraMemory={globeCamera} selectionActive={selectionActive} draftVertexCount={draftVertexCount} location={location} clearSignal={clearSignal} undoSignal={undoSignal} homeSignal={homeSignal} focusRequest={focusRequest} rasterOverlay={rasterOverlay} onRasterClick={() => {}} onDraftChange={setDraftVertexCount} onSelectionChange={setSelection} />
            <div className="globe-info">
              <button className={`globe-info-button${infoOpen ? ' active' : ''}`} aria-label="Globe controls" aria-expanded={infoOpen} onClick={() => setInfoOpen((open) => !open)}><Info size={16} /></button>
              {infoOpen && (
                <div className="globe-info-popover" role="dialog" aria-label="Globe controls">
                  <span className="section-kicker">Globe controls</span>
                  <dl>
                    <div><dt>Rotate</dt><dd>Click and drag</dd></div>
                    <div><dt>Zoom</dt><dd>Scroll, or pinch on a trackpad</dd></div>
                    <div><dt>Pan</dt><dd>Right-click and drag</dd></div>
                    <div><dt>Search</dt><dd><kbd>⌘ K</kbd></dd></div>
                    <div><dt>Select area</dt><dd>Click three or more points on the globe</dd></div>
                  </dl>
                </div>
              )}
            </div>
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
