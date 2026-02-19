/**
 * Typography tokens.
 *
 * Web loads fonts from Google Fonts (layout.tsx).
 * Mobile bundles .ttf assets and loads via react-native link.
 */

export const fontFamily = {
  serif: 'Crimson Pro',
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
