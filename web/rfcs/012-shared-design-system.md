# RFC 012: Shared Design System

**Status:** Accepted
**Created:** 2026-02-18
**Author:** Claude

## Summary

Establish a shared design system package (`@vertex/ui`) providing design tokens, primitive components, and typography presets consumed by both the Next.js web app and React Native mobile app. The web app is the source of truth — the package codifies what already works there and provides RN-compatible equivalents.

## Motivation

Both apps already share the same HSL color palette and semantic color names (manually duplicated). But:

1. **Tokens are duplicated** — `globals.css` (CSS vars) and `app/src/styles/theme.ts` (JS object) define the same colors independently. A palette change requires editing both.
2. **Web has inconsistencies** — heading styles vary across pages (`font-bold` vs `font-normal`, missing `font-serif`, inconsistent responsive breakpoints). Loading indicators mix Loader2, custom spinners, and pulse animations with no clear guideline.
3. **Mobile lacks custom fonts** — uses system `serif`/`monospace` instead of Crimson Pro/JetBrains Mono. This is fine for Android but diverges visually.
4. **No shared component contracts** — both apps have Button, Card, Badge, Toast, Modal components with similar variant names but no shared interface.

## Audit: Current State

### Colors — Well Aligned

Both apps use identical HSL values. Semantic names match:

| Token | Web (CSS var) | Mobile (JS) | Match? |
|---|---|---|---|
| background | `0 0% 100%` | `hsl(0, 0%, 100%)` | Yes |
| primary | `0 0% 9%` | `hsl(0, 0%, 9%)` | Yes |
| success | `142 76% 36%` | `hsl(142, 76%, 36%)` | Yes |
| error | `0 84% 60%` | `hsl(0, 84%, 60%)` | Yes |
| text-secondary | `0 0% 45.1%` | `hsl(0, 0%, 45.1%)` | Yes |
| border | `0 0% 89.8%` | `hsl(0, 0%, 89.8%)` | Yes |

Dark mode values also match. No issues here — just needs single-sourcing.

### Typography — Divergent

| Property | Web | Mobile |
|---|---|---|
| Serif | Crimson Pro (Google Fonts) | System `serif` |
| Mono | JetBrains Mono (Google Fonts) | System `monospace` |
| Sizes | Tailwind defaults (sm=14, base=16, lg=18, xl=20, 2xl=24, 3xl=30) | Custom scale (xs=12, sm=14, md=16, lg=18, xl=24, xxl=32) |
| Weights | Tailwind (normal=400, medium=500, semibold=600, bold=700) | Custom (light=300, normal=400, medium=500, semibold=600) |

**Web heading inconsistencies:**

| Page | H1 Style | Issue |
|---|---|---|
| Dashboard | `text-2xl md:text-3xl font-serif font-normal` | Reference pattern |
| Settings | `text-2xl md:text-3xl font-serif font-normal` | Matches |
| Upload | `text-3xl font-normal` | Missing `font-serif`, no responsive |
| Ride detail | `text-2xl md:text-3xl font-bold` | `font-bold` instead of `font-normal` |
| Login/Signup | `text-3xl font-serif font-normal` | No responsive sizing |
| Create Ride | `text-3xl font-serif font-normal` | No responsive sizing |

### Components — Similar APIs, Separate Implementations

| Component | Web | Mobile | Shared? |
|---|---|---|---|
| Button | shadcn/CVA: default, destructive, outline, secondary, ghost, link | Custom: primary, secondary, danger, ghost | Variant names differ |
| Card | shadcn: Card/Header/Title/Content/Footer | Custom: default, elevated, outlined | Similar structure |
| Badge | shadcn: default, secondary, destructive, outline | Custom: success, error, warning, info, default | Different variant sets |
| Toast | Custom context + container: success, error, warning, info | Custom context: success, error, warning, info | Same variants |
| Modal | Custom ConfirmationModal, BatchOperationModal | Custom Modal, ConfirmDialog, InfoDialog, ErrorDialog | Different split |
| Loading | Loader2 spinner (lucide) | ActivityIndicator + custom LoadingScreen | Different |

