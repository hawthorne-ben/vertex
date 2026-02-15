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
import { Activity, FileText, Trash2, CloudUpload, CheckCircle } from 'lucide-react-native';
import { LineChart } from 'react-native-gifted-charts';
import { theme as staticTheme } from '../styles/theme';
import { useTheme } from '../contexts/ThemeContext';
import { BackButton, ErrorDialog, ConfirmDialog, InfoDialog, UploadProgressDialog } from '../components/ui';
import FileService, { IMUSensorData, RecordingMetadata } from '../services/FileService';
import VTXFileService from '../services/VTXFileService';
import { RootStackParamList } from '../navigation/AppNavigator';
import RNFS from 'react-native-fs';
import { useToast } from '../contexts/ToastContext';
import { createClient } from '../lib/supabase';
import { API_URL } from '@env';
import { useSyncStore } from '../stores/syncStore';
type DataDetailRouteProp = RouteProp<RootStackParamList, 'DataDetail'>;

type DataType = 'orientation' | 'accelerometer' | 'gyroscope';  // Added orientation

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
  const { showToast } = useToast();
  const navigation = useNavigation();
  const route = useRoute<DataDetailRouteProp>();
  const { fileName, filePath } = route.params;

  // Use syncStore to track if file is synced
  const { checkSyncStatus, isSynced, markAsSynced } = useSyncStore();

  const [isLoading, setIsLoading] = useState(true);
  const [data, setData] = useState<IMUSensorData[]>([]);
  // Check if orientation data exists in first sample
  const hasOrientationData = data.length > 0 && data[0].roll !== undefined;

  const [selectedDataType, setSelectedDataType] = useState<DataType>('accelerometer');
  const [statistics, setStatistics] = useState<Record<DataType, Statistics>>({
    orientation: { x: { min: 0, max: 0, mean: 0 }, y: { min: 0, max: 0, mean: 0 }, z: { min: 0, max: 0, mean: 0 } },
    accelerometer: { x: { min: 0, max: 0, mean: 0 }, y: { min: 0, max: 0, mean: 0 }, z: { min: 0, max: 0, mean: 0 } },
    gyroscope: { x: { min: 0, max: 0, mean: 0 }, y: { min: 0, max: 0, mean: 0 }, z: { min: 0, max: 0, mean: 0 } },
    // Magnetometer removed - using 6DoF mode
  });

  // Set default view to orientation if available
  useEffect(() => {
    if (hasOrientationData && selectedDataType === 'accelerometer') {
      setSelectedDataType('orientation');
    }
  }, [hasOrientationData]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [showUploadDialog, setShowUploadDialog] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [showSyncInfo, setShowSyncInfo] = useState(false);

  useEffect(() => {
    loadData();
    checkSyncStatus([fileName]);
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
          // Magnetometer removed - using 6DoF mode
          quat_w: record.quatW,
          quat_x: record.quatX,
          quat_y: record.quatY,
          quat_z: record.quatZ,
          roll: record.roll,
          pitch: record.pitch,
          yaw: record.yaw,
        }));

      } else {
        // Read CSV file
        recordingData = await FileService.readRecordingData(filePath);
      }

      setData(recordingData);
      calculateStatistics(recordingData);
    } catch (error) {
      console.error('[DataDetailScreen] Error loading data:', error);
      const errorMsg = error instanceof Error ? error.message : 'Failed to load recording data';

      // Check if this is a corrupt/in-progress file (VTX parse errors typically contain these phrases)
      const isCorruptFile = errorMsg.includes('parse') ||
                            errorMsg.includes('invalid') ||
                            errorMsg.includes('corrupted') ||
                            errorMsg.includes('incomplete');

      if (isCorruptFile && fileName.endsWith('.vtx')) {
        // Corrupt/in-progress file - navigate to RecordScreen as fallback
        console.log('[DataDetailScreen] Detected corrupt/in-progress file, navigating to RecordScreen');
        navigation.replace('Record', {
          deviceId: '', // Will show disconnected state
          deviceName: 'Unknown Device'
        });
      } else {
        // Other errors - show error dialog
        setErrorMessage(errorMsg + '. The file may be corrupted or in an unsupported format.');
      }
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

    // Orientation stats (if available)
    const orientationData = recordingData.filter(d => d.roll !== undefined);
    const orientationStats: Statistics = orientationData.length > 0 ? {
      x: calculateAxisStats(orientationData.map(d => d.roll!)),
      y: calculateAxisStats(orientationData.map(d => d.pitch!)),
      z: calculateAxisStats(orientationData.map(d => d.yaw!)),
    } : { x: { min: 0, max: 0, mean: 0 }, y: { min: 0, max: 0, mean: 0 }, z: { min: 0, max: 0, mean: 0 } };

    setStatistics({
      orientation: orientationStats,
      accelerometer: accelStats,
      gyroscope: gyroStats,
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

  const handleUploadFile = async () => {
    setIsUploading(true);
    setUploadProgress(0);
    setShowUploadDialog(false);

    try {
      console.log('[DataDetailScreen] API_URL from env:', API_URL);
      if (!API_URL) {
        showToast({
          message: 'API_URL not configured in .env',
          variant: 'error',
        });
        return;
      }

      const supabase = createClient();

      // Get current user session
      const { data: { session }, error: sessionError } = await supabase.auth.getSession();

      if (sessionError || !session) {
        console.error('[DataDetailScreen] Auth error:', sessionError);
        showToast({
          message: 'Not authenticated. Please log in.',
          variant: 'error',
        });
        return;
      }

      // Only support VTX files
      if (!fileName.toLowerCase().endsWith('.vtx')) {
        showToast({
          message: 'Only VTX files can be uploaded',
          variant: 'error',
        });
        return;
      }

      // Read file and get file size
      const fileStats = await RNFS.stat(filePath);
      const fileSize = fileStats.size;

      // Upload file to Supabase storage
      const userId = session.user.id;
      const storageFileName = `${fileName}`;
      const storagePath = `${userId}/${storageFileName}`;

      console.log(`[DataDetailScreen] Starting upload: ${fileName} (${fileSize} bytes)`);

      // Read file as base64 and convert to ArrayBuffer
      const fileBase64 = await RNFS.readFile(filePath, 'base64');
      const binaryString = atob(fileBase64);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      // Simulate progress updates (since Supabase SDK doesn't provide native progress)
      const progressInterval = setInterval(() => {
        setUploadProgress(prev => {
          if (prev >= 90) return prev; // Cap at 90% until complete
          return prev + 10;
        });
      }, 200);

      try {
        // Use Supabase SDK for reliable upload
        const { error: uploadError } = await supabase.storage
          .from('recordings')
          .upload(storagePath, bytes.buffer, {
            contentType: 'application/octet-stream',
            upsert: false,
          });

        clearInterval(progressInterval);
        setUploadProgress(100);

        if (uploadError) {
          console.error('[DataDetailScreen] Storage upload error:', uploadError);
          throw new Error(`Storage upload failed: ${uploadError.message}`);
        }

        console.log('[DataDetailScreen] Upload successful');
      } catch (error) {
        clearInterval(progressInterval);
        throw error;
      }

      // Call API to process the recording
      // Ensure API_URL has protocol
      const baseUrl = API_URL.startsWith('http') ? API_URL : `https://${API_URL}`;
      const apiUrl = `${baseUrl}/api/upload/recording`;

      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          fileName: fileName,
          fileSize: fileSize,
          storagePath: storagePath,
        }),
      });

      // Check if response is JSON
      const contentType = response.headers.get('content-type');
      const isJson = contentType && contentType.includes('application/json');

      if (!response.ok) {
        let errorMessage = 'Unknown error';

        if (isJson) {
          const result = await response.json();
          console.error('[DataDetailScreen] API error:', result);
          errorMessage = result.error || 'Unknown error';
        } else {
          const text = await response.text();
          console.error('[DataDetailScreen] API error:', text.substring(0, 200));
          errorMessage = response.status === 404
            ? 'API endpoint not found. Check API_URL in .env'
            : `Server error (${response.status})`;
        }

        // Clean up uploaded file on error
        await supabase.storage
          .from('recordings')
          .remove([storagePath]);

        showToast({
          message: `Upload failed: ${errorMessage}`,
          variant: 'error',
        });
        return;
      }

      const result = await response.json();
      console.log('[DataDetailScreen] Upload successful:', result);

      // Mark file as synced in store
      if (result.recordingId) {
        markAsSynced(fileName, result.recordingId);
      }

      showToast({
        message: 'Recording uploaded successfully',
        variant: 'success',
      });

    } catch (error) {
      console.error('[DataDetailScreen] Upload error:', error);
      showToast({
        message: `Upload failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        variant: 'error',
      });
    } finally {
      setIsUploading(false);
    }
  };

  const getChartData = () => {
    if (data.length === 0) {
      return {
        xData: [],
        yData: [],
        zData: [],
        timeGaps: [],
      };
    }

    // FIRST: Detect gaps in FULL data before downsampling
    const fullIntervals: number[] = [];
    for (let i = 1; i < data.length; i++) {
      const interval = data[i].timestamp.getTime() - data[i - 1].timestamp.getTime();
      fullIntervals.push(interval);
    }

    const sortedFullIntervals = [...fullIntervals].sort((a, b) => a - b);
    const medianInterval = sortedFullIntervals[Math.floor(sortedFullIntervals.length / 2)] || 100;
    const gapThreshold = medianInterval * 5; // 5x median to catch real gaps, not just noise

    // Find gaps in FULL data
    const detectedGaps = [];
    for (let i = 1; i < data.length; i++) {
      const interval = data[i].timestamp.getTime() - data[i - 1].timestamp.getTime();
      if (interval > gapThreshold) {
        detectedGaps.push({
          index: i,
          gapMs: interval,
          beforeTime: data[i - 1].timestamp,
          afterTime: data[i].timestamp,
        });
      }
    }

    // THEN: Insert synthetic zero data for gaps to show time proportion
    let dataWithGaps = [...data];
    if (detectedGaps.length > 0) {
      // Process gaps in reverse to maintain indices
      for (let g = detectedGaps.length - 1; g >= 0; g--) {
        const gap = detectedGaps[g];
        const gapStartTime = gap.beforeTime.getTime();
        const gapEndTime = gap.afterTime.getTime();
        const gapDurationMs = gap.gapMs;

        // Generate synthetic points at median interval to fill the gap
        const syntheticPoints = [];
        const numPoints = Math.ceil(gapDurationMs / medianInterval);

        for (let i = 1; i < numPoints; i++) {
          const syntheticTime = new Date(gapStartTime + (i * medianInterval));
          syntheticPoints.push({
            timestamp: syntheticTime,
            accel_x: 0,
            accel_y: 0,
            accel_z: 0,
            gyro_x: 0,
            gyro_y: 0,
            gyro_z: 0,
            // Magnetometer removed - using 6DoF mode
            batteryVoltage: null,
            isGap: true, // Mark as synthetic
          });
        }

        // Insert synthetic points at gap position
        dataWithGaps.splice(gap.index, 0, ...syntheticPoints);
      }
    }

    // Downsample data with gaps for chart rendering
    const maxPoints = 200;
    const step = Math.ceil(dataWithGaps.length / maxPoints);
    const sampledData = dataWithGaps.filter((_, index) => index % step === 0)

    // Get relative time in seconds from start for X-axis
    const startTime = data[0].timestamp.getTime();

    // Build data arrays (synthetic gap data is now included in sampledData)
    const xData = sampledData.map(d =>
      selectedDataType === 'orientation' ? (d.roll ?? 0) :
      selectedDataType === 'accelerometer' ? d.accel_x : d.gyro_x
    );
    const yData = sampledData.map(d =>
      selectedDataType === 'orientation' ? (d.pitch ?? 0) :
      selectedDataType === 'accelerometer' ? d.accel_y : d.gyro_y
    );
    const zData = sampledData.map(d =>
      selectedDataType === 'orientation' ? (d.yaw ?? 0) :
      selectedDataType === 'accelerometer' ? d.accel_z : d.gyro_z
    );
    const times = sampledData.map(d => (d.timestamp.getTime() - startTime) / 1000);

    // For magnetometer, normalize each axis independently to make all data visible
    let normalizedXData = xData;
    let normalizedYData = yData;
    let normalizedZData = zData;

    if (false) { // Magnetometer removed
      // Calculate range for each axis
      const xMin = Math.min(...xData);
      const xMax = Math.max(...xData);
      const xRange = xMax - xMin;

      const yMin = Math.min(...yData);
      const yMax = Math.max(...yData);
      const yRange = yMax - yMin;

      const zMin = Math.min(...zData);
      const zMax = Math.max(...zData);
      const zRange = zMax - zMin;

      // Normalize each axis to 0-100 range for display
      normalizedXData = xData.map(v => xRange === 0 ? 50 : ((v - xMin) / xRange) * 100);
      normalizedYData = yData.map(v => yRange === 0 ? 50 : ((v - yMin) / yRange) * 100);
      normalizedZData = zData.map(v => zRange === 0 ? 50 : ((v - zMin) / zRange) * 100);
    }

    return {
      xData: normalizedXData.map((value, index) => ({
        value: value,
        dataPointText: '',
        label: times[index].toFixed(1) + 's',
      })),
      yData: normalizedYData.map((value, index) => ({
        value: value,
        dataPointText: '',
      })),
      zData: normalizedZData.map((value, index) => ({
        value: value,
        dataPointText: '',
      })),
      timeGaps: [],
      isNormalized: false,  // Magnetometer removed
    };
  };

  const getDataTypeLabel = (type: DataType): string => {
    switch (type) {
      case 'orientation': return 'Orientation (degrees)';
      case 'accelerometer': return 'Accelerometer (m/s²)';
      case 'gyroscope': return 'Gyroscope (rad/s)';
      // Magnetometer removed
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
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top, backgroundColor: theme.colors.background }]}>
        <BackButton onPress={() => navigation.goBack()} />
        <Text style={[styles.title, { color: theme.colors.textPrimary }]} numberOfLines={1}>Detail</Text>
        <View style={styles.headerActions}>
          {isSynced(fileName) ? (
            <TouchableOpacity
              style={styles.actionButton}
              onPress={() => setShowSyncInfo(true)}
            >
              <CheckCircle
                size={20}
                color={theme.colors.success}
              />
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={styles.actionButton}
              onPress={() => setShowUploadDialog(true)}
              disabled={isUploading || !fileName.toLowerCase().endsWith('.vtx')}
            >
              <CloudUpload
                size={20}
                color={isUploading || !fileName.toLowerCase().endsWith('.vtx') ? theme.colors.textSecondary : theme.colors.primary}
              />
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={styles.actionButton}
            onPress={() => setShowDeleteDialog(true)}
            disabled={isDeleting}
          >
            <Trash2 size={20} color={theme.colors.error} />
          </TouchableOpacity>
        </View>
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
          {hasOrientationData && (
            <TouchableOpacity
              style={[styles.selectorButton, selectedDataType === 'orientation' && { backgroundColor: theme.colors.card }]}
              onPress={() => setSelectedDataType('orientation')}>
              <Text style={[
                styles.selectorText,
                { color: theme.colors.textSecondary },
                selectedDataType === 'orientation' && { color: theme.colors.primary, fontWeight: staticTheme.typography.fontWeight.semibold }
              ]}>
                Orientation
              </Text>
            </TouchableOpacity>
          )}
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
          {/* Magnetometer button removed - using 6DoF mode */}
        </View>

        {/* Statistics Cards */}
        <View style={styles.statsContainer}>
          <Text style={[styles.sectionTitle, { color: theme.colors.textPrimary }]}>Statistics</Text>
          <View style={styles.statsGrid}>
            {['x', 'y', 'z'].map((axis) => {
              const axisKey = axis as 'x' | 'y' | 'z';
              const axisStats = currentStats[axisKey];
              const axisLabel = selectedDataType === 'orientation'
                ? (axis === 'x' ? 'Roll' : axis === 'y' ? 'Pitch' : 'Yaw')
                : axis.toUpperCase() + ' Axis';
              return (
                <View key={axis} style={[styles.statCard, { backgroundColor: theme.colors.muted, borderColor: theme.colors.border }]}>
                  <Text style={[styles.statAxisLabel, { color: theme.colors.textPrimary }]}>{axisLabel}</Text>
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
          {/* Magnetometer chart note removed - using 6DoF mode */}

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
                let dataMax: number;
                let dataMin: number;
                let padding: number;

                if (chartData.isNormalized) {
                  // Magnetometer removed - no normalized data
                  dataMin = 0;
                  dataMax = 100;
                  padding = 0;
                } else {
                  // Calculate min/max with padding to prevent cutoff
                  const allValues = [
                    ...chartData.xData.map(d => d.value),
                    ...chartData.yData.map(d => d.value),
                    ...chartData.zData.map(d => d.value)
                  ];

                  dataMax = Math.max(...allValues);
                  dataMin = Math.min(...allValues);
                  const range = dataMax - dataMin;

                  // Handle edge cases for padding
                  if (range === 0) {
                    // Flat data - use absolute padding based on value magnitude
                    padding = Math.abs(dataMax) * 0.1 || 0.1; // 10% of value or 0.1 minimum
                  } else if (range < 0.01) {
                    // Very small range - use minimum padding
                    padding = 0.01;
                  } else {
                    // Normal case - 15% padding
                    padding = range * 0.15;
                  }
                }

                const finalMin = dataMin - padding;
                const finalMax = dataMax + padding;

                // Shift data to be positive if we have negative values (chart library limitation)
                const offset = finalMin < 0 ? -finalMin : 0;
                const shiftedData = offset > 0 ? {
                  xData: chartData.xData.map(d => ({ ...d, value: d.value + offset })),
                  yData: chartData.yData.map(d => ({ ...d, value: d.value + offset })),
                  zData: chartData.zData.map(d => ({ ...d, value: d.value + offset })),
                } : chartData;

                const shiftedMax = finalMax + offset;

                return (
                  <View style={{ maxHeight: 280, overflow: 'hidden' }}>
                    <LineChart
                      data={shiftedData.xData}
                      data2={shiftedData.yData}
                      data3={shiftedData.zData}
                      height={250}
                      width={screenWidth - 80}
                      maxValue={shiftedMax}
                      noOfSections={4}
                      stepValue={shiftedMax / 4}
                      formatYLabel={(value) => {
                        // Shift labels back to show actual values
                        const actualValue = parseFloat(value) - offset;
                        return actualValue.toFixed(1);
                      }}
                      spacing={Math.max(1, (screenWidth - 100) / chartData.xData.length)}
                      thickness={2}
                      color1="#ef4444"
                      color2="#22c55e"
                      color3="#3b82f6"
                      hideDataPoints
                      hideRules
                      showReferenceLine1={false}
                      showReferenceLine2={false}
                      showReferenceLine3={false}
                      rulesColor={theme.colors.border}
                      yAxisColor={theme.colors.border}
                      xAxisColor="transparent"
                      yAxisTextStyle={{ color: theme.colors.textSecondary, fontSize: 10 }}
                      xAxisLabelTextStyle={{ color: theme.colors.textSecondary, fontSize: 10 }}
                      curved
                      animateOnDataChange={false}
                      areaChart={false}
                      yAxisThickness={1}
                      xAxisThickness={0}
                      initialSpacing={15}
                      endSpacing={15}
                    />
                  </View>
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
      message={`Delete local recording "${fileName.replace(/\.(csv|vtx)$/, '')}"? This only deletes the file from your device. Cloud recordings can be managed through the web app.`}
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

    {/* Sync Info Dialog */}
    <InfoDialog
      visible={showSyncInfo}
      onDismiss={() => setShowSyncInfo(false)}
      title="Synced with Cloud"
      message="This recording has been successfully uploaded to cloud storage and can be accessed from the web app."
      icon={<CheckCircle size={48} color={theme.colors.success} />}
    />

    {/* Upload Confirmation Dialog */}
    <ConfirmDialog
      visible={showUploadDialog}
      onDismiss={() => setShowUploadDialog(false)}
      title="Upload Recording"
      message={`Upload "${fileName.replace(/\.(csv|vtx)$/, '')}" to cloud storage?`}
      icon={<CloudUpload size={48} color={theme.colors.primary} />}
      actions={[
        {
          label: 'Cancel',
          onPress: () => setShowUploadDialog(false),
          variant: 'default',
        },
        {
          label: 'Upload',
          onPress: handleUploadFile,
          variant: 'primary',
        },
      ]}
    />

    {/* Upload Progress Dialog */}
    <UploadProgressDialog
      visible={isUploading}
      fileName={fileName}
      progress={uploadProgress}
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
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: staticTheme.spacing.sm,
  },
  actionButton: {
    padding: staticTheme.spacing.sm,
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
  chartNote: {
    fontSize: staticTheme.typography.fontSize.xs,
    color: staticTheme.colors.textSecondary,
    fontFamily: staticTheme.typography.mono,
    marginTop: 4,
    marginBottom: staticTheme.spacing.sm,
    fontStyle: 'italic',
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
    maxHeight: 350, // Constrain chart height for large value ranges
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
