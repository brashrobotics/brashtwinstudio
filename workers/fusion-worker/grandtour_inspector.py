#!/usr/bin/env python3
"""Bounded, read-only inspection of the pinned GrandTour processed survey subset."""

from __future__ import annotations

import gc
import json
import math
import sys
import tarfile
from pathlib import Path, PurePosixPath
from typing import Any

import numpy as np
from numcodecs import get_codec


SCHEMA_VERSION = "brash.survey-materialization-preview/v1"
INSPECTOR_VERSION = "1.0.0"
MAX_SELECTION_BYTES = 1_048_576
MAX_TAR_MEMBERS = 128
MAX_METADATA_BYTES = 65_536
MAX_COMPRESSED_CHUNK_BYTES = 64 * 1024 * 1024
MAX_DECODED_CHUNK_BYTES = 512 * 1024 * 1024
MAX_PREVIEW_SAMPLES = 4_096


class InspectionError(RuntimeError):
    pass


def main() -> None:
    if len(sys.argv) != 3:
        raise InspectionError(
            "Usage: grandtour_inspector.py <selection.json> <dataset-directory>"
        )
    selection_path = Path(sys.argv[1]).resolve(strict=True)
    dataset_root = Path(sys.argv[2]).resolve(strict=True)
    selection = read_bounded_json(selection_path)
    files = role_paths(selection, dataset_root)

    odometry = inspect_odometry(files["TRAJECTORY"])
    transforms = inspect_transforms(files["COORDINATE_FRAMES"])
    point_cloud = inspect_ply(files["POINT_CLOUD_MAP"])
    warnings: list[dict[str, str]] = []
    if transforms["timestamp"]["nonIncreasingCount"] > 0:
        warnings.append(
            {
                "code": "TF_TIMESTAMP_NON_INCREASING",
                "message": (
                    "The TF stream contains "
                    f"{transforms['timestamp']['nonIncreasingCount']} non-increasing intervals; "
                    "materialization must preserve order and expose this as quality evidence."
                ),
            }
        )

    report = {
        "schemaVersion": SCHEMA_VERSION,
        "source": {
            "kind": "EXTERNAL_DATASET",
            "sourceId": selection["datasetId"],
            "revision": selection["source"]["revision"],
        },
        "coordinateSystem": {
            "rootFrameId": odometry["frameId"],
            "lengthUnit": "METRE",
            "handedness": "RIGHT_HANDED",
            "upAxis": "Z",
        },
        "trajectory": odometry,
        "coordinateFrames": transforms,
        "reconstruction": {
            **point_cloud,
            "frameId": odometry["frameId"],
        },
        "qualityWarnings": warnings,
        "generatedBy": {
            "name": "brash-grandtour-inspector",
            "version": INSPECTOR_VERSION,
        },
    }
    print(json.dumps(report, separators=(",", ":"), allow_nan=False))


def read_bounded_json(path: Path) -> dict[str, Any]:
    metadata = path.stat()
    if not path.is_file() or metadata.st_size > MAX_SELECTION_BYTES:
        raise InspectionError("Selection must be a regular JSON file no larger than 1 MiB.")
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise InspectionError("Selection JSON must contain an object.")
    return value


def role_paths(selection: dict[str, Any], dataset_root: Path) -> dict[str, Path]:
    base = selection.get("baseSelection")
    entries = base.get("files") if isinstance(base, dict) else None
    if not isinstance(entries, list):
        raise InspectionError("Selection has no baseSelection.files array.")
    paths: dict[str, Path] = {}
    for entry in entries:
        if not isinstance(entry, dict):
            raise InspectionError("Selection file entry must be an object.")
        role = entry.get("role")
        relative = entry.get("path")
        if role not in {"TRAJECTORY", "COORDINATE_FRAMES", "POINT_CLOUD_MAP"}:
            continue
        if role in paths:
            raise InspectionError(f"Selection contains duplicate {role} entries.")
        if not safe_relative_path(relative):
            raise InspectionError(f"Selection path for {role} is unsafe.")
        candidate = (dataset_root / relative).resolve(strict=True)
        if dataset_root not in candidate.parents or not candidate.is_file():
            raise InspectionError(f"Selection path for {role} escapes the dataset directory.")
        paths[role] = candidate
    missing = {"TRAJECTORY", "COORDINATE_FRAMES", "POINT_CLOUD_MAP"} - paths.keys()
    if missing:
        raise InspectionError(f"Selection is missing required roles: {', '.join(sorted(missing))}.")
    return paths


