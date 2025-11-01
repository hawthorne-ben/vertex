/**
 * InfoDialog Component
 *
 * Glass-like info modal for displaying simple information
 * Follows theme system and design language
 */

import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  TouchableWithoutFeedback,
} from 'react-native';
import { useTheme } from '../../contexts/ThemeContext';

interface InfoDialogProps {
  visible: boolean;
  onDismiss: () => void;
  title: string;
  message?: string;
  icon?: React.ReactNode;
  backdropDismiss?: boolean;
}

export const InfoDialog: React.FC<InfoDialogProps> = ({
  visible,
  onDismiss,
  title,
  message,
  icon,
  backdropDismiss = true,
}) => {
  const { theme, isDark } = useTheme();

  const handleBackdropPress = () => {
    if (backdropDismiss) {
      onDismiss();
    }
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onDismiss}
      statusBarTranslucent>
      <TouchableWithoutFeedback onPress={handleBackdropPress}>
        <View style={styles.backdrop}>
          <TouchableWithoutFeedback>
            <View
              style={[
                styles.dialogContainer,
                {
                  backgroundColor: isDark
                    ? 'rgba(30, 30, 30, 0.95)'
                    : 'rgba(255, 255, 255, 0.95)',
                  borderColor: theme.colors.border,
                },
              ]}>
              {/* Icon */}
              {icon && (
                <View style={styles.iconContainer}>
                  {icon}
                </View>
              )}

              {/* Title */}
              <Text
                style={[
                  styles.title,
                  {
                    color: theme.colors.textPrimary,
                    fontFamily: theme.typography.serif,
                    fontSize: theme.typography.fontSize.lg,
                  },
                ]}>
                {title}
              </Text>

              {/* Message */}
              {message && (
                <Text
                  style={[
                    styles.message,
                    {
                      color: theme.colors.textSecondary,
                      fontFamily: theme.typography.serif,
                      fontSize: theme.typography.fontSize.sm,
                    },
                  ]}>
                  {message}
                </Text>
              )}

              {/* OK Button */}
              <View style={styles.actionsContainer}>
                <TouchableOpacity
                  onPress={onDismiss}
                  style={[
                    styles.actionButton,
                    {
                      backgroundColor: theme.colors.primary,
                      borderColor: theme.colors.primary,
                    },
                  ]}>
                  <Text
                    style={[
                      styles.actionText,
                      {
                        color: theme.colors.primaryForeground,
                        fontFamily: theme.typography.serif,
                        fontSize: theme.typography.fontSize.md,
                        fontWeight: '600',
                      },
                    ]}>
                    OK
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          </TouchableWithoutFeedback>
        </View>
      </TouchableWithoutFeedback>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },

  dialogContainer: {
    width: '100%',
    maxWidth: 400,
    borderRadius: 8,
    borderWidth: 1,
    padding: 24,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 8,
    },
    shadowOpacity: 0.25,
    shadowRadius: 16,
    elevation: 10,
  },

  iconContainer: {
    alignItems: 'center',
    marginBottom: 16,
  },

  title: {
    textAlign: 'center',
    marginBottom: 8,
  },

  message: {
    textAlign: 'center',
    marginBottom: 24,
    lineHeight: 20,
  },

  actionsContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
  },

  actionButton: {
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 8,
    borderWidth: 1,
    minWidth: 80,
    alignItems: 'center',
  },

  actionText: {
    textAlign: 'center',
  },
});
