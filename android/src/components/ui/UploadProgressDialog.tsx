/**
 * UploadProgressDialog Component
 *
 * Glass-like progress modal for file uploads
 * Follows theme system and design language
 * Matches web app upload progress implementation
 */

import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  ActivityIndicator,
} from 'react-native';
import { useTheme } from '../../contexts/ThemeContext';

interface UploadProgressDialogProps {
  visible: boolean;
  fileName: string;
  progress: number; // 0-100
  currentFileIndex?: number;
  totalFiles?: number;
}

export const UploadProgressDialog: React.FC<UploadProgressDialogProps> = ({
  visible,
  fileName,
  progress,
  currentFileIndex = 0,
  totalFiles = 1,
}) => {
  const { theme, isDark } = useTheme();

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent>
      <View style={styles.backdrop}>
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
            Uploading Files
          </Text>

          {/* Spinner and file info */}
          <View style={styles.infoContainer}>
            <ActivityIndicator
              size="large"
              color={theme.colors.primary}
              style={styles.spinner}
            />
            <View style={styles.fileInfoContainer}>
              <Text
                style={[
                  styles.fileName,
                  {
                    color: theme.colors.textPrimary,
                    fontFamily: theme.typography.serif,
                    fontSize: theme.typography.fontSize.sm,
                  },
                ]}
                numberOfLines={1}
                ellipsizeMode="middle">
                {fileName}
              </Text>
              <Text
                style={[
                  styles.fileCount,
                  {
                    color: theme.colors.textSecondary,
                    fontFamily: theme.typography.serif,
                    fontSize: theme.typography.fontSize.xs,
                  },
                ]}>
                File {currentFileIndex + 1} of {totalFiles}
              </Text>
            </View>
          </View>

          {/* Progress bar */}
          <View
            style={[
              styles.progressBarContainer,
              {
                backgroundColor: theme.colors.muted,
              },
            ]}>
            <View
              style={[
                styles.progressBarFill,
                {
                  width: `${Math.min(100, Math.max(0, progress))}%`,
                  backgroundColor: theme.colors.primary,
                },
              ]}
            />
          </View>

          {/* Percentage */}
          <Text
            style={[
              styles.percentage,
              {
                color: theme.colors.textSecondary,
                fontFamily: theme.typography.serif,
                fontSize: theme.typography.fontSize.xs,
              },
            ]}>
            {Math.round(progress)}% complete
          </Text>
        </View>
      </View>
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

  title: {
    textAlign: 'center',
    marginBottom: 16,
    fontWeight: '600',
  },

  infoContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
    gap: 12,
  },

  spinner: {
    flexShrink: 0,
  },

  fileInfoContainer: {
    flex: 1,
    minWidth: 0, // Allow text truncation
  },

  fileName: {
    fontWeight: '600',
    marginBottom: 4,
  },

  fileCount: {
    // No additional styles needed
  },

  progressBarContainer: {
    width: '100%',
    height: 8,
    borderRadius: 4,
    overflow: 'hidden',
    marginBottom: 8,
  },

  progressBarFill: {
    height: '100%',
    borderRadius: 4,
    transition: 'width 0.3s ease',
  },

  percentage: {
    textAlign: 'center',
  },
});
