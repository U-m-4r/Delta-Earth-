import { useEffect, useState } from 'react';
import { ChevronRight } from 'lucide-react';
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

  return (
    <section className="home-stories" aria-label="Flood stories">
      <div className="home-stories-heading">
        <span className="section-kicker">Stories</span>
        <p>Open a finished NISAR flood story without drawing an area.</p>
      </div>
      <div className="home-stories-scroll">
        {items.map((item) => (
          <button key={item.slug} type="button" className="home-story-chip" onClick={() => onOpenStory(item.slug)}>
            {item.preview ? <img src={`${root}/${item.slug}/${item.preview}`} alt="" loading="lazy" /> : null}
            <span>
              <strong>{item.title}</strong>
              <small>{item.location}</small>
            </span>
            <ChevronRight size={14} />
          </button>
        ))}
      </div>
    </section>
  );
}
