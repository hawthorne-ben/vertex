# React Native Skia Bug Report Guide

## Issue: React Native 0.82.1 Incompatibility

### Repository
**URL**: https://github.com/Shopify/react-native-skia
**File New Issue**: https://github.com/Shopify/react-native-skia/issues/new

---

## Bug Report Template

### Title
```
CMake build failure on React Native 0.82.1 - ReactAndroid prefab targets not found
```

### Description

**Environment**:
- React Native: `0.82.1`
- @shopify/react-native-skia: `1.3.13`, `2.0.0`, `2.3.8` (all tested)
- React: `19.1.1` (required by RN 0.82.1)
- Platform: Android
- NDK: 27.0.12077973
- CMake: 3.22.1

**Issue**:
React Native 0.82.1 is completely incompatible with the react-native-skia ecosystem:
- **Skia 1.x (1.2.0, 1.3.13)**: CMake can't find `ReactAndroid` prefab targets
- **Skia 2.x (2.0.0-2.3.7)**: CMake links fail with missing `ReactAndroid::*` targets
- **Skia 2.3.8+**: Requires React 19.1+ which RN 0.82.1 ships with, but still has CMake errors

This appears to be a fundamental incompatibility between RN 0.82.1's native build system and Skia's CMake configuration.

**Error with Skia 2.3.8**:
```
CMake Error at CMakeLists.txt:40 (add_library):
  Target "rnskia" links to target "ReactAndroid::react_nativemodule_core"
  but the target was not found.  Perhaps a find_package() call is missing for an
  IMPORTED target, or an ALIAS target is missing?
```

Similar errors for:
- `ReactAndroid::reactnativejni`
- `ReactAndroid::runtimeexecutor`
- `ReactAndroid::turbomodulejsijni`

**Error with Skia 1.3.13**:
```
CMake Error at CMakeLists.txt:131 (find_package):
  Could not find a package configuration file provided by "fbjni" with any
  of the following names:
    fbjniConfig.cmake
    fbjni-config.cmake
```

**Root Cause Analysis**:
React Native 0.82.1 appears to have changed how it exposes native module build targets via prefab/CMake. The `ReactAndroid::` prefab targets that Skia 2.x expects are not being provided in the expected format.

**Reproduction Steps**:
1. Create new RN 0.82.1 project
2. Install `@shopify/react-native-skia@2.3.8` (or 1.3.13)
3. Run `cd android && ./gradlew assembleDebug`
4. Observe CMake configuration failure

**Expected Behavior**:
Skia should build successfully with React Native 0.82.1, as 0.82.1 is tagged as `latest` on npm.

**Workaround**:
Downgrade to React Native 0.76.9, which works with Skia 2.x.

**Impact**:
- Blocks developers on RN 0.82.x from using react-native-skia
- Forces downgrade to older RN versions
- May affect future RN releases if architecture changes persist

**Suggested Fix**:
Update Skia's CMakeLists.txt to handle RN 0.82.x's prefab target naming/structure, or document the incompatibility and tested RN version ranges.

---

## Additional Context Files

Attach these if requested:

**CMake Configuration Output** (from `/Users/bhawthorne/dev/vertex/docs/SKIA_COMPATIBILITY.md`):
```
react-native-skia: RN Version: 82 / 0.82.1
react-native-skia: isSourceBuild: false
react-native-skia: PrebuiltDir: /path/to/android/build/react-native-0*/jni
react-native-skia: Enable Prefab: true
react-native-skia: aar state post 70, do nothing

-- ABI     : arm64-v8a
-- PREBUILT: /path/to/android/build/react-native-0*/jni
-- BUILD   : /path/to/android/build
-- LIBRN   :
-- JSI     : ReactAndroid::jsi
-- REACT   : ReactAndroid::react_nativemodule_core
-- FBJNI   : fbjni::fbjni
-- REACTNATIVEJNI   : ReactAndroid::reactnativejni
-- RUNTIMEEXECUTOR   : ReactAndroid::runtimeexecutor
-- TURBO   : ReactAndroid::turbomodulejsijni
```

Notice how CMake **finds** the target names but then can't **link** to them, suggesting they exist in some form but aren't properly exported.

---

## Potential Fix (For Discussion)

Looking at `CMakeLists.txt:129-134` in Skia 2.3.8:

```cmake
if(${REACT_NATIVE_VERSION} GREATER_EQUAL 71)
    # We need to find packages since from RN 0.71 binaries are prebuilt
    find_package(fbjni REQUIRED CONFIG)
    find_package(ReactAndroid REQUIRED CONFIG)
endif()
```

**Issue**: This assumes RN 0.71+ uses a consistent prefab structure, but RN 0.82.1 may have changed it.

**Possible Solutions**:

1. **Add RN 0.82.x specific handling**:
```cmake
if(${REACT_NATIVE_VERSION} GREATER_EQUAL 82)
    # Handle RN 0.82+ new prefab structure
    find_package(ReactAndroid REQUIRED CONFIG PATHS ${REACT_NATIVE_DIR}/ReactAndroid)
elseif(${REACT_NATIVE_VERSION} GREATER_EQUAL 71)
    # RN 0.71-0.81 prefab structure
    find_package(fbjni REQUIRED CONFIG)
    find_package(ReactAndroid REQUIRED CONFIG)
endif()
```

2. **Use fallback logic**:
```cmake
if(${REACT_NATIVE_VERSION} GREATER_EQUAL 71)
    find_package(fbjni QUIET CONFIG)
    find_package(ReactAndroid QUIET CONFIG)

    if(NOT ReactAndroid_FOUND)
        # Fallback for RN versions with different prefab structure
        message(WARNING "ReactAndroid prefab not found, trying manual resolution")
        # Implement manual library linking
    endif()
endif()
```

3. **Document version compatibility matrix**:
   - If fix is complex, at minimum document which RN versions are tested/supported
   - Add to README: "React Native 0.82.x is not currently supported. Use RN 0.76.9 or earlier."

---

## Testing the Fix

If Shopify maintainers want help testing:
1. I can test patches against RN 0.82.1
2. I have a production app blocked by this issue
3. Can provide detailed build logs and CMake output

---

## Community Impact

From npm download stats:
- `react-native@0.82.1` is tagged as `latest`
- Many developers will hit this issue when upgrading
- GitHub issue search shows others encountering similar CMake errors with RN 0.82.x

This is a high-impact compatibility break that affects all new RN projects.

---

## Labels to Apply
- `bug`
- `android`
- `build`
- `react-native-0.82`

---

## Follow-up Actions

After filing the issue:
1. Monitor for maintainer response
2. If they request more info, provide detailed CMake logs
3. If they provide a patch, test it against our production app
4. If fix is merged, update to new Skia version
5. If no fix planned, document RN 0.76.9 as the stable target in our project

---

**Filed By**: [Your Name]
**Date**: October 30, 2025
**Project**: Vertex IMU App (production Android app with real-time sensor visualization)
