import { useEffect, useSyncExternalStore } from 'react';
import type { StoryIndexItem } from '../types/stories';

const backend = import.meta.env.VITE_BACKEND_URL ?? 'http://localhost:8787';
type Snapshot = { items: StoryIndexItem[]; loading: boolean; error: string | null };
let snapshot: Snapshot = { items: [], loading: true, error: null };
let request: Promise<void> | null = null;
let fetchedAt = 0;
const listeners = new Set<() => void>();
const publish = (value: Snapshot) => { snapshot = value; listeners.forEach(listener => listener()); };
export const storyAssetUrl = (story: StoryIndexItem) => story.preview
  ? `${backend}/case-studies/${encodeURIComponent(story.slug)}/${story.preview}` : undefined;

export function refreshStoryCatalog(force = false): Promise<void> {
  if (request) return request;
  if (!force && fetchedAt && Date.now() - fetchedAt < 60_000) return Promise.resolve();
  request = fetch(`${backend}/api/stories`).then(async response => {
    if (!response.ok) throw new Error('Could not load the saved stories list.');
    const items = await response.json() as StoryIndexItem[];
    if (!Array.isArray(items)) throw new Error('Invalid stories catalogue.');
    fetchedAt = Date.now();
    publish({ items, loading: false, error: null });
  }).catch((error: unknown) => {
    fetchedAt = Date.now();
    publish({ items: snapshot.items, loading: false, error: error instanceof Error ? error.message : 'Stories unavailable.' });
  }).finally(() => { request = null; });
  return request;
}
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export function useStoryCatalog() {
  const value = useSyncExternalStore(subscribe, () => snapshot);
  useEffect(() => {
    void refreshStoryCatalog();
    const onFocus = () => { void refreshStoryCatalog(); };
    const onUpdate = () => { void refreshStoryCatalog(true); };
    window.addEventListener('focus', onFocus);
    window.addEventListener('delta-earth:stories-updated', onUpdate);
    return () => { window.removeEventListener('focus', onFocus); window.removeEventListener('delta-earth:stories-updated', onUpdate); };
  }, []);
  return value;
}
