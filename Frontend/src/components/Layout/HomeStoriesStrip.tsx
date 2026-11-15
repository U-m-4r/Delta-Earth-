import { useEffect, useState } from 'react';
import { ArrowRight } from 'lucide-react';
import type { StoryIndexItem } from '../../types/stories';

const root = '/case-studies';

export function HomeStoriesStrip({ onOpenStory }: { onOpenStory: (slug: string) => void }) {
  const [items, setItems] = useState<StoryIndexItem[]>([]);

  useEffect(() => {
    let active = true;
    fetch(`${root}/index.json`)
      .then(async (response) => (response.ok ? response.json() as Promise<StoryIndexItem[]> : []))
      .then((list) => {
        if (active) setItems(Array.isArray(list) ? list : []);
      })
      .catch(() => {
        if (active) setItems([]);
      });
    return () => {
      active = false;
    };
  }, []);

  if (!items.length) return null;

  const [feature, ...rest] = items;
  const card = (item: StoryIndexItem, featured = false) => (
    <button key={item.slug} type="button" className={`story-tile${featured ? ' featured' : ''}`} onClick={() => onOpenStory(item.slug)}>
      {item.preview ? <img src={`${root}/${item.slug}/${item.preview}`} alt="" loading="lazy" /> : null}
      <span className="story-tile-copy">
        <span className="story-tile-kicker">{item.changeType}</span>
        <strong>{item.title} <ArrowRight className="nasa-arrow" size={14} /></strong>
        {featured ? <small>{item.location}</small> : null}
      </span>
    </button>
  );

  return (
    <section className="home-stories" aria-label="Flood stories">
      <div className="home-stories-heading">
        <span className="section-kicker">Stories</span>
        <p><span className="welcome-dot" /> Click a red spot on the globe, or pick one below.</p>
      </div>
      {card(feature, true)}
      {rest.length ? <div className="story-tile-grid">{rest.map((item) => card(item))}</div> : null}
    </section>
  );
}
