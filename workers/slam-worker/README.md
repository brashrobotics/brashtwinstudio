# External SLAM Output Boundary

Real-time SLAM and localization are owned by Brash Embodied Controller. Twin
Studio does not select, run, package, or deploy a production SLAM engine.

This directory remains as architecture documentation for the external output
adapter. Accepted outputs are:

- Robot trajectory and pose covariance
- 2D occupancy/elevation layers
- Registered 3D point cloud
- Loop-closure and quality report
- Sensor coverage map
- Reconstruction coordinate-frame definition

Algorithm selection and sensor-profile configuration remain external. Twin
Studio records producer, algorithm, build, and configuration identity as
provenance but keeps algorithm-specific types out of its domain.
