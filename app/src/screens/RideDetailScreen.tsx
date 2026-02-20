/**
 * Ride Detail Screen
 *
 * Shows ride stats, performance charts, and derived metrics.
 * Hero map at top with translucent header overlay.
 */

import React, { useEffect, useMemo, useRef } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  Dimensions,
  TouchableOpacity,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import {
  ArrowLeft, MapPin, TrendingUp, TrendingDown, Minus, Clock, Zap, Heart, Activity,
  Gauge, Mountain,
} from 'lucide-react-native';
import { LineChart } from 'react-native-gifted-charts';
import { useTheme } from '../contexts/ThemeContext';
import { theme as staticTheme } from '../styles/theme';
import { StatCard } from '../components/ui';
import RouteMap from '../components/RouteMap';
import { useRideStore, Ride } from '../stores/rideStore';
import { useRideDetailStore, FitSample, SamplesMetadata, RideComparisons, ComparisonData } from '../stores/rideDetailStore';
import { RootStackParamList } from '../navigation/AppNavigator';

type RideDetailRouteProp = RouteProp<RootStackParamList, 'RideDetail'>;

const SCREEN_WIDTH = Dimensions.get('window').width;
const CHART_HORIZONTAL_PADDING = 48;
const CHART_CARD_PADDING = 32; // 16px padding on each side of chart card
const CHART_WIDTH = SCREEN_WIDTH - CHART_HORIZONTAL_PADDING - CHART_CARD_PADDING;
const CHART_HEIGHT = 180;

// --- Formatting helpers ---

function formatDistance(meters: number | null): string {
  if (meters == null) return '—';
  return `${(meters / 1609.344).toFixed(1)} mi`;
}

function formatElevation(meters: number | null): string {
  if (meters == null) return '—';
  return `${Math.round(meters * 3.28084)} ft`;
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return s > 0 ? `${m}m ${s}s` : `${m}m`;
  return `${s}s`;
}

function formatDate(dateString: string): string {
  const date = new Date(dateString);
  const options: Intl.DateTimeFormatOptions = {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit',
  };
  return date.toLocaleDateString([], options);
}

// --- Chart data helpers ---

function downsample(samples: FitSample[], maxPoints: number): FitSample[] {
  if (samples.length <= maxPoints) return samples;
  const step = Math.ceil(samples.length / maxPoints);
  return samples.filter((_, i) => i % step === 0);
}

function buildChartData(
  samples: FitSample[],
  field: keyof FitSample,
  color: string,
) {
  const downsampled = downsample(samples, 200);
  return downsampled
    .filter((s) => s[field] != null)
    .map((s) => ({
      value: Number(s[field]),
      dataPointColor: 'transparent',
      dataPointRadius: 0,
    }));
}

// --- Components ---

function QuickStats({ ride }: { ride: Ride }) {
  const { theme } = useTheme();

  const stats = [
    { label: 'Distance', value: formatDistance(ride.distance_meters), icon: <MapPin size={16} color={theme.colors.textSecondary} /> },
    { label: 'Duration', value: formatDuration(ride.duration_seconds), icon: <Clock size={16} color={theme.colors.textSecondary} /> },
    { label: 'Elevation', value: formatElevation(ride.elevation_gain_meters), icon: <Mountain size={16} color={theme.colors.textSecondary} /> },
  ];

  return (
    <View style={styles.statsGrid}>
      {stats.map((s) => (
        <StatCard key={s.label} label={s.label} value={s.value} icon={s.icon} style={styles.statCard} />
      ))}
    </View>
  );
}

