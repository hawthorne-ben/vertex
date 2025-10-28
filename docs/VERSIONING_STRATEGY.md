# Vertex Monorepo Versioning Strategy

## Overview

This document defines how we manage independent versioning for different components in the Vertex monorepo while maintaining compatibility and traceability.

---

## Components Requiring Independent Versioning

### 1. VTX File Format Specification
- **Versioned**: Format specification itself
- **Semantic**: Major.Minor (e.g., `1.0`, `2.0`)
- **Breaking changes**: Major version bump
- **Scope**: File structure, binary layout, metadata schema

### 2. Firmware (ESP32)
- **Versioned**: Firmware binary and features
- **Semantic**: Major.Minor.Patch (e.g., `1.2.3`)
- **Breaking changes**: BLE protocol changes, data format changes
- **Scope**: Sensor reading, BLE communication, power management

### 3. Android App
- **Versioned**: App releases
- **Semantic**: Major.Minor.Patch (e.g., `2.1.0`)
- **Breaking changes**: Incompatible file format, removed features
- **Scope**: UI, BLE client, file management, recording

### 4. Web App
- **Versioned**: Web platform releases
- **Semantic**: Major.Minor.Patch (e.g., `1.5.2`)
- **Breaking changes**: API changes, removed features
- **Scope**: Data visualization, user management, ride analysis

---

## Monorepo Structure for Versioning

```
vertex/
├── packages/
│   ├── vtx-format/                 # VTX Format Specification Package
│   │   ├── package.json            # version: "1.0.0"
│   │   ├── CHANGELOG.md
│   │   ├── spec/
│   │   │   └── v1.0.md             # Current spec version
│   │   ├── schema/
│   │   │   └── vtx-v1.schema.json  # JSON schema for metadata
│   │   └── README.md
│   │
│   ├── vtx-parser/                 # Shared VTX Parser Library
│   │   ├── package.json            # version: "1.0.0"
│   │   ├── src/
│   │   │   ├── parser.ts           # Core parser
│   │   │   ├── encoder.ts          # Core encoder
│   │   │   └── types.ts            # TypeScript types
│   │   └── test/
│   │
│   └── vtx-constants/              # Shared Constants
│       ├── package.json            # version: "1.0.0"
│       └── src/
│           └── constants.ts        # Format constants, magic bytes, etc.
│
├── firmware/
│   ├── VERSION                     # Plain text: "1.2.3"
│   ├── CHANGELOG.md
│   ├── platformio.ini              # build_flags = -DFIRMWARE_VERSION=\"1.2.3\"
│   └── src/
│       └── main.cpp                # Uses FIRMWARE_VERSION constant
│
├── android/vertex/
│   ├── package.json                # version: "2.1.0"
│   ├── CHANGELOG.md
│   ├── android/
│   │   └── app/build.gradle        # versionName "2.1.0"
│   └── src/
│       └── services/
│           ├── VTXEncoder.ts       # Uses vtx-constants
│           └── VTXParser.ts        # Uses vtx-parser
│
├── web/
│   ├── package.json                # version: "1.5.2"
│   ├── CHANGELOG.md
│   └── src/
│       └── lib/
│           └── vtx-parser.ts       # Uses vtx-parser package
│
├── lerna.json                      # Multi-package versioning
├── package.json                    # Root package
└── VERSIONING_STRATEGY.md          # This file
```

---

## Versioning Implementation

### 1. VTX Format Versioning

**Package Structure:**
```json
// packages/vtx-format/package.json
{
  "name": "@vertex/vtx-format",
  "version": "1.0.0",
  "description": "VTX binary format specification",
  "main": "spec/v1.0.md",
  "files": [
    "spec/",
    "schema/",
    "README.md",
    "CHANGELOG.md"
  ]
}
```

**Version in Binary Header:**
```typescript
// packages/vtx-constants/src/constants.ts
export const VTX_FORMAT = {
  MAGIC: 'VTX\0',
  VERSION_MAJOR: 1,
  VERSION_MINOR: 0,
  HEADER_SIZE: 64,
} as const;
```

