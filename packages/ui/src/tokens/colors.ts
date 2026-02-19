/**
 * Color tokens — single source of truth for web and mobile.
 *
 * Stored as HSL components so each platform can format them:
 *   Web (CSS vars):  toCSS()  → "0 0% 100%"
 *   Mobile (inline):  toHSL() → "hsl(0, 0%, 100%)"
 */

export interface HSL {
  h: number
  s: number
  l: number
}

export const toHSL = (c: HSL) => `hsl(${c.h}, ${c.s}%, ${c.l}%)`
export const toCSS = (c: HSL) => `${c.h} ${c.s}% ${c.l}%`

// ── Light palette ──────────────────────────────────────────────

export const palette = {
  // Base
  background:           { h: 0, s: 0, l: 100 },
  foreground:           { h: 0, s: 0, l: 3.9 },
  card:                 { h: 0, s: 0, l: 100 },
  cardForeground:       { h: 0, s: 0, l: 3.9 },
  popover:              { h: 0, s: 0, l: 100 },
  popoverForeground:    { h: 0, s: 0, l: 3.9 },
  primary:              { h: 0, s: 0, l: 9 },
  primaryForeground:    { h: 0, s: 0, l: 98 },
  secondary:            { h: 0, s: 0, l: 96.1 },
  secondaryForeground:  { h: 0, s: 0, l: 9 },
  muted:                { h: 0, s: 0, l: 96.1 },
  mutedForeground:      { h: 0, s: 0, l: 45.1 },
  accent:               { h: 0, s: 0, l: 96.1 },
  accentForeground:     { h: 0, s: 0, l: 9 },
  destructive:          { h: 0, s: 84.2, l: 60.2 },
  destructiveForeground:{ h: 0, s: 0, l: 98 },
  border:               { h: 0, s: 0, l: 89.8 },
  input:                { h: 0, s: 0, l: 89.8 },
  ring:                 { h: 0, s: 0, l: 3.9 },

  // Charts
  chart1:               { h: 12, s: 76, l: 61 },
  chart2:               { h: 173, s: 58, l: 39 },
  chart3:               { h: 197, s: 37, l: 24 },
  chart4:               { h: 43, s: 74, l: 66 },
  chart5:               { h: 27, s: 87, l: 67 },

  // Form
  formBackground:       { h: 0, s: 0, l: 100 },
  formBorder:           { h: 0, s: 0, l: 89.8 },
  formText:             { h: 0, s: 0, l: 3.9 },
  formPlaceholder:      { h: 0, s: 0, l: 45.1 },
  formDisabled:         { h: 0, s: 0, l: 96.1 },
  formDisabledText:     { h: 0, s: 0, l: 45.1 },
  formDisabledBorder:   { h: 0, s: 0, l: 89.8 },

  // Status
  success:              { h: 142, s: 76, l: 36 },
  successForeground:    { h: 0, s: 0, l: 98 },
  successBg:            { h: 142, s: 76, l: 95 },
  successBorder:        { h: 142, s: 76, l: 85 },
  warning:              { h: 38, s: 92, l: 50 },
  warningForeground:    { h: 0, s: 0, l: 98 },
  warningBg:            { h: 38, s: 92, l: 95 },
  warningBorder:        { h: 38, s: 92, l: 85 },
  error:                { h: 0, s: 84, l: 60 },
  errorForeground:      { h: 0, s: 0, l: 9 },
  errorBg:              { h: 0, s: 84, l: 95 },
  errorBorder:          { h: 0, s: 84, l: 85 },
  info:                 { h: 199, s: 89, l: 36 },
  infoForeground:       { h: 0, s: 0, l: 98 },
  infoBg:               { h: 199, s: 89, l: 95 },
  infoBorder:           { h: 199, s: 89, l: 85 },

  // Semantic text
  textPrimary:          { h: 0, s: 0, l: 3.9 },
  textSecondary:        { h: 0, s: 0, l: 45.1 },
  textTertiary:         { h: 0, s: 0, l: 63.9 },
  textInverse:          { h: 0, s: 0, l: 98 },

  // Interactive
  hoverBg:              { h: 0, s: 0, l: 96.1 },
  hoverBorder:          { h: 0, s: 0, l: 89.8 },
  activeBg:             { h: 0, s: 0, l: 92 },
  activeBorder:         { h: 0, s: 0, l: 85 },
} as const