def safe_relative_path(value: Any) -> bool:
    if not isinstance(value, str) or not value or "\\" in value:
        return False
    path = PurePosixPath(value)
    return not path.is_absolute() and all(part not in {"", ".", ".."} for part in path.parts)


class SafeZarrTar:
    def __init__(self, path: Path, group: str):
        self._archive = tarfile.open(path, mode="r:")
        self.group = group
        members = self._archive.getmembers()
        if len(members) > MAX_TAR_MEMBERS:
            self._archive.close()
            raise InspectionError(f"{path.name} contains too many archive members.")
        self._members: dict[str, tarfile.TarInfo] = {}
        for member in members:
            if not safe_relative_path(member.name) or not (member.isfile() or member.isdir()):
                self._archive.close()
                raise InspectionError(f"{path.name} contains an unsafe archive member.")
            self._members[member.name] = member

    def __enter__(self) -> "SafeZarrTar":
        return self

    def __exit__(self, *_: object) -> None:
        self._archive.close()

    def json_member(self, name: str) -> dict[str, Any]:
        member = self._required_file(name)
        if member.size > MAX_METADATA_BYTES:
            raise InspectionError(f"Archive metadata {name} exceeds the bounded limit.")
        stream = self._archive.extractfile(member)
        if stream is None:
            raise InspectionError(f"Archive metadata {name} cannot be read.")
        value = json.loads(stream.read().decode("utf-8"))
        if not isinstance(value, dict):
            raise InspectionError(f"Archive metadata {name} must be an object.")
        return value

    def array(self, name: str) -> np.ndarray[Any, Any]:
        prefix = f"{self.group}/{name}"
        metadata = self.json_member(f"{prefix}/.zarray")
        shape = integer_shape(metadata.get("shape"), f"{name}.shape")
        chunks = integer_shape(metadata.get("chunks"), f"{name}.chunks")
        if len(shape) != len(chunks) or any(size > chunk for size, chunk in zip(shape, chunks)):
            raise InspectionError(f"{name} must fit in exactly one Zarr chunk.")
        if metadata.get("zarr_format") != 2 or metadata.get("order") != "C":
            raise InspectionError(f"{name} must use C-ordered Zarr v2.")
        if metadata.get("filters") not in (None, []):
            raise InspectionError(f"{name} uses unsupported Zarr filters.")
        dtype = np.dtype(metadata.get("dtype"))
        if dtype.str not in {"<f8", "<u8"}:
            raise InspectionError(f"{name} uses unsupported dtype {dtype.str}.")
        decoded_bytes = math.prod(chunks) * dtype.itemsize
        if decoded_bytes > MAX_DECODED_CHUNK_BYTES:
            raise InspectionError(f"{name} decoded chunk exceeds 512 MiB.")
        chunk_name = ".".join("0" for _ in shape)
        member = self._required_file(f"{prefix}/{chunk_name}")
        if member.size > MAX_COMPRESSED_CHUNK_BYTES:
            raise InspectionError(f"{name} compressed chunk exceeds 64 MiB.")
        compressor = metadata.get("compressor")
        if not isinstance(compressor, dict) or compressor.get("id") != "blosc" or compressor.get("cname") != "lz4":
            raise InspectionError(f"{name} must use the expected Blosc/LZ4 compressor.")
        stream = self._archive.extractfile(member)
        if stream is None:
            raise InspectionError(f"{name} chunk cannot be read.")
        decoded = get_codec(compressor).decode(stream.read())
        if len(decoded) != decoded_bytes:
            raise InspectionError(f"{name} decoded chunk byte length is inconsistent.")
        padded = np.frombuffer(decoded, dtype=dtype).reshape(chunks, order="C")
        result = padded[tuple(slice(0, size) for size in shape)].copy()
        del padded, decoded
        gc.collect()
        return result

    def _required_file(self, name: str) -> tarfile.TarInfo:
        member = self._members.get(name)
        if member is None or not member.isfile():
            raise InspectionError(f"Required archive member {name} was not found.")
        return member


