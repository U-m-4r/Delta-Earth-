import { createRoot } from 'react-dom/client';
import { StrictMode } from 'react';
import { VisualizationPage } from '../src/components/visualizations/VisualizationPage';
import { StoryViewer } from '../src/components/stories/StoryViewer';
import type { StoryDefinition } from '../src/components/stories/storyDefinition';
import { toStoryDefinition } from '../src/components/stories/storyDefinition';
import type { RawStory } from '../src/components/stories/storyDefinition';
const noop = () => {};
export function mountVisualization(element: HTMLElement) {
  createRoot(element).render(<VisualizationPage studyId="0123456789abcdef" retrievalSessionId="local-test"
    onRasterOverlayChange={noop} onBack={noop} />);
}
export function mountStory(element: HTMLElement, story: StoryDefinition) {
  createRoot(element).render(<StoryViewer story={story} />);
}
export function adapt(raw: RawStory) { return toStoryDefinition(raw); }
export function mountStrictStory(element: HTMLElement, story: StoryDefinition) {
  const root = createRoot(element);
  root.render(<StrictMode><StoryViewer story={story} /></StrictMode>);
  return () => root.unmount();
}
