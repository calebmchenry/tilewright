#!/usr/bin/env python3
"""Standalone reader for docs/agent-export-format.md, using only Python's stdlib.

Copy this file anywhere; no Tilewright imports, server, or project file is needed.
Validation and queries retain sparse runs. Only iter_cells/--cells expands them,
one occupied cell at a time, in bottom-to-top layer then y/x order.
"""

import argparse
import hashlib
import json
import re
import sys


MAX_INTEGER = 9007199254740991
MAX_BYTES = 256 * 1024 * 1024
ID = re.compile(r"[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}\Z")
RGBA = re.compile(r"#[0-9a-f]{8}\Z")
# ECMAScript trim whitespace, also used by the authoring contract.
WHITESPACE = "\t\n\v\f\r \u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff"


class SchemaError(ValueError):
    """The entire input is rejected; no partial map is returned."""


def require(condition, path, message):
    if not condition:
        raise SchemaError(f"{path}: {message}")


def integer(value, path):
    require(type(value) is int and abs(value) <= MAX_INTEGER, path,
            "expected an exact safe integer")
    return value


def parse_integer(token):
    # Check the lexical range before any machine-number conversion or rounding.
    digits = token.removeprefix("-")
    limit = str(MAX_INTEGER)
    require(len(digits) < len(limit) or
            (len(digits) == len(limit) and digits <= limit),
            "$", "integer token outside safe range")
    return int(token)


def reject_number(token):
    raise SchemaError(f"$: invalid numeric token {token!r}; use integer spelling")


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        require(key not in result, "$", f"duplicate JSON key {key!r}")
        result[key] = value
    return result


def fields(value, keys, path):
    require(type(value) is dict, path, "expected an object")
    require(set(value) == set(keys.split()), path,
            f"expected exactly these properties: {keys}")


def collection(value, limit, path):
    require(type(value) is list, path, "expected an array")
    require(len(value) <= limit, path, f"capacity exceeds {limit}")


def text(value, path, nonblank=False):
    require(type(value) is str, path, "expected a string")
    require(not nonblank or bool(value.strip(WHITESPACE)), path,
            "expected nonblank text")


def identity(value, seen, path):
    require(type(value) is str and ID.fullmatch(value) is not None, path,
            "invalid identity")
    require(value not in seen, path, "duplicate identity")
    seen.add(value)


def bounds(value, path, outer=None):
    fields(value, "minX minY maxX maxY", path)
    for key, coordinate in value.items():
        integer(coordinate, f"{path}.{key}")
    for axis in ("X", "Y"):
        size = value[f"max{axis}"] - value[f"min{axis}"]
        require(1 <= size <= 65536, path, "dimensions must be in 1..65536")
        if outer is not None:
            require(outer[f"min{axis}"] <= value[f"min{axis}"] and
                    value[f"max{axis}"] <= outer[f"max{axis}"], path,
                    "area is outside map bounds")


def read_map(data):
    """Validate UTF-8 bytes using only the published v1 schema and capacity policy."""
    require(len(data) <= MAX_BYTES, "$", "input exceeds 256 MiB capacity")
    require(not data.startswith(b"\xef\xbb\xbf"), "$", "UTF-8 BOM is not allowed")
    try:
        value = json.loads(data.decode("utf-8", errors="strict"),
                           object_pairs_hook=unique_object,
                           parse_int=parse_integer, parse_float=reject_number,
                           parse_constant=reject_number)
    except (UnicodeError, json.JSONDecodeError, RecursionError) as error:
        raise SchemaError(f"$: invalid UTF-8 or JSON: {error}") from error
    fields(value, "format version bounds colors layers areas", "$")
    require(value["format"] == "tilewright-agent-map", "format", "unsupported format")
    integer(value["version"], "version")
    require(value["version"] == 1, "version", "unsupported version")
    bounds(value["bounds"], "bounds")
    collection(value["colors"], 1000000, "colors")
    registry_ids, registry_colors, raw_colors = set(), set(), set()
    for index, color in enumerate(value["colors"]):
        path = f"colors[{index}]"
        require(type(color) is dict, path, "expected an object")
        kind = color.get("kind")
        require(kind in ("raw", "registered"), path, "unknown color kind")
        fields(color, "kind rgba meaning" +
               (" registryId" if kind == "registered" else ""), path)
        require(type(color["rgba"]) is str and RGBA.fullmatch(color["rgba"]),
                path, "expected lowercase #rrggbbaa")
        if kind == "raw":
            require(color["meaning"] is None, path, "raw meaning must be null")
            require(color["rgba"] not in raw_colors, path, "duplicate raw RGBA")
            raw_colors.add(color["rgba"])
        else:
            identity(color["registryId"], registry_ids, path + ".registryId")
            text(color["meaning"], path + ".meaning", nonblank=True)
            require(color["rgba"].endswith("ff"), path, "registry colors must be opaque")
            require(color["rgba"] not in registry_colors, path, "duplicate registered RGBA")
            registry_colors.add(color["rgba"])
    require(len(registry_ids) <= 65536, "colors", "registry capacity exceeds 65536")
    collection(value["layers"], 1024, "layers")
    require(len(value["layers"]) > 0, "layers", "at least one layer is required")
    layer_ids, used_colors = set(), set()
    run_count, cell_count = 0, 0
    box = value["bounds"]
    for index, layer in enumerate(value["layers"]):
        path = f"layers[{index}]"
        fields(layer, "id name runs", path)
        identity(layer["id"], layer_ids, path + ".id")
        text(layer["name"], path + ".name", nonblank=True)
        collection(layer["runs"], 2000000, path + ".runs")
        previous_y, previous_end = None, None
        for offset, run in enumerate(layer["runs"]):
            where = f"{path}.runs[{offset}]"
            require(type(run) is list and len(run) == 4, where, "expected [x,y,length,colorIndex]")
            for item in run:
                integer(item, where)
            x, y, length, color_index = run
            require(length > 0, where, "length must be positive")
            end = integer(x + length, where)
            require(box["minX"] <= x < end <= box["maxX"] and
                    box["minY"] <= y < box["maxY"], where, "span outside map bounds")
            require(0 <= color_index < len(value["colors"]), where, "missing color index")
            require(previous_y is None or y > previous_y or
                    (y == previous_y and x >= previous_end), where,
                    "runs must be sorted by y/x and must not overlap")
            previous_y, previous_end = y, end
            used_colors.add(color_index)
            run_count += 1
            cell_count += length
        require(run_count <= 2000000, path, "run capacity exceeds 2000000")
        require(cell_count <= 100000000, path, "occupied cell capacity exceeds 100000000")
    for index, color in enumerate(value["colors"]):
        require(color["kind"] != "raw" or index in used_colors,
                f"colors[{index}]", "raw colors must be used by a run")
    collection(value["areas"], 65536, "areas")
    area_ids = set()
    for index, area in enumerate(value["areas"]):
        path = f"areas[{index}]"
        fields(area, "id name description tier bounds", path)
        identity(area["id"], area_ids, path + ".id")
        text(area["name"], path + ".name", nonblank=True)
        require(area["name"] == area["name"].strip(WHITESPACE) and
                not any(char in area["name"] for char in "\r\n\u2028\u2029"), path,
                "area names must be trimmed and single-line")
        text(area["description"], path + ".description")
        require(area["tier"] in ("detail", "locality", "region"), path, "invalid area tier")
        bounds(area["bounds"], path + ".bounds", box)
    return value


