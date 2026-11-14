import argparse
import asyncio
import json
from pathlib import Path

from .geometry import validate_geojson
from .harmony import extract_granule, inspect_capabilities
from .cmr import search_granules


async def run(args):
    if args.command == "capabilities":
        result = await inspect_capabilities()
    else:
        feature = json.loads(Path(args.geojson).read_text())
        polygon, area, bounds, centroid = validate_geojson(feature)
        if args.command == "search":
            result = {"areaKm2": area, "bbox": bounds, "centroid": centroid, **await search_granules(polygon)}
        else:
            result = await extract_granule(args.granule_id, feature, args.variables.split(","), args.frequency)
    print(json.dumps(result, indent=2))


def main():
    parser = argparse.ArgumentParser(prog="dwsar", description="NISAR GCOV discovery and Harmony extraction")
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("capabilities", help="Inspect this collection's actual Harmony service capabilities")
    search = commands.add_parser("search", help="Discover NISAR GCOV granules for a GeoJSON Feature")
    search.add_argument("geojson")
    extract = commands.add_parser("extract", help="Extract selected available variables as GeoTIFFs")
    extract.add_argument("granule_id")
    extract.add_argument("geojson")
    extract.add_argument("--variables", default="HHHH,HVHV")
    extract.add_argument("--frequency", choices=("frequencyA", "frequencyB"), default="frequencyA")
    asyncio.run(run(parser.parse_args()))


if __name__ == "__main__":
    main()
