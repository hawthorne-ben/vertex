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
import {
  Bluetooth,
  Battery,
  Activity,
  Zap,
  Trash2,
  RefreshCw,
  Heart,
  ArrowLeft,
} from 'lucide-react-native';
import { theme } from '../styles/theme';
import BleService from '../services/BleService';
import { RootStackParamList } from '../navigation/AppNavigator';
import AsyncStorage from '@react-native-async-storage/async-storage';
import ErrorBoundary from '../components/ErrorBoundary';

type DeviceDetailRouteProp = RouteProp<RootStackParamList, 'DeviceDetail'>;

const SAVED_DEVICES_KEY = '@vertex_saved_devices';

const DeviceDetailScreenContent: React.FC = () => {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const route = useRoute<DeviceDetailRouteProp>();
  const { deviceId, deviceName } = route.params;

  const [isConnected, setIsConnected] = useState(false);
  const [isPolling, setIsPolling] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [batteryLevel, setBatteryLevel] = useState<number | null>(null);
  const [sensorReading, setSensorReading] = useState<any>(null);
  const [connectionStatus, setConnectionStatus] = useState('Connecting...');
  const [lastReadingTime, setLastReadingTime] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [streamingError, setStreamingError] = useState<string | null>(null);

  // Track if component is mounted to prevent state updates after unmount
  const isMountedRef = useRef(true);

  // Detect if this is a Vertex IMU device
  const isVertexDevice = deviceName?.toLowerCase().includes('vertex');

  useEffect(() => {
    isMountedRef.current = true;
    initializeDevice().catch((err) => {
      console.error('Init error caught:', err);
      if (isMountedRef.current) {
        setError(err?.message || 'Failed to initialize');
      }
    });
    return () => {
      isMountedRef.current = false;
      // Don't disconnect on unmount - user controls disconnect
    };
  }, []);

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

    setIsConnecting(true);
    setError(null);
    setStreamingError(null);

    try {
      // Check if already connected
      const connectedDevice = BleService.getConnectedDevice();

      if (connectedDevice?.id === deviceId) {
        safeSetState(setIsConnected, true);
        safeSetState(setConnectionStatus, 'Connected');
        safeSetState(setError, null);
        await discoverServices();
      } else {
        // Connect to device
        safeSetState(setConnectionStatus, 'Connecting...');
        await BleService.connectToDevice(deviceId);
        safeSetState(setIsConnected, true);
        safeSetState(setConnectionStatus, 'Connected');
        safeSetState(setError, null);
        await discoverServices();
      }

      // If this is a Vertex device, automatically start streaming
      if (isVertexDevice && isMountedRef.current) {
        await startIMUStreaming();
      }
    } catch (error: any) {
      console.error('Connection error:', error);
      if (!isMountedRef.current) return;

      safeSetState(setIsConnected, false);
      safeSetState(setConnectionStatus, 'Connection Failed');
      const errorMsg = error?.message || 'Failed to connect to device';
      safeSetState(setError, errorMsg);
    } finally {
      if (isMountedRef.current) {
        safeSetState(setIsConnecting, false);
      }
    }
  };

  const handleReconnect = async () => {
    await initializeDevice();
  };

  const discoverServices = async () => {
    try {
      // Attempt to read battery level
      const battery = await BleService.readBatteryLevel();
      if (battery !== null && isMountedRef.current) {
        safeSetState(setBatteryLevel, battery);
      }
    } catch (error) {
      console.log('Battery service not available');
    }
  };

  /**
   * Start streaming IMU data (for Vertex devices)
   */
  const startIMUStreaming = async () => {
    if (!isMountedRef.current) return;

    safeSetState(setIsStreaming, true);
    safeSetState(setStreamingError, null);

    try {
      await BleService.subscribeToIMUStream(
        (data) => {
          if (!isMountedRef.current) return;

          safeSetState(setSensorReading, data);
          safeSetState(setLastReadingTime, new Date());
          safeSetState(setStreamingError, null);
        },
        (error) => {
          if (!isMountedRef.current) return;

          console.error('IMU stream error:', error);
          safeSetState(setStreamingError, error.message);

          if (error.message.toLowerCase().includes('disconnect')) {
            safeSetState(setIsConnected, false);
            safeSetState(setConnectionStatus, 'Disconnected');
            safeSetState(setIsStreaming, false);
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

    safeSetState(setIsPolling, true);
    safeSetState(setSensorReading, null);
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
        safeSetState(setSensorReading, reading);
        safeSetState(setLastReadingTime, new Date());
        safeSetState(setError, null);

        // Refresh battery after reading (optional, don't fail if unavailable)
        safeBleCall(
          () => BleService.readBatteryLevel(),
          5000,
          'Battery read failed'
        ).then(battery => {
          if (battery !== null && isMountedRef.current) {
            safeSetState(setBatteryLevel, battery);
          }
        }).catch(() => {
          // Silently fail battery read
        });
      } else if (isMountedRef.current) {
        // safeBleCall returned null, error already set
        safeSetState(setIsConnected, false);
        safeSetState(setConnectionStatus, 'Disconnected');
      }
    } catch (error: any) {
      if (!isMountedRef.current) return;

      console.error('Polling error:', error);
      const errorMessage = error?.message || 'Could not read sensor data';

      // Check if device disconnected
      if (errorMessage.includes('disconnected') || errorMessage.includes('connection') || errorMessage.includes('not connected')) {
        safeSetState(setIsConnected, false);
        safeSetState(setConnectionStatus, 'Disconnected');
        safeSetState(setError, 'Device disconnected. Please reconnect.');
      } else {
        safeSetState(setError, errorMessage);
      }
    } finally {
      if (isMountedRef.current) {
        safeSetState(setIsPolling, false);
      }
    }
  };

  const handleDisconnect = async () => {
    try {
      await BleService.disconnect();
      setIsConnected(false);
      setConnectionStatus('Disconnected');
      Alert.alert('Disconnected', 'Device disconnected successfully', [
        { text: 'OK', onPress: () => navigation.goBack() }
      ]);
    } catch (error) {
      console.error('Disconnect error:', error);
      Alert.alert('Error', 'Failed to disconnect properly');
    }
  };

  const handleForget = async () => {
    Alert.alert(
      'Forget Device',
      `Remove ${deviceName} from saved devices?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Forget',
          style: 'destructive',
          onPress: async () => {
            try {
              // Disconnect if connected
              if (isConnected) {
                await BleService.disconnect();
              }

              // Remove from saved devices
              const saved = await AsyncStorage.getItem(SAVED_DEVICES_KEY);
              if (saved) {
                const devices = JSON.parse(saved);
                const updated = devices.filter((d: any) => d.id !== deviceId);
                await AsyncStorage.setItem(SAVED_DEVICES_KEY, JSON.stringify(updated));
              }

              Alert.alert('Device Forgotten', 'Device removed from saved devices', [
                { text: 'OK', onPress: () => navigation.goBack() }
              ]);
            } catch (error) {
              console.error('Forget error:', error);
              Alert.alert('Error', 'Failed to remove device');
            }
          },
        },
      ]
    );
  };

  const handleCalibrate = () => {
    Alert.alert(
      'Calibrate Sensor',
      'Place device on a flat, level surface for 5 seconds to calibrate.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Start',
          onPress: () => {
            // TODO: Implement calibration command to IMU device
            Alert.alert('Coming Soon', 'Calibration feature will be implemented for IMU devices');
          },
        },
      ]
    );
  };

  const renderStatusCard = () => (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>Device Status</Text>

      <View style={styles.statusRow}>
        <View style={styles.statusItem}>
          <Bluetooth
            size={20}
            color={isConnected ? theme.colors.success : theme.colors.error}
          />
          <View style={styles.statusInfo}>
            <Text style={styles.statusLabel}>Connection</Text>
            <Text style={[
              styles.statusValue,
              { color: isConnected ? theme.colors.success : theme.colors.error }
            ]}>
              {connectionStatus}
            </Text>
          </View>
        </View>

        <View style={styles.statusItem}>
          <Battery
            size={20}
            color={
              batteryLevel === null ? theme.colors.textTertiary :
              batteryLevel > 20 ? theme.colors.success :
              batteryLevel > 10 ? theme.colors.warning :
              theme.colors.error
            }
          />
          <View style={styles.statusInfo}>
            <Text style={styles.statusLabel}>Battery</Text>
            <Text style={styles.statusValue}>
              {batteryLevel !== null ? `${batteryLevel}%` : 'N/A'}
            </Text>
          </View>
        </View>
      </View>

      <View style={styles.divider} />

      <View style={styles.statusRow}>
        <View style={styles.statusItem}>
          <Activity size={20} color={theme.colors.textSecondary} />
          <View style={styles.statusInfo}>
            <Text style={styles.statusLabel}>Calibration</Text>
            <Text style={styles.statusValue}>Ready</Text>
          </View>
        </View>

        <View style={styles.statusItem}>
          <Zap size={20} color={theme.colors.textSecondary} />
          <View style={styles.statusInfo}>
            <Text style={styles.statusLabel}>Sample Rate</Text>
            <Text style={styles.statusValue}>100 Hz</Text>
          </View>
        </View>
      </View>
    </View>
  );

  const renderSensorData = () => {
    if (!sensorReading) {
      return (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Sensor Reading</Text>
          <View style={styles.emptyReading}>
            <Activity size={48} color={theme.colors.textTertiary} />
            <Text style={styles.emptyReadingText}>
              {isVertexDevice
                ? (isStreaming ? 'Waiting for data stream...' : 'No data yet. Starting stream...')
                : 'No data yet. Tap "Poll Sensor" to get a reading.'}
            </Text>
          </View>
        </View>
      );
    }

    return (
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <Text style={styles.cardTitle}>
            {isVertexDevice ? 'Live Sensor Stream' : 'Sensor Reading'}
          </Text>
          {lastReadingTime && (
            <Text style={styles.timestamp}>
              {lastReadingTime.toLocaleTimeString()}
            </Text>
          )}
        </View>

        {/* Streaming error indicator */}
        {streamingError && (
          <View style={styles.streamingErrorBanner}>
            <Text style={styles.streamingErrorText}>{streamingError}</Text>
          </View>
        )}

        {/* For Whoop: Show Heart Rate */}
        {sensorReading.heartRate !== undefined && (
          <View style={styles.readingCard}>
            <Heart size={32} color={theme.colors.error} />
            <View style={styles.readingInfo}>
              <Text style={styles.readingLabel}>Heart Rate</Text>
              <Text style={styles.readingValue}>{sensorReading.heartRate} BPM</Text>
              {sensorReading.contactDetected !== undefined && (
                <Text style={styles.readingMeta}>
                  Contact: {sensorReading.contactDetected ? 'Detected' : 'Not Detected'}
                </Text>
              )}
            </View>
          </View>
        )}

        {/* For Vertex IMU: Show orientation data */}
        {(sensorReading.roll !== undefined || sensorReading.pitch !== undefined || sensorReading.yaw !== undefined) && (
          <>
            <Text style={styles.sectionLabel}>Orientation (degrees)</Text>
            <View style={styles.sensorGrid}>
              <View style={styles.sensorValue}>
                <Text style={styles.sensorLabel}>Roll</Text>
                <Text style={styles.sensorNumber}>{sensorReading.roll?.toFixed(1) ?? '0.0'}°</Text>
              </View>
              <View style={styles.sensorValue}>
                <Text style={styles.sensorLabel}>Pitch</Text>
                <Text style={styles.sensorNumber}>{sensorReading.pitch?.toFixed(1) ?? '0.0'}°</Text>
              </View>
              <View style={styles.sensorValue}>
                <Text style={styles.sensorLabel}>Yaw</Text>
                <Text style={styles.sensorNumber}>{sensorReading.yaw?.toFixed(1) ?? '0.0'}°</Text>
              </View>
            </View>

            {/* Show calibration status */}
            {sensorReading.calibration && (
              <>
                <View style={styles.divider} />
                <Text style={styles.sectionLabel}>Calibration Status (0-3, higher is better)</Text>
                <View style={styles.sensorGrid}>
                  <View style={styles.sensorValue}>
                    <Text style={styles.sensorLabel}>System</Text>
                    <Text style={styles.sensorNumber}>{sensorReading.calibration.system}</Text>
                  </View>
                  <View style={styles.sensorValue}>
                    <Text style={styles.sensorLabel}>Gyro</Text>
                    <Text style={styles.sensorNumber}>{sensorReading.calibration.gyro}</Text>
                  </View>
                  <View style={styles.sensorValue}>
                    <Text style={styles.sensorLabel}>Accel</Text>
                    <Text style={styles.sensorNumber}>{sensorReading.calibration.accel}</Text>
                  </View>
                  <View style={styles.sensorValue}>
                    <Text style={styles.sensorLabel}>Mag</Text>
                    <Text style={styles.sensorNumber}>{sensorReading.calibration.mag}</Text>
                  </View>
                </View>
              </>
            )}
          </>
        )}
      </View>
    );
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <ArrowLeft size={24} color={theme.colors.textPrimary} />
        </TouchableOpacity>
        <View style={styles.headerInfo}>
          <Text style={styles.title}>{deviceName}</Text>
          <Text style={styles.deviceId}>{deviceId}</Text>
        </View>
      </View>

      <ScrollView style={styles.content}>
        {/* Error Banner */}
        {error && (
          <View style={styles.errorBanner}>
            <Text style={styles.errorText}>{error}</Text>
            {!isConnected && (
              <TouchableOpacity
                style={styles.reconnectButton}
                onPress={handleReconnect}
                disabled={isConnecting}>
                {isConnecting ? (
                  <ActivityIndicator size="small" color={theme.colors.primary} />
                ) : (
                  <Text style={styles.reconnectButtonText}>Reconnect</Text>
                )}
              </TouchableOpacity>
            )}
          </View>
        )}

        {renderStatusCard()}
        {renderSensorData()}

        {/* Primary Action - Only show poll button for non-Vertex devices */}
        {!isVertexDevice && (
          <TouchableOpacity
            style={[styles.primaryButton, !isConnected && styles.buttonDisabled]}
            onPress={handlePollSensor}
            disabled={!isConnected || isPolling}>
            {isPolling ? (
              <ActivityIndicator size="small" color={theme.colors.primaryForeground} />
            ) : (
              <>
                <RefreshCw size={20} color={theme.colors.primaryForeground} />
                <Text style={styles.primaryButtonText}>Poll Sensor</Text>
              </>
            )}
          </TouchableOpacity>
        )}

        {/* Streaming status for Vertex devices */}
        {isVertexDevice && (
          <View style={styles.streamingStatusCard}>
            <Activity size={20} color={isStreaming ? theme.colors.success : theme.colors.textSecondary} />
            <Text style={[
              styles.streamingStatusText,
              { color: isStreaming ? theme.colors.success : theme.colors.textSecondary }
            ]}>
              {isStreaming ? 'Live streaming at 1 Hz' : 'Stream inactive'}
            </Text>
          </View>
        )}

        {/* Secondary Actions */}
        <View style={styles.actionsGrid}>
          <TouchableOpacity
            style={styles.secondaryButton}
            onPress={handleCalibrate}
            disabled={!isConnected}>
            <Activity size={20} color={theme.colors.textPrimary} />
            <Text style={styles.secondaryButtonText}>Calibrate</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.secondaryButton}
            onPress={handleDisconnect}
            disabled={!isConnected}>
            <Bluetooth size={20} color={theme.colors.textPrimary} />
            <Text style={styles.secondaryButtonText}>Disconnect</Text>
          </TouchableOpacity>
        </View>

        {/* Danger Zone */}
        <View style={styles.dangerZone}>
          <Text style={styles.dangerTitle}>Danger Zone</Text>
          <TouchableOpacity style={styles.dangerButton} onPress={handleForget}>
            <Trash2 size={20} color={theme.colors.error} />
            <Text style={styles.dangerButtonText}>Forget Device</Text>
          </TouchableOpacity>
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
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  backButton: {
    marginRight: theme.spacing.md,
  },
  headerInfo: {
    flex: 1,
  },
  title: {
    fontSize: theme.typography.fontSize.xl,
    fontWeight: theme.typography.fontWeight.semibold,
    color: theme.colors.textPrimary,
    fontFamily: theme.typography.serif,
  },
  deviceId: {
    fontSize: theme.typography.fontSize.xs,
    color: theme.colors.textTertiary,
    fontFamily: theme.typography.mono,
    marginTop: 2,
  },
  content: {
    flex: 1,
    padding: theme.spacing.lg,
  },
  errorBanner: {
    backgroundColor: theme.colors.error + '15', // 15 is hex for ~8% opacity
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: theme.colors.error + '40',
    padding: theme.spacing.md,
    marginBottom: theme.spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  errorText: {
    fontSize: theme.typography.fontSize.sm,
    color: theme.colors.error,
    fontFamily: theme.typography.serif,
    flex: 1,
    marginRight: theme.spacing.sm,
  },
  reconnectButton: {
    backgroundColor: theme.colors.primary,
    paddingVertical: theme.spacing.sm,
    paddingHorizontal: theme.spacing.md,
    borderRadius: theme.borderRadius.sm,
    minWidth: 80,
    alignItems: 'center',
  },
  reconnectButtonText: {
    color: theme.colors.primaryForeground,
    fontSize: theme.typography.fontSize.sm,
    fontWeight: theme.typography.fontWeight.medium,
    fontFamily: theme.typography.serif,
  },
  card: {
    backgroundColor: theme.colors.muted,
    borderRadius: theme.borderRadius.md,
    padding: theme.spacing.lg,
    marginBottom: theme.spacing.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: theme.spacing.md,
  },
  cardTitle: {
    fontSize: theme.typography.fontSize.lg,
    fontWeight: theme.typography.fontWeight.medium,
    color: theme.colors.textPrimary,
    fontFamily: theme.typography.serif,
    marginBottom: theme.spacing.md,
  },
  timestamp: {
    fontSize: theme.typography.fontSize.xs,
    color: theme.colors.textSecondary,
    fontFamily: theme.typography.mono,
  },
  statusRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: theme.spacing.md,
  },
  statusItem: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  statusInfo: {
    marginLeft: theme.spacing.sm,
  },
  statusLabel: {
    fontSize: theme.typography.fontSize.xs,
    color: theme.colors.textSecondary,
    fontFamily: theme.typography.serif,
  },
  statusValue: {
    fontSize: theme.typography.fontSize.md,
    fontWeight: theme.typography.fontWeight.medium,
    color: theme.colors.textPrimary,
    fontFamily: theme.typography.serif,
  },
  divider: {
    height: 1,
    backgroundColor: theme.colors.border,
    marginVertical: theme.spacing.md,
  },
  emptyReading: {
    alignItems: 'center',
    padding: theme.spacing.xl,
  },
  emptyReadingText: {
    marginTop: theme.spacing.md,
    fontSize: theme.typography.fontSize.sm,
    color: theme.colors.textSecondary,
    fontFamily: theme.typography.serif,
    textAlign: 'center',
  },
  readingCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.background,
    padding: theme.spacing.lg,
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  readingInfo: {
    marginLeft: theme.spacing.md,
    flex: 1,
  },
  readingLabel: {
    fontSize: theme.typography.fontSize.sm,
    color: theme.colors.textSecondary,
    fontFamily: theme.typography.serif,
  },
  readingValue: {
    fontSize: theme.typography.fontSize.xxxl,
    fontWeight: theme.typography.fontWeight.semibold,
    color: theme.colors.textPrimary,
    fontFamily: theme.typography.serif,
  },
  readingMeta: {
    fontSize: theme.typography.fontSize.xs,
    color: theme.colors.textTertiary,
    fontFamily: theme.typography.serif,
    marginTop: 4,
  },
  sectionLabel: {
    fontSize: theme.typography.fontSize.sm,
    fontWeight: theme.typography.fontWeight.medium,
    color: theme.colors.textSecondary,
    fontFamily: theme.typography.serif,
    marginBottom: theme.spacing.sm,
  },
  sensorGrid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: theme.spacing.sm,
  },
  sensorValue: {
    flex: 1,
    backgroundColor: theme.colors.background,
    padding: theme.spacing.md,
    borderRadius: theme.borderRadius.sm,
    alignItems: 'center',
  },
  sensorLabel: {
    fontSize: theme.typography.fontSize.xs,
    color: theme.colors.textSecondary,
    fontFamily: theme.typography.serif,
    marginBottom: 4,
  },
  sensorNumber: {
    fontSize: theme.typography.fontSize.xl,
    fontWeight: theme.typography.fontWeight.semibold,
    color: theme.colors.textPrimary,
    fontFamily: theme.typography.mono,
  },
  rawData: {
    marginTop: theme.spacing.md,
    padding: theme.spacing.sm,
    backgroundColor: theme.colors.background,
    borderRadius: theme.borderRadius.sm,
  },
  rawDataLabel: {
    fontSize: theme.typography.fontSize.xs,
    color: theme.colors.textSecondary,
    fontFamily: theme.typography.serif,
    marginBottom: 4,
  },
  rawDataText: {
    fontSize: theme.typography.fontSize.xs,
    color: theme.colors.textPrimary,
    fontFamily: theme.typography.mono,
  },
  primaryButton: {
    backgroundColor: theme.colors.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: theme.spacing.lg,
    borderRadius: theme.borderRadius.md,
    marginBottom: theme.spacing.md,
    gap: theme.spacing.sm,
  },
  primaryButtonText: {
    color: theme.colors.primaryForeground,
    fontSize: theme.typography.fontSize.lg,
    fontWeight: theme.typography.fontWeight.semibold,
    fontFamily: theme.typography.serif,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  actionsGrid: {
    flexDirection: 'row',
    gap: theme.spacing.md,
    marginBottom: theme.spacing.lg,
  },
  secondaryButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: theme.spacing.md,
    backgroundColor: theme.colors.muted,
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    gap: theme.spacing.sm,
  },
  secondaryButtonText: {
    color: theme.colors.textPrimary,
    fontSize: theme.typography.fontSize.md,
    fontWeight: theme.typography.fontWeight.medium,
    fontFamily: theme.typography.serif,
  },
  dangerZone: {
    marginTop: theme.spacing.xl,
    paddingTop: theme.spacing.lg,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
    marginBottom: theme.spacing.xxl,
  },
  dangerTitle: {
    fontSize: theme.typography.fontSize.md,
    fontWeight: theme.typography.fontWeight.medium,
    color: theme.colors.error,
    fontFamily: theme.typography.serif,
    marginBottom: theme.spacing.md,
  },
  dangerButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: theme.spacing.md,
    backgroundColor: 'transparent',
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: theme.colors.error,
    gap: theme.spacing.sm,
  },
  dangerButtonText: {
    color: theme.colors.error,
    fontSize: theme.typography.fontSize.md,
    fontWeight: theme.typography.fontWeight.medium,
    fontFamily: theme.typography.serif,
  },
  streamingErrorBanner: {
    backgroundColor: theme.colors.error + '15',
    borderRadius: theme.borderRadius.sm,
    padding: theme.spacing.sm,
    marginBottom: theme.spacing.md,
  },
  streamingErrorText: {
    fontSize: theme.typography.fontSize.xs,
    color: theme.colors.error,
    fontFamily: theme.typography.serif,
  },
  streamingStatusCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: theme.spacing.md,
    backgroundColor: theme.colors.muted,
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    gap: theme.spacing.sm,
    marginBottom: theme.spacing.md,
  },
  streamingStatusText: {
    fontSize: theme.typography.fontSize.md,
    fontWeight: theme.typography.fontWeight.medium,
    fontFamily: theme.typography.serif,
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
