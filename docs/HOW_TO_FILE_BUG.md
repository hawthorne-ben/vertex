# How to File the Skia Bug Report

## Step 1: Go to GitHub Issues
Visit: https://github.com/Shopify/react-native-skia/issues/new

## Step 2: Fill Out the Issue

Copy the content from `/Users/bhawthorne/dev/vertex/docs/OSS_BUG_REPORT.md` into the GitHub issue form.

### What to Include:
1. **Title**: "CMake build failure on React Native 0.82.1 - ReactAndroid prefab targets not found"
2. **Body**: The full description from OSS_BUG_REPORT.md
3. **Labels**: `bug`, `android`, `build` (if you can apply them)

## Step 3: Monitor the Issue

After filing:
- **Check notifications** for maintainer responses
- **Be responsive** if they ask for more details
- **Test any patches** they provide against our app

## Step 4: Report Back Here

Once you've filed the issue:
1. Note the issue number (e.g., #1234)
2. Update `SKIA_COMPATIBILITY.md` with the issue link
3. We'll track it for resolution

---

## Current Status: Downgrading to RN 0.76.9

While we wait for upstream fix, we're downgrading to RN 0.76.9:
- **React Native**: 0.82.1 → 0.76.9
- **React**: 19.1.1 → 18.3.1
- **Skia**: Attempting 1.2.0 (React 18 compatible)

This will allow us to continue development while the issue is being resolved upstream.

---

## Potential for Contributing a Fix

If you want to contribute a fix (after filing the issue):

### Easy Win: Documentation PR
**File**: `README.md` or `COMPATIBILITY.md`
**Change**: Add version compatibility matrix

```markdown
## React Native Compatibility

| RN Version | Skia Version | Status |
|------------|--------------|--------|
| 0.76.x     | 1.2.x - 2.3.x | ✅ Supported |
| 0.82.x     | None         | ❌ Not Supported (CMake incompatibility) |

### Known Issues
- React Native 0.82.1 changed its CMake/prefab target structure
- Skia's build system currently expects 0.76.x patterns
- Workaround: Use RN 0.76.9 until compatibility is restored
```

### Medium Complexity: CMake Fix

If maintainers are interested, propose this fix to `CMakeLists.txt`:

```cmake
# Around line 129
if(${REACT_NATIVE_VERSION} GREATER_EQUAL 82)
    # RN 0.82+ has different prefab structure
    message(STATUS "Detected RN 0.82+, using updated prefab resolution")

    # Try to find ReactAndroid with explicit paths
    find_package(fbjni QUIET CONFIG)
    find_package(ReactAndroid QUIET CONFIG
        PATHS "${NODE_MODULES_DIR}/react-native/ReactAndroid"
    )

    if(NOT ReactAndroid_FOUND)
        message(FATAL_ERROR "
            React Native 0.82.x is not currently supported.
            Please use React Native 0.76.9 or earlier.
            Track progress at: https://github.com/Shopify/react-native-skia/issues/XXXX
        ")
    endif()
elseif(${REACT_NATIVE_VERSION} GREATER_EQUAL 71)
    # RN 0.71-0.81 prefab structure
    find_package(fbjni REQUIRED CONFIG)
    find_package(ReactAndroid REQUIRED CONFIG)
endif()
```

**Testing**:
- Test against RN 0.76.9 (should still work)
- Test against RN 0.82.1 (should give clear error or work if fix is correct)
- Verify no regressions on older RN versions

---

## What Success Looks Like

### Short Term (This Week)
✅ RN 0.76.9 downgrade completes successfully
✅ Skia 1.2.0 builds without CMake errors
✅ App works with 3D viz and charts
✅ Bug report filed with react-native-skia

### Medium Term (Next Month)
✅ Skia maintainers acknowledge the issue
✅ Either:
   - CMake fix is merged for RN 0.82.x support, OR
   - Documentation updated with version compatibility matrix

### Long Term (Next Quarter)
✅ Can upgrade to latest stable RN without Skia issues
✅ Clear compatibility matrix helps other developers
✅ Our contribution helps the React Native community

---

## Questions to Ask in the Issue Thread

If maintainers respond, useful questions:

1. **"Is RN 0.82.x support planned?"**
   - If yes: When can we expect a fix?
   - If no: Should docs be updated to warn users?

2. **"Would you accept a PR for this?"**
   - If yes: What approach do you prefer (CMake fix vs. clear error message)?
   - If no: Will you handle it internally?

3. **"What's the recommended Skia version for RN 0.76.9?"**
   - Helps us lock to a stable version

4. **"Are there automated tests for RN version compatibility?"**
   - Could help prevent future breaks

---

**Filed by**: [Your Name]
**Date**: October 30, 2025
**Project**: Vertex IMU (production Android app)
**Impact**: Blocking upgrade to latest React Native
