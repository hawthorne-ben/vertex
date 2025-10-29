# Linting & Formatting Guide

## Overview

The Vertex monorepo uses **ESLint** for code quality and **Prettier** for formatting, with **Husky** pre-commit hooks to enforce standards automatically.

---

## Stack

- **ESLint 9** - Code quality linter (flat config format)
- **Prettier 2.8** - Code formatter
- **Husky** - Git hooks for pre-commit enforcement
- **lint-staged** - Only lint changed files (fast)

**Plugins:**
- `@typescript-eslint/*` - TypeScript support
- `eslint-plugin-react` - React rules
- `eslint-plugin-react-hooks` - React Hooks rules
- `eslint-plugin-react-native` - React Native specific rules

---

## Installation

All linting tools are installed at **monorepo root** (`/Users/bhawthorne/dev/vertex/`):

```bash
npm install --save-dev eslint @typescript-eslint/parser @typescript-eslint/eslint-plugin \
  eslint-plugin-react eslint-plugin-react-hooks eslint-plugin-react-native \
  prettier eslint-config-prettier husky lint-staged --legacy-peer-deps
```

---

## Configuration Files

### ESLint Config (`eslint.config.js`)

ESLint 9 uses **flat config format** (not `.eslintrc.*`).

**Location**: `/Users/bhawthorne/dev/vertex/eslint.config.js`

**Key Rules:**
- ✅ Enforces TypeScript best practices
- ✅ Catches unused variables/imports
- ✅ React Hooks dependency warnings
- ✅ Warns on `console.log` (allows `console.warn`/`console.error`)
- ✅ Enforces `const` over `let` where possible
- ✅ **Stricter for Android** (inline styles are errors)
- ✅ **Lenient for Web** (allows `any`, unused vars for now)

**Ignored Files:**
- `node_modules/`
- `android/android/` (native Android code)
- `build/`, `dist/`, `.expo/`
- `*.config.js`, `metro.config.js`, `babel.config.js`

---

### Prettier Config (`.prettierrc.js`)

**Location**: `/Users/bhawthorne/dev/vertex/.prettierrc.js`

**Settings:**
- **Line width**: 100 characters
- **Indentation**: 2 spaces (no tabs)
- **Quotes**: Single quotes (except JSX uses double quotes)
- **Semicolons**: Required
- **Trailing commas**: ES5 style
- **End of line**: LF (Unix style)

---

### Husky Pre-Commit Hook

**Location**: `/Users/bhawthorne/dev/vertex/.husky/pre-commit`

**Triggers**: Runs `lint-staged` on every `git commit`

**What it does:**
1. Detects staged files in `android/**` and `packages/**`
2. Runs `eslint --fix` on them
3. Runs `prettier --write` on them
4. Adds fixes back to the commit
5. **Blocks commit if errors remain**

---

### lint-staged Config (`package.json`)

```json
"lint-staged": {
  "android/**/*.{js,jsx,ts,tsx}": [
    "eslint --fix",
    "prettier --write"
  ],
  "packages/**/*.{js,jsx,ts,tsx}": [
    "eslint --fix",
    "prettier --write"
  ]
}
```

**Behavior**:
- Only lints files you're committing (fast!)
- Auto-fixes what it can
- Blocks commit if errors can't be auto-fixed

---

## NPM Scripts

All scripts run from monorepo root:

```bash
# Lint entire codebase
npm run lint

# Lint and auto-fix issues
npm run lint:fix

# Format all code with Prettier
npm run format

# Check formatting without changing files
npm run format:check
```

---

## Usage

### 1. Manual Linting

**Lint a single file:**
```bash
npx eslint android/src/screens/RecordScreen.tsx
```

**Lint and auto-fix:**
```bash
npx eslint android/src/screens/RecordScreen.tsx --fix
```

**Lint entire Android app:**
```bash
npx eslint android/src/**/*.{ts,tsx}
```

---

### 2. Manual Formatting

**Format a single file:**
```bash
npx prettier --write android/src/screens/RecordScreen.tsx
```

**Format all TypeScript/TSX:**
```bash
npm run format
```

**Check formatting (dry run):**
```bash
npm run format:check
```

---

### 3. Automatic (Pre-Commit)

**Pre-commit hooks run automatically:**

```bash
git add android/src/screens/RecordScreen.tsx
git commit -m "refactor: update RecordScreen"

# Husky triggers:
# → Runs ESLint --fix on RecordScreen.tsx
# → Runs Prettier --write on RecordScreen.tsx
# → Adds fixes to commit
# → Blocks if errors remain
```

**Bypass pre-commit (not recommended):**
```bash
git commit --no-verify -m "skip hooks"
```

---

## Common Issues

### Issue: "Inline style" errors in Android

**Error:**
```
react-native/no-inline-styles: Inline style: { borderWidth: 2 }
```

