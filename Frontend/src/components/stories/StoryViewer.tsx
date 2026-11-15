import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent } from 'react';
import { AcquisitionTimeline } from '../timeline/AcquisitionTimeline';
import { useTimelineFrames } from '../timeline/useTimelineFrames';
import type { StoryDefinition } from './storyDefinition';

const shortDate = (value: string) => {
  if (!value || value === 'NAN') return 'NAN';
  const date = new Date(value.length === 10 ? `${value}T00:00:00Z` : value);
  return Number.isNaN(date.getTime()) ? 'NAN' : date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
};
type View = { x: number; y: number; width: number; height: number };
type Mode = 'observation' | 'compare' | 'changes' | 'water';
type Frame = { key: string; index: number; mode: Mode; image: string; baseline: string; pairIndex: number };
type Preview = Frame & { imageUrl: string; width: number; height: number; baselineUrl?: string };
const keyOf = (frame: Frame) => frame.key;
async function decodeImage(url: string, signal: AbortSignal) {
  if (!url) throw new Error('Observation unavailable: NAN');
  for (let attempt = 0; attempt < 3; attempt++) {
    let imageUrl: string | undefined;
    let retryable = true;
    try {
      signal.throwIfAborted();
      const response = await fetch(url, { signal, cache: attempt ? 'reload' : 'force-cache' });
      if (!response.ok) {
        retryable = response.status >= 500 || response.status === 408 || response.status === 429;
        throw new Error(`Image request failed (HTTP ${response.status}).`);
      }
      if (!response.headers.get('content-type')?.startsWith('image/')) throw new Error('Image response was not an image.');
      imageUrl = URL.createObjectURL(await response.blob());
      const image = new Image(); image.src = imageUrl; await image.decode();
      signal.throwIfAborted();
      return { imageUrl, width: image.naturalWidth, height: image.naturalHeight };
    } catch (error) {
      if (imageUrl) URL.revokeObjectURL(imageUrl);
      if (signal.aborted) throw new DOMException('Superseded acquisition', 'AbortError');
      if (!retryable || attempt === 2) {
        throw new Error('This observation image could not be loaded. The previous acquisition remains visible. ' + (error instanceof Error ? error.message : 'Check the local image server.'));
      }
      await new Promise<void>((resolve, reject) => {
        const timer = window.setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, 200 * (attempt + 1));
        const abort = () => { window.clearTimeout(timer); reject(new DOMException('Superseded acquisition', 'AbortError')); };
        signal.addEventListener('abort', abort, { once: true });
      });
    }
  }
  throw new Error('Observation image unavailable.');
}

