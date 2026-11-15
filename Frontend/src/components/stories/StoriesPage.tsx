import { useEffect, useState } from 'react';
import { ArrowLeft, BookOpen } from 'lucide-react';
import { useStoryCatalog } from '../../services/storyCatalog';
import { StoryViewer } from './StoryViewer';
import { toStoryDefinition } from './storyDefinition';
import type { RawStory, StoryDefinition } from './storyDefinition';
import './stories.css';

const root = `${import.meta.env.VITE_BACKEND_URL ?? 'http://localhost:8787'}/case-studies`;

export function StoriesPage({ onBack, initialSlug = null }: { onBack: () => void; initialSlug?: string | null }) {
  const { items: index, loading: catalogueLoading, error: catalogueError } = useStoryCatalog();
  const [slug, setSlug] = useState<string | null>(initialSlug);
  const [story, setStory] = useState<StoryDefinition | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setSlug(initialSlug);
  }, [initialSlug]);

  useEffect(() => {
    if (!slug) {
      setStory(null);

      return;
    }
    let active = true;
    setLoading(true);
    setStory(null);

    setError(null);

    fetch(`${import.meta.env.VITE_BACKEND_URL ?? 'http://localhost:8787'}/api/stories/${slug}`)
      .then(async (response) => {
        if (!response.ok) throw new Error('Could not load this story.');
        return response.json() as Promise<RawStory>;
      })
      .then((result) => {
        if (!active) return;
        setStory(toStoryDefinition(result));
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

  return (
    <main className="stories-workspace">
      <header className="stories-header">
        <button className="visual-back" onClick={slug ? () => setSlug(null) : onBack}>
          <ArrowLeft size={16} /> {slug ? 'All stories' : 'Globe'}
        </button>
        <div>
          <span className="section-kicker">Real NISAR stories</span>
          <h1>{story?.title ?? 'Every Landscape Has a Story.'}</h1>
          <p>{story ? `${story.subtitle} · ${story.location}` : 'Explore prepared observation sequences and water-change stories.'}</p>
        </div>
      </header>

      <div className="stories-scroll">
        {(error || catalogueError) && <div className="stories-alert stories-alert-error" role="alert">{error || catalogueError}</div>}
        {loading && slug && <div className="stories-alert" role="status">Loading story…</div>}
        {catalogueLoading && !story && !index.length && <div className="stories-alert" role="status">Loading saved stories…</div>}

        {!slug && (
          <>
            <section className="story-hero">
              <div className="story-hero-icon"><BookOpen size={22} /></div>
              <div>
                <span className="section-kicker">Earth, observed</span>
                <h2>Every Landscape Has a Story.</h2>
                <p>Discover how our planet changes through real satellite observations.</p>
              </div>
            </section>

            <h2 className="featured-heading">Featured Stories <span>Field notes from a changing planet</span></h2>
            <div className="story-grid">
              {index.map((item) => (
                <button key={item.slug} className="story-card" onClick={() => setSlug(item.slug)}>
                  {item.preview ? <img src={`${root}/${item.slug}/${item.preview}`} alt="" loading="lazy" /> : null}
                  <div>
                    <span className="section-kicker">{item.changeType}</span>
                    <strong>{item.title}</strong>
                    <small>{item.location}</small>
                    {item.period && <p className="story-card-period">{item.period} · NISAR · {item.observationCount ?? 'NAN'} observations</p>}
                    {item.description && <p className="story-card-description">{item.description}</p>}
                    <span className="story-card-link">Explore Story →</span>
                  </div>
                </button>
              ))}
              {!catalogueLoading && !index.length && !catalogueError && <div className="stories-empty">No saved stories were found under /case-studies.</div>}
            </div>
          </>
        )}

        {story && <StoryViewer key={story.slug} story={story} />}
      </div>
    </main>
  );
}