def iter_cells(value):
    """Yield all occupied cells, retaining overlap, layer identity/order and raw paint."""
    for order, layer in enumerate(value["layers"]):
        for x, y, length, color_index in layer["runs"]:
            for cell_x in range(x, x + length):
                yield {"layerId": layer["id"], "layerOrder": order,
                       "x": cell_x, "y": y, "color": value["colors"][color_index]}


def contains(box, x, y):
    return box["minX"] <= x < box["maxX"] and box["minY"] <= y < box["maxY"]


def at(value, x, y):
    integer(x, "x")
    integer(y, "y")
    require(contains(value["bounds"], x, y), "coordinate", "outside map bounds")
    layers = []
    for order, layer in enumerate(value["layers"]):
        runs = layer["runs"]
        low, high = 0, len(runs)
        # Locate the last run whose (y,x) start is <= the query, without expanding.
        while low < high:
            middle = (low + high) // 2
            if (runs[middle][1], runs[middle][0]) <= (y, x):
                low = middle + 1
            else:
                high = middle
        run = runs[low - 1] if low else None
        color = (value["colors"][run[3]] if run is not None and
                 run[1] == y and run[0] <= x < run[0] + run[2] else None)
        layers.append({"id": layer["id"], "name": layer["name"],
                       "order": order, "color": color})
    return {"x": x, "y": y, "layers": layers,
            "areas": [area["id"] for area in value["areas"] if contains(area["bounds"], x, y)]}


def summary(value):
    layers = []
    for order, layer in enumerate(value["layers"]):
        digest = hashlib.sha256()
        occupied = 0
        for x, y, length, color_index in layer["runs"]:
            color = value["colors"][color_index]
            record = [x, y, length, color["kind"], color.get("registryId"),
                      color["rgba"], color["meaning"]]
            digest.update((json.dumps(record, ensure_ascii=True, separators=(",", ":")) + "\n").encode("ascii"))
            occupied += length
        layers.append({"id": layer["id"], "name": layer["name"], "order": order,
                       "runs": len(layer["runs"]), "occupiedCells": occupied,
                       "resolvedRunsSha256": digest.hexdigest()})
    return {"bounds": value["bounds"], "colors": value["colors"], "layers": layers,
            "areas": value["areas"],
            "occupiedLayerCells": sum(layer["occupiedCells"] for layer in layers)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("file", help="agent-map JSON file, or - for stdin")
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--cells", action="store_true", help="stream occupied cells as JSON lines")
    mode.add_argument("--at", nargs=2, type=int, metavar=("X", "Y"), help="include all layers at a tile")
    args = parser.parse_args()
    try:
        if args.file == "-":
            data = sys.stdin.buffer.read(MAX_BYTES + 1)
        else:
            with open(args.file, "rb") as source:
                data = source.read(MAX_BYTES + 1)
        value = read_map(data)  # Finish validation before emitting any output.
        if args.cells:
            for cell in iter_cells(value):
                print(json.dumps(cell, ensure_ascii=True, separators=(",", ":")))
        else:
            result = summary(value)
            if args.at:
                result["at"] = at(value, *args.at)
            print(json.dumps(result, ensure_ascii=True, indent=2))
        return 0
    except (OSError, SchemaError) as error:
        print(f"Invalid agent map: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
