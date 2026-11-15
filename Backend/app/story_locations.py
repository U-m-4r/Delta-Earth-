"""Derive display locations from curated metadata without reading any rasters."""
import math
from shapely.geometry import Point, shape
from shapely.errors import GEOSException


def coordinate(value):
    if not isinstance(value, dict):
        return None
    lon, lat = value.get('longitude'), value.get('latitude')
    if (isinstance(lon, bool) or isinstance(lat, bool) or
        not isinstance(lon, (int, float)) or not isinstance(lat, (int, float)) or
        not math.isfinite(lon) or not math.isfinite(lat) or not -180 <= lon <= 180 or not -90 <= lat <= 90):
        return None
    return {'longitude': float(lon), 'latitude': float(lat)}


def _polygon(value):
    if not isinstance(value, dict):
        return None, None
    geometry = value.get('geometry', value)
    if not isinstance(geometry, dict) or geometry.get('type') not in {'Polygon', 'MultiPolygon'}:
        return None, None
    try:
        polygons = geometry['coordinates'] if geometry['type'] == 'MultiPolygon' else [geometry['coordinates']]
        anchor = float(polygons[0][0][0][0])
        def unwrap(ring):
            result = []
            for position in ring:
                point = coordinate({'longitude': position[0], 'latitude': position[1]})
                if point is None:
                    raise ValueError('Invalid geographic coordinate')
                result.append([anchor + (point['longitude'] - anchor + 180) % 360 - 180, point['latitude']])
            return result
        coordinates = [[unwrap(ring) for ring in polygon] for polygon in polygons]
        unwrapped = shape({'type': 'MultiPolygon', 'coordinates': coordinates})
        if unwrapped.is_empty or not unwrapped.is_valid or unwrapped.area <= 0:
            return None, None
        return unwrapped, anchor
    except (ValueError, KeyError, TypeError, IndexError, GEOSException):
        return None, None


def story_location(story):
    explicit = coordinate(story.get('markerLocation'))
    if explicit:
        return {**explicit, 'method': 'explicit'}
    polygon, anchor = _polygon(story.get('polygon') or story.get('studyArea'))
    representative = coordinate(story.get('representativeLocation'))
    if representative and polygon is not None:
        lon = anchor + (representative['longitude'] - anchor + 180) % 360 - 180
        if polygon.covers(Point(lon, representative['latitude'])):
            return {**representative, 'method': 'validated-representative-point'}
    if polygon is not None:
        point = polygon.representative_point()
        return {'longitude': (point.x + 180) % 360 - 180, 'latitude': point.y,
                'method': 'study-area-interior-point'}
    bounds = story.get('bounds')
    if isinstance(bounds, (list, tuple)) and len(bounds) == 4:
        bounds = dict(zip(['west', 'south', 'east', 'north'], bounds))
    if not isinstance(bounds, dict):
        return None
    southwest = coordinate({'longitude': bounds.get('west'), 'latitude': bounds.get('south')})
    northeast = coordinate({'longitude': bounds.get('east'), 'latitude': bounds.get('north')})
    if not southwest or not northeast or bounds['south'] >= bounds['north'] or bounds['east'] == bounds['west']:
        return None
    span = (bounds['east'] - bounds['west']) % 360
    if representative and bounds['south'] <= representative['latitude'] <= bounds['north'] and (representative['longitude'] - bounds['west']) % 360 <= span:
        return {**representative, 'method': 'validated-representative-point'}
    return {'longitude': (bounds['west'] + span / 2 + 180) % 360 - 180,
            'latitude': (bounds['south'] + bounds['north']) / 2, 'method': 'study-bounds-center'}
