/**
 * StatCard Component
 *
 * Custom component for displaying statistics with optional trends
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTheme } from '../../contexts/ThemeContext';
import { theme as staticTheme } from '../../styles/theme';
import { TrendingUp, TrendingDown } from 'lucide-react-native';
import type { StatCardProps } from '../../types/components.types';

export const StatCard: React.FC<StatCardProps> = ({
  label,
  value,
  icon,
  variant = 'default',
  trend,
  style,
  testID,
}) => {
  const { theme } = useTheme();
  const isLarge = variant === 'large';

  return (
    <View style={[
      styles.container,
      {
        backgroundColor: theme.colors.muted,
        borderColor: theme.colors.border,
      },
      isLarge && styles.containerLarge,
      style
    ]} testID={testID}>
      <View style={styles.header}>
        {icon && <View style={styles.iconContainer}>{icon}</View>}
        <Text style={[styles.label, { color: theme.colors.textSecondary }, isLarge && styles.labelLarge]}>{label}</Text>
      </View>

      <Text style={[styles.value, { color: theme.colors.textPrimary }, isLarge && styles.valueLarge]}>{value}</Text>

      {trend && (
        <View style={styles.trendContainer}>
          {trend.direction === 'up' ? (
            <TrendingUp
              size={16}
              color={theme.colors.success}
            />
          ) : (
            <TrendingDown
              size={16}
              color={theme.colors.error}
            />
          )}
          <Text
            style={[
              styles.trendText,
              trend.direction === 'up' ? styles.trendUp : styles.trendDown,
            ]}>
            {Math.abs(trend.value)}%
          </Text>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    padding: 16,
    borderRadius: 8,
    borderWidth: 1,
  },

  containerLarge: {
    padding: 24,
  },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
    gap: 8,
  },

  iconContainer: {
    justifyContent: 'center',
    alignItems: 'center',
  },

  label: {
    fontSize: 14,
    fontWeight: '500',
    fontFamily: staticTheme.typography.serif,
  },

  labelLarge: {
    fontSize: 16,
  },

  value: {
    fontSize: 18,
    fontWeight: '600',
    fontFamily: staticTheme.typography.mono,
  },

  valueLarge: {
    fontSize: 32,
  },

  trendContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
    gap: 4,
  },

  trendText: {
    fontSize: 14,
    fontWeight: '500',
    fontFamily: staticTheme.typography.mono,
  },

  trendUp: {
    color: 'hsl(142, 76%, 36%)',
  },

  trendDown: {
    color: 'hsl(0, 84%, 60%)',
  },
});
