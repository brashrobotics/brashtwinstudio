# SLAM Worker

Produces metric reconstruction with measured uncertainty from a Raw Survey
Package.

## Outputs

- Robot trajectory and pose covariance
- 2D occupancy/elevation layers
- Registered 3D point cloud
- Loop-closure and quality report
- Sensor coverage map
- Reconstruction coordinate-frame definition

Algorithm selection is made through adapters and configuration for each sensor
profile; domain records must not contain algorithm-specific types.
