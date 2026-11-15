import { useEffect, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import type { StoryIndexItem } from '../../types/stories';

const root = `${import.meta.env.VITE_BACKEND_URL ?? 'http://localhost:8787'}/case-studies`;

export function HomeStoriesStrip({ onOpenStory }: { onOpenStory: (slug: string) => void }) {
  const [items, setItems] = useState<StoryIndexItem[]>([]);

  useEffect(() => {
    let active = true;
    fetch(`${import.meta.env.VITE_BACKEND_URL ?? 'http://localhost:8787'}/api/stories`)
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
    <section className="home-stories" aria-label="Satellite stories">
      <div className="home-stories-heading">
        <span className="section-kicker">Stories</span>
        <p>Follow a NISAR observation story without drawing an area.</p>
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
