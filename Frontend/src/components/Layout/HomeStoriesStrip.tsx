import { ArrowRight } from 'lucide-react';
import type { StoryIndexItem } from '../../types/stories';
import { storyAssetUrl, useStoryCatalog } from '../../services/storyCatalog';

// Hand-picked for the home panel (most legible previews); anything missing falls back to catalogue order.
const FEATURED = ['po-delta-sequence-2026', 'australia-manning-2025', 'bhagalpur-flood-2026'];

// Pass null to open the full stories list.
export function HomeStoriesStrip({ onOpenStory }: { onOpenStory: (slug: string | null) => void }) {
  const { items } = useStoryCatalog();

  if (!items.length) return null;

  const picked = FEATURED.map((slug) => items.find((item) => item.slug === slug)).filter((item): item is StoryIndexItem => Boolean(item));
  const [feature, ...rest] = [...picked, ...items.filter((item) => !FEATURED.includes(item.slug))];
  const card = (item: StoryIndexItem, featured = false) => {
    const preview = storyAssetUrl(item);
    return (
      <button key={item.slug} type="button" className={`story-tile${featured ? ' featured' : ''}`} onClick={() => onOpenStory(item.slug)}>
        {preview ? <img src={preview} alt="" loading="lazy" /> : null}
        <span className="story-tile-copy">
          {featured ? <span className="story-tile-kicker">{item.changeType}</span> : null}
          <strong>{item.title} <ArrowRight className="nasa-arrow" size={14} /></strong>
          {featured ? <small>{item.location}</small> : null}
        </span>
      </button>
    );
  };

  return (
    <section className="home-stories" aria-label="Satellite stories">
      <div className="home-stories-heading">
        <span className="section-kicker">Stories</span>
        <p><span className="welcome-dot" /> Click a red spot on the globe, or pick one below.</p>
      </div>
      {card(feature, true)}
      {rest.length ? <div className="story-tile-grid">{rest.slice(0, 2).map((item) => card(item))}</div> : null}
      {items.length > 3 ? (
        <button type="button" className="browse-stories" onClick={() => onOpenStory(null)}>
          Browse all {items.length} stories <ArrowRight className="nasa-arrow" size={14} />
        </button>
      ) : null}
    </section>
  );
}
