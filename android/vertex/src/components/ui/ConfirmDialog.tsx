/**
 * ConfirmDialog Component
 *
 * Glass-like confirmation modal that replaces Alert.alert
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

interface ConfirmDialogAction {
  label: string;
  onPress: () => void;
  variant?: 'default' | 'primary' | 'danger';
}

interface ConfirmDialogProps {
  visible: boolean;
  onDismiss: () => void;
  title: string;
  message?: string;
  icon?: React.ReactNode;
  actions: ConfirmDialogAction[];
  backdropDismiss?: boolean;
}

export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  visible,
  onDismiss,
  title,
  message,
  icon,
  actions,
  backdropDismiss = true,
}) => {
  const { theme, isDark } = useTheme();

  const handleBackdropPress = () => {
    if (backdropDismiss) {
      onDismiss();
    }
  };

  const getActionColor = (variant?: 'default' | 'primary' | 'danger') => {
    switch (variant) {
      case 'primary':
        return theme.colors.primary;
      case 'danger':
        return theme.colors.error;
      default:
        return theme.colors.textPrimary;
    }
  };

  const getActionBackground = (variant?: 'default' | 'primary' | 'danger') => {
    switch (variant) {
      case 'primary':
        return theme.colors.primary;
      case 'danger':
        return 'transparent';
      default:
        return 'transparent';
    }
  };

  const getActionBorder = (variant?: 'default' | 'primary' | 'danger') => {
    switch (variant) {
      case 'primary':
        return theme.colors.primary;
      case 'danger':
        return theme.colors.error;
      default:
        return theme.colors.border;
    }
  };

  const getActionTextColor = (variant?: 'default' | 'primary' | 'danger') => {
    switch (variant) {
      case 'primary':
        return theme.colors.primaryForeground;
      case 'danger':
        return theme.colors.error;
      default:
        return theme.colors.textPrimary;
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

              {/* Actions */}
              <View style={styles.actionsContainer}>
                {actions.map((action, index) => (
                  <TouchableOpacity
                    key={index}
                    onPress={() => {
                      action.onPress();
                      onDismiss();
                    }}
                    style={[
                      styles.actionButton,
                      {
                        backgroundColor: getActionBackground(action.variant),
                        borderColor: getActionBorder(action.variant),
                      },
                      index < actions.length - 1 && styles.actionButtonSpacing,
                    ]}>
                    <Text
                      style={[
                        styles.actionText,
                        {
                          color: getActionTextColor(action.variant),
                          fontFamily: theme.typography.serif,
                          fontSize: theme.typography.fontSize.md,
                          fontWeight: action.variant === 'primary' ? '600' : '400',
                        },
                      ]}>
                      {action.label}
                    </Text>
                  </TouchableOpacity>
                ))}
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
    gap: 12,
  },

  actionButton: {
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 8,
    borderWidth: 1,
    minWidth: 80,
    alignItems: 'center',
  },

  actionButtonSpacing: {
    marginRight: 8,
  },

  actionText: {
    textAlign: 'center',
  },
});
