/**
 * Rides Screen
 *
 * Lists all rides from the web API with mini-metrics.
 */

import React, { useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Bike, Zap, Heart, Activity } from 'lucide-react-native';
import { useTheme } from '../contexts/ThemeContext';
import { theme as staticTheme } from '../styles/theme';
import { useRideStore, Ride } from '../stores/rideStore';
import { RootStackParamList } from '../navigation/AppNavigator';

type NavigationProp = NativeStackNavigationProp<RootStackParamList>;

// --- Formatting helpers ---

function formatDistance(meters: number | null): string {
  if (meters == null) return '—';
  const miles = meters / 1609.344;
  return `${miles.toFixed(1)} mi`;
}

function formatElevation(meters: number | null): string {
  if (meters == null) return '—';
  const feet = meters * 3.28084;
  return `${Math.round(feet)} ft`;
}

function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  if (hours > 0) return `${hours}h ${mins}m`;
  const secs = seconds % 60;
  if (mins > 0) return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
  return `${secs}s`;
}

function formatDate(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffDays === 0) {
    return 'Today, ' + date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }
  if (diffDays === 1) {
    return 'Yesterday, ' + date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }

  const options: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
  if (date.getFullYear() !== now.getFullYear()) {
    options.year = 'numeric';
  }
  return date.toLocaleDateString([], options) + ', ' + date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

// --- Components ---

