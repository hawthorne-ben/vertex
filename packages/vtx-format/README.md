# @vertex/vtx-format

Official specification for the VTX binary format for IMU sensor data storage.

## Current Version

**VTX Format v1.0**

See [spec/v1.0.md](./spec/v1.0.md) for the complete specification.

## Overview

VTX is a custom binary format designed for efficient storage of IMU (Inertial Measurement Unit) sensor data from cycling devices. It provides:

- **60-70% smaller file sizes** compared to CSV
- **Faster parsing** with binary data structures
- **Extendible metadata** for device info, calibration, and session notes
- **Random access** to any data point
- **Future-proof design** with versioning

## Format Structure

```
┌─────────────────────────────────────┐
│        FILE HEADER (64 bytes)       │
├─────────────────────────────────────┤
│     METADATA (variable length)      │
├─────────────────────────────────────┤
│   DATA RECORDS (28-56 bytes each)   │
└─────────────────────────────────────┘
```

## File Extension

`.vtx`

## MIME Type

`application/vnd.vertex.vtx` (proposed)

## Specification

The complete format specification is available in [spec/v1.0.md](./spec/v1.0.md).

## JSON Schema

Metadata JSON schema is available in [schema/vtx-v1.schema.json](./schema/vtx-v1.schema.json).

## Version History

- **v1.0** (2025-10-28) - Initial specification

## Related Packages

- [@vertex/vtx-constants](../vtx-constants) - Shared constants for VTX format
- [@vertex/vtx-parser](../vtx-parser) - TypeScript parser implementation (coming soon)

## License

MIT
