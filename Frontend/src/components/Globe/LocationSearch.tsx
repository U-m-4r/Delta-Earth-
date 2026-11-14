import { useState } from 'react';
import { LoaderCircle, Search, X } from 'lucide-react';
import { searchLocations, type LocationResult } from '../../services/locationSearchService';

export function LocationSearch({ onSelect, onClose }: { onSelect: (result: LocationResult) => void; onClose: () => void }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<LocationResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const search = async () => {
    setLoading(true); setError('');
    try { setResults(await searchLocations(query)); } catch (reason) { setError(reason instanceof Error ? reason.message : 'Search failed.'); } finally { setLoading(false); }
  };
  return <div className="search-overlay"><div className="location-search"><div className="search-input"><Search size={18} /><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void search(); }} placeholder="Search countries, cities, forests..." /><button onClick={onClose}><X size={17} /></button></div>{loading && <div className="search-message"><LoaderCircle className="spin" size={16} /> Searching OpenStreetMap...</div>}{error && <div className="search-message error">{error}</div>}{!loading && !error && results.map((result) => <button className="location-result" key={`${result.latitude}-${result.longitude}-${result.displayName}`} onClick={() => onSelect(result)}><span><strong>{result.displayName.split(',')[0]}</strong><small>{result.displayName}</small></span><span className="result-coordinates">{result.latitude.toFixed(3)}°, {result.longitude.toFixed(3)}°</span></button>)}{!loading && !error && query && results.length === 0 && <div className="search-message">Press Enter to search the world.</div>}</div></div>;
}
