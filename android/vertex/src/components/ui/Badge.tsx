/**
 * Badge Component
 *
 * Status indicators with variants and icon support
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { theme } from '../../styles/theme';
import type { BadgeProps } from '../../types/components.types';

export const Badge: React.FC<BadgeProps> = ({
  variant = 'default',
  size = 'md',
  icon,
  children,
  style,
  testID,
}) => {
  const getBadgeStyles = () => {
    const baseStyles = [styles.badge, styles[`badge_${size}`]];
    const variantStyles = styles[`badge_${variant}`];

    return [baseStyles, variantStyles, style];
  };

  const getTextStyles = () => {
    const baseStyles = [styles.text, styles[`text_${size}`]];
    const variantStyles = styles[`text_${variant}`];

    return [baseStyles, variantStyles];
  };

  return (
    <View style={getBadgeStyles()} testID={testID}>
      {icon && <View style={styles.iconContainer}>{icon}</View>}
      <Text style={getTextStyles()}>{children}</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: theme.borderRadius.sm,
    borderWidth: 1,
    alignSelf: 'flex-start',
  },

  // Size variants
  badge_sm: {
    paddingVertical: theme.spacing.xs,
    paddingHorizontal: theme.spacing.sm,
    gap: theme.spacing.xs,
  },
  badge_md: {
    paddingVertical: theme.spacing.sm,
    paddingHorizontal: theme.spacing.md,
    gap: theme.spacing.sm,
  },
  badge_lg: {
    paddingVertical: theme.spacing.md,
    paddingHorizontal: theme.spacing.lg,
    gap: theme.spacing.sm,
  },

  // Variant styles
  badge_success: {
    backgroundColor: theme.colors.successBg,
    borderColor: theme.colors.successBorder,
  },
  badge_error: {
    backgroundColor: theme.colors.errorBg,
    borderColor: theme.colors.errorBorder,
  },
  badge_warning: {
    backgroundColor: theme.colors.warningBg,
    borderColor: theme.colors.warningBorder,
  },
  badge_info: {
    backgroundColor: theme.colors.infoBg,
    borderColor: theme.colors.infoBorder,
  },
  badge_default: {
    backgroundColor: theme.colors.muted,
    borderColor: theme.colors.border,
  },

  // Text styles
  text: {
    fontWeight: theme.typography.fontWeight.medium,
  },
  text_sm: {
    fontSize: theme.typography.fontSize.xs,
  },
  text_md: {
    fontSize: theme.typography.fontSize.sm,
  },
  text_lg: {
    fontSize: theme.typography.fontSize.md,
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
    color: theme.colors.textSecondary,
  },

  // Icon
  iconContainer: {
    justifyContent: 'center',
    alignItems: 'center',
  },
});
