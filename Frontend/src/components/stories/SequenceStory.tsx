import { useState } from 'react';
import type { SequenceStoryResult } from '../../types/stories';

const date = (value: string) => value.slice(0, 10);

export function SequenceStory({ story }: { story: SequenceStoryResult }) {
  const [position, setPosition] = useState(0);
  const [showBaseline, setShowBaseline] = useState(false);
  const [failedImage, setFailedImage] = useState<string | null>(null);
  const frame = story.observations[position];
  const baseline = story.observations[0];
  const root = `/case-studies/${story.slug}`;
  if (!frame) return <p role="alert">No observations are available for this story.</p>;
  return <>
    <section className="story-panel story-lead">
      <span className="section-kicker">{story.observations.length} observations · one consistent colour scale</span>
      <h2>{story.headline}</h2><p>{story.introduction}</p>
    </section>
    <section className="story-panel" aria-label="Observation sequence">
      <div className="story-sequence-track" aria-label="Choose an observation">
        {story.observations.map((item, index) => <button key={item.key} type="button"
          className={`story-sequence-stop ${position === index ? 'active' : ''}`}
          aria-label={`Frame ${index + 1}: ${date(item.date)}`} aria-pressed={position === index}
          onClick={() => { setPosition(index); setFailedImage(null); }}>
          <img src={`${root}/${item.image}`} alt="" loading="lazy" />
          <strong>{date(item.date)}</strong><span>{item.label}</span>
        </button>)}
      </div>
      <div className="story-panel-heading">
        <div aria-live="polite"><span className="section-kicker">Observation {position + 1} of {story.observations.length}</span>
          <h2>{frame.label} · {date(frame.date)}</h2></div>
        <div className="story-chips">
          <button className="story-chip" disabled={position === 0} onClick={() => { setPosition(position - 1); setFailedImage(null); }}>Previous observation</button>
          <button className="story-chip" disabled={position === story.observations.length - 1} onClick={() => { setPosition(position + 1); setFailedImage(null); }}>Next observation</button>
        </div>
      </div>
      <p className="story-sequence-caption">{frame.caption}</p>
      <label className="story-baseline-toggle"><input type="checkbox" checked={showBaseline} onChange={event => setShowBaseline(event.target.checked)} /> Show first observation alongside</label>
      <div className={`story-sequence-images ${showBaseline ? 'with-baseline' : ''}`}>
        {showBaseline && <figure><figcaption>Baseline · {date(baseline.date)}</figcaption><div className="story-map"><img src={`${root}/${baseline.image}`} alt={`Baseline radar response on ${date(baseline.date)}`} /></div></figure>}
        <figure><figcaption>Selected · {date(frame.date)}</figcaption><div className="story-map">
          {failedImage === frame.image ? <p role="alert">This observation image could not be loaded. Select another date or reload the story.</p> :
            <img src={`${root}/${frame.image}`} alt={`${story.location}: radar response on ${date(frame.date)}`} onError={() => setFailedImage(frame.image)} />}
        </div></figure>
      </div>
      <div className="story-sequence-legend"><span>{story.display.minimum} dB · lower response</span><i /><span>{story.display.maximum} dB · higher response</span></div>
      <p className="story-note">Every image uses {story.display.palette}, the same {story.display.minimum} to +{story.display.maximum} dB range and the same geographic grid. Transparent areas have no valid observation. Colours represent radar response, not flood depth or water classification.</p>
      <div className="story-metrics">
        <article><span>Mean radar response</span><strong>{frame.meanDb.toFixed(2)} dB</strong></article>
        <article><span>Median radar response</span><strong>{frame.medianDb.toFixed(2)} dB</strong></article>
        <article><span>Valid pixels</span><strong>{frame.validPixelCount.toLocaleString()}</strong></article>
        {frame.changeFromPrevious && <article><span>Mean change since previous date</span><strong>{frame.changeFromPrevious.meanDb > 0 ? '+' : ''}{frame.changeFromPrevious.meanDb.toFixed(2)} dB</strong></article>}
      </div>
      <details className="story-provenance"><summary>Acquisition and processing details</summary><p>{frame.productId}</p><p>{story.method}</p><a href={frame.sourceUrl} target="_blank" rel="noreferrer">Original NASA acquisition</a></details>
    </section>
    <section className="story-panel story-lead"><span className="section-kicker">What this sequence tells us</span><h2>Follow the pattern, then check the explanation</h2><p>{story.conclusion}</p>
      <ul className="story-refs">{story.references.map(reference => <li key={reference.url}><a href={reference.url} target="_blank" rel="noreferrer">{reference.title}</a></li>)}</ul>
    </section>
  </>;
}
