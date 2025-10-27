/**
 * Theme Constants
 * 
 * Matches the web app's design system with HSL colors
 */

export const theme = {
  colors: {
    // Base colors
    background: 'hsl(0, 0%, 100%)',
    foreground: 'hsl(0, 0%, 3.9%)',
    card: 'hsl(0, 0%, 100%)',
    cardForeground: 'hsl(0, 0%, 3.9%)',
    primary: 'hsl(0, 0%, 9%)',
    primaryForeground: 'hsl(0, 0%, 98%)',
    secondary: 'hsl(0, 0%, 96.1%)',
    secondaryForeground: 'hsl(0, 0%, 9%)',
    muted: 'hsl(0, 0%, 96.1%)',
    mutedForeground: 'hsl(0, 0%, 45.1%)',
    border: 'hsl(0, 0%, 89.8%)',
    input: 'hsl(0, 0%, 89.8%)',

    // Form elements
    formBackground: 'hsl(0, 0%, 100%)',
    formBorder: 'hsl(0, 0%, 89.8%)',
    formText: 'hsl(0, 0%, 3.9%)',

    // Text
    textPrimary: 'hsl(0, 0%, 3.9%)',
    textSecondary: 'hsl(0, 0%, 45.1%)',
    textTertiary: 'hsl(0, 0%, 63.9%)',

    // Semantic
    success: 'hsl(142, 76%, 36%)',
    successBg: 'hsl(142, 76%, 88%)',
    successBorder: 'rgba(34, 197, 94, 0.2)',
    error: 'hsl(0, 84%, 60%)',
    errorBg: 'rgba(239, 68, 68, 0.08)',
    errorBorder: 'rgba(239, 68, 68, 0.25)',
    warning: 'hsl(38, 92%, 50%)',
    warningBg: 'hsl(38, 92%, 95%)',
    warningBorder: 'rgba(245, 158, 11, 0.2)',
    info: 'hsl(199, 89%, 36%)',
    infoBg: 'hsl(199, 89%, 95%)',
    infoBorder: 'rgba(14, 165, 233, 0.2)',
  },
  
  spacing: {
    xs: 4,
    sm: 8,
    md: 16,
    lg: 24,
    xl: 32,
    xxl: 48,
  },
  
  typography: {
    // Font families - Android doesn't support custom fonts without setup
    serif: 'serif', // System serif font
    mono: 'monospace', // Monospace font
    
    fontSize: {
      xs: 12,
      sm: 14,
      md: 16,
      lg: 18,
      xl: 24,
      xxl: 32,
      xxxl: 48,
    },
    
    fontWeight: {
      light: '300',
      normal: '400',
      medium: '500',
      semibold: '600',
    },
  },
  
  borderRadius: {
    sm: 4,
    md: 8,
    lg: 12,
  },
};

