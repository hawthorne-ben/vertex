/**
 * Dark Theme Constants
 *
 * Sourced from @vertex/ui shared design tokens.
 * Matches web app's dark mode exactly.
 */

import { darkPalette, toHSL } from '@vertex/ui';
import { theme as lightTheme } from './theme';

export const darkTheme = {
  colors: {
    // Base
    background: toHSL(darkPalette.background),
    foreground: toHSL(darkPalette.foreground),
    card: toHSL(darkPalette.card),
    cardForeground: toHSL(darkPalette.cardForeground),
    primary: toHSL(darkPalette.primary),
    primaryForeground: toHSL(darkPalette.primaryForeground),
    secondary: toHSL(darkPalette.secondary),
    secondaryForeground: toHSL(darkPalette.secondaryForeground),
    muted: toHSL(darkPalette.muted),
    mutedForeground: toHSL(darkPalette.mutedForeground),
    border: toHSL(darkPalette.border),
    input: toHSL(darkPalette.input),

    // Form
    formBackground: toHSL(darkPalette.formBackground),
    formBorder: toHSL(darkPalette.formBorder),
    formText: toHSL(darkPalette.formText),

    // Text
    textPrimary: toHSL(darkPalette.textPrimary),
    textSecondary: toHSL(darkPalette.textSecondary),
    textTertiary: toHSL(darkPalette.textTertiary),

    // Semantic
    success: toHSL(darkPalette.success),
    successBg: toHSL(darkPalette.successBg),
    successBorder: toHSL(darkPalette.successBorder),
    error: toHSL(darkPalette.error),
    errorBg: toHSL(darkPalette.errorBg),
    errorBorder: toHSL(darkPalette.errorBorder),
    warning: toHSL(darkPalette.warning),
    warningBg: toHSL(darkPalette.warningBg),
    warningBorder: toHSL(darkPalette.warningBorder),
    info: toHSL(darkPalette.info),
    infoBg: toHSL(darkPalette.infoBg),
    infoBorder: toHSL(darkPalette.infoBorder),
  },

  // Spacing, typography, and borderRadius shared with light theme
  spacing: lightTheme.spacing,
  typography: lightTheme.typography,
  borderRadius: lightTheme.borderRadius,
};
