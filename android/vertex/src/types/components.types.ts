/**
 * Component Prop Type Definitions
 *
 * Reusable type definitions for UI components
 */

import { ReactNode } from 'react';
import { ViewStyle, TextStyle, StyleProp } from 'react-native';

// Base component props
export interface BaseComponentProps {
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export interface BaseTextProps {
  style?: StyleProp<TextStyle>;
  testID?: string;
}

export interface ChildrenProp {
  children: ReactNode;
}

// Common prop patterns
export type Size = 'sm' | 'md' | 'lg';
export type Variant = 'default' | 'primary' | 'secondary' | 'danger' | 'ghost';
export type StatusVariant = 'success' | 'error' | 'warning' | 'info' | 'default';

// Button props
export interface ButtonProps extends BaseComponentProps {
  variant?: Variant;
  size?: Size;
  icon?: ReactNode;
  iconOnly?: boolean;
  iconPosition?: 'left' | 'right';
  loading?: boolean;
  disabled?: boolean;
  onPress: () => void;
  children?: ReactNode;
}

// Card props
export interface CardProps extends BaseComponentProps, ChildrenProp {
  variant?: 'default' | 'elevated' | 'outlined';
  padding?: 'none' | 'sm' | 'md' | 'lg';
  header?: ReactNode;
  headerAction?: ReactNode;
}

// Input props
export interface InputProps extends BaseComponentProps {
  label?: string;
  placeholder?: string;
  value: string;
  onChangeText: (text: string) => void;
  error?: string;
  secureTextEntry?: boolean;
  keyboardType?: 'default' | 'email-address' | 'numeric' | 'phone-pad';
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
  disabled?: boolean;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
  required?: boolean;
}

// Badge props
export interface BadgeProps extends BaseComponentProps {
  variant?: StatusVariant;
  size?: Size;
  icon?: ReactNode;
  children: ReactNode;
}

// Modal props
export interface ModalProps extends ChildrenProp {
  visible: boolean;
  onClose: () => void;
  title?: string;
  footer?: ReactNode;
  style?: StyleProp<ViewStyle>;
  animationType?: 'slide' | 'fade' | 'none';
}

// EmptyState props
export interface EmptyStateProps extends BaseComponentProps {
  icon: ReactNode;
  title: string;
  subtitle?: string;
  action?: {
    label: string;
    onPress: () => void;
  };
}

// StatCard props
export interface StatCardProps extends BaseComponentProps {
  label: string;
  value: string | number;
  icon?: ReactNode;
  variant?: 'default' | 'large';
  trend?: {
    value: number;
    direction: 'up' | 'down';
  };
}

// ErrorBanner props
export interface ErrorBannerProps extends BaseComponentProps {
  error: string | null;
  onDismiss?: () => void;
  variant?: StatusVariant;
}
