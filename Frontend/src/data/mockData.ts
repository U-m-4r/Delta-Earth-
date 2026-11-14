import type { Layer, StudyArea } from '../types';

export const studyAreas: StudyArea[] = [
  { id: 'amazon', name: 'Amazon Rainforest', subtitle: 'Deforestation monitoring', coordinates: '−3.4653°, −62.2159°', lat: -3.4, lon: -62.2, category: 'Forest', color: '#65d69a', area: '5.5M km²', vegetation: 82, change: '−3.4%' },
  { id: 'los-angeles', name: 'Los Angeles', subtitle: 'Wildfire impact zone', coordinates: '34.0522°, −118.2437°', lat: 34, lon: -118, category: 'Fire', color: '#f67a5f', area: '1,302 km²', vegetation: 31, change: '−8.1%' },
  { id: 'rajasthan', name: 'Rajasthan', subtitle: 'Desertification indicators', coordinates: '27.0238°, 74.2179°', lat: 27, lon: 74, category: 'Desert', color: '#e5b968', area: '342,239 km²', vegetation: 22, change: '+1.8%' },
  { id: 'gujarat', name: 'Gujarat', subtitle: 'Agriculture & land changes', coordinates: '22.2587°, 71.1924°', lat: 22, lon: 71, category: 'Agriculture', color: '#4fb4e8', area: '196,024 km²', vegetation: 56, change: '+5.2%' },
  { id: 'antarctica', name: 'Antarctica', subtitle: 'Glacier & ice changes', coordinates: '82.8628°, 135.0000°', lat: -82, lon: 135, category: 'Ice', color: '#a8d7f0', area: '14.2M km²', vegetation: 0, change: '−2.7%' },
  { id: 'texas', name: 'Texas', subtitle: 'Agriculture & land use', coordinates: '31.9686°, −99.9018°', lat: 31, lon: -99, category: 'Agriculture', color: '#4fb4e8', area: '695,662 km²', vegetation: 47, change: '+2.4%' },
];

export const defaultLayers: Layer[] = [
  { id: 'sar', label: 'SAR imagery', color: '#55c9e8', visible: true, opacity: 82 },
  { id: 'change', label: 'Change detection', color: '#f67a5f', visible: true, opacity: 68 },
  { id: 'vegetation', label: 'Vegetation / land cover', color: '#65d69a', visible: false, opacity: 55 },
  { id: 'water', label: 'Water bodies', color: '#4f9ee8', visible: false, opacity: 65 },
  { id: 'population', label: 'Population density', color: '#e5b968', visible: false, opacity: 45 },
];

export const timeSeries = [
  { year: '2021', vegetation: 91, water: 47, forestLoss: 5 },
  { year: '2022', vegetation: 89, water: 45, forestLoss: 8 },
  { year: '2023', vegetation: 87, water: 43, forestLoss: 12 },
  { year: '2024', vegetation: 85, water: 42, forestLoss: 15 },
  { year: '2025', vegetation: 84, water: 40, forestLoss: 18 },
  { year: '2026', vegetation: 82, water: 38, forestLoss: 22 },
];
