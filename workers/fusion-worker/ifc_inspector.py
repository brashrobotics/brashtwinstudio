#!/usr/bin/env python3
"""Inspect and triangulate an IFC model without mutating the source file."""

from __future__ import annotations

import json
import math
import os
import sys
from collections import Counter
from pathlib import Path

import ifcopenshell
import ifcopenshell.geom
import ifcopenshell.util.unit


def inspect_ifc(path: Path) -> dict:
    model = ifcopenshell.open(str(path))
    unit_scale = float(ifcopenshell.util.unit.calculate_unit_scale(model))
    exact_counts = Counter(entity.is_a() for entity in model)
    storeys = []
    for storey in model.by_type("IfcBuildingStorey"):
        source_elevation = storey.Elevation
        storeys.append(
            {
                "globalId": storey.GlobalId,
                "name": storey.Name,
                "sourceElevation": source_elevation,
                "elevationMetres": (
                    float(source_elevation) * unit_scale
                    if source_elevation is not None
                    else None
                ),
            }
        )
    storeys.sort(
        key=lambda item: (
            item["elevationMetres"] is None,
            item["elevationMetres"] or 0.0,
        )
    )

    settings = ifcopenshell.geom.settings()
    settings.set(settings.USE_WORLD_COORDS, True)
    iterator = ifcopenshell.geom.iterator(
        settings,
        model,
        max(1, min(4, os.cpu_count() or 1)),
    )

    minimum = [math.inf, math.inf, math.inf]
    maximum = [-math.inf, -math.inf, -math.inf]
    geometry_product_count = 0
    vertex_count = 0
    triangle_count = 0
    if iterator.initialize():
        while True:
            shape = iterator.get()
            vertices = shape.geometry.verts
            faces = shape.geometry.faces
            geometry_product_count += 1
            vertex_count += len(vertices) // 3
            triangle_count += len(faces) // 3
            for index in range(0, len(vertices), 3):
                for axis in range(3):
                    value = float(vertices[index + axis])
                    minimum[axis] = min(minimum[axis], value)
                    maximum[axis] = max(maximum[axis], value)
            if not iterator.next():
                break

    if geometry_product_count == 0:
        raise RuntimeError("IfcOpenShell could not triangulate any products.")

    represented_products = sum(
        1
        for product in model.by_type("IfcProduct")
        if getattr(product, "Representation", None) is not None
    )
    return {
        "engine": "IfcOpenShell",
        "engineVersion": ifcopenshell.version,
        "schema": model.schema,
        "unitScaleToMetres": unit_scale,
        "spatialStructure": {
            "projects": len(model.by_type("IfcProject")),
            "sites": len(model.by_type("IfcSite")),
            "buildings": len(model.by_type("IfcBuilding")),
            "storeys": storeys,
        },
        "elementCounts": {
            "walls": len(model.by_type("IfcWall")),
            "slabs": len(model.by_type("IfcSlab")),
            "doors": len(model.by_type("IfcDoor")),
            "windows": len(model.by_type("IfcWindow")),
            "spaces": len(model.by_type("IfcSpace")),
            "buildingElementProxies": len(model.by_type("IfcBuildingElementProxy")),
        },
        "exactEntityTypeCount": len(exact_counts),
        "representedProductCount": represented_products,
        "geometryProductCount": geometry_product_count,
        "vertexCount": vertex_count,
        "triangleCount": triangle_count,
        "boundsMetres": {
            "minimum": [round(value, 9) for value in minimum],
            "maximum": [round(value, 9) for value in maximum],
        },
    }


def main() -> int:
    if len(sys.argv) != 2:
        print("Usage: ifc_inspector.py <model.ifc>", file=sys.stderr)
        return 2
    path = Path(sys.argv[1]).resolve()
    if not path.is_file() or path.is_symlink():
        print("IFC input must be a regular non-symbolic-link file.", file=sys.stderr)
        return 1
    try:
        print(json.dumps(inspect_ifc(path), indent=2, sort_keys=True))
        return 0
    except Exception as error:  # Boundary CLI: return a concise failure to Node.
        print(f"IFC inspection failed: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
