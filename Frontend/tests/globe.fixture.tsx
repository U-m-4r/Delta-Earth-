// Test-only instrumentation: mount the real app and observe its existing viewer.
import { useRef, useState } from 'react';
import { EarthGlobe } from '../src/components/Globe/EarthGlobe';
import type { GlobeCameraState } from '../src/components/Globe/EarthGlobe';
import type { StoryIndexItem } from '../src/types/stories';
import { createRoot } from 'react-dom/client';
import { Camera, Cartesian3, Cartographic, JulianDate, SceneTransforms, Viewer, Math as CesiumMath } from 'cesium';
import App from '../src/App';
import '../src/styles.css';
let viewer: Viewer | null = null;
const viewers = new Set<Viewer>();
let flights = 0;
const originalResize = Viewer.prototype.resize;
Viewer.prototype.resize = function () { viewer = this; viewers.add(this); return originalResize.call(this); };
const originalFlyTo = Camera.prototype.flyTo;
Camera.prototype.flyTo = function (options) { flights++; return originalFlyTo.call(this, options); };
const source = () => viewer?.dataSources.getByName('published-story-markers')[0];
Object.assign(window, { globeTest: {
  ready: () => Boolean(viewer && !viewer.isDestroyed() && source()),
  stats: () => ({ activeViewers: [...viewers].filter(item => !item.isDestroyed()).length,
    totalViewers: viewers.size, entities: source()?.entities.values.map(entity => entity.id),
    visible: source()?.show, flights, imagery: viewer?.imageryLayers.length,
    drawings: viewer?.entities.values.filter(entity => entity.name === 'study-area-drawing').length }),
  basemap: () => viewer?.imageryLayers.get(0).imageryProvider.url,
  tilesLoaded: () => viewer?.scene.globe.tilesLoaded,
  locations: () => source()?.entities.values.map(entity => {
    const position = Cartographic.fromCartesian(entity.position!.getValue(JulianDate.now())!);
    return { id: entity.id, longitude: CesiumMath.toDegrees(position.longitude), latitude: CesiumMath.toDegrees(position.latitude) };
  }),
  look: (longitude: number, latitude: number, height = 650000) => {
    viewer!.camera.cancelFlight(); viewer!.camera.setView({ destination: Cartesian3.fromDegrees(longitude,latitude,height),
      orientation: { heading: 0, pitch: -Math.PI/2, roll: 0 } });
  },
  point: (id: string) => {
    const position = source()?.entities.getById(id)?.position?.getValue(JulianDate.now());
    if (!position || !viewer) return null;
    const point = SceneTransforms.worldToWindowCoordinates(viewer.scene,position);
    if (!point) return null;
    const box=viewer.canvas.getBoundingClientRect();return { x:point.x+box.left,y:point.y+box.top };
  },
  picked: (id: string) => {
    const position=source()?.entities.getById(id)?.position?.getValue(JulianDate.now());
    if(!viewer || !position) return [];
    const point=SceneTransforms.worldToWindowCoordinates(viewer.scene,position);
    const hit=point ? viewer.scene.pick(point) : undefined;
    const ids=Array.isArray(hit?.id) ? hit.id : hit?.id ? [hit.id] : [];
    return ids.map((entity:{id:string})=>entity.id);
  },
  camera: () => viewer ? [...[viewer.camera.positionWC,viewer.camera.directionWC,viewer.camera.upWC].flatMap(p=>[p.x,p.y,p.z])] : [],
  scale: (id:string) => source()?.entities.getById(id)?.billboard?.scale?.getValue(JulianDate.now()),
} });
function OverlayHarness() {
  const [visible, setVisible] = useState(true);
  const [draft, setDraft] = useState(0);
  const [drawing, setDrawing] = useState(false);
  const [clicks, setClicks] = useState(0);
  const camera = useRef<GlobeCameraState | null>(null);
  const overlay = useRef({url:'http://localhost:8787/case-studies/bhagalpur-flood-2026/preview.png',boundsWgs84:[86.90852923933747,25.24208520024809,87.00820902433779,25.361541258819315] as [number,number,number,number]});
  const stories: StoryIndexItem[] = [{slug:'local-story',title:'Local observation',location:'Bhagalpur',changeType:'Test',markerLocation:{longitude:86.95836913183763,latitude:25.301813229533703}}];
  const noop = () => {};
  // Stable callbacks avoid intentionally reinitializing the real viewer.
  const callbacks = useRef({ cursor: noop, selection: noop });
  return <div style={{height:'100vh',position:'relative'}}>
    <EarthGlobe stories={stories} storiesVisible={visible} onOpenStory={noop} cameraMemory={camera}
      selectionActive={drawing} draftVertexCount={draft} clearSignal={0} undoSignal={0} homeSignal={0} focusRequest={null}
      rasterOverlay={overlay.current}
      onRasterClick={()=>setClicks(value=>value+1)} onDraftChange={setDraft} onSelectionChange={callbacks.current.selection} onCursorChange={callbacks.current.cursor} />
    <div style={{position:'absolute',zIndex:5,top:10,left:10}}><button onClick={()=>setVisible(value=>!value)}>Toggle markers</button><button onClick={()=>setDrawing(value=>!value)}>Toggle drawing</button><span id="raster-clicks">{clicks}</span><span id="draft-count">{draft}</span></div>
  </div>;
}
createRoot(document.getElementById('root')!).render(new URLSearchParams(location.search).has('overlay') ? <OverlayHarness /> : <App />);
