# Dead Code Detection Guide

A systematic approach to finding and removing unused code, variables, and dead code patterns in the Vertex codebase.

## Overview

Dead code increases maintenance burden, reduces code clarity, and can mislead developers. This guide provides multiple detection strategies, from automated tools to manual review patterns.

## Detection Methods

### 1. **Automated Tooling (Primary)**

#### A. ESLint Unused Variables
**Status**: ✅ Already configured for Android

The project uses `@typescript-eslint/no-unused-vars` which should catch most unused variables.

**How to use:**
```bash
# Run ESLint on Android source
npx eslint android/src

# Get JSON output for programmatic analysis
npx eslint --format json android/src

# Only show errors (suppress warnings)
npx eslint android/src --quiet
```

**Why it might miss issues:**
- Variables assigned but never read (like `displayData` we just found)
- Variables used in conditional branches that are never reached
- Variables created in closures but the closure itself is never called

#### B. Custom Detection Script
**Location**: `scripts/find-dead-code.js`

A custom script that finds:
- Variables with suspicious names (`display`, `temp`, `unused`, etc.)
- Large commented-out code blocks
- ESLint results aggregated

**Usage:**
```bash
node scripts/find-dead-code.js
```

### 2. **Manual Review Patterns**

#### A. Code Review Checklist
When reviewing code, look for:

1. **Variable Declarations**
   - Variables declared but only assigned, never read
   - Variables with clearly suspicious names: `temp`, `tmp`, `unused`, `old`, `deprecated`
   - Variables set in conditionals that are never used after

2. **Import Statements**
   - Unused imports (TypeScript/ESLint should catch most)
   - Imports from deprecated modules

3. **Function Definitions**
   - Private functions never called
   - Callback functions passed but handlers never invoked
   - Utility functions defined but not exported/used

4. **Commented Code**
   - Large blocks of commented code (>5 lines)
   - Commented code with TODO/FIXME that's obsolete

5. **State Management**
   - State variables set but never read
   - Redux/Zustand actions dispatched but never handled
   - Store values updated but never consumed by UI

#### B. Suspicious Code Patterns

**Pattern 1: Variables Created But Never Used**
```typescript
// 🚩 Suspicious - variable created but never used
let displayData = data;
if (condition) {
  displayData = transform(data);
}
// If displayData is never referenced after this block, it's dead code
// Note: "displayData" itself isn't suspicious - it's the non-usage that matters
```

**Pattern 2: Conditional Assignment Without Usage**
```typescript
// 🚩 Suspicious - assigned but never read
const processedData = condition ? transform(data) : data;
// If processedData isn't used, remove it
```

**Pattern 3: Commented Out Code Blocks**
```typescript
// 🚩 Suspicious - large commented blocks
/*
const oldFunction = () => {
  // 20 lines of code
};
*/
```

**Pattern 4: Unused Callback Results**
```typescript
// 🚩 Suspicious - callback returns value but it's ignored
streamSubscriptionRef.current = await BleService.subscribeToIMUStream(
  (data) => {
    const processed = process(data); // Never used
    doSomething(processed); // If doSomething doesn't use it
  }
);
```

### 3. **IDE-Based Detection**

#### VS Code / Cursor
- Grayed out variables indicate unused
- TypeScript compiler highlights unused variables
- Extension: "TypeScript Importer" shows unused imports

#### JetBrains IDEs
- Built-in unused code detection
- "Code → Inspect Code" to find unused declarations

### 4. **Build-Time Checks**

#### TypeScript Compiler
```bash
# Enable strict unused variable checking
# Already enabled in tsconfig.json: "strict": true

# Check specific files
npx tsc --noEmit android/src/screens/RecordScreen.tsx
```

#### CI/CD Integration
Add to build pipeline:
```bash
# Fail build on unused variables
npx eslint android/src --max-warnings 0

# Or use exit codes
npx eslint android/src --quiet && echo "No unused variables"
```

