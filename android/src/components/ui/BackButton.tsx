/**
 * BackButton Component
 *
 * Consistent back button for navigation headers
 */

import React from 'react';
import { TouchableOpacity, StyleSheet } from 'react-native';
import { ArrowLeft } from 'lucide-react-native';
import { useTheme } from '../../contexts/ThemeContext';
import { theme as staticTheme } from '../../styles/theme';

interface BackButtonProps {
  onPress: () => void;
}

export const BackButton: React.FC<BackButtonProps> = ({ onPress }) => {
  const { theme } = useTheme();

  return (
    <TouchableOpacity onPress={onPress} style={styles.backButton}>
      <ArrowLeft size={24} color={theme.colors.textPrimary} />
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  backButton: {
    marginRight: staticTheme.spacing.md,
    padding: staticTheme.spacing.xs,
  },
});
