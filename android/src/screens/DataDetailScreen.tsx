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
  Dimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { Activity, FileText, Trash2 } from 'lucide-react-native';
import { LineChart } from 'react-native-gifted-charts';
import { theme as staticTheme } from '../styles/theme';
import { useTheme } from '../contexts/ThemeContext';
import { BackButton, ErrorDialog, ConfirmDialog } from '../components/ui';
import FileService, { IMUSensorData, RecordingMetadata } from '../services/FileService';
import VTXFileService from '../services/VTXFileService';
import { RootStackParamList } from '../navigation/AppNavigator';
import RNFS from 'react-native-fs';

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
  const { theme } = useTheme();
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
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setIsLoading(true);

      // Check if it's a VTX file based on extension
      const isVTX = filePath.endsWith('.vtx');
      let recordingData: IMUSensorData[];

      if (isVTX) {
        // Read VTX file using VTXFileService
        const vtxData = await VTXFileService.readVTXFile(filePath);

        // Convert VTX records to IMUSensorData format
        recordingData = vtxData.records.map(record => ({
          timestamp: new Date(record.timestamp),
          accel_x: record.accelX,
          accel_y: record.accelY,
          accel_z: record.accelZ,
          gyro_x: record.gyroX,
          gyro_y: record.gyroY,
          gyro_z: record.gyroZ,
          mag_x: record.magX,
          mag_y: record.magY,
          mag_z: record.magZ,
          quat_w: record.quatW,
          quat_x: record.quatX,
          quat_y: record.quatY,
          quat_z: record.quatZ,
        }));
      } else {
        // Read CSV file
        recordingData = await FileService.readRecordingData(filePath);
      }

      setData(recordingData);
      calculateStatistics(recordingData);
    } catch (error) {
      console.error('[DataDetailScreen] Error loading data:', error);
      setErrorMessage(error instanceof Error ? error.message : 'Failed to load recording data. The file may be corrupted or in an unsupported format.');
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

  const handleDeleteFile = async () => {
    setIsDeleting(true);
    try {
      await RNFS.unlink(filePath);
      console.log(`[DataDetailScreen] Deleted file: ${fileName}`);
      setShowDeleteDialog(false);
      // Navigate back to the data list
      navigation.goBack();
    } catch (error) {
      console.error('[DataDetailScreen] Error deleting file:', error);
      setErrorMessage('Failed to delete file');
      setShowDeleteDialog(false);
    } finally {
      setIsDeleting(false);
    }
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
      <View style={[styles.container, styles.centerContent, { paddingTop: insets.top, backgroundColor: theme.colors.background }]}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
        <Text style={[styles.loadingText, { color: theme.colors.textSecondary }]}>Loading data...</Text>
      </View>
    );
  }

  const chartData = getChartData();
  const currentStats = statistics[selectedDataType];
  const screenWidth = Dimensions.get('window').width;

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      {/* Static Header */}
      <View style={[styles.header, { paddingTop: insets.top, backgroundColor: theme.colors.background, borderBottomColor: theme.colors.border }]}>
        <BackButton onPress={() => navigation.goBack()} />
        <Text style={[styles.title, { color: theme.colors.textPrimary }]} numberOfLines={1}>Detail</Text>
        <TouchableOpacity
          style={styles.deleteButton}
          onPress={() => setShowDeleteDialog(true)}
          disabled={isDeleting}
        >
          <Trash2 size={20} color={theme.colors.error} />
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.scrollView}>
        <View style={styles.content}>

        {/* File Info */}
        <View style={[styles.infoCard, { backgroundColor: theme.colors.muted, borderColor: theme.colors.border }]}>
          <View style={styles.infoGrid}>
            {/* Row 1: Icon + Filename (no extension) */}
            <View style={styles.infoGridRow}>
              <View style={styles.infoGridItem}>
                {filePath.endsWith('.vtx') ? (
                  <Activity size={18} color={theme.colors.primary} style={styles.infoIcon} />
                ) : (
                  <FileText size={18} color={theme.colors.textSecondary} style={styles.infoIcon} />
                )}
                <Text style={[styles.infoValue, { color: theme.colors.textPrimary }]} numberOfLines={1}>
                  {fileName.replace(/\.(csv|vtx)$/, '')}
                </Text>
              </View>
            </View>

            {data.length > 0 && (
              <>
                {/* Row 2: Duration + Sample Rate */}
                <View style={styles.infoGridRow}>
                  <View style={styles.infoGridItemVertical}>
                    <Text style={[styles.infoLabel, { color: theme.colors.textSecondary }]}>Duration</Text>
                    <Text style={[styles.infoValue, { color: theme.colors.textPrimary }]}>
                      {(() => {
                        const start = data[0].timestamp;
                        const end = data[data.length - 1].timestamp;
                        const durationMs = end.getTime() - start.getTime();
                        const durationSecs = Math.floor(durationMs / 1000);
                        const minutes = Math.floor(durationSecs / 60);
                        const seconds = durationSecs % 60;
                        return `${minutes}m ${seconds}s`;
                      })()}
                    </Text>
                  </View>
                  <View style={styles.infoGridItemVertical}>
                    <Text style={[styles.infoLabel, { color: theme.colors.textSecondary }]}>Rate</Text>
                    <Text style={[styles.infoValue, { color: theme.colors.textPrimary }]}>
                      {(() => {
                        const start = data[0].timestamp;
                        const end = data[data.length - 1].timestamp;
                        const durationSecs = (end.getTime() - start.getTime()) / 1000;
                        const sampleRate = durationSecs > 0 ? Math.round(data.length / durationSecs) : 0;
                        return `${sampleRate}Hz`;
                      })()}
                    </Text>
                  </View>
                </View>

                {/* Row 3: Start + End time */}
                <View style={styles.infoGridRow}>
                  <View style={styles.infoGridItemVertical}>
                    <Text style={[styles.infoLabel, { color: theme.colors.textSecondary }]}>Start</Text>
                    <Text style={[styles.infoValue, { color: theme.colors.textPrimary }]}>
                      {formatDate(data[0].timestamp)}
                    </Text>
                  </View>
                  <View style={styles.infoGridItemVertical}>
                    <Text style={[styles.infoLabel, { color: theme.colors.textSecondary }]}>End</Text>
                    <Text style={[styles.infoValue, { color: theme.colors.textPrimary }]}>
                      {formatDate(data[data.length - 1].timestamp)}
                    </Text>
                  </View>
                </View>
              </>
            )}
          </View>
        </View>

        {/* Data Type Selector */}
        <View style={[styles.selectorContainer, { backgroundColor: theme.colors.muted }]}>
          <TouchableOpacity
            style={[styles.selectorButton, selectedDataType === 'accelerometer' && { backgroundColor: theme.colors.card }]}
            onPress={() => setSelectedDataType('accelerometer')}>
            <Text style={[
              styles.selectorText,
              { color: theme.colors.textSecondary },
              selectedDataType === 'accelerometer' && { color: theme.colors.primary, fontWeight: staticTheme.typography.fontWeight.semibold }
            ]}>
              Accel
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.selectorButton, selectedDataType === 'gyroscope' && { backgroundColor: theme.colors.card }]}
            onPress={() => setSelectedDataType('gyroscope')}>
            <Text style={[
              styles.selectorText,
              { color: theme.colors.textSecondary },
              selectedDataType === 'gyroscope' && { color: theme.colors.primary, fontWeight: staticTheme.typography.fontWeight.semibold }
            ]}>
              Gyro
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.selectorButton, selectedDataType === 'magnetometer' && { backgroundColor: theme.colors.card }]}
            onPress={() => setSelectedDataType('magnetometer')}>
            <Text style={[
              styles.selectorText,
              { color: theme.colors.textSecondary },
              selectedDataType === 'magnetometer' && { color: theme.colors.primary, fontWeight: staticTheme.typography.fontWeight.semibold }
            ]}>
              Mag
            </Text>
          </TouchableOpacity>
        </View>

        {/* Statistics Cards */}
        <View style={styles.statsContainer}>
          <Text style={[styles.sectionTitle, { color: theme.colors.textPrimary }]}>Statistics</Text>
          <View style={styles.statsGrid}>
            {['x', 'y', 'z'].map((axis) => {
              const axisKey = axis as 'x' | 'y' | 'z';
              const axisStats = currentStats[axisKey];
              return (
                <View key={axis} style={[styles.statCard, { backgroundColor: theme.colors.muted, borderColor: theme.colors.border }]}>
                  <Text style={[styles.statAxisLabel, { color: theme.colors.textPrimary }]}>{axis.toUpperCase()} Axis</Text>
                  <View style={styles.statRow}>
                    <Text style={[styles.statLabel, { color: theme.colors.textSecondary }]}>Min</Text>
                    <Text style={[styles.statValue, { color: theme.colors.textPrimary }]}>{formatStatValue(axisStats.min)}</Text>
                  </View>
                  <View style={styles.statRow}>
                    <Text style={[styles.statLabel, { color: theme.colors.textSecondary }]}>Max</Text>
                    <Text style={[styles.statValue, { color: theme.colors.textPrimary }]}>{formatStatValue(axisStats.max)}</Text>
                  </View>
                  <View style={styles.statRow}>
                    <Text style={[styles.statLabel, { color: theme.colors.textSecondary }]}>Mean</Text>
                    <Text style={[styles.statValue, { color: theme.colors.textPrimary }]}>{formatStatValue(axisStats.mean)}</Text>
                  </View>
                </View>
              );
            })}
          </View>
        </View>

        {/* Chart */}
        <View style={styles.chartContainer}>
          <Text style={[styles.sectionTitle, { color: theme.colors.textPrimary }]}>{getDataTypeLabel(selectedDataType)}</Text>

          {/* Legend */}
          <View style={styles.legend}>
            <View style={styles.legendItem}>
              <View style={[styles.legendColor, { backgroundColor: '#ef4444' }]} />
              <Text style={[styles.legendText, { color: theme.colors.textPrimary }]}>X</Text>
            </View>
            <View style={styles.legendItem}>
              <View style={[styles.legendColor, { backgroundColor: '#22c55e' }]} />
              <Text style={[styles.legendText, { color: theme.colors.textPrimary }]}>Y</Text>
            </View>
            <View style={styles.legendItem}>
              <View style={[styles.legendColor, { backgroundColor: '#3b82f6' }]} />
              <Text style={[styles.legendText, { color: theme.colors.textPrimary }]}>Z</Text>
            </View>
          </View>

          <View style={[styles.chartWrapper, { backgroundColor: theme.colors.card }]}>
            {chartData.xData.length > 0 ? (
              (() => {
                // Calculate min/max with padding to prevent cutoff
                const dataMax = Math.max(
                  ...chartData.xData.map(d => d.value),
                  ...chartData.yData.map(d => d.value),
                  ...chartData.zData.map(d => d.value)
                );
                const dataMin = Math.min(
                  ...chartData.xData.map(d => d.value),
                  ...chartData.yData.map(d => d.value),
                  ...chartData.zData.map(d => d.value)
                );
                const range = dataMax - dataMin;
                const padding = range * 0.15; // 15% padding on each side

                return (
                  <LineChart
                    data={chartData.xData}
                    data2={chartData.yData}
                    data3={chartData.zData}
                    height={250}
                    width={screenWidth - 80}
                    maxValue={dataMax + padding}
                    minValue={dataMin - padding}
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
                );
              })()

            ) : (
              <View style={styles.noDataContainer}>
                <Text style={[styles.noDataText, { color: theme.colors.textSecondary }]}>No data available</Text>
              </View>
            )}
          </View>
        </View>
      </View>
    </ScrollView>

    <ErrorDialog
      visible={errorMessage !== null}
      onDismiss={() => setErrorMessage(null)}
      title="Error"
      message={errorMessage || ''}
    />

    {/* Delete Confirmation Dialog */}
    <ConfirmDialog
      visible={showDeleteDialog}
      onDismiss={() => setShowDeleteDialog(false)}
      title="Delete Recording"
      message={`Are you sure you want to delete "${fileName.replace(/\.(csv|vtx)$/, '')}"? This action cannot be undone.`}
      icon={<Trash2 size={48} color={theme.colors.error} />}
      actions={[
        {
          label: 'Cancel',
          onPress: () => setShowDeleteDialog(false),
          variant: 'default',
        },
        {
          label: 'Delete',
          onPress: handleDeleteFile,
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
  content: {
    padding: staticTheme.spacing.lg,
  },
  scrollView: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: staticTheme.spacing.lg,
    paddingVertical: staticTheme.spacing.md,
    backgroundColor: staticTheme.colors.background,
    borderBottomWidth: 1,
    borderBottomColor: staticTheme.colors.border,
  },
  backButton: {
    marginRight: staticTheme.spacing.md,
    padding: staticTheme.spacing.xs,
  },
  title: {
    flex: 1,
    fontSize: staticTheme.typography.fontSize.xxl,
    fontWeight: staticTheme.typography.fontWeight.light,
    color: staticTheme.colors.textPrimary,
    fontFamily: staticTheme.typography.serif,
  },
  deleteButton: {
    padding: staticTheme.spacing.sm,
    marginLeft: staticTheme.spacing.md,
  },
  loadingText: {
    fontSize: staticTheme.typography.fontSize.md,
    color: staticTheme.colors.textSecondary,
    fontFamily: staticTheme.typography.serif,
    marginTop: staticTheme.spacing.md,
  },
  infoCard: {
    backgroundColor: staticTheme.colors.card,
    padding: staticTheme.spacing.lg,
    borderRadius: staticTheme.borderRadius.md,
    marginBottom: staticTheme.spacing.lg,
    borderWidth: 1,
    borderColor: staticTheme.colors.border,
  },
  infoGrid: {
    gap: staticTheme.spacing.md,
  },
  infoGridRow: {
    flexDirection: 'row',
    gap: staticTheme.spacing.md,
  },
  infoGridItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: staticTheme.spacing.xs,
    flex: 1,
  },
  infoGridItemVertical: {
    flexDirection: 'column',
    gap: 4,
    flex: 1,
  },
  infoIcon: {
    marginRight: staticTheme.spacing.xs,
  },
  infoLabel: {
    fontSize: staticTheme.typography.fontSize.xs,
    color: staticTheme.colors.textSecondary,
    fontFamily: staticTheme.typography.serif,
  },
  infoValue: {
    fontSize: staticTheme.typography.fontSize.sm,
    color: staticTheme.colors.textPrimary,
    fontFamily: staticTheme.typography.mono,
    fontWeight: staticTheme.typography.fontWeight.medium,
  },
  selectorContainer: {
    flexDirection: 'row',
    marginBottom: staticTheme.spacing.lg,
    backgroundColor: staticTheme.colors.muted,
    borderRadius: staticTheme.borderRadius.md,
    padding: 4,
  },
  selectorButton: {
    flex: 1,
    paddingVertical: staticTheme.spacing.sm,
    paddingHorizontal: staticTheme.spacing.md,
    borderRadius: staticTheme.borderRadius.sm,
    alignItems: 'center',
  },
  selectorButtonActive: {
    backgroundColor: staticTheme.colors.card,
  },
  selectorText: {
    fontSize: staticTheme.typography.fontSize.sm,
    color: staticTheme.colors.textSecondary,
    fontFamily: staticTheme.typography.serif,
    fontWeight: staticTheme.typography.fontWeight.medium,
  },
  selectorTextActive: {
    color: staticTheme.colors.primary,
    fontWeight: staticTheme.typography.fontWeight.semibold,
  },
  statsContainer: {
    marginBottom: staticTheme.spacing.lg,
  },
  sectionTitle: {
    fontSize: staticTheme.typography.fontSize.lg,
    fontWeight: staticTheme.typography.fontWeight.medium,
    color: staticTheme.colors.textPrimary,
    fontFamily: staticTheme.typography.serif,
    marginBottom: staticTheme.spacing.md,
  },
  statsGrid: {
    flexDirection: 'row',
    gap: 12,
  },
  statCard: {
    flex: 1,
    backgroundColor: staticTheme.colors.card,
    padding: staticTheme.spacing.md,
    borderRadius: staticTheme.borderRadius.md,
    borderWidth: 1,
    borderColor: staticTheme.colors.border,
  },
  statAxisLabel: {
    fontSize: staticTheme.typography.fontSize.xs,
    fontWeight: staticTheme.typography.fontWeight.semibold,
    color: staticTheme.colors.primary,
    fontFamily: staticTheme.typography.serif,
    marginBottom: staticTheme.spacing.sm,
    textAlign: 'center',
  },
  statRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  statLabel: {
    fontSize: staticTheme.typography.fontSize.xs,
    color: staticTheme.colors.textSecondary,
    fontFamily: staticTheme.typography.serif,
  },
  statValue: {
    fontSize: staticTheme.typography.fontSize.xs,
    color: staticTheme.colors.textPrimary,
    fontFamily: staticTheme.typography.mono,
    fontWeight: staticTheme.typography.fontWeight.medium,
  },
  chartContainer: {
    marginBottom: staticTheme.spacing.xxl * 2,
  },
  legend: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: staticTheme.spacing.lg,
    marginBottom: staticTheme.spacing.md,
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
    fontSize: staticTheme.typography.fontSize.sm,
    color: staticTheme.colors.textPrimary,
    fontFamily: staticTheme.typography.serif,
    fontWeight: staticTheme.typography.fontWeight.medium,
  },
  chartWrapper: {
    backgroundColor: staticTheme.colors.card,
    borderRadius: staticTheme.borderRadius.md,
    paddingTop: staticTheme.spacing.lg,
    paddingBottom: staticTheme.spacing.xl,
    paddingHorizontal: staticTheme.spacing.md,
    borderWidth: 1,
    borderColor: staticTheme.colors.border,
    alignItems: 'center',
    overflow: 'hidden',
  },
  noDataContainer: {
    height: 250,
    justifyContent: 'center',
    alignItems: 'center',
  },
  noDataText: {
    fontSize: staticTheme.typography.fontSize.md,
    color: staticTheme.colors.textSecondary,
    fontFamily: staticTheme.typography.serif,
  },
});

export default DataDetailScreen;