def integer_shape(value: Any, name: str) -> tuple[int, ...]:
    if (
        not isinstance(value, list)
        or not value
        or len(value) > 3
        or any(not isinstance(item, int) or isinstance(item, bool) or item < 1 for item in value)
    ):
        raise InspectionError(f"{name} is invalid.")
    return tuple(value)


def inspect_odometry(path: Path) -> dict[str, Any]:
    with SafeZarrTar(path, "dlio_map_odometry") as archive:
        attributes = archive.json_member("dlio_map_odometry/.zattrs")
        timestamps = archive.array("timestamp")
        positions = archive.array("pose_pos")
        quaternions = archive.array("pose_orien")
    require_array_shapes(timestamps, positions, quaternions)
    require_finite("odometry", timestamps, positions, quaternions)
    deltas = np.diff(timestamps)
    steps = np.linalg.norm(np.diff(positions, axis=0), axis=1)
    quaternion_norms = np.linalg.norm(quaternions, axis=1)
    preview_stride = max(1, math.ceil(len(timestamps) / MAX_PREVIEW_SAMPLES))
    preview_indices = np.arange(0, len(timestamps), preview_stride)[:MAX_PREVIEW_SAMPLES]
    return {
        "format": "GRANDTOUR_ZARR_V2_ODOMETRY",
        "frameId": required_text(attributes.get("frame_id"), "odometry frame_id"),
        "sampleCount": int(len(timestamps)),
        "timestamp": timestamp_summary(timestamps),
        "sampling": {"medianRateHz": rounded(1.0 / np.median(deltas[deltas > 0]))},
        "positionBounds": bounds(positions),
        "pathLengthMetres": rounded(steps.sum()),
        "maximumStepMetres": rounded(steps.max()),
        "quaternionNorm": {
            "minimum": rounded(quaternion_norms.min()),
            "maximum": rounded(quaternion_norms.max()),
        },
        "preview": {
            "method": "STRIDE",
            "sourceStride": preview_stride,
            "poses": [
                {
                    "timestamp": rounded(timestamps[index]),
                    "position": rounded_vector(positions[index]),
                }
                for index in preview_indices
            ],
        },
    }


def inspect_transforms(path: Path) -> dict[str, Any]:
    with SafeZarrTar(path, "dlio_tf") as archive:
        attributes = archive.json_member("dlio_tf/.zattrs")
        timestamps = archive.array("timestamp")
        translations = archive.array("translation")
        rotations = archive.array("rotation")
    require_array_shapes(timestamps, translations, rotations)
    require_finite("TF", timestamps, translations, rotations)
    quaternion_norms = np.linalg.norm(rotations, axis=1)
    transform = attributes.get("transform")
    if not isinstance(transform, dict):
        raise InspectionError("TF metadata has no static transform.")
    return {
        "format": "GRANDTOUR_ZARR_V2_TF",
        "frameId": required_text(attributes.get("frame_id"), "TF frame_id"),
        "sampleCount": int(len(timestamps)),
        "timestamp": timestamp_summary(timestamps),
        "translationBounds": bounds(translations),
        "quaternionNorm": {
            "minimum": rounded(quaternion_norms.min()),
            "maximum": rounded(quaternion_norms.max()),
        },
        "staticTransform": transform,
    }


