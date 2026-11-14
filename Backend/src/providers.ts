import type { Acquisition, CatalogSearch, CollectionSummary, GeoJsonPolygon, Observation, ObservationAsset } from './types.js';

type ProviderConfig = { baseUrl: string; timeoutMs: number; pageSize: number };
type CmrLink = { rel?: string; href?: string; title?: string; type?: string };

const DATA_REL = 'http://esipfed.org/ns/fedsearch/1.1/data#';
const BROWSE_REL = 'http://esipfed.org/ns/fedsearch/1.1/browse#';

function firstString(...values: unknown[]): string | undefined {
  return values.find((value): value is string => typeof value === 'string' && value.length > 0);
}

function parseAssets(entry: Record<string, unknown>): ObservationAsset[] {
  const links = Array.isArray(entry.links) ? entry.links as CmrLink[] : [];
  return links.flatMap((link) => {
    if (!link.href || !/^https?:\/\//i.test(link.href)) return [];
    const type = link.rel === DATA_REL ? 'data' : link.rel === BROWSE_REL ? 'browse' : link.rel === 'http://esipfed.org/ns/fedsearch/1.1/metadata#' ? 'metadata' : undefined;
    return type ? [{ type, url: link.href, title: link.title, mediaType: link.type }] : [];
  });
}

function parseBbox(entry: Record<string, unknown>): [number, number, number, number] | undefined {
  const boxes = Array.isArray(entry.boxes) ? entry.boxes : [];
  const box = boxes.find((value): value is string => typeof value === 'string');
  if (box) {
    const values = box.trim().split(/\s+/).map(Number);
    if (values.length === 4 && values.every(Number.isFinite)) return [values[1], values[0], values[3], values[2]];
  }
  const polygon = Array.isArray(entry.polygons) ? entry.polygons[0] : undefined;
  const text = Array.isArray(polygon) ? polygon[0] : undefined;
  if (typeof text !== 'string') return undefined;
  const values = text.trim().split(/\s+/).map(Number);
  const positions: Array<[number, number]> = [];
  for (let index = 0; index + 1 < values.length; index += 2) {
    if (Number.isFinite(values[index]) && Number.isFinite(values[index + 1])) positions.push([values[index], values[index + 1]]);
  }
  if (!positions.length) return undefined;
  return [
    Math.min(...positions.map(([longitude]) => longitude)),
    Math.min(...positions.map(([, latitude]) => latitude)),
    Math.max(...positions.map(([longitude]) => longitude)),
    Math.max(...positions.map(([, latitude]) => latitude)),
  ];
}

function productDetails(entry: Record<string, unknown>): { shortName: string; type: string; maturity: string; mission: string; frequencies: string[]; polarizations: string[] } {
  const title = String(entry.producer_granule_id ?? entry.title ?? '');
  const dataset = String(entry.dataset_id ?? '');
  const productMatch = title.match(/NISAR_L(?<level>\d)_(?<maturity>[A-Z]{2})_(?<product>GCOV|GSLC|RSLC|SME2)/i);
  const shortName = productMatch?.groups?.product?.toUpperCase() ?? (dataset.match(/(GCOV|GSLC|RSLC|SME2)/i)?.[1]?.toUpperCase() ?? 'UNKNOWN');
  const maturity = /\bbeta\b/i.test(dataset) ? 'BETA' : /\bprovisional\b/i.test(dataset) ? 'PROVISIONAL' : /_UR_/i.test(title) ? 'URGENT_RESPONSE' : 'VALIDATED';
  const polarizationMatches = [...title.matchAll(/(?:_|-)(HH|HV|VH|VV)(?:_|-)/gi)].map((match) => match[1].toUpperCase());
  const links = Array.isArray(entry.links) ? entry.links as CmrLink[] : [];
  const assetPolarizations = links.flatMap((link) => [...(link.title ?? '').matchAll(/(?:_|-)(HHHH|HVHV|VHVH|VVVV)(?:[._-]|$)/gi)].map((match) => match[1].slice(0, 2).toUpperCase()));
  const frequencies = /NISAR/i.test(title) && /GCOV|GSLC|RSLC|SME2/i.test(title) ? ['L-band'] : [];
  return {
    shortName,
    type: `${shortName} (${dataset || 'unknown collection'})`,
    maturity,
    mission: /NISAR/i.test(title) || /NISAR/i.test(dataset) ? 'NISAR' : 'Unknown',
    frequencies,
    polarizations: [...new Set([...polarizationMatches, ...assetPolarizations])],
  };
}

export function parseGranule(entry: Record<string, unknown>): Observation {
  const details = productDetails(entry);
  const id = String(entry.id ?? entry.producer_granule_id ?? entry.title ?? 'unknown');
  const title = String(entry.producer_granule_id ?? entry.title ?? id);
  const startAt = firstString(entry.time_start, entry.time_start_utc);
  const endAt = firstString(entry.time_end, entry.time_end_utc);
  const assets = parseAssets(entry);
  const browseUrl = assets.find((asset) => asset.type === 'browse')?.url;
  const orbitDomains = Array.isArray(entry.orbit_calculated_spatial_domains) ? entry.orbit_calculated_spatial_domains as Array<Record<string, unknown>> : [];
  const orbit = orbitDomains[0] ?? {};
  const sourceMetadata = {
    datasetId: firstString(entry.dataset_id),
    collectionConceptId: firstString(entry.collection_concept_id),
    dataCenter: firstString(entry.data_center),
    coordinateSystem: firstString(entry.coordinate_system),
    granuleSizeMb: typeof entry.granule_size === 'number' ? entry.granule_size : Number.isFinite(Number(entry.granule_size)) ? Number(entry.granule_size) : undefined,
    updatedAt: firstString(entry.updated),
    orbitDirection: firstString(entry.orbit_direction, entry.flight_direction, orbit.direction),
    relativeOrbit: firstString(entry.relative_orbit, orbit.relative_orbit, orbit.orbit_number),
  };
  const acquisitionKey = `${details.mission}:${startAt ?? title.match(/(20\d{6}T\d{6})/)?.[1] ?? id}`;
  return {
    id,
    provider: sourceMetadata.dataCenter ? `NASA CMR / ${sourceMetadata.dataCenter}` : 'NASA CMR',
    title,
    mission: details.mission,
    productShortName: details.shortName,
    acquiredAt: startAt,
    startAt,
    endAt,
    productType: details.type,
    processingMaturity: details.maturity,
    acquisitionKey,
    frequencies: details.frequencies,
    polarizations: details.polarizations,
    bbox: parseBbox(entry),
    downloadUrl: assets.find((asset) => asset.type === 'data')?.url,
    metadataUrl: assets.find((asset) => asset.type === 'metadata')?.url,
    browseUrl,
    assets,
    sourceMetadata,
  };
}

function groupAcquisitions(observations: Observation[]): Acquisition[] {
  const groups = new Map<string, Observation[]>();
  observations.forEach((observation) => groups.set(observation.acquisitionKey, [...(groups.get(observation.acquisitionKey) ?? []), observation]));
  return [...groups.entries()].map(([id, items]) => ({
    id,
    acquiredAt: items.map((item) => item.acquiredAt).find(Boolean),
    observationIds: items.map((item) => item.id),
    mission: items[0].mission,
    productTypes: [...new Set(items.map((item) => item.productShortName))],
  }));
}

function isProductCollection(entry: Record<string, unknown>): boolean {
  const shortName = String(entry.short_name ?? '');
  return /^NISAR_(?:L[0-3]|UR)_/.test(shortName) && !/_OE$|_RP$|_TEC$|_ANC_/.test(shortName);
}

function collectionSummary(entry: Record<string, unknown>): CollectionSummary | undefined {
  if (!isProductCollection(entry) || typeof entry.id !== 'string') return undefined;
  const shortName = String(entry.short_name);
  const maturity = /_BETA_/i.test(shortName) ? 'BETA' : /_PROVISIONAL_/i.test(shortName) ? 'PROVISIONAL' : 'VALIDATED';
  return {
    id: entry.id,
    shortName,
    title: String(entry.title ?? shortName),
    maturity,
    productType: shortName.match(/NISAR_(?:L\d|UR)_([A-Z0-9]+)/)?.[1],
    temporalStart: firstString(entry.time_start),
    granuleCount: 0,
  };
}

async function fetchCollectionPage(baseUrl: string, pageNum: number, config: ProviderConfig): Promise<Record<string, unknown>[]> {
  const params = new URLSearchParams({ keyword: 'NISAR', page_size: '200', page_num: String(pageNum) });
  const response = await fetch(`${baseUrl}/search/collections.json?${params}`, { signal: AbortSignal.timeout(config.timeoutMs), headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`NASA CMR collection search returned HTTP ${response.status}.`);
  const body = await response.json() as { feed?: { entry?: Array<Record<string, unknown>> } };
  return body.feed?.entry ?? [];
}

async function fetchGranulesForCollection(baseUrl: string, collectionId: string, polygon: GeoJsonPolygon, config: ProviderConfig): Promise<Record<string, unknown>[]> {
  const results: Record<string, unknown>[] = [];
  const pageSize = Math.min(Math.max(config.pageSize, 1), 2000);
  for (let pageNum = 1; ; pageNum += 1) {
    const params = new URLSearchParams({
      page_size: String(pageSize),
      page_num: String(pageNum),
      sort_key: 'start_date',
      temporal: '1900-01-01T00:00:00Z,2100-01-01T00:00:00Z',
      polygon: polygon.geometry.coordinates[0].map(([longitude, latitude]) => `${longitude},${latitude}`).join(','),
    });
    params.set('collection_concept_id[]', collectionId);
    const response = await fetch(`${baseUrl}/search/granules.json?${params}`, { signal: AbortSignal.timeout(config.timeoutMs), headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error(`NASA CMR granule search returned HTTP ${response.status} for ${collectionId}.`);
    const body = await response.json() as { feed?: { entry?: Array<Record<string, unknown>> } };
    const entries = body.feed?.entry ?? [];
    results.push(...entries);
    if (entries.length < pageSize) break;
  }
  return results;
}

export async function searchNisar(polygon: GeoJsonPolygon, config: ProviderConfig): Promise<CatalogSearch> {
  const baseUrl = config.baseUrl.replace(/\/$/, '');
  const collectionEntries: Record<string, unknown>[] = [];
  for (let pageNum = 1; ; pageNum += 1) {
    const entries = await fetchCollectionPage(baseUrl, pageNum, config);
    collectionEntries.push(...entries);
    if (entries.length < 200) break;
  }
  const collections = collectionEntries.map(collectionSummary).filter((item): item is CollectionSummary => Boolean(item));
  if (collections.length === 0) return { observations: [], acquisitions: [], collections: [], warnings: ['NASA CMR returned no NISAR product collections.'] };
  const observationsById = new Map<string, Observation>();
  const warnings: string[] = [];
  for (const collection of collections) {
    try {
      const entries = await fetchGranulesForCollection(baseUrl, collection.id, polygon, config);
      collection.granuleCount = entries.length;
      entries.map((entry) => {
        const observation = parseGranule(entry);
        const collection = collections.find((item) => item.id === observation.sourceMetadata.collectionConceptId);
        if (collection) observation.processingMaturity = collection.maturity;
        return observation;
      }).forEach((observation) => observationsById.set(observation.id, observation));
    } catch (error) {
      warnings.push(error instanceof Error ? error.message : `Unable to search ${collection.shortName}.`);
    }
  }
  const observations = [...observationsById.values()].sort((a, b) => (a.acquiredAt ?? '').localeCompare(b.acquiredAt ?? ''));
  return { observations, acquisitions: groupAcquisitions(observations), collections, warnings };
}

export async function searchCatalogs(polygon: GeoJsonPolygon, config: ProviderConfig): Promise<CatalogSearch> {
  try {
    return await searchNisar(polygon, config);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown catalog error.';
    return { observations: [], acquisitions: [], collections: [], warnings: [`NISAR discovery unavailable: ${message}`] };
  }
}