**Git Tags:**
```bash
# Format spec releases
git tag vtx-format/v1.0.0
git tag vtx-format/v1.1.0
git tag vtx-format/v2.0.0

# Push tags
git push origin vtx-format/v1.0.0
```

**Changelog:**
```markdown
# VTX Format Changelog

## [1.1.0] - 2025-11-15
### Added
- Compression support (zstd)
- Index section for fast seeking

### Changed
- Metadata schema now supports custom fields

## [1.0.0] - 2025-10-28
### Added
- Initial VTX format specification
- Binary header with magic bytes
- JSON metadata section
- Fixed-size data records
```

---

### 2. Firmware Versioning

**Version File:**
```
# firmware/VERSION
1.2.3
```

**PlatformIO Integration:**
```ini
# firmware/platformio.ini
[common]
build_flags =
    -DFIRMWARE_VERSION=\"1.2.3\"
    -DVTX_FORMAT_MAJOR=1
    -DVTX_FORMAT_MINOR=0

[env:esp32]
platform = espressif32
board = esp32dev
framework = arduino
build_flags = ${common.build_flags}
```

**Firmware Code:**
```cpp
// firmware/src/main.cpp
#ifndef FIRMWARE_VERSION
#define FIRMWARE_VERSION "0.0.0"
#endif

void setup() {
    Serial.begin(115200);
    Serial.printf("Vertex IMU Firmware v%s\n", FIRMWARE_VERSION);
    Serial.printf("VTX Format: v%d.%d\n", VTX_FORMAT_MAJOR, VTX_FORMAT_MINOR);
}

// Include version in BLE device info characteristic
void sendDeviceInfo() {
    DeviceInfo info;
    strcpy(info.firmware_version, FIRMWARE_VERSION);
    info.vtx_format_major = VTX_FORMAT_MAJOR;
    info.vtx_format_minor = VTX_FORMAT_MINOR;
    // Send via BLE...
}
```

**Git Tags:**
```bash
# Firmware releases
git tag firmware/v1.2.3
git tag firmware/v1.2.4
git tag firmware/v1.3.0

# Push tags
git push origin firmware/v1.2.3
```

**Changelog:**
```markdown
# Firmware Changelog

## [1.2.3] - 2025-10-30
### Fixed
- Battery voltage reading accuracy improved
- Reduced BLE connection drops

### Changed
- Sample rate increased to 50Hz (was 10Hz)

## [1.2.2] - 2025-10-28
### Added
- VTX format v1.0 support in metadata
- Device ID in BLE advertising

## [1.2.1] - 2025-10-25
### Fixed
- Memory leak in BLE notification handler
```

---

### 3. Android App Versioning

**package.json:**
```json
// android/vertex/package.json
{
  "name": "vertex-android",
  "version": "2.1.0",
  "dependencies": {
    "@vertex/vtx-parser": "^1.0.0",
    "@vertex/vtx-constants": "^1.0.0"
  }
}
```

**Gradle (Android Build):**
```gradle
// android/vertex/android/app/build.gradle
android {
    defaultConfig {
        applicationId "com.vertex.app"
        versionCode 21  // Increment for each release
        versionName "2.1.0"  // Semantic version

        // Include VTX format version
        buildConfigField "int", "VTX_FORMAT_MAJOR", "1"
        buildConfigField "int", "VTX_FORMAT_MINOR", "0"
    }
}
```

**App Code:**
```typescript
// android/vertex/src/services/VTXEncoder.ts
import { VTX_FORMAT } from '@vertex/vtx-constants';

export class VTXEncoder {
  private writeHeader() {
    // Write VTX format version from constants package
    this.buffer.writeUInt16LE(VTX_FORMAT.VERSION_MAJOR, 4);
    this.buffer.writeUInt16LE(VTX_FORMAT.VERSION_MINOR, 6);
  }
}
```