### Spacing — Close Enough

| Scale | Web (Tailwind rem) | Mobile (dp) | Equivalent? |
|---|---|---|---|
| xs/1 | 4px (p-1) | 4 | Yes |
| sm/2 | 8px (p-2) | 8 | Yes |
| md/4 | 16px (p-4) | 16 | Yes |
| lg/6 | 24px (p-6) | 24 | Yes |
| xl/8 | 32px (p-8) | 32 | Yes |

### Border Radius — Close

| Token | Web | Mobile |
|---|---|---|
| sm | `calc(0.5rem - 4px)` ≈ 4px | 4 |
| md | `calc(0.5rem - 2px)` ≈ 6px | 8 |
| lg | `0.5rem` = 8px | 12 |

Minor differences in md/lg. Not critical but should be unified.

### Shadows — Web Only

Web defines glass-surface, card-interactive, map-shadow. Mobile uses RN `elevation` + `shadowOffset` natively. No shared abstraction needed — shadows are platform-specific.

## Proposal

### Package Structure

```
packages/
  ui/
    src/
      tokens/
        colors.ts        # Single-source color palette
        typography.ts     # Font sizes, weights, families
        spacing.ts        # Spacing scale
        radius.ts         # Border radius scale
        index.ts          # Barrel export
      types/
        components.ts     # Shared component prop interfaces
      index.ts
    package.json
```

The package is **tokens + types only** — no React/RN runtime dependency. Each app imports tokens and applies them through its own rendering layer (Tailwind CSS vars for web, StyleSheet for mobile).

### Tokens

```ts
// tokens/colors.ts
export const palette = {
  background: { h: 0, s: 0, l: 100 },
  foreground: { h: 0, s: 0, l: 3.9 },
  primary: { h: 0, s: 0, l: 9 },
  // ...
  success: { h: 142, s: 76, l: 36 },
  error: { h: 0, s: 84, l: 60 },
  warning: { h: 38, s: 92, l: 50 },
  info: { h: 199, s: 89, l: 36 },
} as const

export const darkOverrides: Partial<typeof palette> = {
  background: { h: 0, s: 0, l: 3.9 },
  foreground: { h: 0, s: 0, l: 98 },
  primary: { h: 0, s: 0, l: 98 },
  // ...
} as const

// Helper for each platform
export const toHSL = (c: { h: number; s: number; l: number }) =>
  `hsl(${c.h}, ${c.s}%, ${c.l}%)`
export const toCSS = (c: { h: number; s: number; l: number }) =>
  `${c.h} ${c.s}% ${c.l}%`
```

```ts
// tokens/typography.ts
export const fontFamily = {
  serif: 'Crimson Pro',     // web loads from Google Fonts, RN bundles asset
  mono: 'JetBrains Mono',
} as const

export const fontSize = {
  xs: 12,
  sm: 14,
  base: 16,
  lg: 18,
  xl: 24,
  '2xl': 32,
  '3xl': 48,
} as const

export const fontWeight = {
  light: '300',
  normal: '400',
  medium: '500',
  semibold: '600',
  bold: '700',
} as const
```

```ts
// tokens/spacing.ts
export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  '2xl': 48,
} as const
```

```ts
// tokens/radius.ts
export const radius = {
  sm: 4,
  md: 8,
  lg: 12,
} as const
```

### Shared Component Interfaces

Not full components — just the prop contracts so both apps expose consistent APIs:

```ts
// types/components.ts
export type ButtonVariant = 'primary' | 'secondary' | 'destructive' | 'ghost' | 'outline'
export type ButtonSize = 'sm' | 'md' | 'lg'

export type BadgeVariant = 'default' | 'success' | 'error' | 'warning' | 'info'

export type ToastType = 'success' | 'error' | 'warning' | 'info'

export type CardVariant = 'default' | 'elevated' | 'interactive'
```

### Integration: Web

Generate `globals.css` variables from tokens at build time (or just import directly in `tailwind.config.ts`):

