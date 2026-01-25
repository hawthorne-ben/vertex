# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.6.1] - 2026-01-25

### Fixed
- **VTXMerger Euler Angle Preservation**: Fixed bug where Euler angles (roll, pitch, yaw) were lost during file merging
- VTXEncoder now supports `includeEuler` option to preserve Euler angle data
- VTXMerger now detects HAS_EULER flag from source files and preserves Euler data in merged output
- Encoder correctly writes Euler angles (12 bytes: 3 × float32) when `includeEuler: true`

### Technical Details
- Added `includeEuler` property to VTXEncoder class
- Added HAS_EULER flag detection in VTXMerger.merge()
- Updated record size calculation to include Euler angles (12 bytes)
- Updated record writing to serialize roll, pitch, yaw after quaternion data
- Added validation to ensure Euler data is present when `includeEuler: true`

## [0.6.0] - 2026-01-25

### Added
- **VTXMerger**: New merger utility for combining multiple VTX files into a single file
- `VTXMerger.merge()` static method to merge ArrayBuffers from multiple VTX files
- `VTXMerger.validateMergeCompatibility()` to check if files can be safely merged
- `MergeResult` type with merged buffer, header, metadata, and statistics

### Features
- Merges multiple VTX recordings into single unified file
- Automatically sorts records by timestamp across all input files
- Deduplicates overlapping timestamps (keeps first occurrence)
- Preserves all sensor data (accel, gyro, mag, quat, GPS) from all files
- Updates header with merged record count and time range
- Stores merge provenance in metadata.custom.mergedFrom array
- Validates sensor compatibility before merging (format, sample rate)

### Use Cases
- Combine multiple recording sessions into single ride file
- Merge non-overlapping time segments from same ride
- Consolidate fragmented recordings for analysis
- Simplify multi-file handling in applications

### Technical Details
- Single-file optimization: Returns original buffer unchanged if only one file provided
- Merge statistics include: input file count, total/output records, deduplication count
- Compatible with all VTX format versions (v1.0, v1.1)
- Handles variable record formats (with/without mag, quat, Euler, GPS)
- Thread-safe: No side effects, pure functional merge

### Example
```typescript
import { VTXMerger } from '@vertex-pkg/vtx-parser';

const files = [buffer1, buffer2, buffer3];
const result = VTXMerger.merge(files);
// result.buffer - merged ArrayBuffer
// result.stats.outputRecords - total records after deduplication
```

## [0.5.0] - 2025-12-12

### Added
- **GPS Support (VTX Format v1.1)**: Added separate GPS data stream to VTX binary format
- New GPSRecord type with fields: `timestamp`, `latitude`, `longitude`, `altitude`, `speed`, `bearing`, `accuracy`
- GPS records stored as separate stream after IMU data (44 bytes per record)
- Extended VTXHeader with `gpsRecordCount` and `gpsDataOffset` fields for v1.1+
- `includeGPS` option in VTXEncoderOptions for enabling GPS recording
- GPS_RECORD_SIZE constant (44 bytes) in VTX_CONSTANTS
- VTXEncoder methods: `addGPSRecord()`, `addGPSRecords()`, `getGPSRecordCount()`
- VTXStreamEncoder method: `addGPSRecord()` for real-time GPS recording
- VTXDecoder methods: `readGPSRecords()`, `readGPSRecord()`, `getGPSRecordCount()`
- VTXFile interface now includes optional `gpsRecords` array
- Exported additional types: `GPSRecord`, `VTXMetadata`, `VTXEncoderOptions`, `VTXDecoderOptions`

### Changed
- Binary format version bumped to v1.1 (minor version increment)
- VTXHeader reserved space now used for GPS fields (8 bytes for gpsRecordCount, 4 bytes for gpsDataOffset)
- Decoder is backwards compatible - reads v1.0 files without GPS data
- VTXStreamEncoder tracks GPS data offset and includes GPS records in finalize()

### Technical Details
- GPS records use double precision for lat/lon (float64), single precision for other fields (float32)
- Null/unavailable GPS fields stored as NaN in binary format
- GPS data stream is independent from IMU data stream for efficient access
- GPS timestamps use same base timestamp as IMU records for synchronization
- Record layout: timestamp (4B) + lat (8B) + lon (8B) + altitude (4B) + speed (4B) + bearing (4B) + accuracy (4B) + reserved (4B) = 44 bytes

### Migration Guide
- v1.0 files continue to work without changes
- v1.1 files with GPS are readable by updated decoder
- Files without GPS data (gpsRecordCount = 0) behave identically to v1.0
- Optional fields in VTXHeader are backwards compatible

## [0.4.0] - 2025-11-06

### Added
- **Euler Angle Support**: Added HAS_EULER flag (bit 4) to record format
- New optional fields in IMURecord: `roll`, `pitch`, `yaw` (in degrees)
- `includeEuler` option in VTXEncoderOptions for enabling Euler angle recording
- Full support for Euler angles in TypeScript encoder, decoder, and stream encoder
- Python decoder support for reading Euler angle data
- Python IMURecord dataclass now includes `roll`, `pitch`, `yaw` fields

### Changed
- Record size calculation now includes Euler angles (12 bytes: 3 × float32) when enabled
- VTXStreamEncoder updated to write Euler angle data when `includeEuler: true`
- Python decoder updated to read Euler angles based on HAS_EULER flag

### Technical Details
- Euler angles are stored as 3 float32 values (roll, pitch, yaw) in degrees
- Data comes from BNO055's built-in sensor fusion (quaternion → Euler conversion)
- Record format flag: `HAS_EULER = 1 << 4` (0x10)
- Record size with Euler: 40 bytes (timestamp + accel + gyro) + optional fields

## [0.2.0] - 2025-10-31

### Added
- **VTXStreamEncoder**: New streaming encoder for incremental writes without memory accumulation
- Comprehensive test suite with 32 tests covering encoder, decoder, and streaming functionality
- `WriteCallback` type for custom write implementations
- Jest test configuration and test scripts
- Tests for VTXEncoder, VTXDecoder, and VTXStreamEncoder

### Changed
- Package now includes proper test coverage
- Improved error messages in decoder

### Fixed
- Memory issues with long recordings by introducing streaming encoder
- Prevents app hanging/thrashing with large datasets

## [0.1.0] - 2025-10-28

### Added
- Initial implementation of VTX encoder and decoder
- TypeScript support with full type definitions
- Support for VTX format v1.0 specification
- VTXEncoder class for creating .vtx files
- VTXDecoder class for reading .vtx files
- Minimal record format (accel + gyro, 28 bytes)
- Full record format (accel + gyro + mag + quat, 56 bytes)
- JSON metadata section support
- Random access to records by index
- Efficient binary parsing with DataView
- Convenience functions: decodeVTX, readVTXHeader, readVTXMetadata
- Complete API documentation in README
- TypeScript compilation configuration

### Features
- 60-70% file size reduction compared to CSV
- Binary format with little-endian byte order
- Extensible metadata with device info, session info, calibration
- Version field for backward compatibility
- Record format bitmask for flexible sensor configurations
- Support for both Node.js and React Native environments