**Git Tags:**
```bash
# App releases
git tag android/v2.1.0
git tag android/v2.1.1
git tag android/v2.2.0

# Push tags
git push origin android/v2.1.0
```

---

### 4. Web App Versioning

**package.json:**
```json
// web/package.json
{
  "name": "vertex-web",
  "version": "1.5.2",
  "dependencies": {
    "@vertex/vtx-parser": "^1.0.0",
    "@vertex/vtx-constants": "^1.0.0"
  }
}
```

**Git Tags:**
```bash
# Web app releases
git tag web/v1.5.2
git tag web/v1.5.3
git tag web/v1.6.0

# Push tags
git push origin web/v1.5.2
```

---

## Monorepo Tooling

### Option 1: Lerna (Recommended)

**Setup:**
```json
// lerna.json
{
  "version": "independent",
  "packages": [
    "packages/*",
    "firmware",
    "android/vertex",
    "web"
  ],
  "command": {
    "version": {
      "allowBranch": "main",
      "message": "chore(release): publish %s"
    }
  }
}
```

**Root package.json:**
```json
{
  "name": "vertex-monorepo",
  "private": true,
  "workspaces": [
    "packages/*",
    "android/vertex",
    "web"
  ],
  "devDependencies": {
    "lerna": "^8.0.0"
  },
  "scripts": {
    "version:vtx-format": "lerna version --scope @vertex/vtx-format",
    "version:android": "lerna version --scope vertex-android",
    "version:web": "lerna version --scope vertex-web",
    "publish:packages": "lerna publish from-package"
  }
}
```

**Usage:**
```bash
# Version a specific package
npm run version:vtx-format

# Or use lerna directly
lerna version --scope @vertex/vtx-format

# Lerna will:
# 1. Prompt for new version
# 2. Update package.json
# 3. Update CHANGELOG.md (with conventional commits)
# 4. Create git tag
# 5. Push changes
```

### Option 2: Manual Versioning with Scripts

**Version Script:**
```bash
#!/bin/bash
# scripts/version.sh

COMPONENT=$1
VERSION=$2

if [ -z "$COMPONENT" ] || [ -z "$VERSION" ]; then
    echo "Usage: ./scripts/version.sh <component> <version>"
    echo "Components: vtx-format, firmware, android, web"
    exit 1
fi

case $COMPONENT in
    vtx-format)
        cd packages/vtx-format
        npm version $VERSION
        git tag "vtx-format/v$VERSION"
        ;;
    firmware)
        echo $VERSION > firmware/VERSION
        # Update platformio.ini
        sed -i '' "s/FIRMWARE_VERSION=\\\".*\\\"/FIRMWARE_VERSION=\\\"$VERSION\\\"/" firmware/platformio.ini
        git add firmware/VERSION firmware/platformio.ini
        git commit -m "chore(firmware): bump version to $VERSION"
        git tag "firmware/v$VERSION"
        ;;
    android)
        cd android/vertex
        npm version $VERSION
        # Update build.gradle
        git tag "android/v$VERSION"
        ;;
    web)
        cd web
        npm version $VERSION
        git tag "web/v$VERSION"
        ;;
    *)
        echo "Unknown component: $COMPONENT"
        exit 1
        ;;
esac

echo "✓ Versioned $COMPONENT to $VERSION"
echo "Run 'git push --follow-tags' to push changes and tags"
```

**Usage:**
```bash
# Version different components
./scripts/version.sh vtx-format 1.1.0
./scripts/version.sh firmware 1.2.4
./scripts/version.sh android 2.1.1
./scripts/version.sh web 1.5.3

# Push all changes and tags
git push --follow-tags
```

---

## Version Compatibility Matrix

Maintain compatibility documentation showing which versions work together:

