/**
 * Modal Component
 *
 * Basic modal with slide animation - can be enhanced with bottom sheet library later
 * Consider using @gorhom/bottom-sheet for more advanced bottom sheet functionality
 */

import React from 'react';
import {
  Modal as RNModal,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { theme as staticTheme } from '../../styles/theme';
import { useTheme } from '../../contexts/ThemeContext';
import { X } from 'lucide-react-native';
import type { ModalProps } from '../../types/components.types';

export const Modal: React.FC<ModalProps> = ({
  visible,
  onClose,
  title,
  children,
  footer,
  style,
  animationType = 'slide',
}) => {
  const { theme } = useTheme();

  return (
    <RNModal
      visible={visible}
      animationType={animationType}
      transparent={true}
      onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.overlay}>
        <TouchableOpacity
          style={styles.backdrop}
          activeOpacity={1}
          onPress={onClose}
        />

        <View style={[styles.container, { backgroundColor: theme.colors.background, borderBottomColor: theme.colors.border }, style]}>
          {/* Header */}
          <View style={[styles.header, { borderBottomColor: theme.colors.border }]}>
            {title && <Text style={[styles.title, { color: theme.colors.textPrimary }]}>{title}</Text>}
            <TouchableOpacity
              onPress={onClose}
              style={styles.closeButton}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <X size={24} color={theme.colors.textPrimary} />
            </TouchableOpacity>
          </View>

          {/* Content */}
          <View style={styles.content}>{children}</View>

          {/* Footer */}
          {footer && <View style={[styles.footer, { borderTopColor: theme.colors.border }]}>{footer}</View>}
        </View>
      </KeyboardAvoidingView>
    </RNModal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },

  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },

  container: {
    borderTopLeftRadius: staticTheme.borderRadius.lg,
    borderTopRightRadius: staticTheme.borderRadius.lg,
    maxHeight: '90%',
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: -2,
    },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 5,
  },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: staticTheme.spacing.lg,
    paddingVertical: staticTheme.spacing.md,
    borderBottomWidth: 1,
  },

  title: {
    fontSize: staticTheme.typography.fontSize.lg,
    fontWeight: staticTheme.typography.fontWeight.semibold,
    flex: 1,
  },

  closeButton: {
    padding: staticTheme.spacing.xs,
  },

  content: {
    paddingHorizontal: staticTheme.spacing.lg,
    paddingVertical: staticTheme.spacing.lg,
  },

  footer: {
    paddingHorizontal: staticTheme.spacing.lg,
    paddingVertical: staticTheme.spacing.md,
    borderTopWidth: 1,
  },
});
