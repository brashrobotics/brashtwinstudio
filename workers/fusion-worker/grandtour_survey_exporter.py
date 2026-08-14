#!/usr/bin/env python3
"""Export a pinned GrandTour processed survey into Twin Studio ingest artifacts."""

from __future__ import annotations

import hashlib
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np

from grandtour_inspector import (
    InspectionError,
    SafeZarrTar,
    inspect_odometry,
    inspect_ply,
    inspect_transforms,
    read_bounded_json,
    role_paths,
)


EXPORTER_VERSION = "1.0.0"


def main() -> None:
    if len(sys.argv) != 4:
        raise InspectionError(
            "Usage: grandtour_survey_exporter.py <selection.json> <dataset-directory> <output-directory>"
        )
    selection_path = Path(sys.argv[1]).resolve(strict=True)
    dataset_root = Path(sys.argv[2]).resolve(strict=True)
    output_root = Path(sys.argv[3]).resolve()
    output_root.mkdir(parents=True, exist_ok=False)

    selection = read_bounded_json(selection_path)
    files = role_paths(selection, dataset_root)
    odometry = inspect_odometry(files["TRAJECTORY"])
    transforms = inspect_transforms(files["COORDINATE_FRAMES"])
    point_cloud = inspect_ply(files["POINT_CLOUD_MAP"])
    frame_id = odometry["frameId"]

    trajectory_path = output_root / "trajectory.tum"
    export_tum(files["TRAJECTORY"], trajectory_path)

    frames_path = output_root / "coordinate-frames.json"
    write_json(frames_path, {
        "schemaVersion": "brash.survey-coordinate-frames/v1",
        "rootFrameId": frame_id,
        "frames": [{
            "frameId": frame_id,
            "parentFrameId": None,
            "transformToParent": {
                "translation": {"x": 0, "y": 0, "z": 0},
                "rotation": {"x": 0, "y": 0, "z": 0, "w": 1},
            },
        }],
    })

    calibration_path = output_root / "calibration.json"
    parameters_hash = sha256_bytes(canonical_json({
        "datasetRevision": selection["source"]["revision"],
        "source": "GrandTour processed DLIO odometry",
    }))
    write_json(calibration_path, {
        "schemaVersion": "brash.survey-calibration/v1",
        "calibrationId": "grandtour-eth2-processed-dlio",
        "sensors": [{
            "sensorId": "dlio-processed-odometry",
            "frameId": frame_id,
            "modality": "ODOMETRY",
            "model": "GrandTour DLIO processed output",
            "parametersSha256": parameters_hash,
        }],
    })

    warnings: list[dict[str, str]] = []
    non_increasing = transforms["timestamp"]["nonIncreasingCount"]
    if non_increasing > 0:
        warnings.append({
            "code": "TF_TIMESTAMP_NON_INCREASING",
            "message": f"The TF stream contains {non_increasing} non-increasing intervals.",
        })
    quality_path = output_root / "quality-report.json"
    write_json(quality_path, {
        "schemaVersion": "brash.grandtour-quality-report/v1",
        "datasetId": selection["datasetId"],
        "revision": selection["source"]["revision"],
        "outcome": "WARNING" if warnings else "PASSED",
        "trajectory": odometry,
        "coordinateFrames": transforms,
        "reconstruction": point_cloud,
        "warnings": warnings,
        "generatedBy": {"name": "brash-grandtour-survey-exporter", "version": EXPORTER_VERSION},
    })

    result = {
        "schemaVersion": "brash.grandtour-survey-export/v1",
        "datasetId": selection["datasetId"],
        "revision": selection["source"]["revision"],
        "frameId": frame_id,
        "capture": {
            "startedAt": iso_timestamp(odometry["timestamp"]["startEpochSeconds"]),
            "completedAt": iso_timestamp(odometry["timestamp"]["endEpochSeconds"]),
        },
        "quality": {
            "outcome": "WARNING" if warnings else "PASSED",
            "trajectoryPoseCount": odometry["sampleCount"],
        },
        "summary": {
            "trajectoryPoseCount": odometry["sampleCount"],
            "pathLengthMetres": odometry["pathLengthMetres"],
            "pointCloudVertexCount": point_cloud["vertexCount"],
            "warningCount": len(warnings),
        },
        "artifacts": [
            artifact("grandtour-frames", "COORDINATE_FRAMES", frames_path,
                     "frames/coordinate-frames.json", "application/vnd.brash.survey-coordinate-frames+json"),
            artifact("grandtour-calibration", "CALIBRATION", calibration_path,
                     "calibration/sensors.json", "application/vnd.brash.survey-calibration+json"),
            artifact("grandtour-trajectory", "TRAJECTORY", trajectory_path,
                     "trajectory/dlio-poses.tum", "application/vnd.brash.trajectory+tum", frame_id),
            artifact("grandtour-point-cloud", "POINT_CLOUD_MAP", files["POINT_CLOUD_MAP"],
                     "reconstruction/dlio-map.ply", "model/vnd.ply", frame_id),
            artifact("grandtour-quality", "QUALITY_REPORT", quality_path,
                     "quality/grandtour-report.json", "application/json"),
        ],
    }
    print(json.dumps(result, separators=(",", ":"), allow_nan=False))


def export_tum(odometry_path: Path, output_path: Path) -> None:
    with SafeZarrTar(odometry_path, "dlio_map_odometry") as archive:
        timestamps = archive.array("timestamp")
        positions = archive.array("pose_pos")
        quaternions = archive.array("pose_orien")
    if np.any(np.diff(timestamps) <= 0):
        raise InspectionError("DLIO odometry timestamps must be strictly increasing for TUM export.")
    with output_path.open("x", encoding="utf-8", newline="\n") as stream:
        for timestamp, position, quaternion in zip(timestamps, positions, quaternions, strict=True):
            values = [timestamp, *position, *quaternion]
            stream.write(" ".join(format(float(value), ".17g") for value in values))
            stream.write("\n")


def artifact(
    artifact_id: str,
    role: str,
    local_path: Path,
    package_path: str,
    media_type: str,
    frame_id: str | None = None,
) -> dict[str, Any]:
    record: dict[str, Any] = {
        "artifactId": artifact_id,
        "role": role,
        "localPath": str(local_path.resolve(strict=True)),
        "path": package_path,
        "mediaType": media_type,
        "bytes": local_path.stat().st_size,
        "sha256": sha256_file(local_path),
    }
    if frame_id is not None:
        record["frameId"] = frame_id
    return record


def write_json(path: Path, value: dict[str, Any]) -> None:
    path.write_bytes(canonical_json(value) + b"\n")


def canonical_json(value: dict[str, Any]) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False).encode("utf-8")


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        while chunk := stream.read(8 * 1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def iso_timestamp(epoch_seconds: float) -> str:
    return datetime.fromtimestamp(epoch_seconds, timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


if __name__ == "__main__":
    try:
        main()
    except (InspectionError, OSError, ValueError, KeyError, json.JSONDecodeError) as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
