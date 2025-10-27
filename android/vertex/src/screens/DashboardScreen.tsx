/**
 * Dashboard Screen
 *
 * Shows stats overview and recent rides
 */

import React, { useState, useEffect } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Circle, CheckCircle } from 'lucide-react-native';
import { theme } from '../styles/theme';
import BleService from '../services/BleService';
import { RootStackParamList } from '../navigation/AppNavigator';

type NavigationProp = NativeStackNavigationProp<RootStackParamList>;

const DashboardScreen: React.FC = () => {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<NavigationProp>();
  const [connectedDevice, setConnectedDevice] = useState<{ id: string; name: string } | null>(null);

  // Placeholder data
  const stats = {
    totalRides: 12,
    totalHours: 18.5,
    maxLeanAngle: 42.3,
    storageUsed: 284,
    storageUnit: 'MB',
  };

  // Check for connected Vertex device
  useFocusEffect(
    React.useCallback(() => {
      checkConnection();
    }, [])
  );

  const checkConnection = () => {
    const device = BleService.getConnectedDevice();
    if (device && device.name?.toLowerCase().includes('vertex')) {
      setConnectedDevice({ id: device.id, name: device.name });
    } else {
      setConnectedDevice(null);
    }
  };

  const handleStartRecording = () => {
    if (connectedDevice) {
      navigation.navigate('Record', {
        deviceId: connectedDevice.id,
        deviceName: connectedDevice.name,
      });
    }
  };

  const isVertexConnected = connectedDevice !== null;

  return (
    <ScrollView style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.content}>
        <Text style={styles.title}>Dashboard</Text>

        {/* Record CTA - Show when Vertex device is connected */}
        {isVertexConnected && (
          <TouchableOpacity style={styles.recordCTA} onPress={handleStartRecording}>
            <View style={styles.recordCTAContent}>
              <Circle size={32} color={theme.colors.primaryForeground} fill={theme.colors.error} />
              <View style={styles.recordCTAText}>
                <Text style={styles.recordCTATitle}>Start Recording</Text>
                <Text style={styles.recordCTASubtitle}>{connectedDevice.name} connected</Text>
              </View>
            </View>
            <View style={styles.recordCTAIcon}>
              <CheckCircle size={24} color={theme.colors.success} />
            </View>
          </TouchableOpacity>
        )}

        {/* Stats Grid */}
        <View style={styles.statsGrid}>
          <View style={styles.statCard}>
            <Text style={styles.statLabel}>Total Rides</Text>
            <Text style={styles.statValue}>{stats.totalRides}</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statLabel}>Total Hours</Text>
            <Text style={styles.statValue}>{stats.totalHours}h</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statLabel}>Max Lean Angle</Text>
            <Text style={styles.statValue}>{stats.maxLeanAngle}°</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statLabel}>Storage Used</Text>
            <Text style={styles.statValue}>{stats.storageUsed} {stats.storageUnit}</Text>
          </View>
        </View>

        {/* Recent Activity */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Recent Rides</Text>
          <View style={styles.activityCard}>
            <Text style={styles.activityText}>
              Mountain Ride - 12.3 mi, 45 min ago
            </Text>
            <Text style={styles.activityText}>
              Track Day Session 1 - 5.8 mi, 2 days ago
            </Text>
            <Text style={styles.activityText}>
              City Commute - 8.1 mi, 5 days ago
            </Text>
          </View>
        </View>

        {/* Quick Stats */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Last 30 Days</Text>
          <View style={styles.quickStats}>
            <View style={styles.quickStatRow}>
              <Text style={styles.quickStatLabel}>Rides</Text>
              <Text style={styles.quickStatValue}>12</Text>
            </View>
            <View style={styles.quickStatRow}>
              <Text style={styles.quickStatLabel}>Total Distance</Text>
              <Text style={styles.quickStatValue}>284 mi</Text>
            </View>
            <View style={styles.quickStatRow}>
              <Text style={styles.quickStatLabel}>Total Time</Text>
              <Text style={styles.quickStatValue}>18.5 h</Text>
            </View>
            <View style={styles.quickStatRow}>
              <Text style={styles.quickStatLabel}>Avg Lean Angle</Text>
              <Text style={styles.quickStatValue}>32.4°</Text>
            </View>
          </View>
        </View>
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  content: {
    padding: theme.spacing.lg,
  },
  title: {
    fontSize: theme.typography.fontSize.xxxl,
    fontWeight: theme.typography.fontWeight.light,
    marginBottom: theme.spacing.lg,
    color: theme.colors.textPrimary,
    fontFamily: theme.typography.serif,
  },
  recordCTA: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: theme.colors.error,
    borderRadius: theme.borderRadius.md,
    padding: theme.spacing.lg,
    marginBottom: theme.spacing.lg,
    borderWidth: 1,
    borderColor: theme.colors.error,
  },
  recordCTAContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.md,
    flex: 1,
  },
  recordCTAText: {
    flex: 1,
  },
  recordCTATitle: {
    fontSize: theme.typography.fontSize.lg,
    fontWeight: theme.typography.fontWeight.semibold,
    color: theme.colors.primaryForeground,
    fontFamily: theme.typography.serif,
    marginBottom: 2,
  },
  recordCTASubtitle: {
    fontSize: theme.typography.fontSize.sm,
    color: theme.colors.primaryForeground + 'CC',
    fontFamily: theme.typography.serif,
  },
  recordCTAIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: theme.colors.primaryForeground,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginBottom: theme.spacing.lg,
  },
  statCard: {
    backgroundColor: theme.colors.muted,
    padding: theme.spacing.lg,
    borderRadius: theme.borderRadius.md,
    width: '47%',
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  statLabel: {
    fontSize: theme.typography.fontSize.xs,
    color: theme.colors.textSecondary,
    marginBottom: 4,
    fontWeight: theme.typography.fontWeight.medium,
    fontFamily: theme.typography.serif,
  },
  statValue: {
    fontSize: theme.typography.fontSize.xl,
    fontWeight: theme.typography.fontWeight.semibold,
    color: theme.colors.textPrimary,
    fontFamily: theme.typography.serif,
  },
  section: {
    marginBottom: theme.spacing.lg,
  },
  sectionTitle: {
    fontSize: theme.typography.fontSize.lg,
    fontWeight: theme.typography.fontWeight.medium,
    marginBottom: theme.spacing.md,
    color: theme.colors.textPrimary,
  },
  activityCard: {
    backgroundColor: theme.colors.muted,
    padding: theme.spacing.lg,
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  activityText: {
    fontSize: theme.typography.fontSize.sm,
    color: theme.colors.textPrimary,
    marginBottom: theme.spacing.sm,
    fontFamily: theme.typography.serif,
  },
  quickStats: {
    backgroundColor: theme.colors.muted,
    padding: theme.spacing.lg,
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  quickStatRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: theme.spacing.sm,
  },
  quickStatLabel: {
    fontSize: theme.typography.fontSize.sm,
    color: theme.colors.textSecondary,
    fontFamily: theme.typography.serif,
  },
  quickStatValue: {
    fontSize: theme.typography.fontSize.sm,
    fontWeight: theme.typography.fontWeight.semibold,
    color: theme.colors.textPrimary,
    fontFamily: theme.typography.serif,
  },
});

export default DashboardScreen;

