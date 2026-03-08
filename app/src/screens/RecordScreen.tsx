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
  AlertCircle,
  CheckCircle,
  Bluetooth,
  Activity,
  WifiOff,
  HardDrive,
  Battery,
  BatteryFull,
} from 'lucide-react-native';
import { theme as staticTheme } from '../styles/theme';
import { useTheme } from '../contexts/ThemeContext';
import { BackButton, Card, ConfirmDialog, ErrorDialog } from '../components/ui';
import { useToast } from '../contexts/ToastContext';
import RecordingService, { RecordingSession } from '../services/RecordingService';
import BleService from '../services/BleService';
import NotificationService from '../services/NotificationService';
import BatteryOptimizationService from '../services/BatteryOptimizationService';
import RNFS from 'react-native-fs';
import { RootStackParamList } from '../navigation/AppNavigator';
import { useDeviceStore } from '../stores/deviceStore';
import { useRecordingStore } from '../stores/recordingStore';
import { useAppStore } from '../stores/appStore';
import DeviceStatusService from '../services/DeviceStatusService';
import { getBatteryStatus, formatBatteryDisplay } from '../utils/battery';

type RecordRouteProp = RouteProp<RootStackParamList, 'Record'>;

const BIKES = ['Bike 1', 'Bike 2', 'Bike 3'];
const POSITIONS = ['Body', 'Seatpost'];
const ZERO_POINT_KEY = '@vertex_zero_point_';

