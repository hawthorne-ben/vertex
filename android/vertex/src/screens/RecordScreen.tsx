/**
 * Record Screen
 *
 * Manages IMU data recording sessions with bike and position selection
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
  TextInput,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  Circle,
  Square,
  Clock,
  Database,
  AlertCircle,
  CheckCircle,
  Bluetooth,
  Activity,
  WifiOff,
  ChevronDown,
} from 'lucide-react-native';
import { theme as staticTheme } from '../styles/theme';
import { useTheme } from '../contexts/ThemeContext';
import { BackButton, Card, ConfirmDialog } from '../components/ui';
import { useToast } from '../contexts/ToastContext';
import RecordingService, { RecordingSession } from '../services/RecordingService';
import BleService from '../services/BleService';
import { RootStackParamList } from '../navigation/AppNavigator';

type RecordRouteProp = RouteProp<RootStackParamList, 'Record'>;

const BIKES = ['Bike 1', 'Bike 2', 'Bike 3'];
const POSITIONS = ['Body', 'Seatpost'];
const ZERO_POINT_KEY = '@vertex_zero_point_';

const RecordScreen: React.FC = () => {
  const insets = useSafeAreaInsets();
  const { theme } = useTheme();
  const { showToast } = useToast();
  const navigation = useNavigation();
  const route = useRoute<RecordRouteProp>();
  const { deviceId, deviceName } = route.params;

  const [session, setSession] = useState<RecordingSession | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isConnected, setIsConnected] = useState(true);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [selectedBike, setSelectedBike] = useState(BIKES[0]);
  const [selectedPosition, setSelectedPosition] = useState(POSITIONS[0]);
  const [showStopConfirm, setShowStopConfirm] = useState(false);
  const [zeroPoint, setZeroPoint] = useState<any | null>(null);
  const [isZeroing, setIsZeroing] = useState(false);
  const [showClearZeroDialog, setShowClearZeroDialog] = useState(false);
  const [sensorReading, setSensorReading] = useState<any | null>(null);
  const [showConnectionLostDialog, setShowConnectionLostDialog] = useState(false);
  const [isResuming, setIsResuming] = useState(false);
  const [isReconnecting, setIsReconnecting] = useState(false);
  const [showFileNameDialog, setShowFileNameDialog] = useState(false);
  const [fileName, setFileName] = useState('');

  const isMountedRef = useRef(true);
  const clockTimerRef = useRef<NodeJS.Timeout | null>(null);
  const readingBufferRef = useRef<any[]>([]);
  const zeroPointRef = useRef<any | null>(null);
  const streamSubscriptionRef = useRef<any>(null);
  const hasShownConnectionLostDialogRef = useRef(false);
  const reconnectIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectAttemptsRef = useRef(0);

  useEffect(() => {
    isMountedRef.current = true;
    checkConnection();
    loadZeroPoint();

    // Check for existing session
    const existingSession = RecordingService.getCurrentSession();
    if (existingSession && existingSession.deviceId === deviceId) {
      setSession(existingSession);
    }

    // Start IMU streaming for zero point buffer (separate from recording)
    startIMUStreamForZero();

    // Start clock timer
    clockTimerRef.current = setInterval(() => {
      if (isMountedRef.current) {
        setCurrentTime(new Date());
      }
    }, 1000);

    // Listen for connection state changes
    const unsubscribe = BleService.addConnectionListener((device, isConn) => {
      console.log('[RecordScreen] Connection state changed:', device?.id, isConn);
      if (!isMountedRef.current) return;

      // Update connection status
      const connected = isConn && device?.id === deviceId;
      setIsConnected(connected);

      const currentSession = RecordingService.getCurrentSession();

      // Handle disconnection during recording
      if (!connected && currentSession?.isRecording) {
        console.log('[RecordScreen] Device disconnected during recording');
        console.log('[RecordScreen] Current session before disconnect:', currentSession);

        // Clean up IMU stream subscription on disconnection
        if (streamSubscriptionRef.current) {
          try {
            streamSubscriptionRef.current.remove();
            streamSubscriptionRef.current = null;
          } catch (err) {
            console.warn('[RecordScreen] Error removing stream on disconnect:', err);
          }
        }

        // Update local session state (RecordingService should have paused it)
        // Wait a moment for RecordingService to process the disconnection
        setTimeout(() => {
          const updatedSession = RecordingService.getCurrentSession();
          console.log('[RecordScreen] Session after disconnect:', updatedSession);
          if (updatedSession && isMountedRef.current) {
            setSession(updatedSession);
          }
        }, 100);

        // Show dialog to user (only once per disconnection)
        if (!hasShownConnectionLostDialogRef.current) {
          hasShownConnectionLostDialogRef.current = true;
          setShowConnectionLostDialog(true);
        }

        // Start automatic reconnection attempts
        startReconnectionAttempts();
      }

      // Handle reconnection during paused recording
      if (connected && currentSession?.isPaused) {
        console.log('[RecordScreen] Device reconnected, attempting to resume recording');
        console.log('[RecordScreen] Current session state:', currentSession);
        hasShownConnectionLostDialogRef.current = false; // Reset for next disconnection
        stopReconnectionAttempts(); // Stop reconnection attempts since we're now connected

        // Update local session state immediately
        setSession(currentSession);

        // Attempt to resume recording
        handleResumeRecording();
      }

      // Restart IMU stream for zero point buffer if reconnected
      if (connected && !streamSubscriptionRef.current) {
        console.log('[RecordScreen] Reconnected, restarting IMU stream');
        startIMUStreamForZero();
      }
    });

    return () => {
      isMountedRef.current = false;
      unsubscribe();
      if (clockTimerRef.current) {
        clearInterval(clockTimerRef.current);
      }
      if (streamSubscriptionRef.current) {
        try {
          streamSubscriptionRef.current.remove();
        } catch (err) {
          console.warn('[RecordScreen] Error removing stream subscription:', err);
        }
      }
      if (reconnectIntervalRef.current) {
        clearInterval(reconnectIntervalRef.current);
      }
    };
  }, [deviceId]);

  const checkConnection = () => {
    const connectedDevice = BleService.getConnectedDevice();
    setIsConnected(connectedDevice?.id === deviceId);
  };

  const getElapsedTime = (): number => {
    if (!session?.startTime) return 0;
    const now = new Date();
    const elapsed = Math.floor((now.getTime() - session.startTime.getTime()) / 1000);
    return elapsed;
  };

  const handleStartRecording = async () => {
    if (!isConnected) {
      Alert.alert('Not Connected', 'Please connect to the device before recording');
      return;
    }

    setIsStarting(true);
    setError(null);

    try {
      const newSession = await RecordingService.startRecording(
        deviceId,
        deviceName,
        (updatedSession) => {
          if (isMountedRef.current) {
            setSession(updatedSession);
            checkConnection();
          }
        },
        (recordingError) => {
          if (isMountedRef.current) {
            setError(recordingError.message);
          }
        },
        zeroPointRef.current // Pass current zero point to recording service
      );

      if (isMountedRef.current) {
        setSession(newSession);
      }
    } catch (err: any) {
      if (isMountedRef.current) {
        setError(err.message || 'Failed to start recording');
        Alert.alert('Error', err.message || 'Failed to start recording');
      }
    } finally {
      if (isMountedRef.current) {
        setIsStarting(false);
      }
    }
  };

  const handleShowStopDialog = () => {
    // Generate default file name
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').split('.')[0];
    const devicePrefix = deviceName ? `${deviceName.replace(/[^a-zA-Z0-9]/g, '_')}_` : '';
    const defaultFileName = `${devicePrefix}imu_${timestamp}`;
    setFileName(defaultFileName);
    setShowFileNameDialog(true);
  };

  const handleStopRecording = async () => {
    setIsStopping(true);
    setShowFileNameDialog(false);

    // Stop any reconnection attempts
    stopReconnectionAttempts();

    try {
      const stoppedSession = await RecordingService.stopRecording();

      if (stoppedSession && fileName && isMountedRef.current) {
        // Rename the file if user changed the name
        const FileService = (await import('../services/FileService')).default;
        const RNFS = (await import('react-native-fs')).default;

        const originalFileName = stoppedSession.fileName;
        const newFileName = fileName.endsWith('.csv') ? fileName : `${fileName}.csv`;

        if (originalFileName !== newFileName) {
          const documentsPath = RNFS.DocumentDirectoryPath;
          const oldPath = `${documentsPath}/${originalFileName}`;
          const newPath = `${documentsPath}/${newFileName}`;

          try {
            await RNFS.moveFile(oldPath, newPath);
            console.log(`[RecordScreen] Renamed file from ${originalFileName} to ${newFileName}`);

            // Navigate to DataDetail with new file
            navigation.replace('DataDetail', {
              fileName: newFileName,
              filePath: newPath,
            });
          } catch (renameErr) {
            console.error('[RecordScreen] Error renaming file:', renameErr);
            // Navigate with original filename if rename fails
            navigation.replace('DataDetail', {
              fileName: originalFileName,
              filePath: stoppedSession.filePath,
            });
          }
        } else {
          // Navigate to DataDetail with original file
          navigation.replace('DataDetail', {
            fileName: originalFileName,
            filePath: stoppedSession.filePath,
          });
        }
      } else if (isMountedRef.current) {
        setSession(null);
        setError(null);
        hasShownConnectionLostDialogRef.current = false;
        navigation.goBack();
      }
    } catch (err: any) {
      if (isMountedRef.current) {
        Alert.alert('Error', err.message || 'Failed to stop recording');
      }
    } finally {
      if (isMountedRef.current) {
        setIsStopping(false);
      }
    }
  };

  const handleResumeRecording = async () => {
    if (isResuming) return;

    setIsResuming(true);
    setError(null);

    try {
      await RecordingService.resumeRecording();
      console.log('[RecordScreen] Recording resumed successfully');

      // Update session state
      const updatedSession = RecordingService.getCurrentSession();
      if (updatedSession && isMountedRef.current) {
        setSession(updatedSession);
      }

      // Show success toast
      showToast({
        message: 'Recording resumed',
        variant: 'success',
        duration: 2000,
        hasTabBar: false, // Record screen has no bottom tabs
      });
    } catch (err: any) {
      console.error('[RecordScreen] Failed to resume recording:', err);
      if (isMountedRef.current) {
        setError('Failed to resume recording. Please try stopping and restarting.');
      }
    } finally {
      if (isMountedRef.current) {
        setIsResuming(false);
      }
    }
  };

  const handleKeepWaitingForConnection = () => {
    setShowConnectionLostDialog(false);
    // Keep recording paused, waiting for reconnection
    // Reconnection attempts are already running, so just dismiss the dialog
    console.log('[RecordScreen] User chose to keep waiting for connection');
  };

  const handleStopDueToDisconnection = async () => {
    setShowConnectionLostDialog(false);
    hasShownConnectionLostDialogRef.current = false;
    stopReconnectionAttempts();
    await handleStopRecording();
  };

  const startReconnectionAttempts = () => {
    // Clear any existing interval
    if (reconnectIntervalRef.current) {
      clearInterval(reconnectIntervalRef.current);
    }

    console.log('[RecordScreen] Starting automatic reconnection attempts');
    setIsReconnecting(true);
    reconnectAttemptsRef.current = 0;

    // Attempt reconnection every 3 seconds
    reconnectIntervalRef.current = setInterval(async () => {
      if (!isMountedRef.current) {
        stopReconnectionAttempts();
        return;
      }

      reconnectAttemptsRef.current++;
      console.log(`[RecordScreen] Reconnection attempt ${reconnectAttemptsRef.current}`);

      try {
        // Try to reconnect to the device
        await BleService.connectToDevice(deviceId);
        console.log('[RecordScreen] Reconnection successful');

        // Stop further attempts
        stopReconnectionAttempts();
      } catch (error) {
        console.log(`[RecordScreen] Reconnection attempt ${reconnectAttemptsRef.current} failed:`, error);
        // Continue trying (interval will call this function again)
      }
    }, 3000);
  };

  const stopReconnectionAttempts = () => {
    if (reconnectIntervalRef.current) {
      console.log('[RecordScreen] Stopping reconnection attempts');
      clearInterval(reconnectIntervalRef.current);
      reconnectIntervalRef.current = null;
    }
    setIsReconnecting(false);
    reconnectAttemptsRef.current = 0;
  };

  // Zero Point Management
  const loadZeroPoint = async () => {
    try {
      const stored = await AsyncStorage.getItem(ZERO_POINT_KEY + deviceId);
      if (stored) {
        const parsed = JSON.parse(stored);
        setZeroPoint(parsed);
        zeroPointRef.current = parsed;
        console.log('[RecordScreen] Loaded zero point for device:', deviceId);
      }
    } catch (error) {
      console.error('[RecordScreen] Error loading zero point:', error);
    }
  };

  const saveZeroPoint = async (point: any) => {
    try {
      await AsyncStorage.setItem(ZERO_POINT_KEY + deviceId, JSON.stringify(point));
      setZeroPoint(point);
      zeroPointRef.current = point;
      console.log('[RecordScreen] Saved zero point for device:', deviceId);
    } catch (error) {
      console.error('[RecordScreen] Error saving zero point:', error);
      throw error;
    }
  };

  const startIMUStreamForZero = async () => {
    if (!isConnected) return;

    // Clean up existing subscription first
    if (streamSubscriptionRef.current) {
      try {
        streamSubscriptionRef.current.remove();
        streamSubscriptionRef.current = null;
      } catch (err) {
        console.warn('[RecordScreen] Error removing old stream subscription:', err);
      }
    }

    try {
      console.log('[RecordScreen] Starting IMU stream for zero point buffer');
      streamSubscriptionRef.current = await BleService.subscribeToIMUStream(
        (data) => {
          if (!isMountedRef.current) return;

          // Add to reading buffer (keep last 10 readings)
          readingBufferRef.current.push(data);
          if (readingBufferRef.current.length > 10) {
            readingBufferRef.current.shift();
          }

          // Update sensor reading display (apply zero offset for display)
          let displayData = data;
          const currentZeroPoint = zeroPointRef.current;
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
              magX: (data.magX || 0) - (currentZeroPoint.magX || 0),
              magY: (data.magY || 0) - (currentZeroPoint.magY || 0),
              magZ: (data.magZ || 0) - (currentZeroPoint.magZ || 0),
            };
          }

          setSensorReading(displayData);
        },
        (error) => {
          console.error('[RecordScreen] IMU stream error:', error);
          // Clear subscription ref on error
          streamSubscriptionRef.current = null;
        }
      );
    } catch (error) {
      console.error('[RecordScreen] Failed to start IMU stream:', error);
      streamSubscriptionRef.current = null;
    }
  };

  const handleZero = async () => {
    if (readingBufferRef.current.length < 5) {
      showToast({
        message: `Need at least 5 readings. Currently have ${readingBufferRef.current.length}. Please wait...`,
        variant: 'warning',
        duration: 3000,
        hasTabBar: false, // Record screen has no bottom tabs
      });
      return;
    }

    setIsZeroing(true);

    try {
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
        magX: last5.reduce((sum, r) => sum + (r.magX || 0), 0) / 5,
        magY: last5.reduce((sum, r) => sum + (r.magY || 0), 0) / 5,
        magZ: last5.reduce((sum, r) => sum + (r.magZ || 0), 0) / 5,
      };

      await saveZeroPoint(avgReading);

      showToast({
        message: 'Zero point set',
        variant: 'success',
        duration: 2000,
        hasTabBar: false, // Record screen has no bottom tabs
      });
    } catch (error) {
      console.error('[RecordScreen] Error setting zero point:', error);
      showToast({
        message: 'Failed to set zero point',
        variant: 'error',
        hasTabBar: false, // Record screen has no bottom tabs
      });
    } finally {
      setIsZeroing(false);
    }
  };

  const confirmClearZero = async () => {
    try {
      await AsyncStorage.removeItem(ZERO_POINT_KEY + deviceId);
      setZeroPoint(null);
      zeroPointRef.current = null;
      setShowClearZeroDialog(false);

      showToast({
        message: 'Zero point cleared',
        variant: 'success',
        duration: 2000,
        hasTabBar: false, // Record screen has no bottom tabs
      });
    } catch (error) {
      console.error('[RecordScreen] Error clearing zero point:', error);
      showToast({
        message: 'Failed to clear zero point',
        variant: 'error',
        hasTabBar: false, // Record screen has no bottom tabs
      });
    }
  };

  const handleBackPress = () => {
    if (isRecording) {
      Alert.alert(
        'Recording in Progress',
        'Stop recording before going back?',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Stop & Go Back',
            style: 'destructive',
            onPress: async () => {
              try {
                await RecordingService.stopRecording();
                navigation.goBack();
              } catch (err) {
                navigation.goBack();
              }
            },
          },
        ]
      );
    } else {
      navigation.goBack();
    }
  };

  const formatTime = (seconds: number): string => {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const formatFileSize = (samples: number): string => {
    const bytes = samples * 90;
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  };

  const isRecording = session?.isRecording && !session?.isPaused;
  const connectionLost = session?.isPaused && session?.connectionLostTime;

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background, paddingTop: insets.top }]}>
      {/* Header */}
      <View style={[styles.header, { backgroundColor: theme.colors.background, borderBottomColor: theme.colors.border }]}>
        <BackButton onPress={handleBackPress} />
        <View style={styles.headerCenter}>
          <Text style={[styles.title, { color: theme.colors.textPrimary }]}>Record Session</Text>
          <Text style={[styles.currentTime, { color: theme.colors.textSecondary }]}>
            {currentTime.toLocaleTimeString()}
          </Text>
        </View>
      </View>

      <ScrollView style={styles.content}>
        {/* Connection Lost Warning - takes priority over error banner */}
        {connectionLost && (
          <View style={[styles.warningBanner, { backgroundColor: theme.colors.warning + '15', borderColor: theme.colors.warning + '40' }]}>
            <WifiOff size={20} color={theme.colors.warning} />
            <View style={styles.warningContent}>
              <Text style={[styles.warningTitle, { color: theme.colors.warning }]}>Connection Lost</Text>
              <Text style={[styles.warningText, { color: theme.colors.warning }]}>
                {isReconnecting
                  ? 'Recording paused. Attempting to reconnect...'
                  : 'Recording paused. Waiting for device to reconnect...'}
              </Text>
              {(isResuming || isReconnecting) && (
                <ActivityIndicator size="small" color={theme.colors.warning} style={{ marginTop: 8 }} />
              )}
            </View>
          </View>
        )}

        {/* Error Banner - only show if not in connection lost state */}
        {error && !connectionLost && (
          <View style={[styles.errorBanner, { backgroundColor: theme.colors.error + '15', borderColor: theme.colors.error + '40' }]}>
            <AlertCircle size={20} color={theme.colors.error} />
            <Text style={[styles.errorText, { color: theme.colors.error }]}>{error}</Text>
          </View>
        )}

        {/* Device Status - Compact */}
        <View style={[styles.card, { backgroundColor: theme.colors.muted, borderColor: theme.colors.border }]}>
          <View style={styles.statusGrid}>
            <View style={styles.statusGridRow}>
              {/* Connection Status */}
              <View style={styles.statusCompactItem}>
                <Bluetooth
                  size={18}
                  color={isConnected ? theme.colors.success : theme.colors.error}
                  style={styles.statusIcon}
                />
                <Text style={[styles.statusCompactValue, {
                  color: isConnected ? theme.colors.success : theme.colors.error,
                  fontFamily: staticTheme.typography.mono,
                }]}>
                  {isConnected ? 'Connected' : 'Disconnected'}
                </Text>
              </View>

              {/* Recording Status */}
              <View style={styles.statusCompactItem}>
                <Activity
                  size={18}
                  color={isRecording ? theme.colors.success : theme.colors.textTertiary}
                  style={styles.statusIcon}
                />
                <Text style={[styles.statusCompactValue, {
                  color: isRecording ? theme.colors.success : theme.colors.textTertiary,
                  fontFamily: staticTheme.typography.mono,
                }]}>
                  {isRecording ? 'Recording' : 'Idle'}
                </Text>
              </View>
            </View>
          </View>
        </View>

        {/* Bike & Position Selectors */}
        {!isRecording && (
          <>
            <Card style={styles.cardSpacing}>
              <Text style={[styles.selectorLabel, { color: theme.colors.textSecondary }]}>Bike</Text>
              <TouchableOpacity
                style={[styles.selector, { backgroundColor: theme.colors.muted, borderColor: theme.colors.border }]}
                onPress={() => {
                  Alert.alert(
                    'Select Bike',
                    '',
                    BIKES.map(bike => ({
                      text: bike,
                      onPress: () => setSelectedBike(bike),
                    }))
                  );
                }}>
                <Text style={[styles.selectorText, { color: theme.colors.textPrimary }]}>{selectedBike}</Text>
                <ChevronDown size={20} color={theme.colors.textTertiary} />
              </TouchableOpacity>
            </Card>

            <Card style={styles.cardSpacing}>
              <Text style={[styles.selectorLabel, { color: theme.colors.textSecondary }]}>Position</Text>
              <TouchableOpacity
                style={[styles.selector, { backgroundColor: theme.colors.muted, borderColor: theme.colors.border }]}
                onPress={() => {
                  Alert.alert(
                    'Select Position',
                    '',
                    POSITIONS.map(position => ({
                      text: position,
                      onPress: () => setSelectedPosition(position),
                    }))
                  );
                }}>
                <Text style={[styles.selectorText, { color: theme.colors.textPrimary }]}>{selectedPosition}</Text>
                <ChevronDown size={20} color={theme.colors.textTertiary} />
              </TouchableOpacity>
            </Card>
          </>
        )}

        {/* Recording Stats */}
        {session && (
          <Card style={styles.cardSpacing}>
            <View style={styles.statsRow}>
              <View style={styles.statItem}>
                <Clock size={24} color={theme.colors.primary} />
                <Text style={[styles.statValue, { color: theme.colors.textPrimary }]}>{formatTime(getElapsedTime())}</Text>
                <Text style={[styles.statLabel, { color: theme.colors.textSecondary }]}>Duration</Text>
              </View>
              <View style={styles.statItem}>
                <Database size={24} color={theme.colors.primary} />
                <Text style={[styles.statValue, { color: theme.colors.textPrimary }]}>{session.sampleCount.toLocaleString()}</Text>
                <Text style={[styles.statLabel, { color: theme.colors.textSecondary }]}>Samples</Text>
              </View>
            </View>
          </Card>
        )}

        {/* Record/Stop Button and Zero Button */}
        {!session || !session.isRecording ? (
          <>
            <View style={styles.actionButtonsRow}>
              {/* Start Recording Button */}
              <TouchableOpacity
                style={[
                  styles.halfWidthButton,
                  {
                    backgroundColor: isConnected ? theme.colors.background : theme.colors.muted,
                    borderColor: isConnected ? theme.colors.error : theme.colors.border,
                    borderWidth: 2,
                  },
                ]}
                onPress={handleStartRecording}
                disabled={!isConnected || isStarting}>
                {isStarting ? (
                  <ActivityIndicator size="small" color={theme.colors.error} />
                ) : (
                  <>
                    <Text style={[styles.halfWidthButtonText, {
                      color: isConnected ? theme.colors.error : theme.colors.textTertiary,
                    }]}>
                      Record
                    </Text>
                    <Circle
                      size={16}
                      color={isConnected ? theme.colors.error : theme.colors.textTertiary}
                      fill={isConnected ? theme.colors.error : 'transparent'}
                    />
                  </>
                )}
              </TouchableOpacity>

              {/* Zero Button */}
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
          </>
        ) : (
          <TouchableOpacity
            style={[
              styles.recordButton,
              {
                backgroundColor: theme.colors.background,
                borderColor: theme.colors.error,
                borderWidth: 2,
              },
            ]}
            onPress={handleShowStopDialog}
            disabled={isStopping}>
            {isStopping ? (
              <ActivityIndicator size="small" color={theme.colors.error} />
            ) : (
              <>
                <Text style={[styles.recordButtonText, { color: theme.colors.error }]}>
                  Stop Recording
                </Text>
                <Square
                  size={16}
                  color={theme.colors.error}
                  fill={theme.colors.error}
                />
              </>
            )}
          </TouchableOpacity>
        )}

        {/* Info Card - Normal State */}
        {!session && !connectionLost && (
          <Card variant="default">
            <View style={styles.infoCard}>
              <CheckCircle size={20} color={theme.colors.success} />
              <Text style={[styles.infoCardText, { color: theme.colors.textSecondary }]}>
                Recording will continue even if the connection is temporarily lost. Data will be saved automatically.
              </Text>
            </View>
          </Card>
        )}
      </ScrollView>

      {/* File Name Dialog */}
      {showFileNameDialog && (
        <View style={styles.dialogOverlay}>
          <View style={[styles.dialogContainer, { backgroundColor: theme.colors.card }]}>
            <Text style={[styles.dialogTitle, { color: theme.colors.textPrimary }]}>
              Save Recording
            </Text>
            <Text style={[styles.dialogMessage, { color: theme.colors.textSecondary }]}>
              Enter a name for this recording:
            </Text>
            <TextInput
              style={[styles.fileNameInput, {
                backgroundColor: theme.colors.background,
                borderColor: theme.colors.border,
                color: theme.colors.textPrimary,
              }]}
              value={fileName}
              onChangeText={setFileName}
              placeholder="File name (without .csv)"
              placeholderTextColor={theme.colors.textTertiary}
              autoFocus
              selectTextOnFocus
            />
            <View style={styles.dialogActions}>
              <TouchableOpacity
                style={[styles.dialogButton, { backgroundColor: theme.colors.muted }]}
                onPress={() => setShowFileNameDialog(false)}
              >
                <Text style={[styles.dialogButtonText, { color: theme.colors.textPrimary }]}>
                  Cancel
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.dialogButton, { backgroundColor: theme.colors.primary }]}
                onPress={handleStopRecording}
                disabled={!fileName.trim()}
              >
                <Text style={[styles.dialogButtonText, { color: theme.colors.primaryForeground }]}>
                  Save
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      )}

      {/* Stop Recording Confirmation */}
      <ConfirmDialog
        visible={showStopConfirm}
        onDismiss={() => setShowStopConfirm(false)}
        title="Stop Recording"
        message={`Stop recording? ${session?.sampleCount || 0} samples recorded so far.`}
        icon={<AlertCircle size={48} color={theme.colors.primary} />}
        actions={[
          {
            label: 'Cancel',
            onPress: () => setShowStopConfirm(false),
            variant: 'default',
          },
          {
            label: 'Stop',
            onPress: handleStopRecording,
            variant: 'primary',
          },
        ]}
      />

      {/* Clear Zero Point Confirmation */}
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

      {/* Connection Lost During Recording */}
      <ConfirmDialog
        visible={showConnectionLostDialog}
        onDismiss={handleKeepWaitingForConnection}
        title="Connection Lost"
        message="The device disconnected during recording. Would you like to keep recording paused and wait for the device to reconnect, or stop the recording now?"
        icon={<WifiOff size={48} color={theme.colors.warning} />}
        actions={[
          {
            label: 'Stop Recording',
            onPress: handleStopDueToDisconnection,
            variant: 'danger',
          },
          {
            label: 'Keep Waiting',
            onPress: handleKeepWaitingForConnection,
            variant: 'primary',
          },
        ]}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: staticTheme.spacing.lg,
    paddingVertical: staticTheme.spacing.md,
    borderBottomWidth: 1,
  },
  headerCenter: {
    flex: 1,
    marginLeft: staticTheme.spacing.md,
  },
  title: {
    fontSize: staticTheme.typography.fontSize.xl,
    fontWeight: staticTheme.typography.fontWeight.semibold,
    fontFamily: staticTheme.typography.serif,
  },
  currentTime: {
    fontSize: staticTheme.typography.fontSize.sm,
    fontFamily: staticTheme.typography.mono,
    marginTop: 2,
  },
  content: {
    flex: 1,
    padding: staticTheme.spacing.lg,
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: staticTheme.borderRadius.md,
    borderWidth: 1,
    padding: staticTheme.spacing.md,
    marginBottom: staticTheme.spacing.lg,
    gap: staticTheme.spacing.sm,
  },
  errorText: {
    flex: 1,
    fontSize: staticTheme.typography.fontSize.sm,
    fontFamily: staticTheme.typography.serif,
  },
  warningBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: staticTheme.borderRadius.md,
    borderWidth: 1,
    padding: staticTheme.spacing.md,
    marginBottom: staticTheme.spacing.lg,
    gap: staticTheme.spacing.sm,
  },
  warningContent: {
    flex: 1,
  },
  warningTitle: {
    fontSize: staticTheme.typography.fontSize.md,
    fontWeight: staticTheme.typography.fontWeight.semibold,
    fontFamily: staticTheme.typography.serif,
    marginBottom: 4,
  },
  warningText: {
    fontSize: staticTheme.typography.fontSize.sm,
    fontFamily: staticTheme.typography.serif,
  },
  card: {
    borderRadius: staticTheme.borderRadius.md,
    borderWidth: 1,
    padding: staticTheme.spacing.md,
    marginBottom: staticTheme.spacing.md,
  },
  cardSpacing: {
    marginBottom: staticTheme.spacing.md,
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
  selectorLabel: {
    fontSize: staticTheme.typography.fontSize.sm,
    fontFamily: staticTheme.typography.serif,
    marginBottom: staticTheme.spacing.xs,
  },
  selector: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: staticTheme.spacing.md,
    borderRadius: staticTheme.borderRadius.md,
    borderWidth: 1,
  },
  selectorText: {
    fontSize: staticTheme.typography.fontSize.md,
    fontFamily: staticTheme.typography.serif,
  },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
  },
  statItem: {
    alignItems: 'center',
    gap: staticTheme.spacing.xs,
  },
  statValue: {
    fontSize: staticTheme.typography.fontSize.xxl,
    fontWeight: staticTheme.typography.fontWeight.semibold,
    fontFamily: staticTheme.typography.mono,
  },
  statLabel: {
    fontSize: staticTheme.typography.fontSize.xs,
    fontFamily: staticTheme.typography.serif,
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
  infoCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: staticTheme.spacing.sm,
  },
  infoCardText: {
    flex: 1,
    fontSize: staticTheme.typography.fontSize.sm,
    fontFamily: staticTheme.typography.serif,
    lineHeight: 20,
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
    fontFamily: staticTheme.typography.serif,
  },
  dialogOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1000,
  },
  dialogContainer: {
    width: '80%',
    maxWidth: 400,
    borderRadius: staticTheme.borderRadius.lg,
    padding: staticTheme.spacing.lg,
    gap: staticTheme.spacing.md,
  },
  dialogTitle: {
    fontSize: staticTheme.typography.fontSize.xl,
    fontWeight: staticTheme.typography.fontWeight.semibold,
    fontFamily: staticTheme.typography.serif,
  },
  dialogMessage: {
    fontSize: staticTheme.typography.fontSize.md,
    fontFamily: staticTheme.typography.serif,
  },
  fileNameInput: {
    borderWidth: 1,
    borderRadius: staticTheme.borderRadius.md,
    padding: staticTheme.spacing.md,
    fontSize: staticTheme.typography.fontSize.md,
    fontFamily: staticTheme.typography.mono,
  },
  dialogActions: {
    flexDirection: 'row',
    gap: staticTheme.spacing.sm,
    marginTop: staticTheme.spacing.sm,
  },
  dialogButton: {
    flex: 1,
    paddingVertical: staticTheme.spacing.md,
    paddingHorizontal: staticTheme.spacing.lg,
    borderRadius: staticTheme.borderRadius.md,
    alignItems: 'center',
  },
  dialogButtonText: {
    fontSize: staticTheme.typography.fontSize.md,
    fontWeight: staticTheme.typography.fontWeight.medium,
    fontFamily: staticTheme.typography.serif,
  },
});

export default RecordScreen;
