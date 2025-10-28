/**
 * Data Screen
 *
 * Lists recorded IMU data files
 */

import React, { useState, useEffect } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, RefreshControl, ActivityIndicator, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { FileText, Trash2, RefreshCw, Clock, Database, Activity, AlertCircle } from 'lucide-react-native';
import { theme as staticTheme } from '../styles/theme';
import { useTheme } from '../contexts/ThemeContext';
import { useToast } from '../contexts/ToastContext';
import { ConfirmDialog } from '../components/ui';
import FileService, { RecordingMetadata } from '../services/FileService';
import { RootStackParamList } from '../navigation/AppNavigator';

type NavigationProp = NativeStackNavigationProp<RootStackParamList>;

const DataScreen: React.FC = () => {
  const insets = useSafeAreaInsets();
  const { theme } = useTheme();
  const { showToast } = useToast();
  const navigation = useNavigation<NavigationProp>();
  const [recordings, setRecordings] = useState<RecordingMetadata[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [recordingToDelete, setRecordingToDelete] = useState<RecordingMetadata | null>(null);

  // Load recordings only on initial mount
  useEffect(() => {
    loadRecordings();
  }, []);

  const loadRecordings = async () => {
    try {
      const files = await FileService.getRecordings();
      setRecordings(files);
    } catch (error) {
      console.error('[DataScreen] Error loading recordings:', error);
      Alert.alert('Error', 'Failed to load recordings');
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  };

  const handleRefresh = () => {
    setIsRefreshing(true);
    loadRecordings();
  };

  const handleDeleteRecording = (recording: RecordingMetadata) => {
    setRecordingToDelete(recording);
  };

  const confirmDelete = async () => {
    if (!recordingToDelete) return;

    try {
      await FileService.deleteRecording(recordingToDelete.fileName);
      setRecordingToDelete(null);
      loadRecordings();

      // Show success toast
      showToast({
        message: 'Recording deleted',
        variant: 'success',
        duration: 2000,
        hasTabBar: true, // Data screen has bottom tabs
      });
    } catch (error) {
      console.error('[DataScreen] Error deleting recording:', error);
      setRecordingToDelete(null);
      showToast({
        message: 'Failed to delete recording',
        variant: 'error',
        duration: 3000,
        hasTabBar: true, // Data screen has bottom tabs
      });
    }
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  };

  const formatDate = (date: Date): string => {
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays}d ago`;

    return date.toLocaleDateString();
  };

  const formatDateRange = (startTime: Date, endTime?: Date): string => {
    const now = new Date();
    const isToday = startTime.toDateString() === now.toDateString();
    const isYesterday = startTime.toDateString() === new Date(now.getTime() - 86400000).toDateString();
    const isSameYear = startTime.getFullYear() === now.getFullYear();

    const startTimeStr = startTime.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

    let prefix = '';
    if (isToday) {
      prefix = '';
    } else if (isYesterday) {
      prefix = 'Yesterday, ';
    } else {
      // Older than yesterday - show truncated date
      const dateOptions: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
      if (!isSameYear) {
        dateOptions.year = 'numeric';
      }
      prefix = startTime.toLocaleDateString([], dateOptions) + ', ';
    }

    if (endTime) {
      const endTimeStr = endTime.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
      return `${prefix}${startTimeStr} - ${endTimeStr}`;
    }

    return `${prefix}${startTimeStr}`;
  };

  const formatDuration = (startTime: Date, endTime?: Date): string => {
    if (!endTime) return 'In progress';

    const durationMs = endTime.getTime() - startTime.getTime();
    const durationSecs = Math.floor(durationMs / 1000);
    const durationMins = Math.floor(durationSecs / 60);
    const durationHours = Math.floor(durationMins / 60);

    if (durationHours > 0) {
      const remainingMins = durationMins % 60;
      return remainingMins > 0 ? `${durationHours}h ${remainingMins}m` : `${durationHours}h`;
    }

    if (durationMins > 0) {
      const remainingSecs = durationSecs % 60;
      return remainingSecs > 0 ? `${durationMins}m ${remainingSecs}s` : `${durationMins}m`;
    }

    return `${durationSecs}s`;
  };

  const getDisplayName = (fileName: string): string => {
    // Remove .csv extension
    const nameWithoutExt = fileName.replace(/\.csv$/, '');

    // Check if it's a default filename pattern: [device_]imu_YYYY-MM-DD_HH-MM-SS
    const defaultPattern = /^(?:.+?_)?imu_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}$/;

    // If it's a default filename, return empty string (we'll just show the date range)
    // Otherwise, return the custom filename truncated to 10 characters
    if (defaultPattern.test(nameWithoutExt)) {
      return '';
    }

    return nameWithoutExt.length > 10 ? nameWithoutExt.substring(0, 10) + '…' : nameWithoutExt;
  };

  if (isLoading) {
    return (
      <View style={[styles.container, styles.centerContent, { paddingTop: insets.top, backgroundColor: theme.colors.background }]}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
        <Text style={[styles.loadingText, { color: theme.colors.textSecondary }]}>Loading recordings...</Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      {/* Static Header */}
      <View style={[styles.header, { paddingTop: insets.top, backgroundColor: theme.colors.background, borderBottomColor: theme.colors.border }]}>
        <Text style={[styles.title, { color: theme.colors.textPrimary }]}>Data</Text>
        <TouchableOpacity onPress={handleRefresh} disabled={isRefreshing}>
          <RefreshCw
            size={24}
            color={theme.colors.textSecondary}
            style={isRefreshing ? styles.spinning : undefined}
          />
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.scrollView}
        refreshControl={
          <RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} tintColor={theme.colors.primary} />
        }>
        <View style={styles.content}>

        {recordings.length === 0 ? (
          <View style={styles.emptyState}>
            <FileText size={64} color={theme.colors.textTertiary} />
            <Text style={[styles.emptyTitle, { color: theme.colors.textPrimary }]}>No Data</Text>
            <Text style={[styles.emptyText, { color: theme.colors.textSecondary }]}>
              Start recording from a connected device to save sensor data
            </Text>
          </View>
        ) : (
          <>
            <Text style={[styles.subtitle, { color: theme.colors.textSecondary }]}>
              {recordings.length} recording{recordings.length !== 1 ? 's' : ''}
            </Text>

            {recordings.map((recording, index) => {
              const dateRange = formatDateRange(recording.startTime, recording.endTime);
              const duration = formatDuration(recording.startTime, recording.endTime);
              const displayName = getDisplayName(recording.fileName);
              const displayTitle = displayName ? `${displayName} - ${dateRange}` : dateRange;

              return (
                <TouchableOpacity
                  key={index}
                  style={[
                    styles.fileRow,
                    { borderBottomColor: theme.colors.border },
                    index === recordings.length - 1 && styles.lastFileRow
                  ]}
                  onPress={() => navigation.navigate('DataDetail', {
                    fileName: recording.fileName,
                    filePath: recording.filePath
                  })}>
                  <View style={styles.fileRowContent}>
                    <View style={styles.fileRowLeft}>
                      <Activity size={20} color={theme.colors.primary} />
                      <View style={styles.fileRowInfo}>
                        <Text style={[styles.fileRowName, { color: theme.colors.textPrimary }]} numberOfLines={1}>
                          {displayTitle}
                        </Text>
                        <View style={styles.fileRowMeta}>
                          <Text style={[styles.fileRowMetaText, { color: theme.colors.textSecondary }]}>
                            {duration}
                          </Text>
                          <Text style={[styles.fileRowDivider, { color: theme.colors.textTertiary }]}> • </Text>
                          <Text style={[styles.fileRowMetaText, { color: theme.colors.textSecondary }]}>
                            {recording.sampleCount.toLocaleString()} samples
                          </Text>
                          <Text style={[styles.fileRowDivider, { color: theme.colors.textTertiary }]}> • </Text>
                          <Text style={[styles.fileRowMetaText, { color: theme.colors.textSecondary }]}>
                            {formatFileSize(recording.fileSize)}
                          </Text>
                        </View>
                      </View>
                    </View>
                    <TouchableOpacity
                      onPress={(e) => {
                        e.stopPropagation();
                        handleDeleteRecording(recording);
                      }}
                      style={styles.fileRowDelete}
                      hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                      <Trash2 size={18} color={theme.colors.error} />
                    </TouchableOpacity>
                  </View>
                </TouchableOpacity>
              );
            })}
          </>
        )}
      </View>
    </ScrollView>

    <ConfirmDialog
      visible={recordingToDelete !== null}
      onDismiss={() => setRecordingToDelete(null)}
      title="Delete Recording"
      message={recordingToDelete ? `Delete recording from ${formatDateRange(recordingToDelete.startTime, recordingToDelete.endTime)}? This cannot be undone.` : ''}
      icon={<AlertCircle size={48} color={theme.colors.error} />}
      actions={[
        {
          label: 'Cancel',
          onPress: () => setRecordingToDelete(null),
          variant: 'default',
        },
        {
          label: 'Delete',
          onPress: confirmDelete,
          variant: 'danger',
        },
      ]}
    />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: staticTheme.colors.background,
  },
  centerContent: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  scrollView: {
    flex: 1,
  },
  content: {
    padding: staticTheme.spacing.lg,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: staticTheme.spacing.lg,
    paddingVertical: staticTheme.spacing.md,
    backgroundColor: staticTheme.colors.background,
    borderBottomWidth: 1,
    borderBottomColor: staticTheme.colors.border,
  },
  title: {
    fontSize: staticTheme.typography.fontSize.xxl,
    fontWeight: staticTheme.typography.fontWeight.light,
    fontFamily: staticTheme.typography.serif,
    color: staticTheme.colors.textPrimary,
  },
  subtitle: {
    fontSize: staticTheme.typography.fontSize.sm,
    color: staticTheme.colors.textSecondary,
    fontFamily: staticTheme.typography.serif,
    marginBottom: staticTheme.spacing.md,
  },
  loadingText: {
    fontSize: staticTheme.typography.fontSize.md,
    color: staticTheme.colors.textSecondary,
    fontFamily: staticTheme.typography.serif,
    marginTop: staticTheme.spacing.md,
  },
  spinning: {
    transform: [{ rotate: '45deg' }],
  },
  emptyState: {
    alignItems: 'center',
    padding: staticTheme.spacing.xxl,
    marginTop: staticTheme.spacing.xxl,
  },
  emptyTitle: {
    fontSize: staticTheme.typography.fontSize.xl,
    fontWeight: staticTheme.typography.fontWeight.semibold,
    color: staticTheme.colors.textPrimary,
    fontFamily: staticTheme.typography.serif,
    marginTop: staticTheme.spacing.lg,
    marginBottom: staticTheme.spacing.sm,
  },
  emptyText: {
    fontSize: staticTheme.typography.fontSize.md,
    color: staticTheme.colors.textSecondary,
    fontFamily: staticTheme.typography.serif,
    textAlign: 'center',
    lineHeight: 22,
  },
  fileRow: {
    borderBottomWidth: 1,
    paddingVertical: staticTheme.spacing.md,
  },
  lastFileRow: {
    borderBottomWidth: 0,
  },
  fileRowContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  fileRowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: staticTheme.spacing.md,
  },
  fileRowInfo: {
    flex: 1,
  },
  fileRowName: {
    fontSize: staticTheme.typography.fontSize.md,
    fontWeight: staticTheme.typography.fontWeight.medium,
    fontFamily: staticTheme.typography.serif,
    marginBottom: 4,
  },
  fileRowMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
  },
  fileRowMetaText: {
    fontSize: staticTheme.typography.fontSize.xs,
    fontFamily: staticTheme.typography.mono,
  },
  fileRowDivider: {
    fontSize: staticTheme.typography.fontSize.xs,
  },
  fileRowDelete: {
    padding: staticTheme.spacing.xs,
    marginLeft: staticTheme.spacing.sm,
  },
});

export default DataScreen;

