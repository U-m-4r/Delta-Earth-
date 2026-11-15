import { useEffect, useRef, useState } from 'react';

export type TimelinePreview = { key: string; imageUrl: string };
const release = (preview: TimelinePreview) => URL.revokeObjectURL(preview.imageUrl);

/** Extracted from Visualization: decode before swapping, retire the old layer on
 * the next animation frame, cache adjacent acquisitions, and cancel stale work. */
export function useTimelineFrames<Frame, Preview extends TimelinePreview>({
  frames, index, version, loader, keyOf, dispose = release,
}: { frames: Frame[]; index: number; version: string;
  loader: (frame: Frame, signal: AbortSignal) => Promise<Preview>;
  keyOf: (frame: Frame) => string; dispose?: (preview: Preview) => void }) {
  const [displayedTimeline, setDisplayedTimeline] = useState<Preview | null>(null);
  const [incomingTimeline, setIncomingTimeline] = useState<Preview | null>(null);
  const [timelineTransitionStarted, setTimelineTransitionStarted] = useState(false);
  const [timelineLoading, setTimelineLoading] = useState(false);
  const [timelineError, setTimelineError] = useState<string | null>(null);
  const [timelineRetry, setTimelineRetry] = useState(0);
  const timelineCache = useRef(new Map<string, Preview>());
  const timelineCacheSignature = useRef('');
  const displayedTimelineRef = useRef<Preview | null>(null);
  const requestSequence = useRef(0);
  const transitionFrame = useRef<number | null>(null);
  useEffect(() => { displayedTimelineRef.current = displayedTimeline; }, [displayedTimeline]);

  useEffect(() => {
    const signature = frames.length ? `${frames.map(keyOf).join('|')}::${version}` : '';
    if (signature !== timelineCacheSignature.current) {
      const displayedUrl = displayedTimelineRef.current?.imageUrl;
      timelineCache.current.forEach((preview) => {
        if (preview.imageUrl !== displayedUrl) dispose(preview);
      });
      timelineCache.current.clear();
      timelineCacheSignature.current = signature;
      if (!frames.length) {
        if (displayedTimelineRef.current) dispose(displayedTimelineRef.current);
        setDisplayedTimeline(null); displayedTimelineRef.current = null;
      }
    }
    if (!frames.length) {
      setTimelineLoading(false); setTimelineError(null); setIncomingTimeline(null);
      setTimelineTransitionStarted(false); return;
    }

    const requestId = ++requestSequence.current;
    const activeController = new AbortController();
    const neighborControllers = new Map<string, AbortController>();
    let cancelled = false;
    setTimelineLoading(true); setTimelineError(null); setIncomingTimeline(null); setTimelineTransitionStarted(false);
    if (transitionFrame.current !== null) window.cancelAnimationFrame(transitionFrame.current);

    const frame = frames[index];
    const key = keyOf(frame);
    const load = async (target: Frame, signal: AbortSignal) => {
      const targetKey = keyOf(target);
      const cached = timelineCache.current.get(targetKey);
      if (cached) return cached;
      const preview = await loader(target, signal);
      if (signal.aborted || cancelled || requestId !== requestSequence.current) {
        dispose(preview);
        throw new DOMException('Preview request was superseded.', 'AbortError');
      }
      timelineCache.current.set(targetKey, preview);
      return preview;
    };

    const preload = (index: number) => {
      if (index < 0 || index >= frames.length) return;
      const neighbor = frames[index], neighborKey = keyOf(neighbor);
      if (timelineCache.current.has(neighborKey)) return;
      const controller = new AbortController(); neighborControllers.set(neighborKey, controller);
      void loader(neighbor, controller.signal).then((preview) => {
        if (controller.signal.aborted || cancelled || requestId !== requestSequence.current) {
          dispose(preview); return;
        }
        const old = timelineCache.current.get(neighborKey);
        if (old) dispose(preview);
        else timelineCache.current.set(neighborKey, preview);
      }).catch(() => {});
    };

    void load(frame, activeController.signal).then((preview) => {
      if (cancelled || requestId !== requestSequence.current) return;
      const previous = displayedTimelineRef.current;
      if (!previous) {
        setDisplayedTimeline(preview); displayedTimelineRef.current = preview;
        setTimelineLoading(false);
      } else if (previous.key === key) {
        if (previous.imageUrl !== preview.imageUrl) dispose(preview);
        timelineCache.current.delete(key);
        setTimelineLoading(false);
      } else {
        setIncomingTimeline(preview);
        transitionFrame.current = window.requestAnimationFrame(() => {
          if (cancelled || requestId !== requestSequence.current) return;
          setDisplayedTimeline(preview); displayedTimelineRef.current = preview;
          setIncomingTimeline(previous); setTimelineTransitionStarted(true); setTimelineLoading(false);
          transitionFrame.current = window.requestAnimationFrame(() => {
            if (cancelled || requestId !== requestSequence.current) return;
            setIncomingTimeline((current) => current === previous ? null : current);
            setTimelineTransitionStarted(false);
            if (previous.imageUrl !== preview.imageUrl && !timelineCache.current.has(previous.key)) dispose(previous);
            const keep = new Set([frames[index - 1], frames[index],
              frames[index + 1]].filter((item): item is Frame => Boolean(item)).map(keyOf));
            timelineCache.current.forEach((entry, entryKey) => {
              if (!keep.has(entryKey)) { dispose(entry); timelineCache.current.delete(entryKey); }
            });
          });
        });
      }
      preload(index - 1); preload(index + 1);
    }).catch((reason) => {
      if (!cancelled && requestId === requestSequence.current && (reason as Error).name !== 'AbortError') {
        setTimelineError(reason instanceof Error ? reason.message : 'Timeline raster failed to load.');
        setTimelineLoading(false);
      }
    });

    return () => {
      cancelled = true; activeController.abort(); neighborControllers.forEach((controller) => controller.abort());
      if (requestId === requestSequence.current) requestSequence.current += 1;
      if (transitionFrame.current !== null) window.cancelAnimationFrame(transitionFrame.current);
    };
  }, [index, frames, version, timelineRetry, loader, keyOf]);

  useEffect(() => () => {
    timelineCache.current.forEach(dispose);
    timelineCache.current.clear();
    if (displayedTimelineRef.current) dispose(displayedTimelineRef.current);
  }, [dispose]);
  return { displayed: displayedTimeline, incoming: incomingTimeline,
    transitionStarted: timelineTransitionStarted, loading: timelineLoading,
    error: timelineError, retry: () => setTimelineRetry(value => value + 1) };
}
