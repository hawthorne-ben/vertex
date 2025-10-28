/**
 * Toast Context
 *
 * Global toast/snackbar notification system
 */

import React, { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Animated,
  TouchableOpacity,
  SafeAreaView,
} from 'react-native';
import { CheckCircle, AlertCircle, AlertTriangle, Info, X } from 'lucide-react-native';
import { theme as lightTheme } from '../styles/theme';
import { useTheme } from './ThemeContext';
import type { StatusVariant } from '../types/components.types';

interface ToastConfig {
  message: string;
  variant?: StatusVariant;
  duration?: number;
  hasTabBar?: boolean; // Whether the current screen has bottom tab bar
  action?: {
    label: string;
    onPress: () => void;
  };
}

interface ToastContextValue {
  showToast: (config: ToastConfig) => void;
  hideToast: () => void;
}

const ToastContext = createContext<ToastContextValue | undefined>(undefined);

interface ToastProviderProps {
  children: ReactNode;
}

export const ToastProvider: React.FC<ToastProviderProps> = ({ children }) => {
  const { theme } = useTheme();
  const [toast, setToast] = useState<ToastConfig | null>(null);
  const [opacity] = useState(new Animated.Value(0));
  const [translateY] = useState(new Animated.Value(100));

  const showToast = useCallback((config: ToastConfig) => {
    setToast(config);

    // Animate in
    Animated.parallel([
      Animated.timing(opacity, {
        toValue: 1,
        duration: 200,
        useNativeDriver: true,
      }),
      Animated.timing(translateY, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
      }),
    ]).start();

    // Auto hide after duration
    if (config.duration !== 0) {
      const duration = config.duration || 3000;
      setTimeout(() => {
        hideToast();
      }, duration);
    }
  }, []);

  const hideToast = useCallback(() => {
    // Animate out
    Animated.parallel([
      Animated.timing(opacity, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
      }),
      Animated.timing(translateY, {
        toValue: 100,
        duration: 200,
        useNativeDriver: true,
      }),
    ]).start(() => {
      setToast(null);
    });
  }, []);

  const getIcon = (variant: StatusVariant) => {
    const iconProps = { size: 20 };

    switch (variant) {
      case 'success':
        return <CheckCircle {...iconProps} color={theme.colors.success} />;
      case 'warning':
        return <AlertTriangle {...iconProps} color={theme.colors.warning} />;
      case 'info':
        return <Info {...iconProps} color={theme.colors.info} />;
      case 'error':
        return <AlertCircle {...iconProps} color={theme.colors.error} />;
      default:
        return <Info {...iconProps} color={theme.colors.textPrimary} />;
    }
  };

  const getBackgroundColor = (variant: StatusVariant) => {
    switch (variant) {
      case 'success':
        return theme.colors.successBg;
      case 'error':
        return theme.colors.errorBg;
      case 'warning':
        return theme.colors.warningBg;
      case 'info':
        return theme.colors.infoBg;
      default:
        return theme.colors.card;
    }
  };

  const getBorderColor = (variant: StatusVariant) => {
    switch (variant) {
      case 'success':
        return theme.colors.successBorder;
      case 'error':
        return theme.colors.errorBorder;
      case 'warning':
        return theme.colors.warningBorder;
      case 'info':
        return theme.colors.infoBorder;
      default:
        return theme.colors.border;
    }
  };

  const value: ToastContextValue = {
    showToast,
    hideToast,
  };

  return (
    <ToastContext.Provider value={value}>
      {children}
      {toast && (
        <SafeAreaView
          style={[
            styles.toastWrapper,
            { paddingBottom: toast.hasTabBar !== false ? 100 : lightTheme.spacing.lg }
          ]}
          pointerEvents="box-none">
          <Animated.View
            style={[
              styles.toastContainer,
              {
                opacity,
                transform: [{ translateY }],
                backgroundColor: getBackgroundColor(toast.variant || 'default'),
                borderColor: getBorderColor(toast.variant || 'default'),
              },
            ]}>
            <View style={styles.toastContent}>
              <View style={styles.iconContainer}>
                {getIcon(toast.variant || 'default')}
              </View>

              <Text style={[styles.message, { color: theme.colors.textPrimary }]}>
                {toast.message}
              </Text>

              {toast.action && (
                <TouchableOpacity
                  onPress={() => {
                    toast.action?.onPress();
                    hideToast();
                  }}
                  style={styles.actionButton}>
                  <Text style={[styles.actionText, { color: theme.colors.primary }]}>
                    {toast.action.label}
                  </Text>
                </TouchableOpacity>
              )}

              <TouchableOpacity
                onPress={hideToast}
                style={styles.closeButton}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <X size={20} color={theme.colors.textSecondary} />
              </TouchableOpacity>
            </View>
          </Animated.View>
        </SafeAreaView>
      )}
    </ToastContext.Provider>
  );
};

/**
 * Hook to access toast context
 */
export const useToast = (): ToastContextValue => {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within ToastProvider');
  }
  return context;
};

const styles = StyleSheet.create({
  toastWrapper: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    alignItems: 'center',
    paddingHorizontal: lightTheme.spacing.md,
    // paddingBottom applied dynamically based on tab screen detection
  },

  toastContainer: {
    width: '100%',
    borderRadius: lightTheme.borderRadius.md,
    borderWidth: 1,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 4,
    },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 5,
  },

  toastContent: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: lightTheme.spacing.md,
  },

  iconContainer: {
    marginRight: lightTheme.spacing.md,
  },

  message: {
    flex: 1,
    fontSize: lightTheme.typography.fontSize.sm,
    fontFamily: lightTheme.typography.serif,
    lineHeight: 20,
  },

  actionButton: {
    marginLeft: lightTheme.spacing.md,
    paddingHorizontal: lightTheme.spacing.sm,
  },

  actionText: {
    fontSize: lightTheme.typography.fontSize.sm,
    fontWeight: lightTheme.typography.fontWeight.semibold,
    fontFamily: lightTheme.typography.serif,
  },

  closeButton: {
    marginLeft: lightTheme.spacing.sm,
    padding: lightTheme.spacing.xs,
  },
});