const RecordScreen: React.FC = () => {
  const insets = useSafeAreaInsets();
  const { theme, isDark } = useTheme();
  const { showToast } = useToast();
  const navigation = useNavigation();
  const route = useRoute<RecordRouteProp>();
  const { deviceId, deviceName } = route.params;

  // Zustand stores (battery, sample rate, connection is local to this screen)
  const { batteryLevel, batteryVoltage } = useDeviceStore();

  // Local connection state for THIS device
  const [isConnected, setIsConnected] = useState(false);
  const {
    session,
    stats,
    isStarting,
    isStopping,
    error,
    zeroPoint,
    isZeroing,
    setSession,
    updateStats,
    setIsStarting,
    setIsStopping,
    setError,
    setZeroPoint,
    setIsZeroing,
  } = useRecordingStore();
  const {
    selectedBike,
    selectedPosition,
    setSelectedBike,
    setSelectedPosition,
  } = useAppStore();

  // Local UI state (dialogs, etc)
  const [currentTime, setCurrentTime] = useState(new Date());
  const [showStopConfirm, setShowStopConfirm] = useState(false);
  const [showClearZeroDialog, setShowClearZeroDialog] = useState(false);
  const [isResuming, setIsResuming] = useState(false);
  const [isReconnecting, setIsReconnecting] = useState(false);
  const [showFileNameDialog, setShowFileNameDialog] = useState(false);
  const [fileName, setFileName] = useState('');
  const [errorDialogMessage, setErrorDialogMessage] = useState<string | null>(null);
  const [showBackDialog, setShowBackDialog] = useState(false);
  const [stoppedSession, setStoppedSession] = useState<RecordingSession | null>(null);
  const [hasShownConnectionLostToast, setHasShownConnectionLostToast] = useState(false);
  const [showBatteryExemptionDialog, setShowBatteryExemptionDialog] = useState(false);
  const [showBatteryInstructionsDialog, setShowBatteryInstructionsDialog] = useState(false);

  const isMountedRef = useRef(true);
  const clockTimerRef = useRef<NodeJS.Timeout | null>(null);
  const zeroPointRef = useRef<any | null>(null);
  const reconnectIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const hasShownDisconnectNotificationRef = useRef(false);


  // Poll recording stats every second (instead of callback-driven updates)
  useEffect(() => {
    if (!session?.isRecording) return;

    const pollInterval = setInterval(() => {
      const currentSession = RecordingService.getCurrentSession();

      if (currentSession && isMountedRef.current) {
        // Update session in store
        setSession(currentSession);

        // Calculate derived stats
        const bytesPerSample = 28;
        const estimatedSize = currentSession.sampleCount * bytesPerSample;
        const duration = Date.now() - currentSession.startTime.getTime();

        updateStats({
          sampleCount: currentSession.sampleCount,
          fileSize: estimatedSize,
          duration: duration,
          droppedSamples: 0
        });
      }
    }, 1000); // Poll every 1 second

    return () => clearInterval(pollInterval);
  }, [session?.isRecording, setSession, updateStats]);

  // Update persistent notification when recording state changes
  useEffect(() => {
    if (session && session.isRecording) {
      // Recording is active - show/update persistent notification
      const elapsed = getElapsedTime();
      const hours = Math.floor(elapsed / 3600);
      const minutes = Math.floor((elapsed % 3600) / 60);
      const seconds = elapsed % 60;
      const timeStr = hours > 0
        ? `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`
        : `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;

      NotificationService.updateRecordingNotification(
        isConnected,
        deviceName,
        timeStr,
        stats.sampleCount, // Use stats from store instead of session
        deviceId
      );
    } else {
      // Recording stopped - hide persistent notification
      NotificationService.hideRecordingNotification();
    }
  }, [session?.isRecording, stats.sampleCount, isConnected, deviceName, currentTime]);

  useEffect(() => {
    isMountedRef.current = true;

    // Initialize notification service and request permissions
    NotificationService.requestPermissions().then(granted => {
      if (granted) {
        NotificationService.initialize();
      }
    });

    // Start device status monitoring
    DeviceStatusService.startMonitoring(deviceId, deviceName);

    loadZeroPoint();

    // Set initial connection state
    const connectedDevice = BleService.getConnectedDevice();
    setIsConnected(connectedDevice?.id === deviceId);

    // Check for existing active session (only if recording or paused)
    const existingSession = RecordingService.getCurrentSession();
    if (existingSession && existingSession.deviceId === deviceId && existingSession.isRecording) {
      setSession(existingSession);
    } else {
      // Clear any old session data
      setSession(null);
    }

    // Start clock timer
    clockTimerRef.current = setInterval(() => {
      if (isMountedRef.current) {
        setCurrentTime(new Date());
      }
    }, 1000);

    // Listen for connection state changes
    const unsubscribe = BleService.addConnectionListener((device, isConn) => {
      if (!isMountedRef.current) return;

      // Handle connection for this specific device OR any disconnection
      let connected: boolean;
      if (device?.id === deviceId) {
        connected = isConn;
        setIsConnected(connected);
      } else if (!device && !isConn) {
        // General disconnection
        connected = false;
        setIsConnected(false);
      } else {
        // Connection event for a different device - ignore
        return;
      }

      const currentSession = RecordingService.getCurrentSession();

      // Handle disconnection during recording
      if (!connected && currentSession?.isRecording) {
        // Update local session state (RecordingService should have paused it)
        // Wait a moment for RecordingService to process the disconnection
        setTimeout(() => {
          const updatedSession = RecordingService.getCurrentSession();
          if (updatedSession && isMountedRef.current) {
            setSession(updatedSession);
          }
        }, 100);

        // Show toast notification (only once per disconnection)
        if (!hasShownConnectionLostToast) {
          setHasShownConnectionLostToast(true);
          showToast({
            message: 'Connection lost - recording paused. Reconnecting...',
            variant: 'error',
            duration: 5000,
            hasTabBar: false,
          });
        }

        // Show push notification for connection lost (only once per disconnection)
        if (!hasShownDisconnectNotificationRef.current) {
          hasShownDisconnectNotificationRef.current = true;
          NotificationService.showConnectionLostNotification(deviceName);
        }

        // Start automatic reconnection attempts
        startReconnectionAttempts();
      }

      // Handle reconnection during paused recording
      if (connected && currentSession?.isPaused) {
        // Reset flags for next disconnection
        setHasShownConnectionLostToast(false);
        hasShownDisconnectNotificationRef.current = false;

        stopReconnectionAttempts(); // Stop reconnection attempts since we're now connected

        // Update local session state immediately
        setSession(currentSession);

        // Show push notification for connection restored
        NotificationService.showConnectionRestoredNotification(deviceName);

        // Attempt to resume recording
        handleResumeRecording();
      }
    });

    return () => {
      isMountedRef.current = false;

      // Stop device status monitoring
      DeviceStatusService.stopMonitoring();

      unsubscribe();
      if (clockTimerRef.current) {
        clearInterval(clockTimerRef.current);
      }
      if (reconnectIntervalRef.current) {
        clearInterval(reconnectIntervalRef.current);
      }
    };
  }, [deviceId]);

  const getElapsedTime = (): number => {
    if (!session?.startTime) return 0;
    // Use endTime if recording stopped, otherwise use current time
    const endTime = session.endTime || new Date();
    const elapsed = Math.floor((endTime.getTime() - session.startTime.getTime()) / 1000);
    return elapsed;
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
  };

  const handleStartRecording = async () => {
    if (!isConnected) {
      setErrorDialogMessage('Please connect to the device before recording');
      return;
    }

    // Check if we should request battery optimization exemption
    const shouldRequest = await BatteryOptimizationService.shouldRequestExemption();

    if (shouldRequest) {
      setShowBatteryExemptionDialog(true);
    } else {
      startRecordingInternal();
    }
  };

  const startRecordingInternal = async () => {
    setIsStarting(true);
    setError(null);

    try {
      const newSession = await RecordingService.startRecording(
        deviceId,
        deviceName,
        zeroPointRef.current // Pass current zero point to recording service
      );

      if (isMountedRef.current) {
        setSession(newSession);
      }
    } catch (err: any) {
      if (isMountedRef.current) {
        setError(err.message || 'Failed to start recording');
        setErrorDialogMessage(err.message || 'Failed to start recording');
      }
    } finally {
      if (isMountedRef.current) {
        setIsStarting(false);
      }
    }
  };

  const handleShowStopDialog = async () => {
    // Stop any reconnection attempts
    stopReconnectionAttempts();

    setIsStopping(true);

    try {
      // Stop recording FIRST, before showing the dialog
      const session = await RecordingService.stopRecording();

      if (session && isMountedRef.current) {
        // Store the stopped session for later use
        setStoppedSession(session);

        // Update the session state so the timer freezes
        setSession(session);

        // Generate default file name
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').split('.')[0];
        const devicePrefix = deviceName ? `${deviceName.replace(/[^a-zA-Z0-9]/g, '_')}_` : '';
        const defaultFileName = `${devicePrefix}imu_${timestamp}`;
        setFileName(defaultFileName);

        // Now show the dialog (recording is already stopped)
        setShowFileNameDialog(true);
      }
    } catch (err: any) {
      if (isMountedRef.current) {
        setErrorDialogMessage(err.message || 'Failed to stop recording');
      }
    } finally {
      if (isMountedRef.current) {
        setIsStopping(false);
      }
    }
  };

  const handleDeleteRecording = async () => {
    setShowFileNameDialog(false);
    setIsStopping(true);

    try {
      if (stoppedSession) {
        // Delete the recorded file
        const documentsPath = RNFS.DocumentDirectoryPath;
        const filePath = `${documentsPath}/${stoppedSession.fileName}`;

        await RNFS.unlink(filePath);

        showToast({
          message: 'Recording deleted',
          variant: 'success',
          duration: 2000,
          hasTabBar: false,
        });
      }

      // Clear session and go back
      if (isMountedRef.current) {
        setSession(null);
        setError(null);
        setStoppedSession(null);
        navigation.goBack();
      }
    } catch (err: any) {
      console.error('[RecordScreen] Error deleting recording:', err);
      if (isMountedRef.current) {
        setErrorDialogMessage(err.message || 'Failed to delete recording');
      }
    } finally {
      if (isMountedRef.current) {
        setIsStopping(false);
      }
    }
  };

  const handleStopRecording = async () => {
    // Recording was already stopped in handleShowStopDialog
    // This function now just handles file renaming and navigation
    setIsStopping(true);
    setShowFileNameDialog(false);

    try {
      if (stoppedSession && fileName && isMountedRef.current) {
        // Rename the file if user changed the name
        const originalFileName = stoppedSession.fileName;
        const extension = '.vtx';
        const hasExtension = fileName.endsWith('.vtx');
        const newFileName = hasExtension ? fileName : `${fileName}${extension}`;

        if (originalFileName !== newFileName) {
          const documentsPath = RNFS.DocumentDirectoryPath;
          const oldPath = `${documentsPath}/${originalFileName}`;
          const newPath = `${documentsPath}/${newFileName}`;

          try {
            await RNFS.moveFile(oldPath, newPath);

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
        navigation.goBack();
      }
    } catch (err: any) {
      if (isMountedRef.current) {
        setErrorDialogMessage(err.message || 'Failed to save recording');
      }
    } finally {
      if (isMountedRef.current) {
        setIsStopping(false);
        setStoppedSession(null); // Clear the stopped session
      }
    }
  };

  const handleResumeRecording = async () => {
    if (isResuming) return;

    setIsResuming(true);
    setError(null);

    try {
      await RecordingService.resumeRecording();

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

  const startReconnectionAttempts = () => {
    // Clear any existing interval
    if (reconnectIntervalRef.current) {
      clearInterval(reconnectIntervalRef.current);
    }

    setIsReconnecting(true);
    reconnectAttemptsRef.current = 0;

    // Attempt reconnection every 5 seconds (increased from 3 to reduce log spam)
    reconnectIntervalRef.current = setInterval(async () => {
      if (!isMountedRef.current) {
        stopReconnectionAttempts();
        return;
      }

      reconnectAttemptsRef.current++;

      try {
        // Try to reconnect to the device
        await BleService.connectToDevice(deviceId);

        // Stop further attempts
        stopReconnectionAttempts();
      } catch (error) {
        // Continue trying (interval will call this function again)
      }
    }, 5000);
  };

  const stopReconnectionAttempts = () => {
    if (reconnectIntervalRef.current) {
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
    } catch (error) {
      console.error('[RecordScreen] Error saving zero point:', error);
      throw error;
    }
  };

  const handleZero = async () => {
    if (!isConnected) {
      showToast({
        message: 'Device not connected',
        variant: 'error',
        duration: 3000,
        hasTabBar: false,
      });
      return;
    }

    setIsZeroing(true);

    try {
      // Collect 5 samples on-demand for zero point averaging
      const samples: any[] = [];
      let subscription: any = null;

      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          if (subscription) {
            subscription.remove();
          }
          reject(new Error('Timeout collecting samples'));
        }, 3000); // 3 second timeout

        BleService.subscribeToIMUStream(
          (data) => {
            samples.push(data);

            if (samples.length >= 5) {
              clearTimeout(timeout);
              if (subscription) {
                subscription.remove();
              }
              resolve();
            }
          },
          (error) => {
            clearTimeout(timeout);
            if (subscription) {
              subscription.remove();
            }
            reject(error);
          }
        ).then(sub => {
          subscription = sub;
        }).catch(reject);
      });

      // Average the collected samples
      const last5 = samples.slice(0, 5);

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
      setShowBackDialog(true);
    } else {
      navigation.goBack();
    }
  };

  const handleStopAndGoBack = async () => {
    try {
      await RecordingService.stopRecording();
      navigation.goBack();
    } catch (err) {
      navigation.goBack();
    }
  };

  const formatTime = (seconds: number): string => {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const isRecording = session?.isRecording && !session?.isPaused;
  const connectionLost = session?.isPaused && session?.connectionLostTime;

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      {/* Translucent Header */}
      <View style={[styles.header, { paddingTop: insets.top, backgroundColor: isDark ? 'rgba(0,0,0,0.85)' : 'rgba(255,255,255,0.92)' }]}>
        <BackButton onPress={handleBackPress} />
        <View style={styles.headerCenter}>
          <Text style={[styles.title, { color: theme.colors.textPrimary }]}>Record Session</Text>
          <Text style={[styles.currentTime, { color: theme.colors.textSecondary }]}>
            {currentTime.toLocaleTimeString()}
          </Text>
        </View>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView style={styles.content} contentContainerStyle={{ paddingTop: insets.top + 56 }}>
        {/* Device Status - Combined */}
        <View style={[styles.card, { backgroundColor: theme.colors.muted, borderColor: theme.colors.border }]}>
          {session && session.isRecording ? (
            // Recording view - show all 4 stats
            <View style={styles.statusGrid}>
              <View style={styles.statusGridRow}>
                <View style={styles.statusCompactItem}>
                  <Bluetooth
                    size={18}
                    color={isConnected ? theme.colors.success : theme.colors.error}
                    style={styles.statusIcon}
                  />
                  <Text style={[styles.statusCompactValue, {
                    color: isConnected ? theme.colors.success : theme.colors.error,
                  }]}>
                    {isConnected ? 'Connected' : 'Disconnected'}
                  </Text>
                </View>
                <View style={styles.statusCompactItem}>
                  <Clock size={18} color={theme.colors.primary} style={styles.statusIcon} />
                  <Text style={[styles.statusCompactValue, { color: theme.colors.textPrimary }]}>
                    {formatTime(getElapsedTime())}
                  </Text>
                </View>
              </View>
              <View style={styles.statusGridRow}>
                <View style={styles.statusCompactItem}>
                  {(() => {
                    const batteryStatus = getBatteryStatus(batteryVoltage);
                    const BatteryIcon = (batteryStatus?.level === 'good') ? BatteryFull : Battery;
                    return (
                      <BatteryIcon
                        size={18}
                        color={
                          batteryStatus === null ? theme.colors.textTertiary :
                          theme.colors[batteryStatus.color as keyof typeof theme.colors]
                        }
                        style={styles.statusIcon}
                      />
                    );
                  })()}
                  <Text style={[styles.statusCompactValue, { color: theme.colors.textPrimary }]}>
                    {formatBatteryDisplay(batteryVoltage)}
                  </Text>
                </View>
                <View style={styles.statusCompactItem}>
                  <HardDrive size={18} color={theme.colors.primary} style={styles.statusIcon} />
                  <Text style={[styles.statusCompactValue, { color: theme.colors.textPrimary }]}>
                    {formatFileSize(stats.fileSize)}
                  </Text>
                </View>
              </View>
            </View>
          ) : (
            // Idle view - show connection, recording status, and battery
            <View style={styles.statusGrid}>
              <View style={styles.statusGridRow}>
                <View style={styles.statusCompactItem}>
                  <Bluetooth
                    size={18}
                    color={isConnected ? theme.colors.success : theme.colors.error}
                    style={styles.statusIcon}
                  />
                  <Text style={[styles.statusCompactValue, {
                    color: isConnected ? theme.colors.success : theme.colors.error,
                  }]}>
                    {isConnected ? 'Connected' : 'Disconnected'}
                  </Text>
                </View>
                <View style={styles.statusCompactItem}>
                  <Activity
                    size={18}
                    color={isRecording ? theme.colors.success : theme.colors.textTertiary}
                    style={styles.statusIcon}
                  />
                  <Text style={[styles.statusCompactValue, {
                    color: isRecording ? theme.colors.success : theme.colors.textTertiary,
                  }]}>
                    {isRecording ? 'Recording' : 'Idle'}
                  </Text>
                </View>
              </View>
              <View style={styles.statusGridRow}>
                <View style={styles.statusCompactItem}>
                  {(() => {
                    const batteryStatus = getBatteryStatus(batteryVoltage);
                    const BatteryIcon = (batteryStatus?.level === 'good') ? BatteryFull : Battery;
                    return (
                      <BatteryIcon
                        size={18}
                        color={
                          batteryStatus === null ? theme.colors.textTertiary :
                          theme.colors[batteryStatus.color as keyof typeof theme.colors]
                        }
                        style={styles.statusIcon}
                      />
                    );
                  })()}
                  <Text style={[styles.statusCompactValue, { color: theme.colors.textPrimary }]}>
                    {formatBatteryDisplay(batteryVoltage)}
                  </Text>
                </View>
              </View>
            </View>
          )}
        </View>

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
                    backgroundColor: (isConnected && !isZeroing) ? theme.colors.card : theme.colors.muted,
                    borderColor: (isConnected && !isZeroing) ? theme.colors.border : theme.colors.border,
                    borderWidth: 2,
                  }
                ]}
                onPress={zeroPoint ? () => setShowClearZeroDialog(true) : handleZero}
                disabled={!isConnected || isZeroing}>
                {isZeroing ? (
                  <ActivityIndicator size="small" color={theme.colors.textSecondary} />
                ) : (
                  <>
                    <Text style={[
                      styles.halfWidthButtonText,
                      { color: (isConnected && !isZeroing) ? theme.colors.textPrimary : theme.colors.textTertiary }
                    ]}>
                      {zeroPoint ? 'Clear Zero' : 'Zero'}
                    </Text>
                    <Activity
                      size={16}
                      color={(isConnected && !isZeroing) ? theme.colors.textPrimary : theme.colors.textTertiary}
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
              placeholder="File name (without .vtx)"
              placeholderTextColor={theme.colors.textTertiary}
              autoFocus
              selectTextOnFocus
            />
            <View style={styles.dialogActions}>
              <TouchableOpacity
                style={[styles.dialogButton, { backgroundColor: theme.colors.error }]}
                onPress={handleDeleteRecording}
              >
                <Text style={[styles.dialogButtonText, { color: '#FFFFFF' }]}>
                  Delete
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

      {/* Back While Recording Confirmation */}
      <ConfirmDialog
        visible={showBackDialog}
        onDismiss={() => setShowBackDialog(false)}
        title="Recording in Progress"
        message="Stop recording before going back?"
        icon={<AlertCircle size={48} color={theme.colors.warning} />}
        actions={[
          {
            label: 'Cancel',
            onPress: () => setShowBackDialog(false),
            variant: 'default',
          },
          {
            label: 'Stop & Go Back',
            onPress: () => {
              setShowBackDialog(false);
              handleStopAndGoBack();
            },
            variant: 'danger',
          },
        ]}
      />

      {/* Error Dialog */}
      <ErrorDialog
        visible={errorDialogMessage !== null}
        onDismiss={() => setErrorDialogMessage(null)}
        title="Error"
        message={errorDialogMessage || ''}
      />

      {/* Battery Optimization Exemption Dialog */}
      <ConfirmDialog
        visible={showBatteryExemptionDialog}
        onDismiss={() => setShowBatteryExemptionDialog(false)}
        title="Improve Recording Reliability"
        message="To prevent Android from stopping your recordings, disable battery optimization for Vertex. This improves reliability by up to 30%."
        icon={<Battery size={48} color={theme.colors.warning} />}
        actions={[
          {
            label: 'Not Now',
            onPress: async () => {
              await BatteryOptimizationService.markExemptionRequested();
              startRecordingInternal();
            },
            variant: 'default',
          },
          {
            label: 'Open Settings',
            onPress: async () => {
              await BatteryOptimizationService.markExemptionRequested();
              await BatteryOptimizationService.openBatteryOptimizationSettings();
              setShowBatteryInstructionsDialog(true);
            },
            variant: 'primary',
          },
        ]}
      />

      {/* Battery Optimization Instructions Dialog */}
      <ConfirmDialog
        visible={showBatteryInstructionsDialog}
        onDismiss={() => setShowBatteryInstructionsDialog(false)}
        title="Follow These Steps"
        message={BatteryOptimizationService.getManufacturerInstructions().instructions.join('\n')}
        actions={[
          {
            label: 'Done',
            onPress: async () => {
              await BatteryOptimizationService.markExemptionGranted();
              startRecordingInternal();
            },
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
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: staticTheme.spacing.lg,
    paddingVertical: staticTheme.spacing.md,
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
  warningBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    borderRadius: staticTheme.borderRadius.md,
    borderWidth: 1,
    padding: staticTheme.spacing.md,
    marginBottom: staticTheme.spacing.lg,
    gap: staticTheme.spacing.sm,
    minHeight: 80,
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
    fontFamily: staticTheme.typography.mono,
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
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  statsGridCompact: {
    gap: staticTheme.spacing.md,
  },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  statItem: {
    alignItems: 'center',
    gap: staticTheme.spacing.xs,
    width: '48%',
    marginBottom: staticTheme.spacing.md,
  },
  statItemCompact: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: staticTheme.spacing.xs,
    flex: 1,
  },
  statValue: {
    fontSize: staticTheme.typography.fontSize.lg,
    fontWeight: staticTheme.typography.fontWeight.semibold,
    fontFamily: staticTheme.typography.mono, // Monospace for all stat values
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
