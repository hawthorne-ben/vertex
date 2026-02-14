/**
 * Card Component
 *
 * Reusable card container with variants, custom headers, and actions
 */

import React from 'react';
import { View, StyleSheet } from 'react-native';
import { useTheme } from '../../contexts/ThemeContext';
import type { CardProps } from '../../types/components.types';

export const Card: React.FC<CardProps> = ({
  variant = 'default',
  padding = 'md',
  header,
  headerAction,
  children,
  style,
  testID,
}) => {
  const { theme } = useTheme();

  const getCardStyles = () => {
    const baseStyles = [styles.card];

    const variantStyles = {
      default: {
        backgroundColor: theme.colors.card,
        borderWidth: 1,
        borderColor: theme.colors.border,
      },
      elevated: {
        backgroundColor: theme.colors.card,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
        elevation: 3,
      },
      outlined: {
        backgroundColor: 'transparent',
        borderWidth: 1,
        borderColor: theme.colors.border,
      },
    };

    const paddingStyles = {
      none: {},
      sm: { padding: 8 },
      md: { padding: 16 },
      lg: { padding: 24 },
    };

    return [baseStyles, variantStyles[variant], paddingStyles[padding], style];
  };

  return (
    <View style={getCardStyles()} testID={testID}>
      {(header || headerAction) && (
        <View style={styles.header}>
          {header && <View style={styles.headerContent}>{header}</View>}
          {headerAction && <View style={styles.headerAction}>{headerAction}</View>}
        </View>
      )}
      <View style={styles.content}>{children}</View>
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    borderRadius: 8,
    overflow: 'hidden',
  },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  headerContent: {
    flex: 1,
  },
  headerAction: {
    marginLeft: 16,
  },

  // Content
  content: {
    flex: 1,
  },
});
