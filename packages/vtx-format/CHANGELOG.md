# Changelog

All notable changes to the VTX format specification will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2025-10-28

### Added
- Initial VTX format specification v1.0
- 64-byte fixed header with magic bytes, version, timestamps
- Variable-length JSON metadata section
- Fixed-size binary data records (28-56 bytes)
- Optional 32-byte footer with checksums
- JSON schema for metadata validation
- Complete documentation and examples
