# Changelog

All notable changes to the VTX format specification will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.0] - 2026-09-05

### Added
- **Clock sync stream (format v1.2)** — a trailing section of 24-byte records
  capturing an NTP-style four-timestamp exchange between the device and the
  phone, sampled every 60s during recording. Recorded as data; never applied
  as an on-device correction.
- Header bytes 58-63 claimed: `sync_data_offset` (uint32 @ 58),
  `sync_record_count` (uint16 @ 62). Header size unchanged at 64 bytes.
- Spec: `spec/v1.2-clock-sync.md`.

### Notes
- Backward compatible: pre-v1.2 files parse unchanged (verified against all
  42 recordings in `analysis/data/sample-recordings/`), and v1.2 files remain
  readable by parsers that ignore the sync section.
- **The 64-byte header's reserved region is now fully consumed.** A future
  stream cannot be added the same way; it will need a section table or a v2.0
  header.

## [0.2.0] - unreleased

### Added
- GPS record stream (format v1.1) — header fields at offsets 46-57, 44-byte
  trailing records. Declared in the parsers but not yet emitted by any
  firmware; every sample recording carries `gps_record_count = 0`.

## [0.1.0] - 2025-10-28

### Added
- Initial VTX format specification v1.0
- 64-byte fixed header with magic bytes, version, timestamps
- Variable-length JSON metadata section
- Fixed-size binary data records (28-56 bytes)
- Optional 32-byte footer with checksums
- JSON schema for metadata validation
- Complete documentation and examples
