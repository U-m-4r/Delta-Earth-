export type LocationResult = { displayName: string; latitude: number; longitude: number; boundingBox?: [number, number, number, number] };

export async function searchLocations(query: string): Promise<LocationResult[]> {
  if (!query.trim()) return [];
  const response = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&accept-language=en&limit=6&q=${encodeURIComponent(query)}`, { headers: { Accept: 'application/json', 'Accept-Language': 'en' } });
  if (!response.ok) throw new Error('Location search is temporarily unavailable.');
  const results: Array<{ display_name: string; lat: string; lon: string; boundingbox?: string[] }> = await response.json();
  return results.map((result) => ({
    displayName: result.display_name,
    latitude: Number(result.lat),
    longitude: Number(result.lon),
    boundingBox: result.boundingbox?.map(Number) as [number, number, number, number] | undefined,
  }));
}