function PerformanceChart({
  title,
  samples,
  field,
  color,
  unit,
}: {
  title: string;
  samples: FitSample[];
  field: keyof FitSample;
  color: string;
  unit: string;
}) {
  const { theme } = useTheme();
  const data = useMemo(() => buildChartData(samples, field, color), [samples, field, color]);

  if (data.length < 2) return null;

  const values = data.map((d) => d.value);
  const avg = values.reduce((a, b) => a + b, 0) / values.length;

  return (
    <View style={[styles.chartCard, { backgroundColor: theme.colors.card, borderColor: theme.colors.border }]}>
      <View style={styles.chartHeader}>
        <Text style={[styles.chartTitle, { color: theme.colors.textPrimary }]}>{title}</Text>
        <Text style={[styles.chartAvg, { color: theme.colors.textSecondary }]}>
          avg {Math.round(avg)} {unit}
        </Text>
      </View>
      <View style={styles.chartContainer}>
        <LineChart
          data={data}
          width={CHART_WIDTH}
          height={CHART_HEIGHT}
          color={color}
          thickness={1.5}
          hideDataPoints
          hideYAxisText
          hideAxesAndRules
          yAxisLabelWidth={0}
          initialSpacing={0}
          endSpacing={0}
          curved
          areaChart
          startFillColor={color}
          endFillColor="transparent"
          startOpacity={0.2}
          endOpacity={0}
          adjustToWidth
          isAnimated={false}
        />
      </View>
    </View>
  );
}

function TrendCard({
  label,
  value,
  average,
  unit,
  precision,
  icon,
  colored = false,
}: {
  label: string;
  value: number;
  average: number;
  unit: string;
  precision: number;
  icon: React.ReactNode;
  colored?: boolean;
}) {
  const { theme } = useTheme();
  const diff = value - average;
  const isUp = diff > 0.05;
  const isDown = diff < -0.05;

  const trendColor = colored
    ? isUp ? theme.colors.success : isDown ? theme.colors.error : theme.colors.textTertiary
    : theme.colors.textTertiary;

  const TrendIcon = isUp ? TrendingUp : isDown ? TrendingDown : Minus;

  return (
    <View style={[styles.trendCard, { backgroundColor: theme.colors.muted, borderColor: theme.colors.border }]}>
      <View style={styles.trendHeader}>
        {icon}
        <Text style={[styles.trendLabel, { color: theme.colors.textSecondary }]}>{label}</Text>
      </View>
      <Text style={[styles.trendValue, { color: theme.colors.textPrimary }]}>
        {value.toFixed(precision)}{unit}
      </Text>
      <View style={styles.trendRow}>
        <TrendIcon size={13} color={trendColor} />
        <Text style={[styles.trendDiff, { color: trendColor }]}>
          {isUp ? '+' : ''}{diff.toFixed(precision)} vs 8-wk avg ({average.toFixed(precision)}{unit})
        </Text>
      </View>
    </View>
  );
}

function TrendsSection({ comparisons }: { comparisons: RideComparisons }) {
  const { theme } = useTheme();
  const hasAny = comparisons.efficiency || comparisons.standing || comparisons.avgHr || comparisons.avgPower;
  if (!hasAny) return null;

  return (
    <View style={styles.section}>
      <Text style={[styles.sectionTitle, { color: theme.colors.textPrimary }]}>Trends</Text>
      <View style={styles.statsGrid}>
        {comparisons.efficiency && (
          <TrendCard
            label="Efficiency"
            value={comparisons.efficiency.value}
            average={comparisons.efficiency.average}
            unit="%"
            precision={1}
            icon={<Activity size={14} color={theme.colors.textSecondary} />}
            colored
          />
        )}
        {comparisons.standing && (
          <TrendCard
            label="Standing"
            value={comparisons.standing.value}
            average={comparisons.standing.average}
            unit="%"
            precision={1}
            icon={<TrendingUp size={14} color={theme.colors.textSecondary} />}
          />
        )}
        {comparisons.avgHr && (
          <TrendCard
            label="Avg HR"
            value={comparisons.avgHr.value}
            average={comparisons.avgHr.average}
            unit=" bpm"
            precision={0}
            icon={<Heart size={14} color={theme.colors.textSecondary} />}
          />
        )}
        {comparisons.avgPower && (
          <TrendCard
            label="Avg Power"
            value={comparisons.avgPower.value}
            average={comparisons.avgPower.average}
            unit=" W"
            precision={0}
            icon={<Zap size={14} color={theme.colors.textSecondary} />}
            colored
          />
        )}
      </View>
    </View>
  );
}

