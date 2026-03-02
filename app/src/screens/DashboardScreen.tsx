/**
 * Dashboard Screen
 *
 * Shows stats overview and recent rides
 * Refactored with new component library
 */

import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { Circle, Bluetooth } from 'lucide-react-native';
import { useTheme } from '../contexts/ThemeContext';
import { theme as staticTheme } from '../styles/theme';
import { Card } from '../components/ui';
import { RootStackNavigationProp } from '../types/navigation.types';
import { useDeviceStore } from '../stores/deviceStore';
import { useDataStore } from '../stores/dataStore';

const DashboardScreen: React.FC = () => {
  const insets = useSafeAreaInsets();
  const { theme, isDark } = useTheme();
  const navigation = useNavigation<RootStackNavigationProp<'Tabs'>>();

  // Use deviceStore for connection and saved devices
  const {
    deviceId,
    deviceName,
    isConnected,
    savedDevices,
    loadSavedDevices,
  } = useDeviceStore();

  // Use dataStore for recordings and stats
  const {
    recordings,
    stats,
    loadRecordings,
  } = useDataStore();

  // Load data when screen comes into focus
  useFocusEffect(
    React.useCallback(() => {
      loadSavedDevices();
      loadRecordings();
    }, [])
  );

  const handleStartRecording = () => {
    if (deviceId && deviceName) {
      const device = savedDevices.find(d => d.id === deviceId);
      if (device?.name.includes('Vertex-V2') || device?.firmwareVersion === 'v2') {
        navigation.navigate('DeviceDetailV2', { deviceId, deviceName });
      } else {
        navigation.navigate('Record', { deviceId, deviceName });
      }
    }
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const formatDuration = (startTime?: Date, endTime?: Date): string => {
    if (!startTime || !endTime) return 'Unknown';
    const durationSec = (endTime.getTime() - startTime.getTime()) / 1000;
    if (durationSec < 60) return `${Math.round(durationSec)}s`;
    if (durationSec < 3600) return `${Math.round(durationSec / 60)}m`;
    const hours = Math.floor(durationSec / 3600);
    const mins = Math.round((durationSec % 3600) / 60);
    return `${hours}h ${mins}m`;
  };

  const formatTotalDuration = (totalHours: number): string => {
    if (totalHours === 0) return '0s';
    const totalSec = totalHours * 3600;
    if (totalSec < 60) return `${Math.round(totalSec)}s`;
    if (totalSec < 3600) return `${Math.round(totalSec / 60)}m`;
    const hours = Math.floor(totalSec / 3600);
    const mins = Math.round((totalSec % 3600) / 60);
    if (hours === 0) return `${mins}m`;
    if (mins === 0) return `${hours}h`;
    return `${hours}h ${mins}m`;
  };

  const formatDateRange = (startTime?: Date, endTime?: Date): string => {
    if (!startTime) return 'Unknown date';
    const startStr = startTime.toLocaleDateString();
    if (!endTime) return startStr;
    const endStr = endTime.toLocaleDateString();
    return startStr === endStr ? startStr : `${startStr} - ${endStr}`;
  };

  const isVertexConnected = isConnected && deviceId !== null;

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      {/* Translucent Header */}
      <View style={[styles.header, { paddingTop: insets.top, backgroundColor: isDark ? 'rgba(0,0,0,0.85)' : 'rgba(255,255,255,0.92)' }]}>
        <Text style={[styles.title, { color: theme.colors.textPrimary }]}>
          Dashboard
        </Text>
      </View>

      <ScrollView style={styles.scrollView} contentContainerStyle={{ paddingTop: insets.top + 56 }}>
        <View style={styles.content}>
          {/* Record Button - Show when Vertex device is connected */}
          {isVertexConnected && (
            <TouchableOpacity
              style={[styles.recordButton, {
                backgroundColor: theme.colors.card,
                borderColor: theme.colors.error,
                borderWidth: 2,
              }]}
              onPress={handleStartRecording}>
              <Text style={[styles.recordButtonText, { color: theme.colors.error }]}>
                Start Recording
              </Text>
              <Circle size={16} color={theme.colors.error} fill={theme.colors.error} />
            </TouchableOpacity>
          )}

          {/* Devices Card */}
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: theme.colors.textPrimary }]}>
              Devices
            </Text>
            <Card variant="default" padding="lg">
              {savedDevices.length === 0 ? (
                <Text style={[styles.emptyText, { color: theme.colors.textSecondary }]}>
                  No saved Vertex devices
                </Text>
              ) : (
                savedDevices.map((device, idx) => {
                  const deviceConnected = isConnected && deviceId === device.id;
                  return (
                    <TouchableOpacity
                      key={device.id}
                      style={[styles.deviceRow, idx > 0 && styles.deviceRowBorder]}
                      onPress={() => {
                        const screen = (device.name.includes('Vertex-V2') || device.firmwareVersion === 'v2')
                          ? 'DeviceDetailV2' : 'DeviceDetail';
                        navigation.navigate(screen, {
                          deviceId: device.id,
                          deviceName: device.name,
                        });
                      }}
                    >
                      <View style={styles.deviceInfo}>
                        <Text style={[styles.deviceName, { color: theme.colors.textPrimary }]}>
                          {device.name}
                        </Text>
                        <Text style={[styles.deviceId, { color: theme.colors.textTertiary }]}>
                          {device.id}
                        </Text>
                      </View>
                      <View style={[
                        styles.connectionBadge,
                        { backgroundColor: deviceConnected ? theme.colors.successBg : theme.colors.muted }
                      ]}>
                        <Bluetooth
                          size={14}
                          color={deviceConnected ? theme.colors.success : theme.colors.textTertiary}
                        />
                        <Text style={[
                          styles.connectionBadgeText,
                          { color: deviceConnected ? theme.colors.success : theme.colors.textTertiary }
                        ]}>
                          {deviceConnected ? 'Connected' : 'Saved'}
                        </Text>
                      </View>
                    </TouchableOpacity>
                  );
                })
              )}
            </Card>
          </View>

          {/* Stats Section */}
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: theme.colors.textPrimary }]}>
              Stats
            </Text>
            <View style={styles.statsStack}>
              <Card variant="default" padding="lg">
                <View style={styles.statRow}>
                  <Text style={[styles.statLabel, { color: theme.colors.textSecondary }]}>
                    Total Recordings
                  </Text>
                  <Text style={[styles.statValue, { color: theme.colors.textPrimary }]}>
                    {stats.totalRecordings}
                  </Text>
                </View>
              </Card>

              <Card variant="default" padding="lg">
                <View style={styles.statRow}>
                  <Text style={[styles.statLabel, { color: theme.colors.textSecondary }]}>
                    Total Duration
                  </Text>
                  <Text style={[styles.statValue, { color: theme.colors.textPrimary }]}>
                    {formatTotalDuration(stats.totalHours)}
                  </Text>
                </View>
              </Card>

              <Card variant="default" padding="lg">
                <View style={styles.statRow}>
                  <Text style={[styles.statLabel, { color: theme.colors.textSecondary }]}>
                    Storage Used
                  </Text>
                  <Text style={[styles.statValue, { color: theme.colors.textPrimary }]}>
                    {stats.storageUsed > 0 ? `${stats.storageUsed} MB` : '0 MB'}
                  </Text>
                </View>
              </Card>
            </View>
          </View>

          {/* Recent Recordings */}
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: theme.colors.textPrimary }]}>
              Recent Recordings
            </Text>
            <TouchableOpacity
              onPress={() => navigation.navigate('Data')}
              activeOpacity={0.7}
            >
              <Card variant="default" padding="lg">
                {recordings.length === 0 ? (
                  <Text style={[styles.emptyText, { color: theme.colors.textSecondary }]}>
                    No recordings yet
                  </Text>
                ) : (
                  recordings.slice(0, 5).map((rec, idx) => (
                    <View
                      key={rec.fileName}
                      style={[styles.recordingRow, idx > 0 && styles.recordingRowBorder]}
                    >
                      <View style={styles.recordingInfo}>
                        <Text style={[styles.recordingDate, { color: theme.colors.textPrimary }]}>
                          {formatDateRange(rec.startTime, rec.endTime)}
                        </Text>
                        <Text style={[styles.recordingMeta, { color: theme.colors.textSecondary }]}>
                          {formatDuration(rec.startTime, rec.endTime)} • {formatFileSize(rec.fileSize)}
                        </Text>
                      </View>
                    </View>
                  ))
                )}
              </Card>
            </TouchableOpacity>
          </View>
        </View>
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
    paddingHorizontal: 24,
    paddingVertical: 16,
  },
  title: {
    fontSize: 32,
    fontWeight: '300',
    fontFamily: staticTheme.typography.serif,
  },
  scrollView: {
    flex: 1,
  },
  content: {
    padding: 24,
  },
  recordButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: staticTheme.spacing.md,
    paddingHorizontal: staticTheme.spacing.lg,
    borderRadius: staticTheme.borderRadius.md,
    borderWidth: 1,
    marginBottom: staticTheme.spacing.md,
  },
  recordButtonText: {
    fontSize: staticTheme.typography.fontSize.md,
    fontWeight: staticTheme.typography.fontWeight.medium,
    fontFamily: staticTheme.typography.serif,
  },
  statsStack: {
    flexDirection: 'column',
    gap: 12,
  },
  statRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  statLabel: {
    fontSize: 14,
    fontFamily: staticTheme.typography.serif,
  },
  statValue: {
    fontSize: 18,
    fontWeight: '600',
    fontFamily: staticTheme.typography.mono,
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '500',
    fontFamily: staticTheme.typography.serif,
    marginBottom: 16,
  },
  emptyText: {
    fontSize: 14,
    fontFamily: staticTheme.typography.serif,
    fontStyle: 'italic',
  },
  deviceRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
  },
  deviceRowBorder: {
    borderTopWidth: 1,
    borderTopColor: staticTheme.colors.border,
    marginTop: 8,
    paddingTop: 12,
  },
  deviceInfo: {
    flex: 1,
  },
  deviceName: {
    fontSize: 14,
    fontWeight: '500',
    fontFamily: staticTheme.typography.serif,
    marginBottom: 2,
  },
  deviceId: {
    fontSize: 12,
    fontFamily: staticTheme.typography.mono,
  },
  connectionBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
  },
  connectionBadgeText: {
    fontSize: 12,
    fontWeight: '500',
    fontFamily: staticTheme.typography.serif,
  },
  recordingRow: {
    paddingVertical: 8,
  },
  recordingRowBorder: {
    borderTopWidth: 1,
    borderTopColor: staticTheme.colors.border,
    marginTop: 8,
    paddingTop: 12,
  },
  recordingInfo: {
    flex: 1,
  },
  recordingDate: {
    fontSize: 14,
    fontWeight: '500',
    fontFamily: staticTheme.typography.serif,
    marginBottom: 4,
  },
  recordingMeta: {
    fontSize: 12,
    fontFamily: staticTheme.typography.mono,
  },
});

export default DashboardScreen;