```ts
// tailwind.config.ts
import { palette, toCSS } from '@vertex/ui/tokens/colors'
import { fontSize, fontFamily } from '@vertex/ui/tokens/typography'
import { radius } from '@vertex/ui/tokens/radius'

export default {
  theme: {
    extend: {
      fontFamily: {
        serif: [fontFamily.serif, 'serif'],
        mono: [fontFamily.mono, 'monospace'],
      },
      borderRadius: {
        sm: `${radius.sm}px`,
        md: `${radius.md}px`,
        lg: `${radius.lg}px`,
      },
    },
  },
}
```

CSS variables still defined in `globals.css` but values sourced from tokens (manually or via a small build script).

### Integration: Mobile

```ts
// app/src/styles/theme.ts
import { palette, toHSL, darkOverrides } from '@vertex/ui/tokens/colors'
import { spacing } from '@vertex/ui/tokens/spacing'
import { fontSize, fontWeight, fontFamily } from '@vertex/ui/tokens/typography'
import { radius } from '@vertex/ui/tokens/radius'

export const theme = {
  colors: Object.fromEntries(
    Object.entries(palette).map(([k, v]) => [k, toHSL(v)])
  ),
  spacing,
  typography: { fontSize, fontWeight, serif: fontFamily.serif, mono: fontFamily.mono },
  borderRadius: radius,
}
```

### Web Consistency Fixes (Part of Rollout)

Standardize heading patterns across all pages:

```tsx
// Page H1: always use this pattern
<h1 className="text-2xl md:text-3xl font-serif font-normal mb-6 md:mb-8">
  Page Title
</h1>
```

Pages to fix: Upload, Ride detail, Login, Signup, Create Ride.

Standardize loading states — use `Loader2` from lucide-react for all spinners:

```tsx
// Standard spinner
<Loader2 className="w-6 h-6 text-primary animate-spin" />
```

Remove the custom `border-2 border-white border-t-transparent` spinner in `confirmation-modal.tsx`.

### Mobile Font Loading

Bundle Crimson Pro and JetBrains Mono as assets and load via `expo-font` or RN asset linking:

```ts
// app/src/styles/fonts.ts
import { fontFamily } from '@vertex/ui/tokens/typography'

export const fonts = {
  [fontFamily.serif]: require('../../assets/fonts/CrimsonPro-Regular.ttf'),
  [`${fontFamily.serif}-Light`]: require('../../assets/fonts/CrimsonPro-Light.ttf'),
  [`${fontFamily.serif}-SemiBold`]: require('../../assets/fonts/CrimsonPro-SemiBold.ttf'),
  [fontFamily.mono]: require('../../assets/fonts/JetBrainsMono-Regular.ttf'),
}
```

## What This Is Not

- **Not a cross-platform component library** — React DOM and RN have fundamentally different rendering. Shared components (like `react-native-web`) add complexity without clear benefit for two apps with different feature sets.
- **Not a monorepo migration** — the package can live in `packages/ui` and be referenced via `file:../packages/ui` or a workspace, without restructuring existing apps.
- **Not a Storybook/docs site** — premature for a solo-developer project. The RFC itself serves as living documentation.

## Scope & Rollout

### Phase 1: Tokens Package
1. Create `packages/ui` with color, typography, spacing, radius tokens
2. Wire into web `tailwind.config.ts` (no visual change)
3. Wire into mobile `theme.ts` (no visual change)
4. Add shared component type interfaces

### Phase 2: Web Consistency
1. Fix H1 heading styles across all pages
2. Standardize loading spinners to Loader2
3. Align web Button variant names with shared types (`default` → `primary`)

### Phase 3: Mobile Fonts
1. Bundle Crimson Pro and JetBrains Mono
2. Load via expo-font or RN asset linking
3. Update `theme.ts` to reference loaded font names

## Decisions (Resolved)

1. **Monorepo tooling** — pnpm workspaces.
2. **CSS variable generation** — Manual sync for now. Revisit if drift becomes a problem.
3. **Button variant naming** — Rename `default` → `primary` for cross-app consistency.
4. **Mobile custom fonts** — Yes, bundle Crimson Pro and JetBrains Mono.
5. **Icon library** — No shared abstraction needed. Both apps use lucide with the same icon names.
