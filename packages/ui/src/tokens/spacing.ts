/**
 * Spacing scale (in pixels/dp).
 *
 * Web uses Tailwind's default scale which maps 1:1 (p-1=4px, p-2=8px, etc).
 * Mobile uses these values directly in StyleSheet.
 */

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  '2xl': 48,
} as const
