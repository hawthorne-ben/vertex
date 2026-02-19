/**
 * Theme Constants
 *
 * Sourced from @vertex/ui shared design tokens.
 * Light theme — matches web app exactly.
 */

import { palette, toHSL, spacing, fontSize, fontWeight, radius } from '@vertex/ui';

export const theme = {
  colors: {
    // Base
    background: toHSL(palette.background),
    foreground: toHSL(palette.foreground),
    card: toHSL(palette.card),
    cardForeground: toHSL(palette.cardForeground),
    primary: toHSL(palette.primary),
    primaryForeground: toHSL(palette.primaryForeground),
    secondary: toHSL(palette.secondary),
    secondaryForeground: toHSL(palette.secondaryForeground),
    muted: toHSL(palette.muted),
    mutedForeground: toHSL(palette.mutedForeground),
    border: toHSL(palette.border),
    input: toHSL(palette.input),

    // Form
    formBackground: toHSL(palette.formBackground),
    formBorder: toHSL(palette.formBorder),
    formText: toHSL(palette.formText),

    // Text
    textPrimary: toHSL(palette.textPrimary),
    textSecondary: toHSL(palette.textSecondary),
    textTertiary: toHSL(palette.textTertiary),

    // Semantic
    success: toHSL(palette.success),
    successBg: toHSL(palette.successBg),
    successBorder: toHSL(palette.successBorder),
    error: toHSL(palette.error),
    errorBg: toHSL(palette.errorBg),
    errorBorder: toHSL(palette.errorBorder),
    warning: toHSL(palette.warning),
    warningBg: toHSL(palette.warningBg),
    warningBorder: toHSL(palette.warningBorder),
    info: toHSL(palette.info),
    infoBg: toHSL(palette.infoBg),
    infoBorder: toHSL(palette.infoBorder),
  },

  spacing: {
    xs: spacing.xs,
    sm: spacing.sm,
    md: spacing.md,
    lg: spacing.lg,
    xl: spacing.xl,
    xxl: spacing['2xl'],
  },

  typography: {
    // Custom fonts linked from assets/fonts/ via react-native-asset.
    // RN on Android uses the file name (without .ttf) as fontFamily.
    serif: 'CrimsonPro-Regular',
    mono: 'JetBrainsMono-Regular',

    fontSize: {
      xs: fontSize.xs,
      sm: fontSize.sm,
      md: fontSize.base,
      lg: fontSize.lg,
      xl: fontSize.xl,
      xxl: fontSize['2xl'],
      xxxl: fontSize['3xl'],
    },

    fontWeight: {
      light: fontWeight.light,
      normal: fontWeight.normal,
      medium: fontWeight.medium,
      semibold: fontWeight.semibold,
    },
  },

  borderRadius: {
    sm: radius.sm,
    md: radius.md,
    lg: radius.lg,
    xl: radius.xl,
  },
};
