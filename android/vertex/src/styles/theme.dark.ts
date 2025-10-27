/**
 * Dark Theme Constants
 *
 * Dark mode color scheme matching the design system
 */

import { theme as lightTheme } from './theme';

export const darkTheme = {
  colors: {
    // Base colors (inverted)
    background: 'hsl(0, 0%, 10%)',
    foreground: 'hsl(0, 0%, 98%)',
    card: 'hsl(0, 0%, 14%)',
    cardForeground: 'hsl(0, 0%, 98%)',
    primary: 'hsl(0, 0%, 98%)',
    primaryForeground: 'hsl(0, 0%, 9%)',
    secondary: 'hsl(0, 0%, 18%)',
    secondaryForeground: 'hsl(0, 0%, 98%)',
    muted: 'hsl(0, 0%, 18%)',
    mutedForeground: 'hsl(0, 0%, 63.9%)',
    border: 'hsl(0, 0%, 20%)',
    input: 'hsl(0, 0%, 20%)',

    // Form elements
    formBackground: 'hsl(0, 0%, 14%)',
    formBorder: 'hsl(0, 0%, 20%)',
    formText: 'hsl(0, 0%, 98%)',

    // Text
    textPrimary: 'hsl(0, 0%, 98%)',
    textSecondary: 'hsl(0, 0%, 63.9%)',
    textTertiary: 'hsl(0, 0%, 45.1%)',

    // Semantic colors (adjusted for dark mode)
    success: 'hsl(142, 76%, 45%)',
    successBg: 'rgba(34, 197, 94, 0.25)',
    successBorder: 'rgba(34, 197, 94, 0.3)',
    error: 'hsl(0, 84%, 65%)',
    errorBg: 'rgba(239, 68, 68, 0.15)',
    errorBorder: 'rgba(239, 68, 68, 0.3)',
    warning: 'hsl(38, 92%, 55%)',
    warningBg: 'rgba(245, 158, 11, 0.15)',
    warningBorder: 'rgba(245, 158, 11, 0.3)',
    info: 'hsl(199, 89%, 48%)',
    infoBg: 'rgba(14, 165, 233, 0.15)',
    infoBorder: 'rgba(14, 165, 233, 0.3)',
  },

  // Spacing, typography, and borderRadius stay the same
  spacing: lightTheme.spacing,
  typography: lightTheme.typography,
  borderRadius: lightTheme.borderRadius,
};
