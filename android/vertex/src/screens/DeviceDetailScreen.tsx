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
  Activity,
  Zap,
  Trash2,
  RefreshCw,
  Heart,
  ArrowLeft,
  Circle,
} from 'lucide-react-native';
import { theme } from '../styles/theme';
import BleService from '../services/BleService';
import { RootStackParamList } from '../navigation/AppNavigator';
import AsyncStorage from '@react-native-async-storage/async-storage';
import ErrorBoundary from '../components/ErrorBoundary';

type DeviceDetailRouteProp = RouteProp<RootStackParamList, 'DeviceDetail'>;

const SAVED_DEVICES_KEY = '@vertex_saved_devices';

type NavigationProp = NativeStackNavigationProp<RootStackParamList>;

const DeviceDetailScreenContent: React.FC = () => {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<NavigationProp>();
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
  const [sampleRate, setSampleRate] = useState<number | null>(null);

  // Track if component is mounted to prevent state updates after unmount
  const isMountedRef = useRef(true);
  const lastUpdateTimeRef = useRef<number>(0);
  const updateCountRef = useRef<number>(0);
  const sampleRateHistoryRef = useRef<number[]>([]);

  // Detect if this is a Vertex IMU device
  const isVertexDevice = deviceName?.toLowerCase().includes('vertex');

  useEffect(() => {
    isMountedRef.current = true;

    // Initialize device with error boundary
    const init = async () => {
      try {
        await initializeDevice();
      } catch (err: any) {
        // Connection failure has UI feedback via error banner - no console logging needed
        if (isMountedRef.current) {
          try {
            safeSetState(setError, 'Connection failed');
            safeSetState(setIsConnecting, false);
          } catch (stateError) {
            console.error('Failed to set error state:', stateError);
          }
        }
      }
    };

    init();

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

    try {
      safeSetState(setIsConnecting, true);
      safeSetState(setError, null);
      safeSetState(setStreamingError, null);

      // Check if already connected
      const connectedDevice = BleService.getConnectedDevice();

      if (connectedDevice?.id === deviceId) {
        if (!isMountedRef.current) return;
        safeSetState(setIsConnected, true);
        safeSetState(setConnectionStatus, 'Connected');
        safeSetState(setError, null);

        try {
          await discoverServices();
        } catch (err) {
          console.warn('Service discovery failed:', err);
        }
      } else {
        // Connect to device (timeout handled by BleService)
        if (!isMountedRef.current) return;
        safeSetState(setConnectionStatus, 'Connecting...');

        try {
          await BleService.connectToDevice(deviceId);

          if (!isMountedRef.current) return;
          safeSetState(setIsConnected, true);
          safeSetState(setConnectionStatus, 'Connected');
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
      // Connection failure has UI feedback via error banner - no console logging needed
      if (!isMountedRef.current) return;

      safeSetState(setIsConnected, false);
      safeSetState(setConnectionStatus, 'Failed');
      // Show error banner with reconnect button, but no detailed error message
      safeSetState(setError, 'Connection failed');
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

              // Calculate average and round
              const avgRate = sampleRateHistoryRef.current.reduce((a, b) => a + b, 0) / sampleRateHistoryRef.current.length;
              safeSetState(setSampleRate, Math.round(avgRate));
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
      console.log('[DeviceDetail] Disconnecting device:', deviceId);

      // Stop any active streaming/polling first
      if (isStreaming || isPolling) {
        console.log('[DeviceDetail] Stopping active streams before disconnect');
        safeSetState(setIsStreaming, false);
        safeSetState(setIsPolling, false);
      }

      // Disconnect from BLE
      await BleService.disconnect();

      // Clear all state
      safeSetState(setIsConnected, false);
      safeSetState(setConnectionStatus, 'Disconnected');
      safeSetState(setSensorReading, null);
      safeSetState(setBatteryLevel, null);
      safeSetState(setSampleRate, null);
      safeSetState(setError, null);
      safeSetState(setStreamingError, null);

      Alert.alert('Disconnected', 'Device disconnected successfully', [
        { text: 'OK', onPress: () => navigation.goBack() }
      ]);
    } catch (error: any) {
      console.error('[DeviceDetail] Disconnect error:', error);

      // Even if disconnect fails, clear local state
      safeSetState(setIsConnected, false);
      safeSetState(setIsStreaming, false);
      safeSetState(setIsPolling, false);
      safeSetState(setConnectionStatus, 'Disconnected');

      Alert.alert(
        'Disconnect Issue',
        'Device may already be disconnected or connection was lost.',
        [{ text: 'OK', onPress: () => navigation.goBack() }]
      );
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
              // Try to disconnect if connected, but continue even if it fails
              if (isConnected) {
                try {
                  await BleService.disconnect();
                } catch (disconnectError) {
                  console.warn('Disconnect failed during forget, continuing...', disconnectError);
                }
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
              Alert.alert('Error', 'Failed to remove device from storage');
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

  const handleStartRecording = () => {
    navigation.navigate('Record', { deviceId, deviceName });
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
              sensorReading?.batteryVoltage === undefined ? theme.colors.textTertiary :
              sensorReading.batteryVoltage > 3.7 ? theme.colors.success :
              sensorReading.batteryVoltage > 3.4 ? theme.colors.warning :
              theme.colors.error
            }
          />
          <View style={styles.statusInfo}>
            <Text style={styles.statusLabel}>Battery</Text>
            <Text style={styles.statusValue}>
              {sensorReading?.batteryVoltage !== undefined
                ? `${sensorReading.batteryVoltage.toFixed(2)}V`
                : 'N/A'}
            </Text>
          </View>
        </View>
      </View>

      <View style={styles.divider} />

      <View style={styles.statusRow}>
        <View style={styles.statusItem}>
          <Activity
            size={20}
            color={
              sensorReading?.calibration?.system === 3 ? theme.colors.success :
              sensorReading?.calibration?.system >= 2 ? theme.colors.warning :
              theme.colors.textSecondary
            }
          />
          <View style={styles.statusInfo}>
            <Text style={styles.statusLabel}>Calibration</Text>
            <Text style={styles.statusValue}>
              {sensorReading?.calibration?.system !== undefined
                ? sensorReading.calibration.system
                : 'N/A'}
            </Text>
          </View>
        </View>

        <View style={styles.statusItem}>
          <Zap
            size={20}
            color={
              sampleRate && sampleRate >= 8 ? theme.colors.success :
              sampleRate && sampleRate >= 5 ? theme.colors.warning :
              theme.colors.textSecondary
            }
          />
          <View style={styles.statusInfo}>
            <Text style={styles.statusLabel}>Sample Rate</Text>
            <Text style={styles.statusValue}>
              {sampleRate ? `${sampleRate} Hz` : 'N/A'}
            </Text>
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

            {/* Accelerometer */}
            {(sensorReading.accelX !== undefined || sensorReading.accelY !== undefined || sensorReading.accelZ !== undefined) && (
              <>
                <View style={styles.divider} />
                <Text style={styles.sectionLabel}>Acceleration (m/s²)</Text>
                <View style={styles.sensorGrid}>
                  <View style={styles.sensorValue}>
                    <Text style={styles.sensorLabel}>X</Text>
                    <Text style={styles.sensorNumber}>{sensorReading.accelX?.toFixed(2) ?? '0.00'}</Text>
                  </View>
                  <View style={styles.sensorValue}>
                    <Text style={styles.sensorLabel}>Y</Text>
                    <Text style={styles.sensorNumber}>{sensorReading.accelY?.toFixed(2) ?? '0.00'}</Text>
                  </View>
                  <View style={styles.sensorValue}>
                    <Text style={styles.sensorLabel}>Z</Text>
                    <Text style={styles.sensorNumber}>{sensorReading.accelZ?.toFixed(2) ?? '0.00'}</Text>
                  </View>
                </View>
              </>
            )}

            {/* Gyroscope */}
            {(sensorReading.gyroX !== undefined || sensorReading.gyroY !== undefined || sensorReading.gyroZ !== undefined) && (
              <>
                <View style={styles.divider} />
                <Text style={styles.sectionLabel}>Angular Velocity (rad/s)</Text>
                <View style={styles.sensorGrid}>
                  <View style={styles.sensorValue}>
                    <Text style={styles.sensorLabel}>X</Text>
                    <Text style={styles.sensorNumber}>{sensorReading.gyroX?.toFixed(2) ?? '0.00'}</Text>
                  </View>
                  <View style={styles.sensorValue}>
                    <Text style={styles.sensorLabel}>Y</Text>
                    <Text style={styles.sensorNumber}>{sensorReading.gyroY?.toFixed(2) ?? '0.00'}</Text>
                  </View>
                  <View style={styles.sensorValue}>
                    <Text style={styles.sensorLabel}>Z</Text>
                    <Text style={styles.sensorNumber}>{sensorReading.gyroZ?.toFixed(2) ?? '0.00'}</Text>
                  </View>
                </View>
              </>
            )}

            {/* Magnetometer */}
            {(sensorReading.magX !== undefined || sensorReading.magY !== undefined || sensorReading.magZ !== undefined) && (
              <>
                <View style={styles.divider} />
                <Text style={styles.sectionLabel}>Magnetic Field (µT)</Text>
                <View style={styles.sensorGrid}>
                  <View style={styles.sensorValue}>
                    <Text style={styles.sensorLabel}>X</Text>
                    <Text style={styles.sensorNumber}>{sensorReading.magX?.toFixed(1) ?? '0.0'}</Text>
                  </View>
                  <View style={styles.sensorValue}>
                    <Text style={styles.sensorLabel}>Y</Text>
                    <Text style={styles.sensorNumber}>{sensorReading.magY?.toFixed(1) ?? '0.0'}</Text>
                  </View>
                  <View style={styles.sensorValue}>
                    <Text style={styles.sensorLabel}>Z</Text>
                    <Text style={styles.sensorNumber}>{sensorReading.magZ?.toFixed(1) ?? '0.0'}</Text>
                  </View>
                </View>
              </>
            )}

            {/* Sensor Calibration Status */}
            {sensorReading.calibration && (
              <>
                <View style={styles.divider} />
                <Text style={styles.sectionLabel}>Sensor Calibration (0-3)</Text>
                <View style={styles.sensorGrid}>
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

        {/* Record and Streaming status for Vertex devices */}
        {isVertexDevice && (
          <>
            {/* Primary Record Button */}
            <TouchableOpacity
              style={[styles.recordButton, !isConnected && styles.buttonDisabled]}
              onPress={handleStartRecording}
              disabled={!isConnected}>
              <Circle size={24} color={theme.colors.primaryForeground} fill={theme.colors.error} />
              <Text style={styles.recordButtonText}>Start Recording</Text>
            </TouchableOpacity>

            {/* Streaming status */}
            <View style={styles.streamingStatusCard}>
              <Activity size={20} color={isStreaming ? theme.colors.success : theme.colors.textSecondary} />
              <Text style={[
                styles.streamingStatusText,
                { color: isStreaming ? theme.colors.success : theme.colors.textSecondary }
              ]}>
                {isStreaming
                  ? (sampleRate ? `Live streaming at ${sampleRate} Hz` : 'Live streaming...')
                  : 'Stream inactive'}
              </Text>
            </View>
          </>
        )}

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
    backgroundColor: theme.colors.errorBg,
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: theme.colors.errorBorder,
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
    fontSize: theme.typography.fontSize.md,
    fontWeight: theme.typography.fontWeight.semibold,
    color: theme.colors.textPrimary,
    fontFamily: theme.typography.mono,
    minWidth: 60,
    textAlign: 'center',
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
  recordButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: theme.spacing.lg,
    backgroundColor: theme.colors.error,
    borderRadius: theme.borderRadius.md,
    marginBottom: theme.spacing.md,
    gap: theme.spacing.sm,
    minHeight: 60,
  },
  recordButtonText: {
    color: theme.colors.primaryForeground,
    fontSize: theme.typography.fontSize.lg,
    fontWeight: theme.typography.fontWeight.semibold,
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
