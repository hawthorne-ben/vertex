# Version Compatibility Matrix

This document tracks version compatibility across all Vertex components.

## Current Versions (Alpha)

| Component            | Version | Status | Notes                           |
|---------------------|---------|--------|---------------------------------|
| VTX Format Spec     | 0.1.0   | Alpha  | Initial specification           |
| VTX Constants       | 0.1.0   | Alpha  | Shared format constants         |
| Firmware            | 0.1.0   | Alpha  | ESP32 + BNO055 IMU             |
| Android App         | 0.1.0   | Alpha  | React Native app               |
| Web App             | 0.1.0   | Alpha  | Next.js platform               |

## Compatibility Table

| VTX Format | Firmware | Android App | Web App | Notes                          |
|------------|----------|-------------|---------|--------------------------------|
| 0.1.0      | 0.1.0    | 0.1.0       | 0.1.0   | **Current** - Alpha release    |

## Version Requirements

### VTX Format 0.1.0
- **Description**: Initial format specification (CSV-based)
- **Firmware**: 0.1.0
- **Android**: 0.1.0
- **Web**: 0.1.0

### Future: VTX Format 1.0.0 (Planned)
- **Description**: Binary format with metadata
- **Firmware**: 1.0.0+ (will write VTX binary)
- **Android**: 1.0.0+ (will read/write VTX binary)
- **Web**: 1.0.0+ (will parse VTX binary)

## Backward Compatibility Policy

### Pre-1.0 (Alpha/Beta)
- **No compatibility guarantees** between versions
- Breaking changes may occur without major version bump
- Version 0.x.y indicates unstable/development versions

### Post-1.0 (Stable)
- **Semantic versioning** will be strictly followed
- **Major version** (X.0.0) - Breaking changes
- **Minor version** (x.Y.0) - New features, backward compatible
- **Patch version** (x.y.Z) - Bug fixes, backward compatible

## Format Evolution

### Current (v0.1.0): CSV Format
```csv
timestamp_ms,accel_x,accel_y,accel_z,gyro_x,gyro_y,gyro_z,mag_x,mag_y,mag_z,quat_w,quat_x,quat_y,quat_z
```

### Planned (v1.0.0): VTX Binary Format
```
[Header][Metadata][Data Records][Footer]
```

## Component Release Schedule

### Phase 1: Alpha (Current - v0.1.0)
- ✅ Basic functionality working
- ✅ CSV file format
- ✅ BLE communication
- ✅ Web visualization

### Phase 2: Beta (v0.2.0 - Planned Q1 2026)
- VTX binary format implementation
- Android VTX encoder
- Web VTX parser
- Migration tools (CSV → VTX)

### Phase 3: Stable (v1.0.0 - Planned Q2 2026)
- Production-ready firmware
- Stable VTX format (v1.0)
- Full feature parity
- Documentation complete
- Breaking changes resolved

## Testing Matrix

Test that these combinations work together:

| Test Case                    | Firmware | Android | Web | Status |
|-----------------------------|----------|---------|-----|--------|
| BLE Connection              | 0.1.0    | 0.1.0   | -   | ✅     |
| Data Streaming              | 0.1.0    | 0.1.0   | -   | ✅     |
| Recording to CSV            | 0.1.0    | 0.1.0   | -   | ✅     |
| CSV Upload & Parsing        | -        | -       | 0.1.0 | ✅   |
| Data Visualization          | -        | 0.1.0   | 0.1.0 | ✅   |

## Version Tags in Git

Components are tagged with namespaced versions:

```bash
# VTX Format specification
git tag vtx-format/v0.1.0

# VTX Constants package
git tag vtx-constants/v0.1.0

# Firmware releases
git tag firmware/v0.1.0

# Android app releases
git tag android/v0.1.0

# Web app releases
git tag web/v0.1.0
```

## Changelog Links

- [VTX Format](../packages/vtx-format/CHANGELOG.md)
- [VTX Constants](../packages/vtx-constants/CHANGELOG.md)
- [Firmware](../firmware/CHANGELOG.md)
- [Android App](../android/CHANGELOG.md)
- [Web App](../web/CHANGELOG.md)

## Migration Guides

### Upgrading Components

When upgrading, follow this order:

1. **VTX Format** - Update format spec first
2. **VTX Constants** - Update shared constants
3. **Firmware** - Update to write new format
4. **Android** - Update to read/write new format
5. **Web** - Update to parse new format

### Breaking Changes

Breaking changes will be documented in individual CHANGELOGs and migration guides will be provided.

---

*Last Updated: 2025-10-28*
*Document Version: 1.0*
