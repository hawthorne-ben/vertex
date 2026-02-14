/**
 * ErrorBanner Component
 *
 * Display error messages with dismissible option
 */

import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { theme } from '../../styles/theme';
import { AlertCircle, CheckCircle, AlertTriangle, Info, X } from 'lucide-react-native';
import type { ErrorBannerProps } from '../../types/components.types';

export const ErrorBanner: React.FC<ErrorBannerProps> = ({
  error,
  onDismiss,
  variant = 'error',
  style,
  testID,
}) => {
  if (!error) return null;

  const getIcon = () => {
    const iconProps = { size: 20 };

    switch (variant) {
      case 'success':
        return <CheckCircle {...iconProps} color={theme.colors.success} />;
      case 'warning':
        return <AlertTriangle {...iconProps} color={theme.colors.warning} />;
      case 'info':
        return <Info {...iconProps} color={theme.colors.info} />;
      case 'error':
      default:
        return <AlertCircle {...iconProps} color={theme.colors.error} />;
    }
  };

  const getIconColor = () => {
    switch (variant) {
      case 'success':
        return theme.colors.success;
      case 'warning':
        return theme.colors.warning;
      case 'info':
        return theme.colors.info;
      case 'error':
      default:
        return theme.colors.error;
    }
  };

  return (
    <View style={[styles.container, styles[`container_${variant}`], style]} testID={testID}>
      <View style={styles.iconContainer}>{getIcon()}</View>

      <Text style={[styles.text, styles[`text_${variant}`]]}>{error}</Text>

      {onDismiss && (
        <TouchableOpacity
          onPress={onDismiss}
          style={styles.dismissButton}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <X size={20} color={getIconColor()} />
        </TouchableOpacity>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: theme.spacing.md,
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    marginBottom: theme.spacing.md,
  },

  // Variant styles
  container_success: {
    backgroundColor: theme.colors.successBg,
    borderColor: theme.colors.successBorder,
  },
  container_error: {
    backgroundColor: theme.colors.errorBg,
    borderColor: theme.colors.errorBorder,
  },
  container_warning: {
    backgroundColor: theme.colors.warningBg,
    borderColor: theme.colors.warningBorder,
  },
  container_info: {
    backgroundColor: theme.colors.infoBg,
    borderColor: theme.colors.infoBorder,
  },
  container_default: {
    backgroundColor: theme.colors.muted,
    borderColor: theme.colors.border,
  },

  iconContainer: {
    marginRight: theme.spacing.md,
  },

  text: {
    flex: 1,
    fontSize: theme.typography.fontSize.sm,
    lineHeight: 20,
  },

  // Text variant colors
  text_success: {
    color: theme.colors.success,
  },
  text_error: {
    color: theme.colors.error,
  },
  text_warning: {
    color: theme.colors.warning,
  },
  text_info: {
    color: theme.colors.info,
  },
  text_default: {
    color: theme.colors.textPrimary,
  },

  dismissButton: {
    marginLeft: theme.spacing.md,
    padding: theme.spacing.xs,
  },
});