```markdown
# Version Compatibility Matrix

| VTX Format | Firmware    | Android App | Web App     | Notes                          |
|------------|-------------|-------------|-------------|--------------------------------|
| 1.0.x      | 1.2.x       | 2.0.x       | 1.4.x       | Initial stable release         |
| 1.0.x      | 1.2.x       | 2.1.x       | 1.5.x       | Current stable                 |
| 1.1.x      | 1.3.x       | 2.2.x       | 1.6.x       | Adds compression support       |
| 2.0.x      | 2.0.x       | 3.0.x       | 2.0.x       | Breaking: new record format    |

## Version Requirements

### VTX Format 1.0.x
- **Firmware**: Minimum 1.2.0
- **Android**: Minimum 2.0.0
- **Web**: Minimum 1.4.0

### VTX Format 1.1.x
- **Firmware**: Minimum 1.3.0 (compression support)
- **Android**: Minimum 2.2.0
- **Web**: Minimum 1.6.0

## Backward Compatibility

- **Format 1.x readers** can read all 1.x files (forward compatible)
- **Format 1.x writers** should write 1.0 by default for compatibility
- **Format 2.0** is NOT backward compatible with 1.x readers
```

---

## Release Process

### 1. VTX Format Release

```bash
# 1. Update spec in packages/vtx-format/spec/
vim packages/vtx-format/spec/v1.1.md

# 2. Update constants
vim packages/vtx-constants/src/constants.ts
# Change: VERSION_MINOR: 1

# 3. Update changelog
vim packages/vtx-format/CHANGELOG.md

# 4. Version and tag
cd packages/vtx-format
npm version minor  # 1.0.0 -> 1.1.0
cd ../../packages/vtx-constants
npm version minor

# 5. Commit and push
git push --follow-tags
```

### 2. Firmware Release

```bash
# 1. Update VERSION file
echo "1.2.4" > firmware/VERSION

# 2. Update platformio.ini
vim firmware/platformio.ini
# Change: -DFIRMWARE_VERSION=\"1.2.4\"

# 3. Update changelog
vim firmware/CHANGELOG.md

# 4. Build and test
cd firmware
pio run
pio test

# 5. Commit and tag
git add VERSION platformio.ini CHANGELOG.md
git commit -m "chore(firmware): release v1.2.4"
git tag firmware/v1.2.4
git push --follow-tags
```

### 3. Android/Web Release

```bash
# 1. Ensure dependencies are up to date
cd android/vertex
npm update @vertex/vtx-parser @vertex/vtx-constants

# 2. Update changelog
vim CHANGELOG.md

# 3. Version and tag
npm version patch  # or minor, major
git push --follow-tags

# 4. Build and test
npm run android
# or
cd ../../web && npm run build
```

---

## CI/CD Integration

### GitHub Actions Example

```yaml
# .github/workflows/release.yml
name: Release

on:
  push:
    tags:
      - 'vtx-format/v*'
      - 'firmware/v*'
      - 'android/v*'
      - 'web/v*'

jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3

      - name: Detect component
        id: detect
        run: |
          TAG=${GITHUB_REF#refs/tags/}
          COMPONENT=${TAG%%/*}
          VERSION=${TAG#*/v}
          echo "component=$COMPONENT" >> $GITHUB_OUTPUT
          echo "version=$VERSION" >> $GITHUB_OUTPUT

      - name: Build firmware
        if: steps.detect.outputs.component == 'firmware'
        run: |
          cd firmware
          pio run
          # Upload binary to releases

      - name: Build Android
        if: steps.detect.outputs.component == 'android'
        run: |
          cd android/vertex
          npm install
          npm run build:android
          # Upload APK to releases

      - name: Deploy Web
        if: steps.detect.outputs.component == 'web'
        run: |
          cd web
          npm install
          npm run build
          # Deploy to Vercel

      - name: Create Release
        uses: actions/create-release@v1
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        with:
          tag_name: ${{ github.ref }}
          release_name: ${{ steps.detect.outputs.component }} v${{ steps.detect.outputs.version }}
          draft: false
          prerelease: false
```

---

## Benefits of This Approach

### 1. **Independent Evolution**
- Each component versions independently
- No forced coordination when only one component changes
- Format spec can evolve slower than implementations

