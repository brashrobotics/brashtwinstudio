# Survey Agent Ownership Boundary

The production survey agent runs in Brash Embodied Controller on the robot or
its edge computer. Twin Studio does not implement or deploy it.

## External responsibilities

- Collect LiDAR, RGB/depth camera, IMU, odometry, and localization streams.
- Record sensor calibration and time-synchronization metadata.
- Split data into bounded, checksummed parts.
- Use a local spool during network outages and resume uploads afterward.
- Record survey start/end times and operator and robot identities.
- Report sensor loss, disk pressure, and insufficient coverage health signals.

## Output

An immutable `brash.embodied-survey-package/v1` transfer containing processed
trajectory/reconstruction outputs, calibration, sensor clocks, device and
producer identity, quality evidence, and an integrity manifest. Optional raw
recordings may be attached for audit or offline research.

Twin Studio owns only the receiving contract and validation policy. The external
agent does not make Twin semantic decisions or modify the published baseline.