## Common Dead Code Scenarios

### Scenario 1: Refactored Display Logic
**Example**: The `displayData` case we just fixed
- **Symptom**: Variable created with zero offset applied but never used
- **Cause**: UI logic moved to separate service/component
- **Detection**: Variable name contains "display", assigned but never read
- **Fix**: Remove unused computation, keep only what's needed

### Scenario 2: Legacy Functionality
- Commented-out code from deprecated features
- Functions that were replaced but not removed
- Configuration options that are no longer used

### Scenario 3: Debug/Development Code
- Console logs left in production
- Debug state variables
- Test data generation code

### Scenario 4: Conditional Paths
- Code in `if (false)` blocks
- Feature flags that are always disabled
- Platform-specific code for unused platforms

## Systematic Search Approach

### Step 1: Run Automated Tools
```bash
# 1. ESLint check
npx eslint android/src --format json > lint-report.json

# 2. Custom script
node scripts/find-dead-code.js

# 3. TypeScript compiler check
npx tsc --noEmit
```

### Step 2: Pattern-Based Search
```bash
# Search for suspicious variable names
grep -r "let display\|const display\|var display" android/src
grep -r "let temp\|const temp\|var temp" android/src
grep -r "let unused\|const unused" android/src

# Search for large comment blocks
grep -r "/\*" android/src | wc -l  # Count comment blocks
```

### Step 3: Code Review
1. Review files flagged by tools
2. Check for variables assigned in streams/callbacks
3. Look for variables with postfixes like `Data`, `Display`, `Processed`
4. Review recently refactored code areas

### Step 4: Verify Removal Safety
Before removing:
1. ✅ Check git history - when was it last used?
2. ✅ Search codebase for references (include similar names)
3. ✅ Check if it's part of a planned feature (look for TODOs)
4. ✅ Verify it's not used indirectly (via dynamic calls, string matching, etc.)

## Best Practices

### 1. Prevention
- Run ESLint in CI/CD before merging PRs
- Enable pre-commit hooks to check for unused variables
- Use `_` prefix for intentionally unused variables:
  ```typescript
  const _unusedVar = something; // ESLint ignores vars starting with _
  ```

### 2. When to Remove
- ✅ Remove immediately if:
  - Clearly unused and no references found
  - Part of deprecated feature
  - Makes code confusing or misleading
  
- ⚠️ Be cautious if:
  - Variable might be used dynamically
  - Part of incomplete refactor (check with team)
  - Related to active bug reports

### 3. Documentation
- Document why code was removed (link to issue/PR)
- Keep commit messages descriptive
- Update related documentation if behavior changes

## Quick Reference

**Find unused variables in current file:**
- Use IDE inspection (grayed out in VS Code/Cursor)
- Run: `npx eslint <file>`

**Find all unused variables:**
- Run: `node scripts/find-dead-code.js`
- Or: `npx eslint android/src --format json`

**Check for clearly suspicious variables:**
```bash
# Search for variables with clearly suspicious names (not "display" or "Data")
grep -rn "temp\|tmp\|unused\|_unused\|unused_" android/src
```

**Verify removal is safe:**
```bash
# Search for any references
grep -rn "<variable-name>" android/src web/src
git log -S "<variable-name>" --all
```

## Integration with Development Workflow

### Pre-Commit Hook (Recommended)
Create `.git/hooks/pre-commit`:
```bash
#!/bin/sh
# Check for unused variables before commit
npx eslint --quiet android/src || exit 1
```

### Regular Cleanup
- Schedule periodic dead code reviews (e.g., monthly)
- Include dead code check in PR review checklist
- Use `find-dead-code.js` script before major releases

## Notes

- **False Positives**: Some tools may flag legitimate code (e.g., variables used in closures, dynamic access). Always verify manually.
- **Performance**: Removing dead code improves bundle size and can improve tree-shaking in production builds.
- **Maintenance**: Less code = easier to understand and maintain.

