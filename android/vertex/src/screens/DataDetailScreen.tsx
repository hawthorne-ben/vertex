/**
 * Data Detail Screen
 *
 * Shows detailed statistics and charts for a recording
 */

import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Dimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { ChevronLeft, Activity } from 'lucide-react-native';
import { LineChart } from 'react-native-gifted-charts';
import { theme } from '../styles/theme';
import FileService, { IMUSensorData, RecordingMetadata } from '../services/FileService';
import { RootStackParamList } from '../navigation/AppNavigator';

type DataDetailRouteProp = RouteProp<RootStackParamList, 'DataDetail'>;

type DataType = 'accelerometer' | 'gyroscope' | 'magnetometer';

interface AxisStats {
  min: number;
  max: number;
  mean: number;
}

interface Statistics {
  x: AxisStats;
  y: AxisStats;
  z: AxisStats;
}

const DataDetailScreen: React.FC = () => {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const route = useRoute<DataDetailRouteProp>();
  const { fileName, filePath } = route.params;

  const [isLoading, setIsLoading] = useState(true);
  const [data, setData] = useState<IMUSensorData[]>([]);
  const [selectedDataType, setSelectedDataType] = useState<DataType>('accelerometer');
  const [statistics, setStatistics] = useState<Record<DataType, Statistics>>({
    accelerometer: { x: { min: 0, max: 0, mean: 0 }, y: { min: 0, max: 0, mean: 0 }, z: { min: 0, max: 0, mean: 0 } },
    gyroscope: { x: { min: 0, max: 0, mean: 0 }, y: { min: 0, max: 0, mean: 0 }, z: { min: 0, max: 0, mean: 0 } },
    magnetometer: { x: { min: 0, max: 0, mean: 0 }, y: { min: 0, max: 0, mean: 0 }, z: { min: 0, max: 0, mean: 0 } },
  });

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setIsLoading(true);
      const recordingData = await FileService.readRecordingData(filePath);
      setData(recordingData);
      calculateStatistics(recordingData);
    } catch (error) {
      console.error('[DataDetailScreen] Error loading data:', error);
      Alert.alert('Error', 'Failed to load recording data');
    } finally {
      setIsLoading(false);
    }
  };

  const calculateStatistics = (recordingData: IMUSensorData[]) => {
    if (recordingData.length === 0) return;

    const calculateAxisStats = (values: number[]): AxisStats => {
      const min = Math.min(...values);
      const max = Math.max(...values);
      const mean = values.reduce((sum, val) => sum + val, 0) / values.length;
      return { min, max, mean };
    };

    // Accelerometer stats
    const accelStats: Statistics = {
      x: calculateAxisStats(recordingData.map(d => d.accel_x)),
      y: calculateAxisStats(recordingData.map(d => d.accel_y)),
      z: calculateAxisStats(recordingData.map(d => d.accel_z)),
    };

    // Gyroscope stats
    const gyroStats: Statistics = {
      x: calculateAxisStats(recordingData.map(d => d.gyro_x)),
      y: calculateAxisStats(recordingData.map(d => d.gyro_y)),
      z: calculateAxisStats(recordingData.map(d => d.gyro_z)),
    };

    // Magnetometer stats (if available)
    const magData = recordingData.filter(d => d.mag_x !== undefined && d.mag_y !== undefined && d.mag_z !== undefined);
    const magStats: Statistics = magData.length > 0 ? {
      x: calculateAxisStats(magData.map(d => d.mag_x!)),
      y: calculateAxisStats(magData.map(d => d.mag_y!)),
      z: calculateAxisStats(magData.map(d => d.mag_z!)),
    } : { x: { min: 0, max: 0, mean: 0 }, y: { min: 0, max: 0, mean: 0 }, z: { min: 0, max: 0, mean: 0 } };

    setStatistics({
      accelerometer: accelStats,
      gyroscope: gyroStats,
      magnetometer: magStats,
    });
  };

  const getChartData = () => {
    // Downsample data if too many points (keep every Nth point)
    const maxPoints = 200;
    const step = Math.ceil(data.length / maxPoints);
    const sampledData = data.filter((_, index) => index % step === 0);

    // Get relative time in seconds from start
    const startTime = sampledData[0]?.timestamp.getTime() || 0;

    let xData: number[], yData: number[], zData: number[];

    switch (selectedDataType) {
      case 'accelerometer':
        xData = sampledData.map(d => d.accel_x);
        yData = sampledData.map(d => d.accel_y);
        zData = sampledData.map(d => d.accel_z);
        break;
      case 'gyroscope':
        xData = sampledData.map(d => d.gyro_x);
        yData = sampledData.map(d => d.gyro_y);
        zData = sampledData.map(d => d.gyro_z);
        break;
      case 'magnetometer':
        const magSampled = sampledData.filter(d => d.mag_x !== undefined && d.mag_y !== undefined && d.mag_z !== undefined);
        xData = magSampled.map(d => d.mag_x!);
        yData = magSampled.map(d => d.mag_y!);
        zData = magSampled.map(d => d.mag_z!);
        break;
    }

    return {
      xData: xData.map((value, index) => ({ value, dataPointText: '' })),
      yData: yData.map((value, index) => ({ value, dataPointText: '' })),
      zData: zData.map((value, index) => ({ value, dataPointText: '' })),
    };
  };

  const getDataTypeLabel = (type: DataType): string => {
    switch (type) {
      case 'accelerometer': return 'Accelerometer (m/s²)';
      case 'gyroscope': return 'Gyroscope (rad/s)';
      case 'magnetometer': return 'Magnetometer (µT)';
    }
  };

  const formatStatValue = (value: number): string => {
    return value.toFixed(3);
  };

  const formatDate = (date: Date): string => {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };

  if (isLoading) {
    return (
      <View style={[styles.container, styles.centerContent, { paddingTop: insets.top }]}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
        <Text style={styles.loadingText}>Loading data...</Text>
      </View>
    );
  }

  const chartData = getChartData();
  const currentStats = statistics[selectedDataType];
  const screenWidth = Dimensions.get('window').width;

  return (
    <ScrollView style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.content}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
            <ChevronLeft size={24} color={theme.colors.textPrimary} />
          </TouchableOpacity>
          <Text style={styles.title} numberOfLines={1}>Detail</Text>
        </View>

        {/* File Info */}
        <View style={styles.infoCard}>
          <View style={styles.infoRow}>
            <Activity size={20} color={theme.colors.primary} />
            <View style={styles.infoText}>
              <Text style={styles.infoLabel}>File</Text>
              <Text style={styles.infoValue} numberOfLines={1}>{fileName}</Text>
            </View>
          </View>
          {data.length > 0 && (
            <>
              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>Duration</Text>
                <Text style={styles.infoValue}>
                  {formatDate(data[0].timestamp)} - {formatDate(data[data.length - 1].timestamp)}
                </Text>
              </View>
              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>Samples</Text>
                <Text style={styles.infoValue}>{data.length.toLocaleString()}</Text>
              </View>
            </>
          )}
        </View>

        {/* Data Type Selector */}
        <View style={styles.selectorContainer}>
          <TouchableOpacity
            style={[styles.selectorButton, selectedDataType === 'accelerometer' && styles.selectorButtonActive]}
            onPress={() => setSelectedDataType('accelerometer')}>
            <Text style={[styles.selectorText, selectedDataType === 'accelerometer' && styles.selectorTextActive]}>
              Accel
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.selectorButton, selectedDataType === 'gyroscope' && styles.selectorButtonActive]}
            onPress={() => setSelectedDataType('gyroscope')}>
            <Text style={[styles.selectorText, selectedDataType === 'gyroscope' && styles.selectorTextActive]}>
              Gyro
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.selectorButton, selectedDataType === 'magnetometer' && styles.selectorButtonActive]}
            onPress={() => setSelectedDataType('magnetometer')}>
            <Text style={[styles.selectorText, selectedDataType === 'magnetometer' && styles.selectorTextActive]}>
              Mag
            </Text>
          </TouchableOpacity>
        </View>

        {/* Statistics Cards */}
        <View style={styles.statsContainer}>
          <Text style={styles.sectionTitle}>Statistics</Text>
          <View style={styles.statsGrid}>
            {['x', 'y', 'z'].map((axis) => {
              const axisKey = axis as 'x' | 'y' | 'z';
              const axisStats = currentStats[axisKey];
              return (
                <View key={axis} style={styles.statCard}>
                  <Text style={styles.statAxisLabel}>{axis.toUpperCase()} Axis</Text>
                  <View style={styles.statRow}>
                    <Text style={styles.statLabel}>Min</Text>
                    <Text style={styles.statValue}>{formatStatValue(axisStats.min)}</Text>
                  </View>
                  <View style={styles.statRow}>
                    <Text style={styles.statLabel}>Max</Text>
                    <Text style={styles.statValue}>{formatStatValue(axisStats.max)}</Text>
                  </View>
                  <View style={styles.statRow}>
                    <Text style={styles.statLabel}>Mean</Text>
                    <Text style={styles.statValue}>{formatStatValue(axisStats.mean)}</Text>
                  </View>
                </View>
              );
            })}
          </View>
        </View>

        {/* Chart */}
        <View style={styles.chartContainer}>
          <Text style={styles.sectionTitle}>{getDataTypeLabel(selectedDataType)}</Text>

          {/* Legend */}
          <View style={styles.legend}>
            <View style={styles.legendItem}>
              <View style={[styles.legendColor, { backgroundColor: '#ef4444' }]} />
              <Text style={styles.legendText}>X</Text>
            </View>
            <View style={styles.legendItem}>
              <View style={[styles.legendColor, { backgroundColor: '#22c55e' }]} />
              <Text style={styles.legendText}>Y</Text>
            </View>
            <View style={styles.legendItem}>
              <View style={[styles.legendColor, { backgroundColor: '#3b82f6' }]} />
              <Text style={styles.legendText}>Z</Text>
            </View>
          </View>

          <View style={styles.chartWrapper}>
            {chartData.xData.length > 0 ? (
              <LineChart
                data={chartData.xData}
                data2={chartData.yData}
                data3={chartData.zData}
                height={250}
                width={screenWidth - 80}
                maxValue={Math.max(
                  ...chartData.xData.map(d => d.value),
                  ...chartData.yData.map(d => d.value),
                  ...chartData.zData.map(d => d.value)
                )}
                minValue={Math.min(
                  ...chartData.xData.map(d => d.value),
                  ...chartData.yData.map(d => d.value),
                  ...chartData.zData.map(d => d.value)
                )}
                spacing={Math.max(1, (screenWidth - 100) / chartData.xData.length)}
                thickness={2}
                color1="#ef4444"
                color2="#22c55e"
                color3="#3b82f6"
                hideDataPoints
                hideRules
                rulesColor={theme.colors.border}
                yAxisColor={theme.colors.border}
                xAxisColor={theme.colors.border}
                yAxisTextStyle={{ color: theme.colors.textSecondary, fontSize: 10 }}
                xAxisLabelTextStyle={{ color: theme.colors.textSecondary, fontSize: 10 }}
                curved
                animateOnDataChange={false}
                areaChart={false}
                yAxisThickness={1}
                xAxisThickness={1}
                initialSpacing={15}
                endSpacing={15}
                noOfSections={4}
              />
            ) : (
              <View style={styles.noDataContainer}>
                <Text style={styles.noDataText}>No data available</Text>
              </View>
            )}
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
  centerContent: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  content: {
    padding: theme.spacing.lg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: theme.spacing.lg,
  },
  backButton: {
    marginRight: theme.spacing.md,
    padding: theme.spacing.xs,
  },
  title: {
    fontSize: theme.typography.fontSize.xxxl,
    fontWeight: theme.typography.fontWeight.light,
    color: theme.colors.textPrimary,
    fontFamily: theme.typography.serif,
  },
  loadingText: {
    fontSize: theme.typography.fontSize.md,
    color: theme.colors.textSecondary,
    fontFamily: theme.typography.serif,
    marginTop: theme.spacing.md,
  },
  infoCard: {
    backgroundColor: theme.colors.card,
    padding: theme.spacing.lg,
    borderRadius: theme.borderRadius.md,
    marginBottom: theme.spacing.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: theme.spacing.md,
  },
  infoText: {
    marginLeft: theme.spacing.md,
    flex: 1,
  },
  infoLabel: {
    fontSize: theme.typography.fontSize.xs,
    color: theme.colors.textSecondary,
    fontFamily: theme.typography.serif,
    marginBottom: 2,
  },
  infoValue: {
    fontSize: theme.typography.fontSize.sm,
    color: theme.colors.textPrimary,
    fontFamily: theme.typography.mono,
  },
  selectorContainer: {
    flexDirection: 'row',
    marginBottom: theme.spacing.lg,
    backgroundColor: theme.colors.muted,
    borderRadius: theme.borderRadius.md,
    padding: 4,
  },
  selectorButton: {
    flex: 1,
    paddingVertical: theme.spacing.sm,
    paddingHorizontal: theme.spacing.md,
    borderRadius: theme.borderRadius.sm,
    alignItems: 'center',
  },
  selectorButtonActive: {
    backgroundColor: theme.colors.card,
  },
  selectorText: {
    fontSize: theme.typography.fontSize.sm,
    color: theme.colors.textSecondary,
    fontFamily: theme.typography.serif,
    fontWeight: theme.typography.fontWeight.medium,
  },
  selectorTextActive: {
    color: theme.colors.primary,
    fontWeight: theme.typography.fontWeight.semibold,
  },
  statsContainer: {
    marginBottom: theme.spacing.lg,
  },
  sectionTitle: {
    fontSize: theme.typography.fontSize.lg,
    fontWeight: theme.typography.fontWeight.medium,
    color: theme.colors.textPrimary,
    fontFamily: theme.typography.serif,
    marginBottom: theme.spacing.md,
  },
  statsGrid: {
    flexDirection: 'row',
    gap: 12,
  },
  statCard: {
    flex: 1,
    backgroundColor: theme.colors.card,
    padding: theme.spacing.md,
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  statAxisLabel: {
    fontSize: theme.typography.fontSize.xs,
    fontWeight: theme.typography.fontWeight.semibold,
    color: theme.colors.primary,
    fontFamily: theme.typography.serif,
    marginBottom: theme.spacing.sm,
    textAlign: 'center',
  },
  statRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  statLabel: {
    fontSize: theme.typography.fontSize.xs,
    color: theme.colors.textSecondary,
    fontFamily: theme.typography.serif,
  },
  statValue: {
    fontSize: theme.typography.fontSize.xs,
    color: theme.colors.textPrimary,
    fontFamily: theme.typography.mono,
    fontWeight: theme.typography.fontWeight.medium,
  },
  chartContainer: {
    marginBottom: theme.spacing.xxl * 2,
  },
  legend: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: theme.spacing.lg,
    marginBottom: theme.spacing.md,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  legendColor: {
    width: 16,
    height: 3,
    borderRadius: 1.5,
  },
  legendText: {
    fontSize: theme.typography.fontSize.sm,
    color: theme.colors.textPrimary,
    fontFamily: theme.typography.serif,
    fontWeight: theme.typography.fontWeight.medium,
  },
  chartWrapper: {
    backgroundColor: theme.colors.card,
    borderRadius: theme.borderRadius.md,
    paddingTop: theme.spacing.lg,
    paddingBottom: theme.spacing.xl,
    paddingHorizontal: theme.spacing.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    alignItems: 'center',
    overflow: 'hidden',
  },
  noDataContainer: {
    height: 250,
    justifyContent: 'center',
    alignItems: 'center',
  },
  noDataText: {
    fontSize: theme.typography.fontSize.md,
    color: theme.colors.textSecondary,
    fontFamily: theme.typography.serif,
  },
});

export default DataDetailScreen;