### 2. **Clear Dependencies**
- Shared packages (`vtx-parser`, `vtx-constants`) prevent drift
- Version constraints in package.json ensure compatibility
- Compatibility matrix documents working combinations

### 3. **Git History Clarity**
- Namespaced tags (`firmware/v1.2.3`) keep history organized
- Easy to find all releases for a component: `git tag -l "firmware/*"`
- Changelogs per component

### 4. **Developer Experience**
- One repo to clone
- Shared tooling and scripts
- Easy to test changes across components
- Atomic commits across components when needed

### 5. **CI/CD Simplicity**
- Single CI/CD configuration
- Can trigger component-specific builds from tags
- Shared build cache across components

---

## Example Workflows

### Scenario 1: VTX Format Change

```bash
# 1. Update format spec (breaking change)
cd packages/vtx-format
# Edit spec to v2.0
vim spec/v2.0.md

# 2. Update constants
cd ../vtx-constants
vim src/constants.ts
# Change: VERSION_MAJOR: 2, VERSION_MINOR: 0

# 3. Version both packages
npm version major  # 1.0.0 -> 2.0.0

# 4. Update parser to support v2.0
cd ../vtx-parser
# Implement new parser logic
npm version major

# 5. Update Android/Web to use new format
cd ../../android/vertex
npm install @vertex/vtx-parser@^2.0.0
# Make necessary code changes
npm version major  # Breaking change for users

cd ../../web
npm install @vertex/vtx-parser@^2.0.0
npm version major

# 6. Update firmware
cd ../../firmware
echo "2.0.0" > VERSION
# Update firmware to write v2.0 format

# 7. Commit and push everything
git add .
git commit -m "feat: VTX format v2.0 with improved compression"
git push --follow-tags
```

### Scenario 2: Firmware Bug Fix (No Format Change)

```bash
# 1. Fix bug in firmware
cd firmware
# Fix bug in src/
vim src/ble_handler.cpp

# 2. Bump patch version
echo "1.2.4" > VERSION
sed -i 's/1.2.3/1.2.4/' platformio.ini

# 3. Update changelog
echo "## [1.2.4] - $(date +%Y-%m-%d)" >> CHANGELOG.md
echo "### Fixed" >> CHANGELOG.md
echo "- BLE connection stability" >> CHANGELOG.md

# 4. Commit and tag
git add .
git commit -m "fix(firmware): improve BLE connection stability"
git tag firmware/v1.2.4
git push --follow-tags

# Android/Web unchanged, no version bump needed
```

### Scenario 3: Android UI Update (No Format/Firmware Change)

```bash
# 1. Make UI changes
cd android/vertex
# Update screens
vim src/screens/DashboardScreen.tsx

# 2. Bump version
npm version minor  # 2.1.0 -> 2.2.0

# 3. Update changelog
vim CHANGELOG.md

# 4. Commit and push
git add .
git commit -m "feat(android): new dashboard layout"
git push --follow-tags

# Format/firmware unchanged
```

---

## Conclusion

**Yes, you can absolutely implement true versioning in a monorepo!**

### Key Takeaways

1. **Use namespaced git tags** (`component/vX.Y.Z`)
2. **Create shared packages** for format constants and parsers
3. **Version independently** where appropriate
4. **Document compatibility** in a matrix
5. **Use tooling** (Lerna or custom scripts) to automate

### Recommended Structure

```
vertex/
├── packages/              # Shared packages
│   ├── vtx-format/       # Format spec (versioned)
│   ├── vtx-parser/       # Shared parser (versioned)
│   └── vtx-constants/    # Shared constants (versioned)
├── firmware/             # ESP32 code (versioned)
├── android/vertex/       # Android app (versioned)
├── web/                  # Web app (versioned)
├── lerna.json            # Multi-package config
└── VERSIONING_STRATEGY.md
```

This gives you the best of both worlds: **monorepo benefits** (single source of truth, atomic commits) with **independent versioning** (components evolve at their own pace).

---

*Document Version: 1.0*
*Last Updated: 2025-10-28*