function PerformanceMetrics({ ride }: { ride: Ride }) {
  const { theme } = useTheme();
  const summary = ride.summary;
  const analysis = ride.analysis_results;

  const metrics: { label: string; value: string; icon: React.ReactNode }[] = [];

  if (summary?.avg_power_watts != null) {
    metrics.push({
      label: 'Avg Power',
      value: `${Math.round(summary.avg_power_watts)} W`,
      icon: <Zap size={16} color={theme.colors.textSecondary} />,
    });
  }
  if (summary?.max_power_watts != null) {
    metrics.push({
      label: 'Max Power',
      value: `${Math.round(summary.max_power_watts)} W`,
      icon: <Zap size={16} color={theme.colors.textSecondary} />,
    });
  }
  if (summary?.avg_heart_rate != null) {
    metrics.push({
      label: 'Avg HR',
      value: `${Math.round(summary.avg_heart_rate)} bpm`,
      icon: <Heart size={16} color={theme.colors.textSecondary} />,
    });
  }
  if (summary?.max_heart_rate != null) {
    metrics.push({
      label: 'Max HR',
      value: `${Math.round(summary.max_heart_rate)} bpm`,
      icon: <Heart size={16} color={theme.colors.textSecondary} />,
    });
  }
  if (summary?.avg_cadence != null) {
    metrics.push({
      label: 'Avg Cadence',
      value: `${Math.round(summary.avg_cadence)} rpm`,
      icon: <Activity size={16} color={theme.colors.textSecondary} />,
    });
  }
  if (summary?.max_cadence != null) {
    metrics.push({
      label: 'Max Cadence',
      value: `${Math.round(summary.max_cadence)} rpm`,
      icon: <Activity size={16} color={theme.colors.textSecondary} />,
    });
  }
  if (analysis?.avg_speed_mph != null) {
    metrics.push({
      label: 'Avg Speed',
      value: `${analysis.avg_speed_mph.toFixed(1)} mph`,
      icon: <Gauge size={16} color={theme.colors.textSecondary} />,
    });
  }
  if (analysis?.max_speed_mph != null) {
    metrics.push({
      label: 'Max Speed',
      value: `${analysis.max_speed_mph.toFixed(1)} mph`,
      icon: <TrendingUp size={16} color={theme.colors.textSecondary} />,
    });
  }

  if (metrics.length === 0) return null;

  return (
    <View style={styles.section}>
      <Text style={[styles.sectionTitle, { color: theme.colors.textPrimary }]}>Performance</Text>
      <View style={styles.statsGrid}>
        {metrics.map((m) => (
          <StatCard key={m.label} label={m.label} value={m.value} icon={m.icon} style={styles.statCard} />
        ))}
      </View>
    </View>
  );
}

function AnalyticsMetrics({ ride }: { ride: Ride }) {
  const { theme } = useTheme();
  const summary = ride.summary;
  if (!summary) return null;

  const hasEfficiency = summary.avg_efficiency_percent != null;
  const hasSmoothRough = summary.smooth_percent != null || summary.rough_percent != null;
  const hasPosition = summary.standing_percent != null || summary.seated_percent != null;
  const hasCadencePosition = summary.avg_cadence_standing != null || summary.avg_cadence_seated != null;

  if (!hasEfficiency && !hasSmoothRough && !hasPosition && !hasCadencePosition) return null;

  return (
    <View style={styles.section}>
      <Text style={[styles.sectionTitle, { color: theme.colors.textPrimary }]}>Analytics</Text>

      {/* Avg Efficiency — full width */}
      {hasEfficiency && (
        <StatCard
          label="Avg Efficiency"
          value={`${summary.avg_efficiency_percent!.toFixed(0)}%`}
          icon={<Activity size={16} color={theme.colors.textSecondary} />}
          style={styles.fullWidthCard}
        />
      )}

      {/* Time Smooth / Time Rough — inline pair */}
      {hasSmoothRough && (
        <View style={styles.statsRow}>
          {summary.smooth_percent != null && (
            <StatCard
              label="Time Smooth"
              value={`${summary.smooth_percent.toFixed(0)}%`}
              icon={<Activity size={16} color={theme.colors.textSecondary} />}
              style={styles.halfCard}
            />
          )}
          {summary.rough_percent != null && (
            <StatCard
              label="Time Rough"
              value={`${summary.rough_percent.toFixed(0)}%`}
              icon={<Activity size={16} color={theme.colors.textSecondary} />}
              style={styles.halfCard}
            />
          )}
        </View>
      )}

      {/* % Standing / % Seated — inline pair */}
      {hasPosition && (
        <View style={styles.statsRow}>
          {summary.standing_percent != null && (
            <StatCard
              label="% Standing"
              value={`${summary.standing_percent.toFixed(0)}%`}
              icon={<TrendingUp size={16} color={theme.colors.textSecondary} />}
              style={styles.halfCard}
            />
          )}
          {summary.seated_percent != null && (
            <StatCard
              label="% Seated"
              value={`${summary.seated_percent.toFixed(0)}%`}
              icon={<TrendingUp size={16} color={theme.colors.textSecondary} />}
              style={styles.halfCard}
            />
          )}
        </View>
      )}

      {/* Cadence Standing / Cadence Seated — inline pair */}
      {hasCadencePosition && (
        <View style={styles.statsRow}>
          {summary.avg_cadence_standing != null && (
            <StatCard
              label="Cadence Standing"
              value={`${Math.round(summary.avg_cadence_standing)} rpm`}
              icon={<Activity size={16} color={theme.colors.textSecondary} />}
              style={styles.halfCard}
            />
          )}
          {summary.avg_cadence_seated != null && (
            <StatCard
              label="Cadence Seated"
              value={`${Math.round(summary.avg_cadence_seated)} rpm`}
              icon={<Activity size={16} color={theme.colors.textSecondary} />}
              style={styles.halfCard}
            />
          )}
        </View>
      )}
    </View>
  );
}

