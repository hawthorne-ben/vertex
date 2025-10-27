/**
 * Theme Type Definitions
 *
 * Type-safe theme system for light and dark modes
 */

import { theme } from '../styles/theme';

export type Theme = typeof theme;
export type ThemeColors = keyof Theme['colors'];
export type ThemeSpacing = keyof Theme['spacing'];
export type ThemeFontSize = keyof Theme['typography']['fontSize'];
export type ThemeFontWeight = keyof Theme['typography']['fontWeight'];
export type ThemeBorderRadius = keyof Theme['borderRadius'];

export type ThemeMode = 'light' | 'dark' | 'system';

export interface ThemeContextValue {
  theme: Theme;
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
  isDark: boolean;
}