export type PaletteKey = keyof typeof palette

// ── Dark overrides ─────────────────────────────────────────────

export const darkPalette: Record<PaletteKey, HSL> = {
  ...palette,

  // Base
  background:           { h: 0, s: 0, l: 3.9 },
  foreground:           { h: 0, s: 0, l: 98 },
  card:                 { h: 0, s: 0, l: 3.9 },
  cardForeground:       { h: 0, s: 0, l: 98 },
  popover:              { h: 0, s: 0, l: 3.9 },
  popoverForeground:    { h: 0, s: 0, l: 98 },
  primary:              { h: 0, s: 0, l: 98 },
  primaryForeground:    { h: 0, s: 0, l: 9 },
  secondary:            { h: 0, s: 0, l: 14.9 },
  secondaryForeground:  { h: 0, s: 0, l: 98 },
  muted:                { h: 0, s: 0, l: 14.9 },
  mutedForeground:      { h: 0, s: 0, l: 63.9 },
  accent:               { h: 0, s: 0, l: 14.9 },
  accentForeground:     { h: 0, s: 0, l: 98 },
  destructive:          { h: 0, s: 62.8, l: 30.6 },
  destructiveForeground:{ h: 0, s: 0, l: 98 },
  border:               { h: 0, s: 0, l: 14.9 },
  input:                { h: 0, s: 0, l: 14.9 },
  ring:                 { h: 0, s: 0, l: 83.1 },

  // Charts
  chart1:               { h: 220, s: 70, l: 50 },
  chart2:               { h: 160, s: 60, l: 45 },
  chart3:               { h: 30, s: 80, l: 55 },
  chart4:               { h: 280, s: 65, l: 60 },
  chart5:               { h: 340, s: 75, l: 55 },

  // Form
  formBackground:       { h: 0, s: 0, l: 3.9 },
  formBorder:           { h: 0, s: 0, l: 14.9 },
  formText:             { h: 0, s: 0, l: 98 },
  formPlaceholder:      { h: 0, s: 0, l: 63.9 },
  formDisabled:         { h: 0, s: 0, l: 14.9 },
  formDisabledText:     { h: 0, s: 0, l: 63.9 },
  formDisabledBorder:   { h: 0, s: 0, l: 14.9 },

  // Status
  success:              { h: 142, s: 76, l: 50 },
  successForeground:    { h: 0, s: 0, l: 98 },
  successBg:            { h: 142, s: 76, l: 20 },
  successBorder:        { h: 142, s: 76, l: 30 },
  warning:              { h: 38, s: 92, l: 60 },
  warningForeground:    { h: 0, s: 0, l: 98 },
  warningBg:            { h: 38, s: 92, l: 20 },
  warningBorder:        { h: 38, s: 92, l: 30 },
  error:                { h: 0, s: 84, l: 70 },
  errorForeground:      { h: 0, s: 0, l: 98 },
  errorBg:              { h: 0, s: 84, l: 20 },
  errorBorder:          { h: 0, s: 84, l: 30 },
  info:                 { h: 199, s: 89, l: 68 },
  infoForeground:       { h: 0, s: 0, l: 98 },
  infoBg:               { h: 199, s: 89, l: 20 },
  infoBorder:           { h: 199, s: 89, l: 30 },

  // Semantic text
  textPrimary:          { h: 0, s: 0, l: 98 },
  textSecondary:        { h: 0, s: 0, l: 63.9 },
  textTertiary:         { h: 0, s: 0, l: 45.1 },
  textInverse:          { h: 0, s: 0, l: 3.9 },

  // Interactive
  hoverBg:              { h: 0, s: 0, l: 14.9 },
  hoverBorder:          { h: 0, s: 0, l: 20 },
  activeBg:             { h: 0, s: 0, l: 20 },
  activeBorder:         { h: 0, s: 0, l: 25 },
}
