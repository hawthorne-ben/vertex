/**
 * Button Component
 *
 * Reusable button with variants, sizes, loading states, and icon support
 */

import React from 'react';
import {
  TouchableOpacity,
  Text,
  ActivityIndicator,
  View,
  StyleSheet,
} from 'react-native';
import { useTheme } from '../../contexts/ThemeContext';
import type { ButtonProps } from '../../types/components.types';

export const Button: React.FC<ButtonProps> = ({
  variant = 'primary',
  size = 'md',
  icon,
  iconOnly = false,
  iconPosition = 'left',
  loading = false,
  disabled = false,
  onPress,
  children,
  style,
  testID,
}) => {
  const { theme } = useTheme();

  const getButtonStyles = () => {
    const baseStyles = [styles.button, styles[`button_${size}`]];

    const variantStyles = {
      primary: {
        backgroundColor: theme.colors.primary,
        borderColor: theme.colors.primary,
      },
      secondary: {
        backgroundColor: theme.colors.secondary,
        borderColor: theme.colors.border,
      },
      danger: {
        backgroundColor: theme.colors.error,
        borderColor: theme.colors.error,
      },
      ghost: {
        backgroundColor: 'transparent',
        borderColor: 'transparent',
      },
      default: {
        backgroundColor: theme.colors.background,
        borderColor: theme.colors.border,
      },
    };

    return [
      ...baseStyles,
      variantStyles[variant],
      iconOnly && styles.buttonIconOnly,
      (disabled || loading) && styles.buttonDisabled,
      style,
    ];
  };

  const getTextStyles = () => {
    const baseStyles = [styles.text, styles[`text_${size}`]];

    const variantTextStyles = {
      primary: { color: theme.colors.primaryForeground },
      secondary: { color: theme.colors.secondaryForeground },
      danger: { color: '#fff' },
      ghost: { color: theme.colors.textPrimary },
      default: { color: theme.colors.textPrimary },
    };

    return [...baseStyles, variantTextStyles[variant], (disabled || loading) && styles.textDisabled];
  };

  const getSpinnerColor = () => {
    switch (variant) {
      case 'primary':
        return theme.colors.primaryForeground;
      case 'danger':
        return '#fff';
      case 'ghost':
        return theme.colors.textPrimary;
      default:
        return theme.colors.textPrimary;
    }
  };

  const renderContent = () => {
    if (loading) {
      return <ActivityIndicator size="small" color={getSpinnerColor()} />;
    }

    if (iconOnly && icon) {
      return <View style={styles.iconContainer}>{icon}</View>;
    }

    if (icon && iconPosition === 'left') {
      return (
        <View style={styles.contentContainer}>
          <View style={styles.iconContainer}>{icon}</View>
          {children && <Text style={getTextStyles()}>{children}</Text>}
        </View>
      );
    }

    if (icon && iconPosition === 'right') {
      return (
        <View style={styles.contentContainer}>
          {children && <Text style={getTextStyles()}>{children}</Text>}
          <View style={styles.iconContainer}>{icon}</View>
        </View>
      );
    }

    return children && <Text style={getTextStyles()}>{children}</Text>;
  };

  return (
    <TouchableOpacity
      style={getButtonStyles()}
      onPress={onPress}
      disabled={disabled || loading}
      testID={testID}
      activeOpacity={0.7}>
      {renderContent()}
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    borderWidth: 1,
  },

  // Size variants
  button_sm: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    minHeight: 36,
  },
  button_md: {
    paddingVertical: 16,
    paddingHorizontal: 24,
    minHeight: 44,
  },
  button_lg: {
    paddingVertical: 24,
    paddingHorizontal: 32,
    minHeight: 52,
  },

  // Icon-only button
  buttonIconOnly: {
    paddingHorizontal: 16,
    aspectRatio: 1,
  },

  // Disabled state
  buttonDisabled: {
    opacity: 0.5,
  },

  // Text styles
  text: {
    fontWeight: '500',
  },
  text_sm: {
    fontSize: 14,
  },
  text_md: {
    fontSize: 16,
  },
  text_lg: {
    fontSize: 18,
  },

  textDisabled: {
    opacity: 1,
  },

  // Layout
  contentContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  iconContainer: {
    justifyContent: 'center',
    alignItems: 'center',
  },
});
