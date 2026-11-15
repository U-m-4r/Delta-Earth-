import { createRoot } from 'react-dom/client';
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
