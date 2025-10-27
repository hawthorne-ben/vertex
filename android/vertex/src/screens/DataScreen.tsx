/**
 * Data Screen
 *
 * Lists recorded IMU data files
 */

import React, { useState, useEffect } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, RefreshControl, ActivityIndicator, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { FileText, Trash2, RefreshCw, Clock, Database, Activity } from 'lucide-react-native';
import { theme } from '../styles/theme';
import FileService, { RecordingMetadata } from '../services/FileService';
import { RootStackParamList } from '../navigation/AppNavigator';

type NavigationProp = NativeStackNavigationProp<RootStackParamList>;

const DataScreen: React.FC = () => {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<NavigationProp>();
  const [recordings, setRecordings] = useState<RecordingMetadata[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Reload recordings when screen comes into focus
  useFocusEffect(
    React.useCallback(() => {
      loadRecordings();
    }, [])
  );

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
    Alert.alert(
      'Delete Recording',
      `Delete ${recording.fileName}?\n\nThis cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await FileService.deleteRecording(recording.fileName);
              loadRecordings();
            } catch (error) {
              console.error('[DataScreen] Error deleting recording:', error);
              Alert.alert('Error', 'Failed to delete recording');
            }
          },
        },
      ]
    );
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

  if (isLoading) {
    return (
      <View style={[styles.container, styles.centerContent, { paddingTop: insets.top }]}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
        <Text style={styles.loadingText}>Loading recordings...</Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Static Header */}
      <View style={styles.header}>
        <Text style={styles.title}>Recordings</Text>
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
            <Text style={styles.emptyTitle}>No Recordings</Text>
            <Text style={styles.emptyText}>
              Start recording from a connected device to save sensor data
            </Text>
          </View>
        ) : (
          <>
            <Text style={styles.subtitle}>{recordings.length} recording{recordings.length !== 1 ? 's' : ''}</Text>

            {recordings.map((recording, index) => {
              // Extract a display name from filename if deviceName is missing
              const displayName = recording.deviceName ||
                recording.fileName.split('_imu_')[0].replace(/_/g, ' ') ||
                'IMU Recording';

              return (
                <TouchableOpacity
                  key={index}
                  style={styles.fileCard}
                  onPress={() => navigation.navigate('DataDetail', {
                    fileName: recording.fileName,
                    filePath: recording.filePath
                  })}>
                  <View style={styles.fileHeader}>
                    <View style={styles.fileIcon}>
                      <Activity size={24} color={theme.colors.primary} />
                    </View>
                    <View style={styles.fileInfo}>
                      <Text style={styles.fileName} numberOfLines={1}>
                        {displayName}
                      </Text>
                      <Text style={styles.fileDate}>{formatDate(recording.startTime)}</Text>
                    </View>
                    <TouchableOpacity
                      onPress={() => handleDeleteRecording(recording)}
                      style={styles.deleteButton}>
                      <Trash2 size={20} color={theme.colors.error} />
                    </TouchableOpacity>
                  </View>

                <View style={styles.fileStats}>
                  <View style={styles.statItem}>
                    <Database size={14} color={theme.colors.textSecondary} />
                    <Text style={styles.statText}>{recording.sampleCount.toLocaleString()} samples</Text>
                  </View>
                  <View style={styles.statItem}>
                    <Clock size={14} color={theme.colors.textSecondary} />
                    <Text style={styles.statText}>{formatFileSize(recording.fileSize)}</Text>
                  </View>
                </View>

                <Text style={styles.fileNameSmall} numberOfLines={1}>
                  {recording.fileName}
                </Text>
                </TouchableOpacity>
              );
            })}
          </>
        )}
      </View>
    </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  centerContent: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  scrollView: {
    flex: 1,
  },
  content: {
    padding: theme.spacing.lg,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.md,
    backgroundColor: theme.colors.background,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  title: {
    fontSize: theme.typography.fontSize.xxxl,
    fontWeight: theme.typography.fontWeight.light,
    color: theme.colors.textPrimary,
    fontFamily: theme.typography.serif,
  },
  subtitle: {
    fontSize: theme.typography.fontSize.sm,
    color: theme.colors.textSecondary,
    fontFamily: theme.typography.serif,
    marginBottom: theme.spacing.md,
  },
  loadingText: {
    fontSize: theme.typography.fontSize.md,
    color: theme.colors.textSecondary,
    fontFamily: theme.typography.serif,
    marginTop: theme.spacing.md,
  },
  spinning: {
    transform: [{ rotate: '45deg' }],
  },
  emptyState: {
    alignItems: 'center',
    padding: theme.spacing.xxl,
    marginTop: theme.spacing.xxl,
  },
  emptyTitle: {
    fontSize: theme.typography.fontSize.xl,
    fontWeight: theme.typography.fontWeight.semibold,
    color: theme.colors.textPrimary,
    fontFamily: theme.typography.serif,
    marginTop: theme.spacing.lg,
    marginBottom: theme.spacing.sm,
  },
  emptyText: {
    fontSize: theme.typography.fontSize.md,
    color: theme.colors.textSecondary,
    fontFamily: theme.typography.serif,
    textAlign: 'center',
    lineHeight: 22,
  },
  fileCard: {
    backgroundColor: theme.colors.muted,
    padding: theme.spacing.lg,
    borderRadius: theme.borderRadius.md,
    marginBottom: theme.spacing.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  fileHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: theme.spacing.md,
  },
  fileIcon: {
    marginRight: theme.spacing.md,
    paddingVertical: theme.spacing.xs,
  },
  fileInfo: {
    flex: 1,
  },
  fileName: {
    fontSize: theme.typography.fontSize.md,
    fontWeight: theme.typography.fontWeight.semibold,
    color: theme.colors.textPrimary,
    fontFamily: theme.typography.serif,
    marginBottom: 2,
  },
  fileDate: {
    fontSize: theme.typography.fontSize.xs,
    color: theme.colors.textSecondary,
    fontFamily: theme.typography.serif,
  },
  deleteButton: {
    padding: theme.spacing.sm,
    marginLeft: theme.spacing.sm,
  },
  fileStats: {
    flexDirection: 'row',
    gap: theme.spacing.md,
    marginBottom: theme.spacing.sm,
  },
  statItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  statText: {
    fontSize: theme.typography.fontSize.xs,
    color: theme.colors.textSecondary,
    fontFamily: theme.typography.serif,
  },
  fileNameSmall: {
    fontSize: theme.typography.fontSize.xs,
    color: theme.colors.textTertiary,
    fontFamily: theme.typography.mono,
    marginTop: theme.spacing.xs,
  },
});

export default DataScreen;

