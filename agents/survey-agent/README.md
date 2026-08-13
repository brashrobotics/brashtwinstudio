# Survey Agent

Runs on a survey robot or its edge computer.

## Responsibilities

- Collect LiDAR, RGB/depth camera, IMU, odometry, and localization streams.
- Record sensor calibration and time-synchronization metadata.
- Split data into bounded, checksummed parts.
- Use a local spool during network outages and resume uploads afterward.
- Record survey start/end times and operator and robot identities.
- Report sensor loss, disk pressure, and insufficient coverage health signals.

## Output

An immutable `Raw Survey Package` containing raw data, calibration, sensor clocks,
device information, and an integrity manifest.

The agent does not make semantic decisions or modify the published twin baseline.
