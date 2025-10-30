# React Native Skia Compatibility Issue

**Date**: October 30, 2025
**Status**: ❌ Critical Incompatibility - Both Versions Broken

---

## Problem Summary

Experiencing critical rendering issues with React Native Skia visualization components:

### Symptoms
- **3D visualization frozen** - Doesn't update when sensor data changes
- **Charts not updating** - Switching between accel/gyro/mag shows stale/corrupted data
- **App crashes** - Intermittent crashes in both dev and production builds
- **EGL errors** - Native OpenGL context errors in logcat

### Error Logs
```
EGL Error: Bad Access (12290) in react-native-skia/android/cpp/rnskia-android/gl/Context.h:33
EGL Error: Bad Surface (12301) in react-native-skia/android/cpp/rnskia-android/gl/Surface.h:27
updateAndRelease() failed. The exception above can safely be ignored
```

**Frequency**: Errors appear constantly during navigation and screen updates

---

## Root Cause Analysis

### Technical Issue
The problem is in **React Native Skia**, not React Native core:

1. **EGL Threading Violations**: Skia is accessing OpenGL contexts from wrong threads
2. **Surface Lifecycle Bugs**: Surfaces being destroyed/recreated improperly during navigation
3. **Version Incompatibility**: Skia 2.3.8 may have threading model mismatch with RN 0.82.1

### Affected Code
- `@shopify/react-native-skia` v2.3.8
- Components: `SkiaLineChart.tsx`, `Skia3DBike.tsx`
- Native layer: EGL/OpenGL surface management

---

## Current Environment

```json
{
  "react-native": "0.82.1",
  "@shopify/react-native-skia": "2.3.8",
  "platform": "Android",
  "buildType": "Debug & Release (both affected)"
}
```

**React Native 0.82.1 Status**: Latest stable release (tagged as `latest` on npm)

---

## Solutions Attempted

### ✅ Code-Level Fixes (Completed)
1. **Added data dependencies to useMemo** - Force path recreation when data changes
2. **Added debug logging** - Track when components re-render
3. **Added error boundaries** - Prevent complete app crashes
4. **Added `mode="continuous"`** - Ensure Canvas refreshes properly
5. **Added input validation** - Prevent NaN/undefined values

**Result**: Didn't fix native EGL errors

### ❌ Library Downgrade (Failed)
**Action**: Attempted downgrade `@shopify/react-native-skia` from 2.3.8 → 1.3.13

**Rationale**:
- Version 1.3.13 is known to work well with RN 0.74-0.76
- May have better compatibility with RN 0.82.1's architecture
- Avoids newer threading changes that may cause EGL issues

**Result**: Failed - Skia 1.3.13 expects old RN architecture

### ❌ Restore 2.3.8 (Also Failed)
**Action**: Reverted to Skia 2.3.8 after 1.3.13 failure

**Result**: Build now fails with CMake errors:
```
CMake Error: Target "rnskia" links to target "ReactAndroid::react_nativemodule_core"
but the target was not found.
```

**Root Cause**: Skia 2.3.8 CMakeLists.txt references `ReactAndroid::` prefab targets that RN 0.82.1 doesn't provide. The new architecture may have changed how these targets are exposed.

---

## Options Going Forward

### Option 1: Downgrade React Native to 0.76.9 (NOW REQUIRED)
**Pros:**
- ✅ 0.76-stable is battle-tested
- ✅ Known compatibility with Skia ecosystem
- ✅ May fix other potential issues

**Cons:**
- ❌ Major downgrade effort
- ❌ Lose any RN 0.82 features/fixes
- ❌ Need to test entire app
- ❌ Potential dependency conflicts

**Current Status**: Only viable option - RN 0.82.1 is incompatible with Skia ecosystem

**Next Steps:**
1. Check if build was working before version changes
2. If yes: Full RN downgrade from 0.82.1 to 0.76.9
3. If no: Investigate what broke the working build

---

