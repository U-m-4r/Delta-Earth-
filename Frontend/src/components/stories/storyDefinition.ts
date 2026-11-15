import type { DocumentaryStory, SequenceStoryResult, StoryPair, StoryResult } from '../../types/stories';

const backend = import.meta.env.VITE_BACKEND_URL ?? 'http://localhost:8787';
export type RawStory = DocumentaryStory | SequenceStoryResult | StoryResult;
export type StoryChapter = {
  id: string; date: string; acquisitionDate: string; title: string; headline?: string;
  narrative: string; observation?: string; badge?: string; stage?: string; available: boolean;
  image: string; pixelUrl?: string; changeImage?: string; metadata: unknown;
};
export type StoryDefinition = {
  slug: string; title: string; subtitle: string; location: string; kicker: string;
  introTitle: string; introEmphasis?: string; introduction: string; summary: string;
  conclusion?: string; interpretation: string; method?: string;
  chapters: StoryChapter[]; stages: string[]; pairs: StoryPair[];
  references: { title: string; url: string }[];
  display: { minimum: number; maximum: number; gradient?: string; note: string };
  changeDisplay: { minimum: number; maximum: number; note: string };
  metadata: unknown; isBhagalpur: boolean;
};
const turbo = 'linear-gradient(90deg,#30123b,#4662d8,#28bbec,#32f298,#a0fc3a,#f9ba38,#f66b19,#c82704,#7a0403)';
export function toStoryDefinition(raw: RawStory): StoryDefinition {
  const root = `${backend}/case-studies/${raw.slug}`;
  if ('kind' in raw && raw.kind === 'documentary') {
    const isBhagalpur = raw.slug === 'bhagalpur-flood-2026';
    return {
      slug: raw.slug, title: raw.title, subtitle: raw.subtitle, location: raw.location,
      kicker: raw.kicker ?? (isBhagalpur ? 'Ganga River / NASA–ISRO NISAR' : 'NASA–ISRO NISAR'), introTitle: raw.introTitle ?? (isBhagalpur ? 'Four months. Eight observations.' : raw.title),
      introEmphasis: raw.introEmphasis ?? (isBhagalpur ? 'A river in motion.' : undefined), introduction: raw.introduction ?? (isBhagalpur ? 'Tracking the 2026 Bihar Floods Through NISAR Satellite Observations' : raw.description ?? 'NAN'),
      summary: raw.summary ?? (isBhagalpur ? 'Bhagalpur, Bihar · June–October 2026 · Frequency A / HV' : `${raw.location || 'NAN'} · ${raw.chapters.length} observations`), interpretation: raw.interpretation || 'NAN',
      chapters: raw.chapters.map(chapter => {
        const observation = `${backend}/api/stories/${raw.slug}/observations/${chapter.observationId}`;
        return { ...chapter, date: chapter.date || 'NAN', title: chapter.title || 'NAN', narrative: chapter.narrative || 'NAN', id: chapter.observationId, image: `${observation}/preview`,
          pixelUrl: `${observation}/pixel`, changeImage: `${observation}/preview?changes=true`, metadata: chapter };
      }),
      stages: isBhagalpur ? ['Normal','Early change','Expansion','Intermediate observation','Maximum observed extent','Recession'] : [...new Set(raw.chapters.map(chapter => chapter.stage).filter(Boolean))],
      pairs: [], references: [],
      display: { minimum: raw.displayRange?.min ?? (isBhagalpur ? .00272371 : 0), maximum: raw.displayRange?.max ?? (isBhagalpur ? .0954112 : 1), gradient: turbo,
        note: isBhagalpur ? 'Turbo · logarithmic stretch · fixed linear radar power range · NoData transparent' : `${raw.palette ?? 'NAN'} · ${raw.stretch ?? 'NAN'} · NoData transparent` },
      changeDisplay: { minimum: -(raw.changeRange ?? .0954112), maximum: raw.changeRange ?? .0954112,
        note: isBhagalpur ? 'Current − June 20 · linear radar power · blue: lower / cream: zero / red: higher' : 'Current − baseline · source units · blue: lower / cream: zero / red: higher' },
      method: raw.method ?? (isBhagalpur ? 'Aligned to the June 20 geographic grid; one fixed display range and baseline log normalization for all dates.' : 'NAN'),
      metadata: raw, isBhagalpur,
    };
  }
  const sequence = 'kind' in raw && raw.kind === 'sequence' ? raw : null;
  const legacy = sequence ? null : raw as StoryResult;
  const observations = sequence?.observations ?? legacy!.observations;
  return {
    slug: raw.slug, title: raw.title, subtitle: raw.changeType, location: raw.location || 'NAN',
    kicker: `${raw.changeType || 'Satellite observations'} / NASA–ISRO NISAR`,
    introTitle: raw.headline || raw.title, introduction: sequence?.introduction ?? legacy?.event ?? 'NAN',
    summary: `${raw.location || 'NAN'} · ${observations.length} observations`,
    conclusion: sequence?.conclusion,
    interpretation: 'Colours represent radar response. Radar differences alone do not confirm flooding or environmental change.',
    chapters: observations.map(item => ({
      id: item.key, date: item.date || 'NAN', acquisitionDate: item.date || 'NAN', title: item.label || 'NAN',
      narrative: ('caption' in item ? item.caption : legacy?.event) || 'NAN',
      badge: item.label, available: Boolean(item.image), image: item.image ? `${root}/${item.image}` : '', metadata: item,
    })),
    stages: [], pairs: legacy?.pairs ?? [], references: Array.isArray(raw.references) ? raw.references : [],
    display: { minimum: sequence?.display.minimum ?? -35, maximum: sequence?.display.maximum ?? 5,
      gradient: sequence ? 'linear-gradient(90deg,#440154,#3b528b,#21918c,#5ec962,#fde725)' : undefined,
      note: sequence ? `${sequence.display.palette} · fixed ${sequence.display.minimum} to ${sequence.display.maximum} ${sequence.display.units} · NoData transparent` : 'Radar backscatter preview · fixed −35 to +5 dB · NoData transparent' },
    changeDisplay: { minimum: -6, maximum: 6, note: 'Saved radar difference · blue: lower / cream: near zero / orange: higher · fixed −6 to +6 dB' },
    method: sequence?.method ?? legacy?.threshold?.method, metadata: raw, isBhagalpur: false,
  };
}