def inspect_ply(path: Path) -> dict[str, Any]:
    header, offset = read_ply_header(path)
    if header[0] != "ply" or "format binary_little_endian 1.0" not in header:
        raise InspectionError("Point cloud must be binary little-endian PLY v1.")
    vertex_lines = [line for line in header if line.startswith("element vertex ")]
    if len(vertex_lines) != 1:
        raise InspectionError("PLY must declare exactly one vertex element.")
    try:
        vertex_count = int(vertex_lines[0].split()[2])
    except (IndexError, ValueError) as error:
        raise InspectionError("PLY vertex count is invalid.") from error
    if vertex_count < 1 or vertex_count > 100_000_000:
        raise InspectionError("PLY vertex count is outside the bounded range.")
    properties = [line.removeprefix("property ") for line in header if line.startswith("property ")]
    if properties != ["float x", "float y", "float z", "float intensity"]:
        raise InspectionError("PLY must contain float x, y, z, and intensity properties only.")
    dtype = np.dtype([("x", "<f4"), ("y", "<f4"), ("z", "<f4"), ("intensity", "<f4")])
    expected_bytes = offset + vertex_count * dtype.itemsize
    if path.stat().st_size != expected_bytes:
        raise InspectionError("PLY byte length is inconsistent with its vertex declaration.")
    vertices = np.memmap(path, mode="r", dtype=dtype, offset=offset, shape=(vertex_count,))
    minimum = np.full(4, np.inf)
    maximum = np.full(4, -np.inf)
    finite_count = 0
    for start in range(0, vertex_count, 1_000_000):
        chunk = vertices[start : min(start + 1_000_000, vertex_count)]
        matrix = np.column_stack([chunk[name] for name in dtype.names])
        finite = np.isfinite(matrix).all(axis=1)
        finite_count += int(finite.sum())
        if finite.any():
            minimum = np.minimum(minimum, matrix[finite].min(axis=0))
            maximum = np.maximum(maximum, matrix[finite].max(axis=0))
    if finite_count != vertex_count:
        raise InspectionError("PLY contains non-finite vertices.")
    preview_stride = max(1, math.ceil(vertex_count / MAX_PREVIEW_SAMPLES))
    preview = vertices[::preview_stride][:MAX_PREVIEW_SAMPLES]
    return {
        "format": "PLY_BINARY_LITTLE_ENDIAN",
        "vertexCount": vertex_count,
        "attributes": ["x", "y", "z", "intensity"],
        "bounds": {
            "minimum": rounded_vector(minimum[:3]),
            "maximum": rounded_vector(maximum[:3]),
        },
        "intensity": {"minimum": rounded(minimum[3]), "maximum": rounded(maximum[3])},
        "preview": {
            "method": "STRIDE",
            "sourceStride": preview_stride,
            "points": [
                [rounded(row["x"]), rounded(row["y"]), rounded(row["z"]), rounded(row["intensity"])]
                for row in preview
            ],
        },
    }


def read_ply_header(path: Path) -> tuple[list[str], int]:
    lines: list[str] = []
    total = 0
    with path.open("rb") as stream:
        while total <= MAX_METADATA_BYTES:
            raw = stream.readline(4_097)
            if not raw or len(raw) > 4_096:
                raise InspectionError("PLY header is invalid or too large.")
            total += len(raw)
            try:
                line = raw.decode("ascii").rstrip("\r\n")
            except UnicodeDecodeError as error:
                raise InspectionError("PLY header must be ASCII.") from error
            lines.append(line)
            if line == "end_header":
                return lines, stream.tell()
    raise InspectionError("PLY header exceeds 64 KiB.")


def timestamp_summary(timestamps: np.ndarray[Any, Any]) -> dict[str, Any]:
    deltas = np.diff(timestamps)
    return {
        "startEpochSeconds": rounded(timestamps[0]),
        "endEpochSeconds": rounded(timestamps[-1]),
        "durationSeconds": rounded(timestamps[-1] - timestamps[0]),
        "nonIncreasingCount": int(np.count_nonzero(deltas <= 0)),
    }


def require_array_shapes(
    timestamps: np.ndarray[Any, Any],
    vectors: np.ndarray[Any, Any],
    quaternions: np.ndarray[Any, Any],
) -> None:
    if (
        timestamps.ndim != 1
        or vectors.shape != (len(timestamps), 3)
        or quaternions.shape != (len(timestamps), 4)
        or len(timestamps) < 2
    ):
        raise InspectionError("Zarr trajectory/transform array shapes are inconsistent.")


def require_finite(name: str, *arrays: np.ndarray[Any, Any]) -> None:
    if any(not np.isfinite(array).all() for array in arrays):
        raise InspectionError(f"{name} arrays contain non-finite values.")


def bounds(vectors: np.ndarray[Any, Any]) -> dict[str, list[float]]:
    return {
        "minimum": rounded_vector(vectors.min(axis=0)),
        "maximum": rounded_vector(vectors.max(axis=0)),
    }


def required_text(value: Any, name: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise InspectionError(f"{name} must be non-empty text.")
    return value


def rounded(value: Any) -> float:
    return round(float(value), 9)


def rounded_vector(values: Any) -> list[float]:
    return [rounded(value) for value in values]


if __name__ == "__main__":
    try:
        main()
    except (InspectionError, OSError, ValueError, KeyError, json.JSONDecodeError) as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
