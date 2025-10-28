# @vertex/vtx-constants

Shared constants for VTX binary format specification.

## Installation

```bash
npm install @vertex/vtx-constants
```

## Usage

```typescript
import {
  VTX_FORMAT_VERSION,
  VTX_HEADER,
  VTX_RECORD_FORMAT,
  getRecordSize,
  getVersionString,
} from '@vertex/vtx-constants';

// Get format version
console.log(getVersionString()); // "1.0"

// Check format bitmask
const recordFormat = VTX_RECORD_FORMAT.HAS_ACCEL | VTX_RECORD_FORMAT.HAS_GYRO | VTX_RECORD_FORMAT.HAS_MAG;
const recordSize = getRecordSize(recordFormat); // 44 bytes
```

## Constants

- `VTX_FORMAT_VERSION` - Major/minor version of format spec
- `VTX_HEADER` - Header structure constants
- `VTX_RECORD_FORMAT` - Sensor bitmask values
- `VTX_RECORD_SIZE` - Record size constants
- `VTX_COMPRESSION` - Compression type codes
- `VTX_FOOTER` - Footer structure constants

## Version

Current format version: **1.0**