export function StoryViewer({ story }: { story: StoryDefinition }) {
  // Only a request cursor is writable. All visible story content derives from the
  // one committed preview returned by the shared Visualization frame lifecycle.
  const [cursor, setCursor] = useState(0);
  const [mode, setMode] = useState<Mode>('observation');
  const [pairChoice, setPairChoice] = useState<number | null>(null);
  const [view, setView] = useState<View | null>(null);
  const [pixel, setPixel] = useState('Click the image to inspect radar values. Drag to pan.');
  const drag = useRef<{ x: number; y: number; view: View; scale: number; moved: boolean } | null>(null);
  const pixelRequest = useRef(0);
  const baselineImages = useRef(new Map<string, Promise<{ imageUrl: string; width: number; height: number }>>());
  const baselineController = useRef(new AbortController());
  const frames = useMemo<Frame[]>(() => story.chapters.map((chapter, index) => {
    const pairIndex = pairChoice !== null && story.pairs[pairChoice]?.to === chapter.id
      ? pairChoice : story.pairs.findIndex(pair => pair.to === chapter.id);
    const pair = story.pairs[pairIndex];
    const pairBaseline = story.chapters.find(item => item.id === pair?.from);
    const baseline = pairBaseline ?? story.chapters[0];
    const root = `${import.meta.env.VITE_BACKEND_URL ?? 'http://localhost:8787'}/case-studies/${story.slug}`;
    const effectiveMode = (mode === 'changes' && !chapter.changeImage && !pair) || (mode === 'water' && !pair) ? 'observation' : mode;
    const image = effectiveMode === 'changes' ? chapter.changeImage ?? (pair ? `${root}/${pair.differenceImage}` : '')
      : effectiveMode === 'water' ? (pair ? `${root}/${pair.waterImage}` : '') : chapter.image;
    return { key: `${story.slug}/${chapter.id}/${effectiveMode}/${pairIndex}/${image}/${baseline?.image ?? ''}`, index, mode: effectiveMode,
      image: chapter.available ? image : '', baseline: baseline?.image ?? '', pairIndex };
  }), [story, mode, pairChoice]);
  const loader = useCallback(async (frame: Frame, signal: AbortSignal): Promise<Preview> => {
    const image = await decodeImage(frame.image, signal);
    try {
      let baselineUrl: string | undefined;
      if (frame.mode === 'compare') {
        const cache = baselineImages.current;
        let baseline = cache.get(frame.baseline);
        if (!baseline) {
          baseline = decodeImage(frame.baseline, baselineController.current.signal);
          cache.set(frame.baseline, baseline);
          const pending = baseline;
          void pending.catch(() => { if (cache.get(frame.baseline) === pending) cache.delete(frame.baseline); });
        }
        baselineUrl = (await baseline).imageUrl;
        if (signal.aborted) throw new DOMException('Superseded acquisition', 'AbortError');
      }
      return { ...frame, ...image, baselineUrl };
    } catch (error) { URL.revokeObjectURL(image.imageUrl); throw error; }
  }, []);
  const { displayed, incoming, transitionStarted, loading, error, retry } = useTimelineFrames({
    frames, index: cursor, version: `${story.slug}/${mode}/${pairChoice}`, loader, keyOf,
  });
  useEffect(() => {
    const controller = new AbortController();
    const cache = new Map<string, Promise<{ imageUrl: string; width: number; height: number }>>();
    baselineController.current = controller;
    baselineImages.current = cache;
    return () => {
      controller.abort();
      cache.forEach(promise => { void promise.then(image => URL.revokeObjectURL(image.imageUrl)).catch(() => {}); });
      cache.clear();
    };
  }, []);
  useEffect(() => { pixelRequest.current += 1; setPixel(story.isBhagalpur
    ? 'Click the image to inspect radar values. Drag to pan.' : 'Drag to pan. Zoom and comparison views stay synchronized.'); }, [displayed?.key, story.isBhagalpur]);
  if (!story.chapters.length) return <p role="alert">No observations are available: NAN</p>;
  const selected = displayed?.index ?? 0;
  const chapter = story.chapters[selected];
  const activeMode = displayed?.mode ?? 'observation';
  const activePair = story.pairs[displayed?.pairIndex ?? -1];
  const reference = story.chapters.find(item => item.id === activePair?.from) ?? story.chapters[0];
  const width = displayed?.width ?? 1003, height = displayed?.height ?? 1322;
  const initialView = { x: 0, y: 0, width, height };
  const camera = view ?? initialView;
  const changesSupported = Boolean(chapter.changeImage || story.pairs.some(pair => pair.to === chapter.id));
  function zoom(factor: number) {
    const nextWidth = Math.max(width / 8, Math.min(width * 2, camera.width * factor));
    const nextHeight = nextWidth * height / width;
    setView({ x: camera.x + (camera.width-nextWidth)/2, y: camera.y+(camera.height-nextHeight)/2, width: nextWidth, height: nextHeight });
  }
  function coordinates(event: PointerEvent<SVGSVGElement>) {
    const point = event.currentTarget.createSVGPoint(); point.x = event.clientX; point.y = event.clientY;
    const matrix = event.currentTarget.getScreenCTM();
    return matrix ? point.matrixTransform(matrix.inverse()) : point;
  }
  async function inspect(event: PointerEvent<SVGSVGElement>, isBaseline: boolean) {
    const target = isBaseline ? reference : chapter;
    if (!target.pixelUrl || !displayed || activeMode === 'water') return;
    const point = coordinates(event);
    if (point.x < 0 || point.x >= width || point.y < 0 || point.y >= height) return;
    const id = ++pixelRequest.current;
    try {
      const response = await fetch(`${target.pixelUrl}?x=${point.x/width}&y=${point.y/height}&changes=${!isBaseline && activeMode === 'changes'}`);
      if (!response.ok) throw new Error('Pixel unavailable');
      const value = await response.json() as { value: number | string; longitude: number; latitude: number };
      if (id === pixelRequest.current) setPixel(`${isBaseline ? 'Baseline' : shortDate(chapter.date)} · ${value.latitude.toFixed(5)}° N, ${value.longitude.toFixed(5)}° E · ${typeof value.value === 'number' ? value.value.toPrecision(6) : 'NAN'} linear radar power`);
    } catch { if (id === pixelRequest.current) setPixel('Pixel inspection unavailable.'); }
  }
  function panel(url: string, label: string, isBaseline = false) {
    return <figure className="flood-map"><figcaption>{label}<span>↑ N · {story.isBhagalpur ? 'Bhagalpur' : story.location}</span></figcaption>
      <svg role="img" aria-label={label} viewBox={`${camera.x} ${camera.y} ${camera.width} ${camera.height}`}
        onPointerDown={event => { drag.current = { x: event.clientX, y: event.clientY, view: camera, scale: 1/(event.currentTarget.getScreenCTM()?.a ?? 1), moved: false }; event.currentTarget.setPointerCapture(event.pointerId); }}
        onPointerMove={event => { const start = drag.current; if (!start) return; const dx = event.clientX-start.x, dy = event.clientY-start.y; if (Math.abs(dx)+Math.abs(dy)>3) start.moved = true; if (start.moved) setView({ ...start.view, x: start.view.x-dx*start.scale, y: start.view.y-dy*start.scale }); }}
        onPointerUp={event => { const moved = drag.current?.moved; drag.current = null; if (!moved) void inspect(event,isBaseline); }} onPointerCancel={() => { drag.current = null; }}>
        {url && <image className="story-frame-visible" href={url} x="0" y="0" width={width} height={height} />}
        {!isBaseline && incoming && <image className={`story-frame-incoming ${transitionStarted ? 'retiring' : ''}`} href={incoming.imageUrl} x="0" y="0" width={width} height={height} />}
      </svg>
      {!url && <span className="flood-map-empty">{loading ? 'Preparing local observation…' : 'NAN'}</span>}
    </figure>;
  }
  return <article className="flood-documentary" data-story={story.slug} style={{ '--story-raster-aspect': `${width} / ${height}` } as CSSProperties}>
    <div className="flood-intro"><span className="section-kicker">{story.kicker}</span><h2>{story.introTitle}{story.introEmphasis && <><br /><em>{story.introEmphasis}</em></>}</h2><p>{story.introduction}</p><span>{story.summary}</span></div>
    <section className="flood-viewer" aria-label="Interactive story">
      <div className="flood-evidence">
        <div className="flood-map-tools"><span role="status">{loading ? `Loading ${shortDate(story.chapters[cursor].date)}…` : 'LOCAL SATELLITE OBSERVATION'}</span><div><button aria-label="Zoom in" onClick={() => zoom(.8)}>+</button><button aria-label="Zoom out" onClick={() => zoom(1.25)}>−</button><button onClick={() => setView(null)}>Reset view</button></div></div>
        <div className={`flood-maps ${activeMode === 'compare' ? 'split' : ''}`}>
          {activeMode === 'compare' && panel(displayed?.baselineUrl ?? '', `Baseline · ${shortDate(reference.date)}`,true)}
          {panel(displayed?.imageUrl ?? '', `${activeMode === 'changes' ? `Change from ${shortDate(reference.date)}` : activeMode === 'water' ? 'Candidate water change' : 'Observation'} · ${shortDate(chapter.date)}`)}
        </div>
        {activeMode === 'water' ? <div className="story-legend"><span><i style={{background:'#2563eb'}} />Water on both dates</span><span><i style={{background:'#ef4444'}} />New water</span><span><i style={{background:'#facc15'}} />Water receded</span><span>Land is transparent</span></div> : <div className="flood-legend"><span>{activeMode === 'changes' ? story.changeDisplay.minimum : story.display.minimum}</span>{(activeMode === 'changes' || story.display.gradient) && <i className={activeMode === 'changes' ? 'diverging' : ''} style={activeMode === 'changes' ? undefined : {background:story.display.gradient}} />}<span>{activeMode === 'changes' ? story.changeDisplay.maximum : story.display.maximum}</span></div>}
        <p className="story-note">{activeMode === 'water' ? 'Candidate open water classification; see the saved method and limitations below.' : activeMode === 'changes' ? story.changeDisplay.note : story.display.note}</p>
        <p className="flood-pixel" aria-live="polite">{pixel}</p>
      </div>
      <aside className="flood-narrative" aria-live="polite" aria-busy={loading}>
        <span className="section-kicker">Chapter {String(selected+1).padStart(2,'0')} / {String(story.chapters.length).padStart(2,'0')}</span><time dateTime={chapter.date}>{shortDate(chapter.date)}{chapter.date && chapter.date !== 'NAN' ? `, ${chapter.date.slice(0,4)}` : ''}</time>
        {chapter.badge && <span className="flood-badge">{chapter.badge}</span>}<h3>{chapter.title}</h3>{chapter.headline && <h4>{chapter.headline}</h4>}
        {chapter.narrative.split('\n\n').map(paragraph => <p key={paragraph}>{paragraph}</p>)}
        {chapter.observation && <blockquote><span>Visual observation</span>{chapter.observation}</blockquote>}
        <div className="flood-actions"><button className={activeMode === 'compare' ? 'active' : ''} disabled={selected === 0 || !reference.available || !chapter.available}
          onClick={() => { setCursor(selected); setMode(activeMode === 'compare' ? 'observation' : 'compare'); }}>{story.isBhagalpur ? 'Compare With June 20' : 'Compare With Baseline'}</button>
          {changesSupported && <button className={activeMode === 'changes' ? 'active' : ''} disabled={!chapter.available}
            onClick={() => { setCursor(selected); setMode(activeMode === 'changes' ? 'observation' : 'changes'); }}>Show Changes</button>}
          {story.pairs.length > 0 && <button className={activeMode === 'water' ? 'active' : ''} disabled={!activePair}
            onClick={() => { setCursor(selected); setMode(activeMode === 'water' ? 'observation' : 'water'); }}>Water map</button>}
        </div>
        {story.pairs.length > 0 && <label className="story-pair-label">Saved comparison<select aria-label="Saved comparison" value={displayed?.pairIndex ?? -1} onChange={event => {
          const value=Number(event.target.value); const pair=story.pairs[value]; if (!pair) return;
          setPairChoice(value); setCursor(story.chapters.findIndex(item=>item.id===pair.to));
        }}><option value={-1} disabled>Select a comparison</option>{story.pairs.map((pair,index)=><option key={`${pair.from}-${pair.to}`} value={index}>{shortDate(story.chapters.find(item=>item.id===pair.from)?.date ?? '')} → {shortDate(story.chapters.find(item=>item.id===pair.to)?.date ?? '')}</option>)}</select></label>}
        <details className="story-provenance"><summary>Acquisition details</summary><p>{chapter.acquisitionDate || 'NAN'}</p><p>{story.method || 'NAN'}</p><pre>{JSON.stringify(chapter.metadata,null,2)}</pre></details>
      </aside>
    </section>
    {error && <div className="stories-alert stories-alert-error" role="alert">{error} <button onClick={retry}>Retry selected frame</button></div>}
    <section className="flood-navigation" aria-label="Story chapters">
      {story.stages.length > 0 && <div className="flood-stages">{story.stages.map(stage=><span key={stage} className={chapter.stage===stage?'active':''}>{stage}</span>)}</div>}
      <AcquisitionTimeline variant="story" frames={story.chapters.map(item=>({id:item.id,label:shortDate(item.date),detail:item.available ? item.acquisitionDate : 'NAN'}))}
        index={cursor} displayedIndex={selected} onSelect={setCursor} />
    </section>
    <p className="flood-interpretation">{story.interpretation}</p>
    {activePair && <section className="story-panel"><span className="section-kicker">Saved scientific comparison · {shortDate(reference.date)} → {shortDate(chapter.date)}</span>
      <div className="story-metrics">{(['waterBeforeKm2','waterAfterKm2','newWaterKm2','recededWaterKm2','netWaterChangeKm2'] as const).map(key=><article key={key}><span>{({waterBeforeKm2:'Water before',waterAfterKm2:'Water after',newWaterKm2:'New water',recededWaterKm2:'Water receded',netWaterChangeKm2:'Net change'})[key]}</span><strong>{activePair.water[key].toFixed(1)} km²</strong></article>)}</div>
      <p className="story-note">{activePair.water.thresholdMethod}</p><p className="story-note">{activePair.water.note}</p>
      {activePair.water.analysisZone && <p className="story-note">{activePair.water.analysisZone.rule}. {activePair.water.analysisZone.reason}</p>}
      <details className="story-provenance"><summary>Saved statistics, calibration and reference agreement</summary><pre>{JSON.stringify(activePair.water,null,2)}</pre></details>
    </section>}
    {(story.conclusion || story.references.length > 0) && <section className="story-panel story-lead">{story.conclusion && <p>{story.conclusion}</p>}<ul className="story-refs">{story.references.map(reference=><li key={reference.url}><a href={reference.url} target="_blank" rel="noreferrer">{reference.title}</a></li>)}</ul></section>}
    <details className="story-provenance"><summary>Complete original story metadata</summary><pre>{JSON.stringify(story.metadata,null,2)}</pre></details>
  </article>;
}
