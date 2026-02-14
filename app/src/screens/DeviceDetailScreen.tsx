/**
 * Device Detail Screen
 *
 * Shows connected device details, sensor readings, and control actions
 */

import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import {
  Bluetooth,
  Battery,
  BatteryFull,
  Activity,
  Zap,
  Trash2,
  RefreshCw,
  Heart,
  Circle,
  Settings,
} from 'lucide-react-native';
import { theme as staticTheme } from '../styles/theme';
import { useTheme } from '../contexts/ThemeContext';
import { useToast } from '../contexts/ToastContext';
import { BackButton, ConfirmDialog } from '../components/ui';
import BleService from '../services/BleService';
import { RootStackParamList } from '../navigation/AppNavigator';
import AsyncStorage from '@react-native-async-storage/async-storage';
import ErrorBoundary from '../components/ErrorBoundary';
import IMUVisualization3D from '../components/IMUVisualization3D';
import { useDeviceStore } from '../stores/deviceStore';
import { useRecordingStore } from '../stores/recordingStore';
import DeviceStatusService from '../services/DeviceStatusService';
import { getBatteryStatus, formatBatteryDisplay } from '../utils/battery';

type DeviceDetailRouteProp = RouteProp<RootStackParamList, 'DeviceDetail'>;

const SAVED_DEVICES_KEY = '@vertex_saved_devices';
const ZERO_POINT_KEY = '@vertex_zero_point_';

type NavigationProp = NativeStackNavigationProp<RootStackParamList>;