### Option 2: Try Intermediate Skia Versions
**Action**: Test versions between 1.3.13 and 2.3.8 to find compatible version

**Rationale**:
- Maybe there's a version that supports RN 0.82.1's new architecture
- Skia 2.x might have early releases compatible with new RN

**Risk**: Time-consuming, may not exist

---

### Option 3: Contribute to React Native Skia (Long-term)
**Repository**: https://github.com/Shopify/react-native-skia
**License**: MIT
**Stars**: 11k+ (very active)

**Contribution Options:**

**A. File Bug Report** (Easiest, High Impact)
```
Title: EGL errors with RN 0.82.1: Bad Access/Bad Surface during navigation
Priority: High (affects rendering stability)
Reproducible: Yes
Impact: Production apps crashing
```

**What to Include:**
- Our detailed error logs
- Reproduction steps (navigation between screens)
- RN version (0.82.1)
- Skia version (2.3.8)
- Workaround (downgrade to 1.3.13)

**B. Submit Fix PR** (Advanced)
```
Steps:
1. Compare Skia 1.3.13 vs 2.3.8 EGL handling
2. Identify threading/lifecycle changes
3. Propose fix for RN 0.82.1 compatibility
4. Add test cases
```

**C. Documentation PR** (Medium)
```
Add to Skia docs:
- Compatibility matrix (RN versions → Skia versions)
- Known issues section
- Workarounds for EGL errors
```

**Why Good First Contribution:**
- ✅ Professional maintainers (Shopify)
- ✅ Active community support
- ✅ Clear contribution guidelines
- ✅ Real impact on users
- ✅ We have reproducible test case

---

## Decision Matrix

| Scenario | Recommended Action |
|----------|-------------------|
| **Build was working before** | ✅ Restore from git, investigate what changed |
| **Build never worked on RN 0.82.1** | ⚠️ Downgrade to RN 0.76.9 + Skia 2.x |
| **Want to contribute to OSS** | 🎯 File RN 0.82.1 incompatibility issue with Skia |
| **Need stable NOW** | 🚀 Downgrade to RN 0.76.9 (known stable) |

---

## Critical Discovery

**RN 0.82.1 is incompatible with React Native Skia ecosystem:**
- Skia 1.3.13: Expects old RN architecture (< 0.71 patterns)
- Skia 2.3.8: References `ReactAndroid::` prefab targets RN 0.82.1 doesn't provide
- RN 0.82.1 may have changed native module build system in a way Skia doesn't support

**Action Required**: Either restore working state from git OR downgrade React Native to 0.76.9

---

## Testing Checklist (After Build Completes)

**3D Visualization:**
- [ ] Bike renders correctly
- [ ] Updates in real-time when device moves
- [ ] Zero functionality works
- [ ] No frozen/stuck visualization
- [ ] Camera angles work (elevation/rotation)

**Charts:**
- [ ] Switching between accel/gyro/mag updates correctly
- [ ] No corrupted/garbled lines
- [ ] Smooth rendering at 60fps
- [ ] All three axes (X/Y/Z) display properly
- [ ] Curved lines render correctly

**Stability:**
- [ ] No app crashes during navigation
- [ ] No EGL errors in logcat
- [ ] Production build works
- [ ] Hot reload works in dev
- [ ] Memory usage acceptable

**Logcat:**
- [ ] Check for `EGL Error: Bad Access` (should be gone)
- [ ] Check for `updateAndRelease() failed` (should be gone)
- [ ] Verify debug logs show proper updates

---

## References

- **React Native Skia**: https://github.com/Shopify/react-native-skia
- **React Native**: https://github.com/facebook/react-native
- **Our Visualization Docs**: `docs/features/VISUALIZATION_SYSTEM.md`
- **Skia Version Used**: Downgraded from 2.3.8 to 1.3.13

---

**Last Updated**: October 30, 2025
**Next Action**: Validate build and test with Skia 1.3.13
