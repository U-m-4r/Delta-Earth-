import { useEffect, useRef } from 'react';
import { ArrowRight, MapPin, X } from 'lucide-react';
import type { StoryPick } from './StoryMarkerLayer';
import { storyAssetUrl } from '../../services/storyCatalog';

export function StoryPreview({ pick, onChoose, onClose, onExplore }: {
  pick: StoryPick; onChoose: (slug: string) => void; onClose: () => void; onExplore: (slug: string) => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { closeRef.current?.focus({ preventScroll: true }); }, []);
  const story = pick.selected;
  return <section className="globe-story-preview" role="region" aria-label="Story preview">
    <button ref={closeRef} className="globe-story-close" aria-label="Close story preview" onClick={onClose}><X size={16} /></button>
    {story ? <>
      {storyAssetUrl(story) && <img className="globe-story-image" src={storyAssetUrl(story)} alt={`Saved preview for ${story.title}`} />}
      <div className="globe-story-copy"><span className="section-kicker">{story.changeType || 'Environmental story'}{story.subtitle ? ` · ${story.subtitle}` : ''}</span>
        <h2>{story.title}</h2><p className="globe-story-location"><MapPin size={13} />{story.location || 'NAN'}</p>
        <span className="globe-story-period">{story.period || 'Period: NAN'}</span><p className="globe-story-description">{story.description || 'NAN'}</p>
        <button className="globe-story-explore" onClick={() => onExplore(story.slug)}>Explore Story <ArrowRight size={15} /></button>
      </div>
    </> : <div className="globe-story-copy"><span className="section-kicker">Global Story Explorer</span><h2>{pick.choices.length} stories nearby</h2><p className="globe-story-description">Choose a story to see its location and observations.</p></div>}
    {pick.choices.length > 1 && <div className="globe-story-choices" aria-label="Nearby stories">{pick.choices.map(item => <button key={item.slug} aria-pressed={item.slug === story?.slug} onClick={() => onChoose(item.slug)}>{item.title}<small>{item.location}</small></button>)}</div>}
  </section>;
}