const DeviceDetailScreenContent: React.FC = () => {
  const insets = useSafeAreaInsets();
  const { theme } = useTheme();
  const { showToast } = useToast();
  const navigation = useNavigation<NavigationProp>();
  const route = useRoute<DeviceDetailRouteProp>();
  const { deviceId, deviceName, autoConnect } = route.params;

  // Use LOCAL state for this device's sensor data - NO global store pollution
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [batteryVoltage, setBatteryVoltage] = useState<number | null>(null);
  const [latestReading, setLatestReading] = useState<any | null>(null);
  const [sampleRate, setSampleRate] = useState<number | null>(null);

  // Use recordingStore for zero point calibration
  const {
    zeroPoint,
    isZeroing,
    setZeroPoint,
    setIsZeroing
  } = useRecordingStore();

  const [isStreaming, setIsStreaming] = useState(false);
  const [lastReadingTime, setLastReadingTime] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [streamingError, setStreamingError] = useState<string | null>(null);
  const [showClearZeroDialog, setShowClearZeroDialog] = useState(false);
  const [showDisconnectDialog, setShowDisconnectDialog] = useState(false);
  const [showForgetDialog, setShowForgetDialog] = useState(false);

  // Track if component is mounted to prevent state updates after unmount
  const isMountedRef = useRef(true);
  const lastUpdateTimeRef = useRef<number>(0);
  const updateCountRef = useRef<number>(0);
  const sampleRateHistoryRef = useRef<number[]>([]);
  const readingBufferRef = useRef<any[]>([]);
  const streamSubscriptionRef = useRef<any>(null);

  // Detect if this is a Vertex IMU device
  const isVertexDevice = deviceName?.toLowerCase().includes('vertex');

  useEffect(() => {
    isMountedRef.current = true;

    // Load zero point from storage
    loadZeroPoint();

    // Listen for connection state changes
    const unsubscribe = BleService.addConnectionListener((device, isConn) => {
      if (!isMountedRef.current) return;

      // Handle connection for this specific device OR any disconnection
      if (device?.id === deviceId || (!device && !isConn)) {
        safeSetState(setIsConnected, isConn);

        if (!isConn) {
          // Device disconnected - clear ALL data
          safeSetState(setIsStreaming, false);
          safeSetState(setError, 'Device disconnected');
          safeSetState(setIsConnecting, false);

          // Clear sensor data
          safeSetState(setLatestReading, null);
          safeSetState(setSampleRate, null);
          safeSetState(setBatteryVoltage, null);

          // Clear local state
          safeSetState(setLastReadingTime, null);
          sampleRateHistoryRef.current = [];
          readingBufferRef.current = [];
          updateCountRef.current = 0;
          lastUpdateTimeRef.current = 0;
        } else {
          safeSetState(setError, null);
        }
      }
    });

    // Defer connection attempt slightly to let UI render first
    const initTimer = setTimeout(() => {
      if (!isMountedRef.current) return;

      const init = async () => {
        safeSetState(setIsConnecting, true);
        try {
          // Connect/verify connection
          await initializeDevice();
          safeSetState(setIsConnecting, false);
        } catch (err: any) {
          // Connection failure has UI feedback via error banner
          if (isMountedRef.current) {
            safeSetState(setError, 'Connection failed');
            safeSetState(setIsConnecting, false);
          }
        }
      };

      init();
    }, 100); // Small delay to let UI render

    return () => {
      isMountedRef.current = false;
      clearTimeout(initTimer);
      unsubscribe();

      // Clean up IMU stream subscription
      if (streamSubscriptionRef.current) {
        try {
          streamSubscriptionRef.current.remove();
          streamSubscriptionRef.current = null;
        } catch (err) {
          console.warn('[DeviceDetailScreen] Error cleaning up subscription:', err);
        }
      }

      // Don't disconnect on unmount - user controls disconnect
    };
  }, [deviceId]);

  // Safely set state only if mounted
  const safeSetState = (setter: Function, value: any) => {
    if (isMountedRef.current) {
      try {
        setter(value);
      } catch (err) {
        console.error('State update error:', err);
      }
    }
  };

  // Wrapper for BLE calls with timeout and error handling
  const safeBleCall = async <T,>(
    operation: () => Promise<T>,
    timeoutMs: number = 10000,
    errorPrefix: string = 'Operation failed'
  ): Promise<T | null> => {
    try {
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Operation timed out')), timeoutMs)
      );

      const result = await Promise.race([operation(), timeoutPromise]);
      return result;
    } catch (err: any) {
      console.error(`${errorPrefix}:`, err);
      const errorMsg = err?.message || 'Unknown error';
      if (isMountedRef.current) {
        setError(`${errorPrefix}: ${errorMsg}`);
      }
      return null;
    }
  };

  const initializeDevice = async () => {
    if (!isMountedRef.current) return;

    try {
      safeSetState(setError, null);
      safeSetState(setStreamingError, null);

      // Check if already connected
      const connectedDevice = BleService.getConnectedDevice();

      if (connectedDevice?.id === deviceId) {
        // Already connected
        if (!isMountedRef.current) return;

        try {
          await discoverServices();
        } catch (err) {
          console.warn('Service discovery failed:', err);
        }
      } else {
        // Not connected - need to connect
        if (!isMountedRef.current) return;

        try {
          await BleService.connectToDevice(deviceId);

          if (!isMountedRef.current) return;
          safeSetState(setError, null);

          try {
            await discoverServices();
          } catch (err) {
            console.warn('Service discovery failed:', err);
          }
        } catch (connectError: any) {
          throw connectError;
        }
      }

      // Start DeviceStatusService to monitor connection and battery
      // This updates the global deviceStore so Dashboard and DevicesList can see the connection
      if (!DeviceStatusService.isMonitoring()) {
        DeviceStatusService.startMonitoring(deviceId, deviceName);
      }

      // If this is a Vertex device, automatically start streaming
      if (isVertexDevice && isMountedRef.current) {
        try {
          await startIMUStreaming();
        } catch (streamError) {
          console.warn('Failed to start streaming:', streamError);
          // Don't fail the entire initialization if streaming fails
        }
      }
    } catch (error: any) {
      // Connection failure has UI feedback via error banner
      if (!isMountedRef.current) return;
      safeSetState(setError, 'Connection failed');
      // DeviceStatusService will handle updating connection status
    }
  };

  const handleReconnect = async () => {
    await initializeDevice();
  };

  const loadZeroPoint = async () => {
    try {
      const stored = await AsyncStorage.getItem(ZERO_POINT_KEY + deviceId);
      if (stored) {
        const parsed = JSON.parse(stored);
        setZeroPoint(parsed);
        }
    } catch (error) {
      console.error('[DeviceDetail] Error loading zero point:', error);
    }
  };

  const saveZeroPoint = async (point: any) => {
    try {
      await AsyncStorage.setItem(ZERO_POINT_KEY + deviceId, JSON.stringify(point));
      setZeroPoint(point);
    } catch (error) {
      console.error('[DeviceDetail] Error saving zero point:', error);
    }
  };

  const handleZero = async () => {
    if (readingBufferRef.current.length < 5) {
      showToast({
        message: `Need at least 5 readings. Currently have ${readingBufferRef.current.length}. Please wait...`,
        variant: 'warning',
        duration: 3000,
      });
      return;
    }

    setIsZeroing(true);

    try {
      // Calculate average of last 5 readings
      const last5 = readingBufferRef.current.slice(-5);

      const avgReading = {
        roll: last5.reduce((sum, r) => sum + (r.roll || 0), 0) / 5,
        pitch: last5.reduce((sum, r) => sum + (r.pitch || 0), 0) / 5,
        yaw: last5.reduce((sum, r) => sum + (r.yaw || 0), 0) / 5,
        accelX: last5.reduce((sum, r) => sum + (r.accelX || 0), 0) / 5,
        accelY: last5.reduce((sum, r) => sum + (r.accelY || 0), 0) / 5,
        accelZ: last5.reduce((sum, r) => sum + (r.accelZ || 0), 0) / 5,
        gyroX: last5.reduce((sum, r) => sum + (r.gyroX || 0), 0) / 5,
        gyroY: last5.reduce((sum, r) => sum + (r.gyroY || 0), 0) / 5,
        gyroZ: last5.reduce((sum, r) => sum + (r.gyroZ || 0), 0) / 5,
        // Magnetometer removed - using 6DoF mode
      };

      await saveZeroPoint(avgReading);

      showToast({
        message: 'Zero point set',
        variant: 'success',
        duration: 2000,
      });
    } catch (error) {
      console.error('[DeviceDetail] Error setting zero point:', error);
      showToast({
        message: 'Failed to set zero point',
        variant: 'error',
      });
    } finally {
      setIsZeroing(false);
    }
  };

  const confirmClearZero = async () => {
    try {
      await AsyncStorage.removeItem(ZERO_POINT_KEY + deviceId);
      setZeroPoint(null);
      showToast({
        message: 'Zero point cleared',
        variant: 'success',
        duration: 2000,
      });
    } catch (error) {
      console.error('[DeviceDetail] Error clearing zero point:', error);
      showToast({
        message: 'Failed to clear zero point',
        variant: 'error',
      });
    }
  };

  const discoverServices = async () => {
    try {
      // Attempt to read battery level
      const battery = await BleService.readBatteryLevel();
      if (battery !== null && isMountedRef.current) {
        // Update store with battery level (percentage only, voltage not available from BLE)
        setBattery(battery, null);
      }
    } catch (error) {
    }
  };

  /**
   * Start streaming IMU data (for Vertex devices)
   */
  const startIMUStreaming = async () => {
    if (!isMountedRef.current) return;

    // Clean up any existing subscription first
    if (streamSubscriptionRef.current) {
      try {
        streamSubscriptionRef.current.remove();
        streamSubscriptionRef.current = null;
      } catch (err) {
        console.warn('[DeviceDetailScreen] Error removing old subscription:', err);
      }
    }

    safeSetState(setIsStreaming, true);
    safeSetState(setStreamingError, null);

    try {
      streamSubscriptionRef.current = await BleService.subscribeToIMUStream(
        (data) => {
          if (!isMountedRef.current) return;

          // Add to reading buffer (keep last 10 readings)
          readingBufferRef.current.push(data);
          if (readingBufferRef.current.length > 10) {
            readingBufferRef.current.shift();
          }

          // Apply zero point offset if set (from recordingStore)
          let displayData = data;
          const currentZeroPoint = useRecordingStore.getState().zeroPoint;
          if (currentZeroPoint) {
            displayData = {
              ...data,
              roll: (data.roll || 0) - (currentZeroPoint.roll || 0),
              pitch: (data.pitch || 0) - (currentZeroPoint.pitch || 0),
              yaw: (data.yaw || 0) - (currentZeroPoint.yaw || 0),
              accelX: (data.accelX || 0) - (currentZeroPoint.accelX || 0),
              accelY: (data.accelY || 0) - (currentZeroPoint.accelY || 0),
              accelZ: (data.accelZ || 0) - (currentZeroPoint.accelZ || 0),
              gyroX: (data.gyroX || 0) - (currentZeroPoint.gyroX || 0),
              gyroY: (data.gyroY || 0) - (currentZeroPoint.gyroY || 0),
              gyroZ: (data.gyroZ || 0) - (currentZeroPoint.gyroZ || 0),
              // Magnetometer removed - using 6DoF mode
            };
          }

          // Update local state
          safeSetState(setLatestReading, displayData);
          safeSetState(setLastReadingTime, new Date());
          safeSetState(setStreamingError, null);

          // Update battery voltage from sensor data
          if (data.batteryVoltage !== undefined && data.batteryVoltage !== null) {
            safeSetState(setBatteryVoltage, data.batteryVoltage);
          }

          // Calculate sample rate with rolling average (updates every 10 samples)
          const now = Date.now();
          updateCountRef.current++;

          if (updateCountRef.current >= 10) {
            if (lastUpdateTimeRef.current > 0) {
              const deltaMs = now - lastUpdateTimeRef.current;
              const instantRate = (10 * 1000) / deltaMs; // 10 samples over deltaMs

              // Add to rolling average (keep last 5 measurements = 50 samples)
              sampleRateHistoryRef.current.push(instantRate);
              if (sampleRateHistoryRef.current.length > 5) {
                sampleRateHistoryRef.current.shift();
              }

              // Calculate average and bucket to nearest 10 Hz
              const avgRate = sampleRateHistoryRef.current.reduce((a, b) => a + b, 0) / sampleRateHistoryRef.current.length;
              const bucketedRate = Math.round(avgRate / 10) * 10; // Round to nearest 10
              safeSetState(setSampleRate, bucketedRate);

              // Update global deviceStore so RecordScreen can use the measured rate
              useDeviceStore.getState().setSampleRate(bucketedRate);
            }
            lastUpdateTimeRef.current = now;
            updateCountRef.current = 0;
          }
        },
        (error) => {
          if (!isMountedRef.current) return;

          console.error('IMU stream error:', error);
          safeSetState(setStreamingError, error.message);

          if (error.message.toLowerCase().includes('disconnect')) {
            safeSetState(setIsStreaming, false);
            // DeviceStatusService connection listener will handle updating connection status
          }
        }
      );
    } catch (error: any) {
      console.error('Failed to start IMU streaming:', error);
      if (!isMountedRef.current) return;

      safeSetState(setStreamingError, error.message || 'Failed to start streaming');
      safeSetState(setIsStreaming, false);
    }
  };

  const handlePollSensor = async () => {
    if (!isMountedRef.current) return;

    if (!isConnected) {
      safeSetState(setError, 'Not connected to device');
      return;
    }

    safeSetState(setError, null);

    try {
      const connectedDevice = BleService.getConnectedDevice();
      if (!connectedDevice) {
        throw new Error('Device connection lost');
      }

      const reading = await safeBleCall(
        () => BleService.pollSensor(),
        10000,
        'Failed to read sensor'
      );

      if (reading && isMountedRef.current) {
        setLatestReading(reading);
        safeSetState(setLastReadingTime, new Date());
        safeSetState(setError, null);

        // Refresh battery after reading (optional, don't fail if unavailable)
        safeBleCall(
          () => BleService.readBatteryLevel(),
          5000,
          'Battery read failed'
        ).then(battery => {
          if (battery !== null && isMountedRef.current) {
            setBattery(battery, null);
          }
        }).catch(() => {
          // Silently fail battery read
        });
      }
      // DeviceStatusService handles connection status updates
    } catch (error: any) {
      if (!isMountedRef.current) return;

      console.error('Polling error:', error);
      const errorMessage = error?.message || 'Could not read sensor data';

      // Check if device disconnected
      if (errorMessage.includes('disconnected') || errorMessage.includes('connection') || errorMessage.includes('not connected')) {
        safeSetState(setError, 'Device disconnected. Please reconnect.');
        // DeviceStatusService will handle updating connection state
      } else {
        safeSetState(setError, errorMessage);
      }
    }
  };

  const confirmDisconnect = async () => {
    setShowDisconnectDialog(false);

    try {

      // Stop any active streaming first
      if (isStreaming) {
        safeSetState(setIsStreaming, false);

        // Clean up subscription
        if (streamSubscriptionRef.current) {
          try {
            streamSubscriptionRef.current.remove();
            streamSubscriptionRef.current = null;
          } catch (err) {
            console.warn('[DeviceDetail] Error removing subscription:', err);
          }
        }
      }

      // Disconnect from BLE
      await BleService.disconnect();

      // Stop device status monitoring
      DeviceStatusService.stopMonitoring();

      // Clear local UI state
      safeSetState(setError, null);
      safeSetState(setStreamingError, null);

      showToast({ message: 'Device disconnected successfully', variant: 'success' });
      navigation.goBack();
    } catch (error: any) {
      console.error('[DeviceDetail] Disconnect error:', error);

      // Even if disconnect fails, clear local UI state
      safeSetState(setIsStreaming, false);

      showToast({
        message: 'Device may already be disconnected or connection was lost',
        variant: 'warning'
      });
      navigation.goBack();
    }
  };

  const confirmForget = async () => {
    setShowForgetDialog(false);

    try {
      // Try to disconnect if connected, but continue even if it fails
      if (isConnected) {
        try {
          await BleService.disconnect();
        } catch (disconnectError) {
          console.warn('Disconnect failed during forget, continuing...', disconnectError);
        }
      }

      // Stop device status monitoring
      DeviceStatusService.stopMonitoring();

      // Remove from saved devices
      const saved = await AsyncStorage.getItem(SAVED_DEVICES_KEY);
      if (saved) {
        const devices = JSON.parse(saved);
        const updated = devices.filter((d: any) => d.id !== deviceId);
        await AsyncStorage.setItem(SAVED_DEVICES_KEY, JSON.stringify(updated));
      }

      showToast({ message: 'Device removed from saved devices', variant: 'success' });
      navigation.goBack();
    } catch (error) {
      console.error('Forget error:', error);
      showToast({ message: 'Failed to remove device from storage', variant: 'error' });
    }
  };

  const handleStartRecording = () => {
    navigation.navigate('Record', { deviceId, deviceName });
  };

  const renderStatusCard = () => {
    const sensorReading = latestReading;
    const batteryVoltageSensor = sensorReading?.batteryVoltage;
    const batteryStatus = getBatteryStatus(batteryVoltage);
    const BatteryIcon = (batteryStatus?.level === 'good') ? BatteryFull : Battery;

    return (
      <View style={[styles.card, { backgroundColor: theme.colors.muted, borderColor: theme.colors.border }]}>
        <View style={styles.statusGrid}>
          {/* Row 1 */}
          <View style={styles.statusGridRow}>
            {/* Connection Status */}
            <View style={styles.statusCompactItem}>
              <Bluetooth
                size={18}
                color={
                  isConnecting ? theme.colors.warning :
                  isConnected ? theme.colors.success :
                  theme.colors.error
                }
                style={styles.statusIcon}
              />
              <Text style={[styles.statusCompactValue, {
                color: isConnecting ? theme.colors.warning :
                       isConnected ? theme.colors.success :
                       theme.colors.error,
                fontFamily: staticTheme.typography.mono,
              }]}>
                {isConnecting ? 'Connecting' : isConnected ? 'Connected' : 'Disconnected'}
              </Text>
            </View>

            {/* Battery Status */}
            <View style={styles.statusCompactItem}>
              <BatteryIcon
                size={18}
                color={
                  batteryStatus === null ? theme.colors.textTertiary :
                  theme.colors[batteryStatus.color as keyof typeof theme.colors]
                }
                style={styles.statusIcon}
              />
              <Text style={[styles.statusCompactValue, {
                color: batteryStatus === null ? theme.colors.textTertiary : theme.colors.textPrimary,
                fontFamily: staticTheme.typography.mono,
              }]}>
                {formatBatteryDisplay(batteryVoltage)}
              </Text>
            </View>
          </View>

          {/* Row 2 */}
          <View style={styles.statusGridRow}>
            {/* Calibration Status */}
            <View style={styles.statusCompactItem}>
              <Activity
                size={18}
                color={
                  sensorReading?.calibration?.system === 3 ? theme.colors.success :
                  sensorReading?.calibration?.system >= 2 ? theme.colors.warning :
                  theme.colors.textTertiary
                }
                style={styles.statusIcon}
              />
              <Text style={[styles.statusCompactValue, {
                color: sensorReading?.calibration?.system === 3 ? theme.colors.success :
                       sensorReading?.calibration?.system >= 2 ? theme.colors.warning :
                       theme.colors.textTertiary,
                fontFamily: staticTheme.typography.mono,
              }]}>
                Calibration
              </Text>
            </View>

            {/* Sample Rate */}
            <View style={styles.statusCompactItem}>
              <Zap
                size={18}
                color={
                  sampleRate && sampleRate >= 8 ? theme.colors.success :
                  sampleRate && sampleRate >= 5 ? theme.colors.warning :
                  theme.colors.textTertiary
                }
                style={styles.statusIcon}
              />
              <Text style={[styles.statusCompactValue, {
                color: sampleRate ? theme.colors.textPrimary : theme.colors.textTertiary,
                fontFamily: staticTheme.typography.mono,
              }]}>
                {sampleRate ? `${sampleRate}Hz` : 'Frequency'}
              </Text>
            </View>
          </View>
        </View>
      </View>
    );
  };

  const renderOrientationVisualization = () => {
    if (!latestReading || (latestReading.roll === undefined && latestReading.pitch === undefined && latestReading.yaw === undefined)) {
      return null;
    }

    return (
      <View style={[styles.card, { backgroundColor: theme.colors.muted, borderColor: theme.colors.border }]}>
        <Text style={[styles.cardTitle, { color: theme.colors.textPrimary }]}>Orientation</Text>
        <View style={[styles.visualizationContainer, { backgroundColor: 'transparent', borderColor: 'transparent' }]}>
          <IMUVisualization3D
            roll={latestReading.roll || 0}
            pitch={latestReading.pitch || 0}
            yaw={latestReading.yaw || 0}
            accelX={latestReading.accelX || 0}
            accelY={latestReading.accelY || 0}
            accelZ={latestReading.accelZ || 0}
            backgroundColor={theme.colors.card}
          />
        </View>
      </View>
    );
  };

  const renderSensorData = () => {
    if (!latestReading) {
      return (
        <View style={[styles.card, { backgroundColor: theme.colors.muted, borderColor: theme.colors.border }]}>
          <Text style={[styles.cardTitle, { color: theme.colors.textPrimary }]}>Sensor Reading</Text>
          <View style={styles.emptyReading}>
            <Activity size={48} color={theme.colors.textTertiary} />
            <Text style={[styles.emptyReadingText, { color: theme.colors.textSecondary }]}>
              {isVertexDevice
                ? (isStreaming ? 'Waiting for data stream...' : 'No data yet. Starting stream...')
                : 'No data yet. Tap "Poll Sensor" to get a reading.'}
            </Text>
          </View>
        </View>
      );
    }

    return (
      <View style={[styles.card, { backgroundColor: theme.colors.muted, borderColor: theme.colors.border }]}>
        <View style={styles.cardHeader}>
          <Text style={[styles.cardTitle, { color: theme.colors.textPrimary }]}>
            Sensor Data
          </Text>
          {lastReadingTime && (
            <Text style={[styles.timestamp, { color: theme.colors.textSecondary }]}>
              {lastReadingTime.toLocaleTimeString()}
            </Text>
          )}
        </View>

        {/* Streaming error indicator */}
        {streamingError && (
          <View style={styles.streamingErrorBanner}>
            <Text style={[styles.streamingErrorText, { color: theme.colors.error }]}>{streamingError}</Text>
          </View>
        )}

        {/* For Whoop: Show Heart Rate */}
        {latestReading.heartRate !== undefined && (
          <View style={[styles.readingCard, { backgroundColor: theme.colors.background, borderColor: theme.colors.border }]}>
            <Heart size={32} color={theme.colors.error} />
            <View style={styles.readingInfo}>
              <Text style={[styles.readingLabel, { color: theme.colors.textSecondary }]}>Heart Rate</Text>
              <Text style={[styles.readingValue, { color: theme.colors.textPrimary }]}>{latestReading.heartRate} BPM</Text>
              {latestReading.contactDetected !== undefined && (
                <Text style={[styles.readingMeta, { color: theme.colors.textTertiary }]}>
                  Contact: {latestReading.contactDetected ? 'Detected' : 'Not Detected'}
                </Text>
              )}
            </View>
          </View>
        )}

        {/* For Vertex IMU: Show orientation data */}
        {(latestReading.roll !== undefined || latestReading.pitch !== undefined || latestReading.yaw !== undefined) && (
          <>
            <Text style={[styles.sectionLabel, { color: theme.colors.textSecondary }]}>Orientation (degrees)</Text>
            <View style={styles.sensorGrid}>
              <View style={[styles.sensorValue, { backgroundColor: theme.colors.background }]}>
                <Text style={[styles.sensorLabel, { color: theme.colors.textSecondary }]}>Roll</Text>
                <Text style={[styles.sensorNumber, { color: theme.colors.textPrimary }]}>{latestReading.roll?.toFixed(1) ?? '0.0'}°</Text>
              </View>
              <View style={[styles.sensorValue, { backgroundColor: theme.colors.background }]}>
                <Text style={[styles.sensorLabel, { color: theme.colors.textSecondary }]}>Pitch</Text>
                <Text style={[styles.sensorNumber, { color: theme.colors.textPrimary }]}>{latestReading.pitch?.toFixed(1) ?? '0.0'}°</Text>
              </View>
              <View style={[styles.sensorValue, { backgroundColor: theme.colors.background }]}>
                <Text style={[styles.sensorLabel, { color: theme.colors.textSecondary }]}>Yaw</Text>
                <Text style={[styles.sensorNumber, { color: theme.colors.textPrimary }]}>{latestReading.yaw?.toFixed(1) ?? '0.0'}°</Text>
              </View>
            </View>

            {/* Accelerometer */}
            {(latestReading.accelX !== undefined || latestReading.accelY !== undefined || latestReading.accelZ !== undefined) && (
              <>
                <View style={[styles.divider, { backgroundColor: theme.colors.border }]} />
                <Text style={[styles.sectionLabel, { color: theme.colors.textSecondary }]}>Acceleration (m/s²)</Text>
                <View style={styles.sensorGrid}>
                  <View style={[styles.sensorValue, { backgroundColor: theme.colors.background }]}>
                    <Text style={[styles.sensorLabel, { color: theme.colors.textSecondary }]}>X</Text>
                    <Text style={[styles.sensorNumber, { color: theme.colors.textPrimary }]}>{latestReading.accelX?.toFixed(2) ?? '0.00'}</Text>
                  </View>
                  <View style={[styles.sensorValue, { backgroundColor: theme.colors.background }]}>
                    <Text style={[styles.sensorLabel, { color: theme.colors.textSecondary }]}>Y</Text>
                    <Text style={[styles.sensorNumber, { color: theme.colors.textPrimary }]}>{latestReading.accelY?.toFixed(2) ?? '0.00'}</Text>
                  </View>
                  <View style={[styles.sensorValue, { backgroundColor: theme.colors.background }]}>
                    <Text style={[styles.sensorLabel, { color: theme.colors.textSecondary }]}>Z</Text>
                    <Text style={[styles.sensorNumber, { color: theme.colors.textPrimary }]}>{latestReading.accelZ?.toFixed(2) ?? '0.00'}</Text>
                  </View>
                </View>
              </>
            )}

            {/* Gyroscope */}
            {(latestReading.gyroX !== undefined || latestReading.gyroY !== undefined || latestReading.gyroZ !== undefined) && (
              <>
                <View style={[styles.divider, { backgroundColor: theme.colors.border }]} />
                <Text style={[styles.sectionLabel, { color: theme.colors.textSecondary }]}>Angular Velocity (rad/s)</Text>
                <View style={styles.sensorGrid}>
                  <View style={[styles.sensorValue, { backgroundColor: theme.colors.background }]}>
                    <Text style={[styles.sensorLabel, { color: theme.colors.textSecondary }]}>X</Text>
                    <Text style={[styles.sensorNumber, { color: theme.colors.textPrimary }]}>{latestReading.gyroX?.toFixed(2) ?? '0.00'}</Text>
                  </View>
                  <View style={[styles.sensorValue, { backgroundColor: theme.colors.background }]}>
                    <Text style={[styles.sensorLabel, { color: theme.colors.textSecondary }]}>Y</Text>
                    <Text style={[styles.sensorNumber, { color: theme.colors.textPrimary }]}>{latestReading.gyroY?.toFixed(2) ?? '0.00'}</Text>
                  </View>
                  <View style={[styles.sensorValue, { backgroundColor: theme.colors.background }]}>
                    <Text style={[styles.sensorLabel, { color: theme.colors.textSecondary }]}>Z</Text>
                    <Text style={[styles.sensorNumber, { color: theme.colors.textPrimary }]}>{latestReading.gyroZ?.toFixed(2) ?? '0.00'}</Text>
                  </View>
                </View>
              </>
            )}

            {/* Magnetometer removed - using 6DoF mode */}

            {/* Sensor Calibration Status */}
            {latestReading.calibration && (
              <>
                <View style={[styles.divider, { backgroundColor: theme.colors.border }]} />
                <Text style={[styles.sectionLabel, { color: theme.colors.textSecondary }]}>Sensor Calibration (0-3)</Text>
                <View style={styles.sensorGrid}>
                  <View style={[styles.sensorValue, { backgroundColor: theme.colors.background }]}>
                    <Text style={[styles.sensorLabel, { color: theme.colors.textSecondary }]}>Gyro</Text>
                    <Text style={[styles.sensorNumber, { color: theme.colors.textPrimary }]}>{latestReading.calibration.gyro}</Text>
                  </View>
                  <View style={[styles.sensorValue, { backgroundColor: theme.colors.background }]}>
                    <Text style={[styles.sensorLabel, { color: theme.colors.textSecondary }]}>Accel</Text>
                    <Text style={[styles.sensorNumber, { color: theme.colors.textPrimary }]}>{latestReading.calibration.accel}</Text>
                  </View>
                  {/* Mag calibration removed - using 6DoF mode */}
                </View>
              </>
            )}
          </>
        )}
      </View>
    );
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top, backgroundColor: theme.colors.background }]}>
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: theme.colors.border }]}>
        <BackButton onPress={() => navigation.goBack()} />
        <View style={styles.headerInfo}>
          <Text style={[styles.title, { color: theme.colors.textPrimary }]}>{deviceName}</Text>
          <Text style={[styles.deviceId, { color: theme.colors.textTertiary }]}>{deviceId}</Text>
        </View>
        <TouchableOpacity
          onPress={() => navigation.navigate('DeviceSettings' as any)}
          style={styles.settingsButton}
        >
          <Settings size={24} color={theme.colors.textPrimary} />
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.content}
        contentContainerStyle={{ paddingBottom: insets.bottom + staticTheme.spacing.xxl }}
      >
        {/* Error Banner */}
        {error && (
          <View style={[styles.errorBanner, { backgroundColor: theme.colors.errorBg, borderColor: theme.colors.errorBorder }]}>
            <Text style={[styles.errorText, { color: theme.colors.error }]}>{error}</Text>
            {!isConnected && (
              <TouchableOpacity
                style={[styles.reconnectButton, { backgroundColor: theme.colors.primary }]}
                onPress={handleReconnect}
                disabled={isConnecting}>
                {isConnecting ? (
                  <ActivityIndicator size="small" color={theme.colors.primary} />
                ) : (
                  <Text style={[styles.reconnectButtonText, { color: theme.colors.primaryForeground }]}>Reconnect</Text>
                )}
              </TouchableOpacity>
            )}
          </View>
        )}

        {renderStatusCard()}

        {/* Record and Zero Buttons for Vertex devices */}
        {isVertexDevice && (
          <View style={styles.actionButtonsRow}>
            <TouchableOpacity
              style={[
                styles.halfWidthButton,
                {
                  backgroundColor: isConnected ? theme.colors.background : theme.colors.muted,
                  borderColor: isConnected ? theme.colors.error : theme.colors.border,
                  borderWidth: 2,
                }
              ]}
              onPress={handleStartRecording}
              disabled={!isConnected}>
              <Text style={[
                styles.halfWidthButtonText,
                {
                  color: isConnected ? theme.colors.error : theme.colors.textTertiary,
                  fontFamily: staticTheme.typography.serif,
                }
              ]}>
                Record
              </Text>
              <Circle
                size={16}
                color={isConnected ? theme.colors.error : theme.colors.textTertiary}
                fill={isConnected ? theme.colors.error : 'transparent'}
              />
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.halfWidthButton,
                {
                  backgroundColor: (isConnected && !isZeroing) ? theme.colors.background : theme.colors.muted,
                  borderColor: (isConnected && !isZeroing) ? '#FFFFFF' : theme.colors.border,
                  borderWidth: 2,
                }
              ]}
              onPress={zeroPoint ? () => setShowClearZeroDialog(true) : handleZero}
              disabled={!isConnected || isZeroing}>
              {isZeroing ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <>
                  <Text style={[
                    styles.halfWidthButtonText,
                    { color: (isConnected && !isZeroing) ? '#FFFFFF' : theme.colors.textTertiary }
                  ]}>
                    {zeroPoint ? 'Clear Zero' : 'Zero'}
                  </Text>
                  <Activity
                    size={16}
                    color={(isConnected && !isZeroing) ? '#FFFFFF' : theme.colors.textTertiary}
                  />
                </>
              )}
            </TouchableOpacity>
          </View>
        )}

        {/* 3D Orientation Visualization for Vertex devices */}
        {isVertexDevice && renderOrientationVisualization()}

        {renderSensorData()}

        {/* Primary Action - Only show poll button for non-Vertex devices */}
        {!isVertexDevice && (
          <TouchableOpacity
            style={[styles.primaryButton, { backgroundColor: theme.colors.primary }, !isConnected && styles.buttonDisabled]}
            onPress={handlePollSensor}
            disabled={!isConnected || isPolling}>
            {isPolling ? (
              <ActivityIndicator size="small" color={theme.colors.primaryForeground} />
            ) : (
              <>
                <RefreshCw size={20} color={theme.colors.primaryForeground} />
                <Text style={[styles.primaryButtonText, { color: theme.colors.primaryForeground }]}>Poll Sensor</Text>
              </>
            )}
          </TouchableOpacity>
        )}

        {/* Secondary Actions */}
        <View style={styles.actionsGrid}>
          <TouchableOpacity
            style={[styles.secondaryButton, { backgroundColor: theme.colors.muted, borderColor: theme.colors.border }]}
            onPress={() => setShowDisconnectDialog(true)}
            disabled={!isConnected}>
            <Bluetooth size={20} color={theme.colors.textPrimary} />
            <Text style={[styles.secondaryButtonText, { color: theme.colors.textPrimary }]}>Disconnect</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.secondaryButton, { backgroundColor: theme.colors.errorBg, borderColor: theme.colors.error }]}
            onPress={() => setShowForgetDialog(true)}>
            <Trash2 size={20} color={theme.colors.error} />
            <Text style={[styles.secondaryButtonText, { color: theme.colors.error }]}>Forget</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>

      <ConfirmDialog
        visible={showClearZeroDialog}
        onDismiss={() => setShowClearZeroDialog(false)}
        title="Clear Zero Point"
        message="Remove the zero point calibration? Readings will return to raw values."
        icon={<Activity size={48} color={theme.colors.primary} />}
        actions={[
          {
            label: 'Cancel',
            onPress: () => setShowClearZeroDialog(false),
            variant: 'default',
          },
          {
            label: 'Clear',
            onPress: confirmClearZero,
            variant: 'primary',
          },
        ]}
      />

      <ConfirmDialog
        visible={showDisconnectDialog}
        onDismiss={() => setShowDisconnectDialog(false)}
        title="Disconnect Device"
        message={`Disconnect from ${deviceName}?`}
        icon={<Bluetooth size={48} color={theme.colors.primary} />}
        actions={[
          {
            label: 'Cancel',
            onPress: () => setShowDisconnectDialog(false),
            variant: 'default',
          },
          {
            label: 'Disconnect',
            onPress: confirmDisconnect,
            variant: 'primary',
          },
        ]}
      />

      <ConfirmDialog
        visible={showForgetDialog}
        onDismiss={() => setShowForgetDialog(false)}
        title="Forget Device"
        message={`Remove ${deviceName} from saved devices? You'll need to pair again to reconnect.`}
        icon={<Trash2 size={48} color={theme.colors.error} />}
        actions={[
          {
            label: 'Cancel',
            onPress: () => setShowForgetDialog(false),
            variant: 'default',
          },
          {
            label: 'Forget',
            onPress: confirmForget,
            variant: 'destructive',
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
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: staticTheme.spacing.lg,
    paddingVertical: staticTheme.spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: staticTheme.colors.border,
  },
  backButton: {
    marginRight: staticTheme.spacing.md,
  },
  headerInfo: {
    flex: 1,
  },
  settingsButton: {
    padding: staticTheme.spacing.sm,
    marginLeft: staticTheme.spacing.md,
  },
  title: {
    fontSize: staticTheme.typography.fontSize.xl,
    fontWeight: staticTheme.typography.fontWeight.semibold,
    color: staticTheme.colors.textPrimary,
    fontFamily: staticTheme.typography.serif,
  },
  deviceId: {
    fontSize: staticTheme.typography.fontSize.xs,
    color: staticTheme.colors.textTertiary,
    fontFamily: staticTheme.typography.mono,
    marginTop: 2,
  },
  content: {
    flex: 1,
    padding: staticTheme.spacing.lg,
  },
  errorBanner: {
    backgroundColor: staticTheme.colors.errorBg,
    borderRadius: staticTheme.borderRadius.md,
    borderWidth: 1,
    borderColor: staticTheme.colors.errorBorder,
    padding: staticTheme.spacing.md,
    marginBottom: staticTheme.spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  errorText: {
    fontSize: staticTheme.typography.fontSize.sm,
    color: staticTheme.colors.error,
    fontFamily: staticTheme.typography.serif,
    flex: 1,
    marginRight: staticTheme.spacing.sm,
  },
  reconnectButton: {
    backgroundColor: staticTheme.colors.primary,
    paddingVertical: staticTheme.spacing.sm,
    paddingHorizontal: staticTheme.spacing.md,
    borderRadius: staticTheme.borderRadius.sm,
    minWidth: 80,
    alignItems: 'center',
  },
  reconnectButtonText: {
    color: staticTheme.colors.primaryForeground,
    fontSize: staticTheme.typography.fontSize.sm,
    fontWeight: staticTheme.typography.fontWeight.medium,
    fontFamily: staticTheme.typography.serif,
  },
  card: {
    backgroundColor: staticTheme.colors.muted,
    borderRadius: staticTheme.borderRadius.md,
    padding: staticTheme.spacing.md,
    marginBottom: staticTheme.spacing.md,
    borderWidth: 1,
    borderColor: staticTheme.colors.border,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: staticTheme.spacing.md,
  },
  cardTitle: {
    fontSize: staticTheme.typography.fontSize.lg,
    fontWeight: staticTheme.typography.fontWeight.medium,
    color: staticTheme.colors.textPrimary,
    fontFamily: staticTheme.typography.serif,
    marginBottom: staticTheme.spacing.md,
  },
  timestamp: {
    fontSize: staticTheme.typography.fontSize.xs,
    color: staticTheme.colors.textSecondary,
    fontFamily: staticTheme.typography.mono,
  },
  statusGrid: {
    gap: staticTheme.spacing.md,
  },
  statusGridRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: staticTheme.spacing.md,
  },
  statusCompactItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: staticTheme.spacing.xs,
    flex: 1,
  },
  statusIcon: {
    marginRight: staticTheme.spacing.xs,
  },
  statusCompactValue: {
    fontSize: staticTheme.typography.fontSize.sm,
    fontWeight: staticTheme.typography.fontWeight.medium,
  },
  divider: {
    height: 1,
    backgroundColor: staticTheme.colors.border,
    marginVertical: staticTheme.spacing.md,
  },
  emptyReading: {
    alignItems: 'center',
    padding: staticTheme.spacing.xl,
  },
  emptyReadingText: {
    marginTop: staticTheme.spacing.md,
    fontSize: staticTheme.typography.fontSize.sm,
    color: staticTheme.colors.textSecondary,
    fontFamily: staticTheme.typography.serif,
    textAlign: 'center',
  },
  readingCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: staticTheme.colors.background,
    padding: staticTheme.spacing.lg,
    borderRadius: staticTheme.borderRadius.md,
    borderWidth: 1,
    borderColor: staticTheme.colors.border,
  },
  readingInfo: {
    marginLeft: staticTheme.spacing.md,
    flex: 1,
  },
  readingLabel: {
    fontSize: staticTheme.typography.fontSize.sm,
    color: staticTheme.colors.textSecondary,
    fontFamily: staticTheme.typography.serif,
  },
  readingValue: {
    fontSize: staticTheme.typography.fontSize.xxxl,
    fontWeight: staticTheme.typography.fontWeight.semibold,
    color: staticTheme.colors.textPrimary,
    fontFamily: staticTheme.typography.serif,
  },
  readingMeta: {
    fontSize: staticTheme.typography.fontSize.xs,
    color: staticTheme.colors.textTertiary,
    fontFamily: staticTheme.typography.serif,
    marginTop: 4,
  },
  sectionLabel: {
    fontSize: staticTheme.typography.fontSize.sm,
    fontWeight: staticTheme.typography.fontWeight.medium,
    color: staticTheme.colors.textSecondary,
    fontFamily: staticTheme.typography.serif,
    marginBottom: staticTheme.spacing.sm,
  },
  sensorGrid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: staticTheme.spacing.sm,
  },
  sensorValue: {
    flex: 1,
    backgroundColor: staticTheme.colors.background,
    padding: staticTheme.spacing.md,
    borderRadius: staticTheme.borderRadius.sm,
    alignItems: 'center',
  },
  sensorLabel: {
    fontSize: staticTheme.typography.fontSize.xs,
    color: staticTheme.colors.textSecondary,
    fontFamily: staticTheme.typography.serif,
    marginBottom: 4,
  },
  sensorNumber: {
    fontSize: staticTheme.typography.fontSize.md,
    fontWeight: staticTheme.typography.fontWeight.semibold,
    color: staticTheme.colors.textPrimary,
    fontFamily: staticTheme.typography.mono,
    minWidth: 60,
    textAlign: 'center',
  },
  rawData: {
    marginTop: staticTheme.spacing.md,
    padding: staticTheme.spacing.sm,
    backgroundColor: staticTheme.colors.background,
    borderRadius: staticTheme.borderRadius.sm,
  },
  rawDataLabel: {
    fontSize: staticTheme.typography.fontSize.xs,
    color: staticTheme.colors.textSecondary,
    fontFamily: staticTheme.typography.serif,
    marginBottom: 4,
  },
  rawDataText: {
    fontSize: staticTheme.typography.fontSize.xs,
    color: staticTheme.colors.textPrimary,
    fontFamily: staticTheme.typography.mono,
  },
  primaryButton: {
    backgroundColor: staticTheme.colors.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: staticTheme.spacing.lg,
    borderRadius: staticTheme.borderRadius.md,
    marginBottom: staticTheme.spacing.md,
    gap: staticTheme.spacing.sm,
  },
  primaryButtonText: {
    color: staticTheme.colors.primaryForeground,
    fontSize: staticTheme.typography.fontSize.lg,
    fontWeight: staticTheme.typography.fontWeight.semibold,
    fontFamily: staticTheme.typography.serif,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  actionsGrid: {
    flexDirection: 'row',
    gap: staticTheme.spacing.md,
    marginBottom: staticTheme.spacing.lg,
  },
  secondaryButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: staticTheme.spacing.md,
    backgroundColor: staticTheme.colors.muted,
    borderRadius: staticTheme.borderRadius.md,
    borderWidth: 1,
    borderColor: staticTheme.colors.border,
    gap: staticTheme.spacing.sm,
  },
  secondaryButtonText: {
    color: staticTheme.colors.textPrimary,
    fontSize: staticTheme.typography.fontSize.md,
    fontWeight: staticTheme.typography.fontWeight.medium,
    fontFamily: staticTheme.typography.serif,
  },
  dangerZone: {
    marginTop: staticTheme.spacing.xl,
    paddingTop: staticTheme.spacing.lg,
    borderTopWidth: 1,
    borderTopColor: staticTheme.colors.border,
    marginBottom: staticTheme.spacing.xxl,
  },
  dangerTitle: {
    fontSize: staticTheme.typography.fontSize.md,
    fontWeight: staticTheme.typography.fontWeight.medium,
    color: staticTheme.colors.error,
    fontFamily: staticTheme.typography.serif,
    marginBottom: staticTheme.spacing.md,
  },
  dangerButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: staticTheme.spacing.md,
    backgroundColor: 'transparent',
    borderRadius: staticTheme.borderRadius.md,
    borderWidth: 1,
    borderColor: staticTheme.colors.error,
    gap: staticTheme.spacing.sm,
  },
  dangerButtonText: {
    color: staticTheme.colors.error,
    fontSize: staticTheme.typography.fontSize.md,
    fontWeight: staticTheme.typography.fontWeight.medium,
    fontFamily: staticTheme.typography.serif,
  },
  streamingErrorBanner: {
    backgroundColor: staticTheme.colors.error + '15',
    borderRadius: staticTheme.borderRadius.sm,
    padding: staticTheme.spacing.sm,
    marginBottom: staticTheme.spacing.md,
  },
  streamingErrorText: {
    fontSize: staticTheme.typography.fontSize.xs,
    color: staticTheme.colors.error,
    fontFamily: staticTheme.typography.serif,
  },
  visualizationContainer: {
    borderRadius: staticTheme.borderRadius.md,
    borderWidth: 1,
    borderColor: staticTheme.colors.border,
    padding: staticTheme.spacing.sm,
    marginBottom: staticTheme.spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  actionButtonsRow: {
    flexDirection: 'row',
    gap: staticTheme.spacing.md,
    marginBottom: staticTheme.spacing.md,
  },
  halfWidthButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: staticTheme.spacing.md,
    paddingHorizontal: staticTheme.spacing.md,
    borderRadius: staticTheme.borderRadius.md,
    borderWidth: 1,
  },
  halfWidthButtonText: {
    fontSize: staticTheme.typography.fontSize.md,
    fontWeight: staticTheme.typography.fontWeight.medium,
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
  },
});

// Wrap the entire screen in an ErrorBoundary to catch any unhandled errors
const DeviceDetailScreen: React.FC = () => {
  return (
    <ErrorBoundary>
      <DeviceDetailScreenContent />
    </ErrorBoundary>
  );
};

export default DeviceDetailScreen;
