import { ChevronLeft, ChevronRight } from 'lucide-react';

/** The Visualization timeline's native range control, shared by every story.
 * Positions are discrete acquisition indices, even when elapsed dates are irregular. */
export function AcquisitionTimeline({ frames, index, displayedIndex = index, onSelect, variant = 'visualization',
}: { frames: { id: string; label: string; detail?: string }[]; index: number;
  displayedIndex?: number; onSelect: (index: number) => void; variant?: 'visualization' | 'story' }) {
  if (!frames.length) return null;
  const position = (value: number) => frames.length > 1 ? value / (frames.length - 1) * 100 : 0;
  const select = (value: number) => onSelect(Math.max(0, Math.min(frames.length - 1, value)));
  return <div className={`acquisition-timeline ${variant}`}>
    <div className="timeline-checkpoint-scroll" aria-label="Acquisition date checkpoints">
      <div className="timeline-checkpoint-track" style={{ width: `max(100%, ${Math.max(680, frames.length * 150)}px)` }}>
        <div className="timeline-checkpoint-dates">{frames.map((frame, offset) => <span key={frame.id}
          className={displayedIndex === offset ? 'active' : ''} style={{ left: `${position(offset)}%` }}>
          <button type="button" aria-label={`Observation ${offset + 1}: ${frame.label}`} aria-pressed={displayedIndex === offset}
            onClick={() => select(offset)}><strong>{frame.label}</strong><small>{frame.detail}</small></button>
        </span>)}</div>
        <div className="timeline-range-wrap"><input aria-label="Select acquisition checkpoint"
          aria-valuetext={`${frames[index].label}, ${frames[index].detail ?? ''}`} type="range" min="0"
          max={Math.max(0, frames.length - 1)} step="1" value={index} disabled={frames.length === 1}
          onChange={event => select(Number(event.target.value))} />
          <div className="timeline-checkpoint-dots" aria-hidden="true">{frames.map((frame, offset) => <i key={frame.id}
            className={displayedIndex === offset ? 'active' : ''} style={{ left: `${position(offset)}%` }} />)}</div>
        </div>
        <div className="timeline-checkpoint-indexes" aria-hidden="true">{frames.map((frame, offset) => <small key={frame.id}
          className={displayedIndex === offset ? 'active' : ''} style={{ left: `${position(offset)}%` }}>{offset}</small>)}</div>
      </div>
    </div>
    <div className="timeline-navigation"><button className="filter-chip" disabled={index === 0} onClick={() => select(index - 1)}>
      <ChevronLeft size={15} /> {variant === 'story' ? 'Previous Chapter' : 'Previous'}</button>
      <span>{displayedIndex + 1} / {frames.length} observations</span>
      <button className="filter-chip" disabled={index === frames.length - 1} onClick={() => select(index + 1)}>
        {variant === 'story' ? 'Next Chapter' : 'Next'} <ChevronRight size={15} /></button></div>
  </div>;
}
