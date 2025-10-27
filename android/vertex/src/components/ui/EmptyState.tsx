/**
 * EmptyState Component
 *
 * Display when there's no data or content
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { theme as staticTheme } from '../../styles/theme';
import { useTheme } from '../../contexts/ThemeContext';
import { Button } from './Button';
import type { EmptyStateProps } from '../../types/components.types';

export const EmptyState: React.FC<EmptyStateProps> = ({
  icon,
  title,
  subtitle,
  action,
  style,
  testID,
}) => {
  const { theme } = useTheme();

  return (
    <View style={[styles.container, style]} testID={testID}>
      <View style={styles.iconContainer}>{icon}</View>

      <Text style={[styles.title, { color: theme.colors.textPrimary }]}>{title}</Text>

      {subtitle && <Text style={[styles.subtitle, { color: theme.colors.textSecondary }]}>{subtitle}</Text>}

      {action && (
        <View style={styles.actionContainer}>
          <Button onPress={action.onPress} variant="primary">
            {action.label}
          </Button>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: staticTheme.spacing.xl,
    paddingVertical: staticTheme.spacing.xxl,
  },

  iconContainer: {
    marginBottom: staticTheme.spacing.lg,
    opacity: 0.5,
  },

  title: {
    fontSize: staticTheme.typography.fontSize.lg,
    fontWeight: staticTheme.typography.fontWeight.semibold,
    fontFamily: staticTheme.typography.serif,
    textAlign: 'center',
    marginBottom: staticTheme.spacing.sm,
  },

  subtitle: {
    fontSize: staticTheme.typography.fontSize.md,
    fontFamily: staticTheme.typography.serif,
    textAlign: 'center',
    marginBottom: staticTheme.spacing.lg,
  },

  actionContainer: {
    marginTop: staticTheme.spacing.lg,
  },
});
