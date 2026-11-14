import { useState } from 'react';
import { Crosshair, Home, Map, MousePointer2, PanelRight, Search, Settings, Undo2, X } from 'lucide-react';
import { EarthGlobe } from './components/Globe/EarthGlobe';
import { LocationSearch } from './components/Globe/LocationSearch';
import { InformationPanel } from './components/Layout/InformationPanel';
import { submitStudyArea } from './services/studyAreaService';
import type { GeoJsonFeature } from './types/geojson';
import type { LocationResult } from './services/locationSearchService';

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

  const startSelection = () => {
    setSubmitMessage(null);
    setSelection(null);
    setDraftVertexCount(0);
    setSelectionActive(true);
  };

  const clearSelection = () => {
    setSelection(null);
    setDraftVertexCount(0);
    setSelectionActive(false);
    setSubmitMessage(null);
    setClearSignal((signal) => signal + 1);
  };

  const submit = () => {
    if (!selection) return;
    const result = submitStudyArea(selection);
    setSubmitMessage(result.message);
    if (result.ok) setFocusRequest({ selection, id: Date.now() });
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
          <button onClick={() => setUndoSignal((signal) => signal + 1)} disabled={!selectionActive || draftVertexCount === 0} title="Undo last point"><Undo2 size={18} /><span>Undo point</span></button>
          <button onClick={clearSelection} disabled={!selection && !selectionActive} title="Clear selection"><X size={18} /><span>Clear</span></button>
          <div className="toolbar-bottom">          <button title="Home view" onClick={() => { setLocation(undefined); setHomeSignal((signal) => signal + 1); }}><Home size={18} /></button><button title="Toggle panel" onClick={() => setPanelOpen((open) => !open)}><PanelRight size={18} /></button></div>
        </aside>

        <main className="globe-workspace">
          <EarthGlobe selectionActive={selectionActive} draftVertexCount={draftVertexCount} location={location} clearSignal={clearSignal} undoSignal={undoSignal} homeSignal={homeSignal} focusRequest={focusRequest} onDraftChange={setDraftVertexCount} onSelectionChange={setSelection} onCursorChange={setCursor} />
          <div className="globe-hint"><Crosshair size={14} /> {selectionActive ? 'Click the globe to add polygon vertices' : 'Click and drag to rotate · Pinch or two-finger scroll to zoom · Right-drag to pan'}</div>
          <div className="bottom-status"><span className="status-live" /> <strong>{selectionActive ? 'SELECTING AREA' : 'GLOBE NAVIGATION'}</strong><i /> {draftVertexCount} {draftVertexCount === 1 ? 'vertex' : 'vertices'}<i /> {cursor ? `${cursor[1].toFixed(4)}°, ${cursor[0].toFixed(4)}°` : 'Move cursor over globe'}</div>
        </main>

        {panelOpen && <InformationPanel selection={selection} draftVertexCount={draftVertexCount} selectionActive={selectionActive} onStart={startSelection} onFinish={() => setSelectionActive(false)} onClear={clearSelection} onSubmit={submit} submitMessage={submitMessage} />}
      </div>

      {searchOpen && <LocationSearch onSelect={(result) => { setLocation(result); setSearchOpen(false); }} onClose={() => setSearchOpen(false)} />}
    </div>
  );
}

export default App;
