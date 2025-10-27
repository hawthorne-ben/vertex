/**
 * Record Screen
 *
 * Manages IMU data recording sessions
 * - Shows device status and connection
 * - Primary CTA to start/stop recording
 * - Displays time ranges being recorded
 * - Handles connection interruptions gracefully
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
  Circle,
  Square,
  ArrowLeft,
  Clock,
  Database,
  AlertCircle,
  CheckCircle,
  Bluetooth,
  Activity,
  WifiOff,
} from 'lucide-react-native';
import { theme } from '../styles/theme';
import RecordingService, { RecordingSession } from '../services/RecordingService';
import BleService from '../services/BleService';
import { RootStackParamList } from '../navigation/AppNavigator';

type RecordRouteProp = RouteProp<RootStackParamList, 'Record'>;

const RecordScreen: React.FC = () => {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const route = useRoute<RecordRouteProp>();
  const { deviceId, deviceName } = route.params;

  const [session, setSession] = useState<RecordingSession | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [elapsedTime, setElapsedTime] = useState(0);
  const [isConnected, setIsConnected] = useState(true);
  const [sensorData, setSensorData] = useState<any>(null);

  const isMountedRef = useRef(true);
  const elapsedTimerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    isMountedRef.current = true;
    checkConnection();

    // Check for existing session
    const existingSession = RecordingService.getCurrentSession();
    if (existingSession && existingSession.deviceId === deviceId) {
      setSession(existingSession);
      startElapsedTimer();
    }

    return () => {
      isMountedRef.current = false;
      if (elapsedTimerRef.current) {
        clearInterval(elapsedTimerRef.current);
      }
    };
  }, []);

  const checkConnection = () => {
    const connectedDevice = BleService.getConnectedDevice();
    setIsConnected(connectedDevice?.id === deviceId);
  };

  const startElapsedTimer = () => {
    if (elapsedTimerRef.current) {
      clearInterval(elapsedTimerRef.current);
    }

    elapsedTimerRef.current = setInterval(() => {
      if (isMountedRef.current) {
        setElapsedTime(prev => prev + 1);
      }
    }, 1000);
  };

  const handleStartRecording = async () => {
    if (!isConnected) {
      Alert.alert('Not Connected', 'Please connect to the device before recording');
      return;
    }

    setIsStarting(true);
    setError(null);
    setElapsedTime(0); // Reset timer

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
        }
      );

      if (isMountedRef.current) {
        setSession(newSession);
        startElapsedTimer();
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

  const handleStopRecording = async () => {
    Alert.alert(
      'Stop Recording',
      `Stop recording? ${session?.sampleCount || 0} samples recorded so far.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Stop',
          style: 'destructive',
          onPress: async () => {
            setIsStopping(true);

            try {
              const stoppedSession = await RecordingService.stopRecording();

              if (elapsedTimerRef.current) {
                clearInterval(elapsedTimerRef.current);
                elapsedTimerRef.current = null;
              }

              if (isMountedRef.current) {
                Alert.alert(
                  'Recording Saved',
                  `Recorded ${stoppedSession?.sampleCount || 0} samples to ${stoppedSession?.fileName}`,
                  [
                    {
                      text: 'OK',
                      onPress: () => navigation.goBack(),
                    },
                  ]
                );
              }
            } catch (err: any) {
              if (isMountedRef.current) {
                setError(err.message || 'Failed to stop recording');
                Alert.alert('Error', err.message || 'Failed to stop recording properly');
              }
            } finally {
              if (isMountedRef.current) {
                setIsStopping(false);
              }
            }
          },
        },
      ]
    );
  };

  const formatTime = (seconds: number): string => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;

    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${minutes}:${secs.toString().padStart(2, '0')}`;
  };

  const formatFileSize = (samples: number): string => {
    // Estimate: ~90 bytes per sample
    const bytes = samples * 90;
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  };

  const isRecording = session?.isRecording && !session?.isPaused;
  const connectionLost = session?.isPaused && session?.connectionLostTime;

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => {
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
          }}
          style={styles.backButton}>
          <ArrowLeft size={24} color={theme.colors.textPrimary} />
        </TouchableOpacity>
        <View style={styles.headerInfo}>
          <Text style={styles.title}>Record Session</Text>
          <Text style={styles.deviceName}>{deviceName}</Text>
        </View>
      </View>

      <ScrollView style={styles.content}>
        {/* Error Banner */}
        {error && (
          <View style={styles.errorBanner}>
            <AlertCircle size={20} color={theme.colors.error} />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        {/* Connection Lost Warning */}
        {connectionLost && (
          <View style={styles.warningBanner}>
            <WifiOff size={20} color={theme.colors.warning} />
            <View style={styles.warningContent}>
              <Text style={styles.warningTitle}>Connection Lost</Text>
              <Text style={styles.warningText}>
                Recording paused. Data will resume when connection is restored.
              </Text>
            </View>
          </View>
        )}

        {/* Device Status Card */}
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
                <Text
                  style={[
                    styles.statusValue,
                    { color: isConnected ? theme.colors.success : theme.colors.error },
                  ]}>
                  {isConnected ? 'Connected' : 'Disconnected'}
                </Text>
              </View>
            </View>

            <View style={styles.statusItem}>
              <Activity
                size={20}
                color={isRecording ? theme.colors.success : theme.colors.textTertiary}
              />
              <View style={styles.statusInfo}>
                <Text style={styles.statusLabel}>Recording</Text>
                <Text
                  style={[
                    styles.statusValue,
                    {
                      color: isRecording
                        ? theme.colors.success
                        : theme.colors.textTertiary,
                    },
                  ]}>
                  {isRecording ? 'Active' : 'Inactive'}
                </Text>
              </View>
            </View>
          </View>
        </View>

        {/* Recording Status Card */}
        {session && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Recording Status</Text>

            <View style={styles.statsGrid}>
              <View style={styles.statItem}>
                <Clock size={32} color={theme.colors.primary} />
                <Text style={styles.statLabel}>Duration</Text>
                <Text style={styles.statValue}>{formatTime(elapsedTime)}</Text>
              </View>

              <View style={styles.statItem}>
                <Database size={32} color={theme.colors.primary} />
                <Text style={styles.statLabel}>Samples</Text>
                <Text style={styles.statValue}>{session.sampleCount.toLocaleString()}</Text>
              </View>
            </View>

            <View style={styles.divider} />

            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Started</Text>
              <Text style={styles.infoValue}>
                {session.startTime.toLocaleTimeString()}
              </Text>
            </View>

            {session.lastSampleTime && (
              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>Last Sample</Text>
                <Text style={styles.infoValue}>
                  {session.lastSampleTime.toLocaleTimeString()}
                </Text>
              </View>
            )}

            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>File Size</Text>
              <Text style={styles.infoValue}>
                ~{formatFileSize(session.sampleCount)}
              </Text>
            </View>

            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>File Name</Text>
              <Text style={[styles.infoValue, styles.monoText]} numberOfLines={1}>
                {session.fileName}
              </Text>
            </View>
          </View>
        )}

        {/* Primary CTA */}
        {!session || !session.isRecording ? (
          <TouchableOpacity
            style={[styles.primaryButton, styles.startButton, !isConnected && styles.buttonDisabled]}
            onPress={handleStartRecording}
            disabled={!isConnected || isStarting}>
            {isStarting ? (
              <ActivityIndicator size="large" color={theme.colors.primaryForeground} />
            ) : (
              <>
                <Circle size={32} color={theme.colors.primaryForeground} fill={theme.colors.error} />
                <Text style={styles.primaryButtonText}>Start Recording</Text>
              </>
            )}
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={[styles.primaryButton, styles.stopButton]}
            onPress={handleStopRecording}
            disabled={isStopping}>
            {isStopping ? (
              <ActivityIndicator size="large" color={theme.colors.primaryForeground} />
            ) : (
              <>
                <Square size={32} color={theme.colors.primaryForeground} fill={theme.colors.primaryForeground} />
                <Text style={styles.primaryButtonText}>Stop Recording</Text>
              </>
            )}
          </TouchableOpacity>
        )}

        {/* Info */}
        {!session && (
          <View style={styles.infoCard}>
            <View style={styles.infoIconContainer}>
              <CheckCircle size={20} color={theme.colors.success} />
            </View>
            <Text style={styles.infoCardText}>
              Recording will continue even if the connection is temporarily lost. Data will be
              saved automatically.
            </Text>
          </View>
        )}
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
    backgroundColor: theme.colors.background,
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
  deviceName: {
    fontSize: theme.typography.fontSize.sm,
    color: theme.colors.textSecondary,
    fontFamily: theme.typography.serif,
    marginTop: 2,
  },
  content: {
    flex: 1,
    padding: theme.spacing.lg,
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.error + '15',
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: theme.colors.error + '40',
    padding: theme.spacing.md,
    marginBottom: theme.spacing.lg,
    gap: theme.spacing.sm,
  },
  errorText: {
    flex: 1,
    fontSize: theme.typography.fontSize.sm,
    color: theme.colors.error,
    fontFamily: theme.typography.serif,
  },
  warningBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: theme.colors.warning + '15',
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: theme.colors.warning + '40',
    padding: theme.spacing.md,
    marginBottom: theme.spacing.lg,
    gap: theme.spacing.sm,
  },
  warningContent: {
    flex: 1,
  },
  warningTitle: {
    fontSize: theme.typography.fontSize.md,
    fontWeight: theme.typography.fontWeight.semibold,
    color: theme.colors.warning,
    fontFamily: theme.typography.serif,
    marginBottom: 4,
  },
  warningText: {
    fontSize: theme.typography.fontSize.sm,
    color: theme.colors.warning,
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
  cardTitle: {
    fontSize: theme.typography.fontSize.lg,
    fontWeight: theme.typography.fontWeight.medium,
    color: theme.colors.textPrimary,
    fontFamily: theme.typography.serif,
    marginBottom: theme.spacing.md,
  },
  statusRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
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
    fontFamily: theme.typography.serif,
  },
  statsGrid: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginBottom: theme.spacing.md,
  },
  statItem: {
    alignItems: 'center',
  },
  statLabel: {
    fontSize: theme.typography.fontSize.xs,
    color: theme.colors.textSecondary,
    fontFamily: theme.typography.serif,
    marginTop: theme.spacing.sm,
  },
  statValue: {
    fontSize: theme.typography.fontSize.xxl,
    fontWeight: theme.typography.fontWeight.semibold,
    color: theme.colors.textPrimary,
    fontFamily: theme.typography.mono,
    marginTop: 4,
  },
  divider: {
    height: 1,
    backgroundColor: theme.colors.border,
    marginVertical: theme.spacing.md,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: theme.spacing.sm,
  },
  infoLabel: {
    fontSize: theme.typography.fontSize.sm,
    color: theme.colors.textSecondary,
    fontFamily: theme.typography.serif,
  },
  infoValue: {
    fontSize: theme.typography.fontSize.sm,
    fontWeight: theme.typography.fontWeight.medium,
    color: theme.colors.textPrimary,
    fontFamily: theme.typography.serif,
    maxWidth: '60%',
  },
  monoText: {
    fontFamily: theme.typography.mono,
    fontSize: theme.typography.fontSize.xs,
  },
  primaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: theme.spacing.xl,
    borderRadius: theme.borderRadius.lg,
    marginBottom: theme.spacing.md,
    gap: theme.spacing.md,
    minHeight: 80,
  },
  startButton: {
    backgroundColor: theme.colors.error,
  },
  stopButton: {
    backgroundColor: theme.colors.textPrimary,
  },
  primaryButtonText: {
    color: theme.colors.primaryForeground,
    fontSize: theme.typography.fontSize.xl,
    fontWeight: theme.typography.fontWeight.semibold,
    fontFamily: theme.typography.serif,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  infoCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: theme.colors.primaryForeground,
    borderRadius: theme.borderRadius.md,
    padding: theme.spacing.md,
    gap: theme.spacing.sm,
    marginBottom: theme.spacing.xl,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  infoIconContainer: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: theme.colors.success + '20',
    alignItems: 'center',
    justifyContent: 'center',
  },
  infoCardText: {
    flex: 1,
    fontSize: theme.typography.fontSize.sm,
    color: theme.colors.textPrimary,
    fontFamily: theme.typography.serif,
    lineHeight: 20,
  },
});

export default RecordScreen;