function RideCard({ ride, onPress }: { ride: Ride; onPress: () => void }) {
  const { theme } = useTheme();
  const analysis = ride.analysis_results;
  const summary = ride.summary;

  return (
    <TouchableOpacity
      style={[styles.rideCard, { backgroundColor: theme.colors.card, borderColor: theme.colors.border }]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      {/* Title row */}
      <View style={styles.cardHeader}>
        <Bike size={18} color={theme.colors.primary} />
        <Text style={[styles.rideName, { color: theme.colors.textPrimary }]} numberOfLines={1}>
          {ride.name}
        </Text>
      </View>
      <Text style={[styles.rideDate, { color: theme.colors.textSecondary }]}>
        {formatDate(ride.start_time)}
      </Text>

      {/* Primary metrics */}
      <View style={styles.metricsRow}>
        <MetricItem label="Distance" value={formatDistance(ride.distance_meters)} />
        <MetricItem label="Elevation" value={formatElevation(ride.elevation_gain_meters)} />
        <MetricItem label="Duration" value={formatDuration(ride.duration_seconds)} />
        {analysis?.avg_speed_mph != null && (
          <MetricItem label="Avg Speed" value={`${analysis.avg_speed_mph.toFixed(1)} mph`} />
        )}
      </View>

      {/* Summary mini-metrics (if available) */}
      {summary && (
        <View style={[styles.summaryRow, { borderTopColor: theme.colors.border }]}>
          {summary.avg_power_watts != null && (
            <MiniMetric
              icon={<Zap size={12} color={theme.colors.textTertiary} />}
              value={`${Math.round(summary.avg_power_watts)}W`}
            />
          )}
          {summary.avg_heart_rate != null && (
            <MiniMetric
              icon={<Heart size={12} color={theme.colors.textTertiary} />}
              value={`${Math.round(summary.avg_heart_rate)} bpm`}
            />
          )}
          {summary.avg_efficiency_percent != null && (
            <MiniMetric
              icon={<Activity size={12} color={theme.colors.textTertiary} />}
              value={`${summary.avg_efficiency_percent.toFixed(0)}% eff`}
            />
          )}
          {summary.standing_percent != null && (
            <MiniMetric
              value={`${summary.standing_percent.toFixed(0)}% standing`}
            />
          )}
        </View>
      )}
    </TouchableOpacity>
  );
}

function MetricItem({ label, value }: { label: string; value: string }) {
  const { theme } = useTheme();
  return (
    <View style={styles.metricItem}>
      <Text style={[styles.metricLabel, { color: theme.colors.textSecondary }]}>{label}</Text>
      <Text style={[styles.metricValue, { color: theme.colors.textPrimary }]}>{value}</Text>
    </View>
  );
}

function MiniMetric({ icon, value }: { icon?: React.ReactNode; value: string }) {
  const { theme } = useTheme();
  return (
    <View style={styles.miniMetric}>
      {icon}
      <Text style={[styles.miniMetricText, { color: theme.colors.textTertiary }]}>{value}</Text>
    </View>
  );
}

// --- Screen ---

const RidesScreen: React.FC = () => {
  const insets = useSafeAreaInsets();
  const { theme, isDark } = useTheme();
  const navigation = useNavigation<NavigationProp>();

  const { rides, isLoading, isRefreshing, error, loadRides, refreshRides } = useRideStore();

  useEffect(() => {
    loadRides();
  }, []);

  if (isLoading && rides.length === 0) {
    return (
      <View style={[styles.container, styles.centerContent, { paddingTop: insets.top, backgroundColor: theme.colors.background }]}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
        <Text style={[styles.loadingText, { color: theme.colors.textSecondary }]}>Loading rides...</Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top, backgroundColor: isDark ? 'rgba(0,0,0,0.85)' : 'rgba(255,255,255,0.92)' }]}>
        <Text style={[styles.title, { color: theme.colors.textPrimary }]}>Rides</Text>
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={[styles.content, { paddingTop: insets.top + 56 }]}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={refreshRides}
            tintColor={theme.colors.primary}
          />
        }
      >
        {rides.length > 0 && (
          <Text style={[styles.subtitle, { color: theme.colors.textSecondary }]}>
            {rides.length} ride{rides.length !== 1 ? 's' : ''}
          </Text>
        )}

        {error && rides.length === 0 && (
          <View style={styles.errorState}>
            <Text style={[styles.errorText, { color: theme.colors.error }]}>{error}</Text>
            <TouchableOpacity onPress={() => loadRides()} style={[styles.retryButton, { borderColor: theme.colors.border }]}>
              <Text style={[styles.retryText, { color: theme.colors.textPrimary }]}>Retry</Text>
            </TouchableOpacity>
          </View>
        )}

        {rides.length === 0 && !error && (
          <View style={styles.emptyState}>
            <Bike size={64} color={theme.colors.textTertiary} />
            <Text style={[styles.emptyTitle, { color: theme.colors.textPrimary }]}>No Rides Yet</Text>
            <Text style={[styles.emptyText, { color: theme.colors.textSecondary }]}>
              Upload a FIT file from the web app to see your rides here.
            </Text>
          </View>
        )}

        {rides.map((ride) => (
          <RideCard
            key={ride.id}
            ride={ride}
            onPress={() => navigation.navigate('RideDetail', { rideId: ride.id })}
          />
        ))}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  centerContent: {
    justifyContent: 'center',
    alignItems: 'center',
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
    fontSize: staticTheme.typography.fontSize.xxl,
    fontWeight: staticTheme.typography.fontWeight.light,
    fontFamily: staticTheme.typography.serif,
  },
  subtitle: {
    fontSize: staticTheme.typography.fontSize.sm,
    fontFamily: staticTheme.typography.serif,
    marginBottom: 12,
  },
  scrollView: {
    flex: 1,
  },
  content: {
    padding: 24,
    paddingBottom: 48,
  },
  loadingText: {
    fontSize: staticTheme.typography.fontSize.md,
    fontFamily: staticTheme.typography.serif,
    marginTop: staticTheme.spacing.md,
  },

  // Ride card
  rideCard: {
    borderRadius: staticTheme.borderRadius.md,
    borderWidth: 1,
    padding: 16,
    marginBottom: 12,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 2,
  },
  rideName: {
    fontSize: staticTheme.typography.fontSize.lg,
    fontWeight: staticTheme.typography.fontWeight.medium,
    fontFamily: staticTheme.typography.serif,
    flex: 1,
  },
  rideDate: {
    fontSize: staticTheme.typography.fontSize.sm,
    fontFamily: staticTheme.typography.serif,
    marginBottom: 12,
    marginLeft: 26, // align with name (icon width + gap)
  },
  metricsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 16,
  },
  metricItem: {
  },
  metricLabel: {
    fontSize: staticTheme.typography.fontSize.xs,
    fontFamily: staticTheme.typography.serif,
  },
  metricValue: {
    fontSize: staticTheme.typography.fontSize.sm,
    fontWeight: staticTheme.typography.fontWeight.semibold,
    fontFamily: staticTheme.typography.mono,
  },
  summaryRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginTop: 12,
    paddingTop: 10,
    borderTopWidth: 1,
  },
  miniMetric: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  miniMetricText: {
    fontSize: staticTheme.typography.fontSize.xs,
    fontFamily: staticTheme.typography.mono,
  },

  // States
  emptyState: {
    alignItems: 'center',
    paddingTop: 64,
    paddingHorizontal: 32,
  },
  emptyTitle: {
    fontSize: staticTheme.typography.fontSize.xl,
    fontWeight: staticTheme.typography.fontWeight.semibold,
    fontFamily: staticTheme.typography.serif,
    marginTop: 16,
    marginBottom: 8,
  },
  emptyText: {
    fontSize: staticTheme.typography.fontSize.md,
    fontFamily: staticTheme.typography.serif,
    textAlign: 'center',
    lineHeight: 22,
  },
  errorState: {
    alignItems: 'center',
    paddingTop: 64,
  },
  errorText: {
    fontSize: staticTheme.typography.fontSize.md,
    fontFamily: staticTheme.typography.serif,
    marginBottom: 16,
  },
  retryButton: {
    paddingVertical: 10,
    paddingHorizontal: 24,
    borderRadius: staticTheme.borderRadius.md,
    borderWidth: 1,
  },
  retryText: {
    fontSize: staticTheme.typography.fontSize.md,
    fontFamily: staticTheme.typography.serif,
  },
});

export default RidesScreen;
