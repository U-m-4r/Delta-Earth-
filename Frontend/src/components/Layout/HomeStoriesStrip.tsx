import { ArrowRight } from 'lucide-react';
import type { StoryIndexItem } from '../../types/stories';
import { storyAssetUrl, useStoryCatalog } from '../../services/storyCatalog';

export function HomeStoriesStrip({ onOpenStory }: { onOpenStory: (slug: string) => void }) {
  const { items } = useStoryCatalog();

  if (!items.length) return null;

  const [feature, ...rest] = items;
  const card = (item: StoryIndexItem, featured = false) => {
    const preview = storyAssetUrl(item);
    return (
      <button key={item.slug} type="button" className={`story-tile${featured ? ' featured' : ''}`} onClick={() => onOpenStory(item.slug)}>
        {preview ? <img src={preview} alt="" loading="lazy" /> : null}
        <span className="story-tile-copy">
          <span className="story-tile-kicker">{item.changeType}</span>
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
      {rest.length ? <div className="story-tile-grid">{rest.map((item) => card(item))}</div> : null}
    </section>
  );
}