// --- Screen ---

const RideDetailScreen: React.FC = () => {
  const insets = useSafeAreaInsets();
  const { theme, isDark } = useTheme();
  const route = useRoute<RideDetailRouteProp>();
  const { rideId } = route.params;

  const navigation = useNavigation();
  const rides = useRideStore((s) => s.rides);
  const ride = rides.find((r) => r.id === rideId);

  const {
    samples, samplesMetadata, samplesLoading, samplesError,
    comparisons,
    loadRideDetail, stopPolling,
  } = useRideDetailStore();

  const scrollViewRef = useRef<ScrollView>(null);

  useEffect(() => {
    loadRideDetail(rideId);
    return () => stopPolling();
  }, [rideId]);

  if (!ride) {
    return (
      <View style={[styles.container, styles.centerContent, { paddingTop: insets.top, backgroundColor: theme.colors.background }]}>
        <Text style={[styles.errorText, { color: theme.colors.error }]}>Ride not found</Text>
      </View>
    );
  }

  const meta = samplesMetadata;

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      {/* Translucent header overlay */}
      <View style={[styles.headerOverlay, { paddingTop: insets.top, backgroundColor: isDark ? 'rgba(0,0,0,0.85)' : 'rgba(255,255,255,0.92)' }]}>
        <View style={styles.headerContent}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
            <ArrowLeft size={24} color={isDark ? '#ffffff' : theme.colors.textPrimary} />
          </TouchableOpacity>
          <View style={styles.headerText}>
            <Text style={[styles.title, { color: isDark ? '#ffffff' : theme.colors.textPrimary }]} numberOfLines={1}>
              {ride.name}
            </Text>
            <Text style={[styles.subtitle, { color: isDark ? 'rgba(255,255,255,0.7)' : theme.colors.textSecondary }]}>
              {formatDate(ride.start_time)}
            </Text>
          </View>
        </View>
      </View>

      <ScrollView ref={scrollViewRef} style={styles.scrollView} contentContainerStyle={{ paddingTop: insets.top }} nestedScrollEnabled>
        {/* Hero Route Map — always blocks layout, route loads async */}
        <RouteMap
          samples={samples}
          hasGps={meta?.hasGps ?? true}
          loading={samplesLoading}
          scrollViewRef={scrollViewRef}
        />

        {/* Content below map */}
        <View style={styles.content}>
          {/* Quick Stats */}
          <View style={styles.section}>
            <QuickStats ride={ride} />
          </View>

          {/* Trends (if available) */}
          {comparisons && <TrendsSection comparisons={comparisons} />}

          {/* Performance metrics */}
          <PerformanceMetrics ride={ride} />

          {/* Analytics metrics (if available) */}
          <AnalyticsMetrics ride={ride} />

          {/* Performance Charts */}
          {samplesLoading ? (
            <View style={styles.chartLoading}>
              <ActivityIndicator size="small" color={theme.colors.primary} />
              <Text style={[styles.chartLoadingText, { color: theme.colors.textSecondary }]}>
                Loading ride data...
              </Text>
            </View>
          ) : samples.length > 0 ? (
            <View style={styles.section}>
              <Text style={[styles.sectionTitle, { color: theme.colors.textPrimary }]}>Charts</Text>

              {meta?.hasPower && (
                <PerformanceChart
                  title="Power"
                  samples={samples}
                  field="power_watts"
                  color={theme.colors.warning}
                  unit="W"
                />
              )}
              {meta?.hasHeartRate && (
                <PerformanceChart
                  title="Heart Rate"
                  samples={samples}
                  field="heart_rate"
                  color={theme.colors.error}
                  unit="bpm"
                />
              )}
              {meta?.hasCadence && (
                <PerformanceChart
                  title="Cadence"
                  samples={samples}
                  field="cadence"
                  color={theme.colors.success}
                  unit="rpm"
                />
              )}
              <PerformanceChart
                title="Speed"
                samples={samples}
                field="speed_ms"
                color={theme.colors.primary}
                unit="m/s"
              />
            </View>
          ) : samplesError ? (
            <View style={styles.chartLoading}>
              <Text style={[styles.errorText, { color: theme.colors.error }]}>{samplesError}</Text>
            </View>
          ) : null}
        </View>
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

  // Translucent header overlay
  headerOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
  },
  headerContent: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 12,
  },
  backButton: {
    padding: staticTheme.spacing.xs,
  },
  headerText: {
    flex: 1,
  },
  title: {
    fontSize: staticTheme.typography.fontSize.xl,
    fontWeight: staticTheme.typography.fontWeight.light,
    fontFamily: staticTheme.typography.serif,
  },
  subtitle: {
    fontSize: staticTheme.typography.fontSize.sm,
    fontFamily: staticTheme.typography.serif,
    marginTop: 2,
  },

  scrollView: {
    flex: 1,
  },
  content: {
    padding: 24,
    paddingBottom: 48,
  },

  // Sections
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: staticTheme.typography.fontSize.lg,
    fontWeight: staticTheme.typography.fontWeight.medium,
    fontFamily: staticTheme.typography.serif,
    marginBottom: 12,
  },

  // Stats grid
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  statCard: {
    width: '47%' as any,
    flexGrow: 1,
  },
  statsRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 12,
  },
  halfCard: {
    flex: 1,
  },
  fullWidthCard: {
    width: '100%',
    marginBottom: 12,
  },

  // Trend cards
  trendCard: {
    padding: 16,
    borderRadius: staticTheme.borderRadius.md,
    borderWidth: 1,
    width: '47%' as any,
    flexGrow: 1,
  },
  trendHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 8,
  },
  trendLabel: {
    fontSize: staticTheme.typography.fontSize.xs,
    fontFamily: staticTheme.typography.serif,
  },
  trendValue: {
    fontSize: staticTheme.typography.fontSize.xl,
    fontWeight: staticTheme.typography.fontWeight.semibold,
    fontFamily: staticTheme.typography.mono,
    marginBottom: 6,
  },
  trendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  trendDiff: {
    fontSize: staticTheme.typography.fontSize.xs,
    fontFamily: staticTheme.typography.mono,
    flex: 1,
  },

  // Charts
  chartCard: {
    borderRadius: staticTheme.borderRadius.md,
    borderWidth: 1,
    padding: 16,
    marginBottom: 12,
    overflow: 'hidden',
  },
  chartContainer: {
    overflow: 'hidden',
  },
  chartHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  chartTitle: {
    fontSize: staticTheme.typography.fontSize.md,
    fontWeight: staticTheme.typography.fontWeight.medium,
    fontFamily: staticTheme.typography.serif,
  },
  chartAvg: {
    fontSize: staticTheme.typography.fontSize.sm,
    fontFamily: staticTheme.typography.mono,
  },
  chartLoading: {
    alignItems: 'center',
    paddingVertical: 32,
    gap: 8,
  },
  chartLoadingText: {
    fontSize: staticTheme.typography.fontSize.sm,
    fontFamily: staticTheme.typography.serif,
  },

  // Error
  errorText: {
    fontSize: staticTheme.typography.fontSize.md,
    fontFamily: staticTheme.typography.serif,
  },
});

export default RideDetailScreen;