**Fix**: Extract to StyleSheet
```typescript
// ❌ Bad (inline style)
<View style={{ borderWidth: 2 }}>

// ✅ Good (extracted)
<View style={styles.border}>

const styles = StyleSheet.create({
  border: { borderWidth: 2 },
});
```

---

### Issue: Unused variables

**Error:**
```
'setIsConnected' is assigned a value but never used
```

**Fix Options:**
1. Remove the variable if truly unused
2. Prefix with `_` if intentionally unused:
```typescript
const [_isConnected, setIsConnected] = useState(false);
```

---

### Issue: Missing useEffect dependencies

**Warning:**
```
React Hook useEffect has missing dependencies: 'initializeDevice'
```

**Fix Options:**
1. Add to dependency array: `[deviceId, initializeDevice]`
2. Wrap in `useCallback` if function
3. Add `// eslint-disable-next-line react-hooks/exhaustive-deps` if intentional

---

### Issue: `no-console` warnings

**Error:**
```
Unexpected console statement
```

**Fix**: Use `console.warn` or `console.error` (allowed):
```typescript
// ❌ Not allowed
console.log('[Debug]', data);

// ✅ Allowed
console.warn('[Debug]', data);
console.error('[Error]', error);
```

---

### Issue: `any` type warnings

**Warning:**
```
Unexpected any. Specify a different type
```

**Fix**: Replace with proper types:
```typescript
// ❌ Bad
const data: any = fetchData();

// ✅ Good
const data: SensorReading = fetchData();

// ✅ Also acceptable if truly dynamic
const data: unknown = fetchData();
```

---

## VSCode Integration

**Recommended Extensions:**
1. **ESLint** (`dbaeumer.vscode-eslint`)
2. **Prettier** (`esbenp.prettier-vscode`)

**Settings (`.vscode/settings.json`):**
```json
{
  "editor.defaultFormatter": "esbenp.prettier-vscode",
  "editor.formatOnSave": true,
  "editor.codeActionsOnSave": {
    "source.fixAll.eslint": true
  },
  "eslint.workingDirectories": [
    { "mode": "auto" }
  ]
}
```

---

## Current Linting Status

### Android (`android/src/`)
- ✅ **Strict rules enforced**
- ✅ Inline styles are errors
- ✅ Unused variables blocked
- ⚠️ DeviceDetailScreen: 46 issues (17 errors, 29 warnings)
  - Needs refactor to use stores (like RecordScreen)
  - Unused local state (batteryLevel, connectionStatus still used in UI)

### Web (`web/src/`)
- ⏸️ **Lenient for now** (deferred enforcement)
- Allows `any` types
- Allows unused variables
- Can be tightened later

### Packages (`packages/`)
- ✅ Standard rules applied
- Enforced on commit

---

## Workflow Integration

### Development Workflow

1. **Write code** (VSCode auto-formats on save)
2. **Stage changes**: `git add .`
3. **Commit**: `git commit -m "..."`
4. **Pre-commit hook runs**:
   - ✅ Auto-fixes linting issues
   - ✅ Formats code
   - ❌ Blocks if errors remain
5. **Fix remaining errors manually**
6. **Commit again**

---

### CI/CD Integration (Future)

Add to GitHub Actions:

```yaml
- name: Lint
  run: npm run lint

- name: Check Formatting
  run: npm run format:check
```

---

## Future enhancements
- Tighten Web linting rules
- Add CI/CD linting checks
- Consider Biome for faster linting (10-100x faster than ESLint)

---

## Best Practices

1. **Fix errors before committing** - Pre-commit hook will block
2. **Use VSCode extensions** - Auto-fix on save
3. **Extract inline styles** - Required for Android
4. **Use proper types** - Avoid `any` where possible
5. **Remove unused code** - Unused imports/variables are errors
6. **Follow React Hooks rules** - useEffect dependencies matter
7. **Use console.warn/error** - Not console.log

---

## Troubleshooting

### Pre-commit hook not running

```bash
# Reinstall Husky
npx husky install

# Make hook executable
chmod +x .husky/pre-commit
```

### ESLint not finding config

```bash
# Verify flat config exists
ls eslint.config.js

# Not .eslintrc.js (old format)
```

### Prettier conflicts with ESLint

```bash
# eslint-config-prettier should be last in extends
# Already configured correctly in eslint.config.js
```

---

## Summary

**What's Enforced:**
- ✅ No unused variables/imports
- ✅ Proper TypeScript types (warn on `any`)
- ✅ React Hooks dependencies
- ✅ No inline styles (Android)
- ✅ Code formatting (Prettier)
- ✅ Runs automatically on commit

**Benefits:**
- 🚀 Catches bugs before runtime
- 🧹 Consistent code style
- 📝 Better code quality
- 🔒 Enforced automatically
- ⚡ Fast (only lints changed files)
