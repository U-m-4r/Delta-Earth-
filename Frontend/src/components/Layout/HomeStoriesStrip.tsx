import { ChevronRight } from 'lucide-react';
import { useStoryCatalog } from '../../services/storyCatalog';

const root = `${import.meta.env.VITE_BACKEND_URL ?? 'http://localhost:8787'}/case-studies`;

export function HomeStoriesStrip({ onOpenStory }: { onOpenStory: (slug: string) => void }) {
  const { items } = useStoryCatalog();

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
