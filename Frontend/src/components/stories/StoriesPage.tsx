import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, BookOpen, ExternalLink } from 'lucide-react';
import type { StoryIndexItem, StoryObservation, StoryResult, SequenceStoryResult } from '../../types/stories';
import { SequenceStory } from './SequenceStory';
import './stories.css';

const root = '/case-studies';

function dateLabel(value?: string) {
  if (!value) return 'Unknown date';
  return new Date(value).toISOString().slice(0, 10);
}

function km(value: number) {
  return `${value.toFixed(1)} km²`;
}

function pct(value?: number) {
  if (typeof value !== 'number') return null;
  return `${Math.round(value * 100)}%`;
}

function observationByKey(story: StoryResult, key: string): StoryObservation | undefined {
  return story.observations.find((item) => item.key === key);
}

export function StoriesPage({ onBack, initialSlug = null }: { onBack: () => void; initialSlug?: string | null }) {
  const [index, setIndex] = useState<StoryIndexItem[]>([]);
  const [slug, setSlug] = useState<string | null>(initialSlug);
  const [story, setStory] = useState<StoryResult | null>(null);
  const [sequence, setSequence] = useState<SequenceStoryResult | null>(null);
  const [pairIndex, setPairIndex] = useState(0);
  const [view, setView] = useState<'water' | 'before' | 'after' | 'difference'>('water');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setSlug(initialSlug);
  }, [initialSlug]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    fetch(`${root}/index.json`)
      .then(async (response) => {
        if (!response.ok) throw new Error('Could not load the saved stories list.');
        return response.json() as Promise<StoryIndexItem[]>;
      })
      .then((items) => {
        if (!active) return;
        setIndex(items);
        setError(null);
      })
      .catch((err: unknown) => {
        if (active) setError(err instanceof Error ? err.message : 'Could not load stories.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!slug) {
      setStory(null);
      setSequence(null);
      return;
    }
    let active = true;
    setLoading(true);
    setStory(null);
    setSequence(null);
    setError(null);
    setPairIndex(0);
    setView('water');
    fetch(`${root}/${slug}/result.json`)
      .then(async (response) => {
        if (!response.ok) throw new Error('Could not load this story.');
        return response.json() as Promise<StoryResult | SequenceStoryResult>;
      })
      .then((result) => {
        if (!active) return;
        if ('kind' in result && result.kind === 'sequence') setSequence(result);
        else setStory(result as StoryResult);
      })
      .catch((err: unknown) => {
        if (active) {
          setStory(null);
          setError(err instanceof Error ? err.message : 'Could not load this story.');
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [slug]);

  const pair = story?.pairs[pairIndex];
  const fromObs = story && pair ? observationByKey(story, pair.from) : undefined;
  const toObs = story && pair ? observationByKey(story, pair.to) : undefined;
  const imageSrc = useMemo(() => {
    if (!story || !pair) return null;
    if (view === 'water') return `${root}/${story.slug}/${pair.waterImage}`;
    if (view === 'difference') return `${root}/${story.slug}/${pair.differenceImage}`;
    if (view === 'before' && fromObs) return `${root}/${story.slug}/${fromObs.image}`;
    if (view === 'after' && toObs) return `${root}/${story.slug}/${toObs.image}`;
    return null;
  }, [story, pair, view, fromObs, toObs]);

  return (
    <main className="stories-workspace">
      <header className="stories-header">
        <button className="visual-back" onClick={slug ? () => setSlug(null) : onBack}>
          <ArrowLeft size={16} /> {slug ? 'All stories' : 'Globe'}
        </button>
        <div>
          <span className="section-kicker">Real NISAR stories</span>
          <h1>{sequence?.title ?? story?.title ?? 'Stories from real satellite radar'}</h1>
          <p>{sequence ? `${sequence.location} · ${sequence.changeType}` : story ? `${story.location} · ${story.changeType}` : 'Explore prepared observation sequences and water-change stories.'}</p>
        </div>
      </header>

      <div className="stories-scroll">
        {error && <div className="stories-alert stories-alert-error" role="alert">{error}</div>}
        {loading && slug && <div className="stories-alert" role="status">Loading story…</div>}
        {loading && !story && !index.length && <div className="stories-alert" role="status">Loading saved stories…</div>}

        {!slug && (
          <>
            <section className="story-hero">
              <div className="story-hero-icon"><BookOpen size={22} /></div>
              <div>
                <span className="section-kicker">Token-free showcase</span>
                <h2>These maps are already prepared.</h2>
                <p>Follow real radar observations through time, compare consistent colour scales, and explore candidate water changes. These prepared stories open without new NASA downloads.</p>
              </div>
            </section>

            <div className="story-grid">
              {index.map((item) => (
                <button key={item.slug} className="story-card" onClick={() => setSlug(item.slug)}>
                  {item.preview ? <img src={`${root}/${item.slug}/${item.preview}`} alt="" loading="lazy" /> : null}
                  <div>
                    <span className="section-kicker">{item.changeType}</span>
                    <strong>{item.title}</strong>
                    <small>{item.location}</small>
                  </div>
                </button>
              ))}
              {!loading && !index.length && !error && <div className="stories-empty">No saved stories were found under /case-studies.</div>}
            </div>
          </>
        )}

        {sequence && <SequenceStory key={sequence.slug} story={sequence} />}
        {story && pair && (
          <>
            <section className="story-panel story-lead">
              <span className="section-kicker">What this story asks</span>
              <h2>{story.headline}</h2>
              <p>{story.event}</p>
              {story.references?.length ? (
                <ul className="story-refs">
                  {story.references.map((ref) => (
                    <li key={ref.url}><a href={ref.url} target="_blank" rel="noreferrer">{ref.title} <ExternalLink size={12} /></a></li>
                  ))}
                </ul>
              ) : null}
            </section>

            <section className="story-panel">
              <div className="story-panel-heading">
                <div>
                  <span className="section-kicker">Water change between dates</span>
                  <h2>{fromObs?.label ?? pair.from} → {toObs?.label ?? pair.to}</h2>
                </div>
                <div className="story-chips">
                  {story.pairs.map((item, index) => {
                    const a = observationByKey(story, item.from);
                    const b = observationByKey(story, item.to);
                    return (
                      <button key={`${item.from}-${item.to}`} className={pairIndex === index ? 'story-chip active' : 'story-chip'} onClick={() => { setPairIndex(index); setView('water'); }}>
                        {dateLabel(a?.date)} → {dateLabel(b?.date)}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="story-chips story-view-tabs">
                {([
                  ['water', 'Water map'],
                  ['before', dateLabel(fromObs?.date)],
                  ['after', dateLabel(toObs?.date)],
                  ['difference', 'Radar difference'],
                ] as const).map(([key, label]) => (
                  <button key={key} className={view === key ? 'story-chip active' : 'story-chip'} onClick={() => setView(key)}>{label}</button>
                ))}
              </div>

              <div className={`story-map${view === 'water' || view === 'difference' ? ' dark-board' : ''}`}>
                {imageSrc ? <img src={imageSrc} alt={view === 'water' ? 'Candidate water change' : view === 'difference' ? 'Radar backscatter difference' : 'Radar backscatter'} /> : <p>Image missing for this view.</p>}
              </div>

              {view === 'water' && (
                <div className="story-legend">
                  <span><i style={{ background: '#2563eb' }} /> Water on both dates</span>
                  <span><i style={{ background: '#ef4444' }} /> New water</span>
                  <span><i style={{ background: '#facc15' }} /> Water receded</span>
                  <span>Land is transparent</span>
                </div>
              )}
              {view === 'difference' && <p className="story-note">Blue: lower radar response · cream: near zero · orange: higher response. Fixed color range −6 to +6 dB.</p>}
              {(view === 'before' || view === 'after') && <p className="story-note">Radar backscatter preview, fixed color range −35 to +5 dB. Darker areas return less radar energy.</p>}

              <div className="story-metrics">
                <article><span>Water before</span><strong>{km(pair.water.waterBeforeKm2)}</strong></article>
                <article><span>Water after</span><strong>{km(pair.water.waterAfterKm2)}</strong></article>
                <article><span>New water</span><strong>{km(pair.water.newWaterKm2)}</strong></article>
                <article><span>Water receded</span><strong>{km(pair.water.recededWaterKm2)}</strong></article>
                <article><span>Net change</span><strong>{km(pair.water.netWaterChangeKm2)}</strong></article>
              </div>
            </section>

            <section className="story-panel">
              <span className="section-kicker">How to read these numbers</span>
              <h2>Radar-dark surfaces below {story.threshold.valueDb} dB are treated as candidate open water.</h2>
              <p className="story-note">{story.threshold.method}</p>
              {pair.water.analysisZone && <p className="story-note">{pair.water.analysisZone.rule}. {pair.water.analysisZone.reason}</p>}
              {pair.water.note && <p className="stories-alert" role="note">{pair.water.note}</p>}
              {(pct(pair.water.reference?.permanentWaterDetectedBefore) || pct(pair.water.reference?.afterAgreement?.recall)) && (
                <p className="story-note">
                  Share of usual permanent water also marked by the radar:
                  {pct(pair.water.reference?.permanentWaterDetectedBefore) ? ` earlier date ${pct(pair.water.reference?.permanentWaterDetectedBefore)}` : ''}
                  {pct(pair.water.reference?.afterAgreement?.recall) ? ` · later date ${pct(pair.water.reference?.afterAgreement?.recall)}` : ''}.
                  Compared against {pair.water.reference?.dataset ?? 'JRC Global Surface Water'}.
                </p>
              )}
              <div className="story-dates">
                {story.observations.map((obs) => (
                  <div key={obs.key}>
                    <span>{obs.label}</span>
                    <strong>{dateLabel(obs.date)}</strong>
                    <small>{obs.measurement ?? 'GCOV'}{obs.bytesRead ? ` · ${(obs.bytesRead / 1048576).toFixed(0)} MB read of ${Math.round(obs.fileSizeMb ?? 0)} MB` : ''}</small>
                  </div>
                ))}
              </div>
            </section>
          </>
        )}
      </div>
    </main>
  );
}
