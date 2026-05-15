/**
 * Device Detail V2 Screen
 *
 * V2 firmware device management: status display, recording control,
 * file list with transfer/delete, clock sync.
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  ScrollView,
  TextInput,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import {
  Bluetooth,
  Circle,
  Trash2,
  Clock,
  HardDrive,
  FileText,
  Battery,
  XCircle,
  Wifi,
  Upload,
  CheckCircle,
  AlertCircle,
  Eye,
  EyeOff,
} from 'lucide-react-native';
import { theme as staticTheme } from '../styles/theme';
import { useTheme } from '../contexts/ThemeContext';
import { useToast } from '../contexts/ToastContext';
import { BackButton, Button, Card, ConfirmDialog } from '../components/ui';
import Inclinometer from '../components/Inclinometer';
import { API_URL, DEVICE_API_KEY } from '@env';
import BleService, { V2Status, V2FileEntry, V2SyncProgress } from '../services/BleService';
import { useAuth } from '../contexts/AuthContext';
import { RootStackParamList } from '../navigation/AppNavigator';
import { useDeviceStore } from '../stores/deviceStore';

type DeviceDetailV2RouteProp = RouteProp<RootStackParamList, 'DeviceDetailV2'>;
type NavigationProp = NativeStackNavigationProp<RootStackParamList>;

const DeviceDetailV2Screen: React.FC = () => {
  const insets = useSafeAreaInsets();
  const { theme, isDark } = useTheme();
  const { showToast } = useToast();
  const { user } = useAuth();
  const navigation = useNavigation<NavigationProp>();
  const route = useRoute<DeviceDetailV2RouteProp>();
  const { deviceId, deviceName } = route.params;

  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [status, setStatus] = useState<V2Status | null>(null);
  const [files, setFiles] = useState<V2FileEntry[]>([]);
  const [clockSynced, setClockSynced] = useState(false);

  // WiFi setup
  const [showWifiModal, setShowWifiModal] = useState(false);
  const [wifiSsid, setWifiSsid] = useState('');
  const [wifiPassword, setWifiPassword] = useState('');
  const [wifiSaving, setWifiSaving] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  // Upload progress (inline, replaces action buttons)
  const [syncProgress, setSyncProgress] = useState<V2SyncProgress | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const syncUnsubRef = useRef<(() => void) | null>(null);

  // Dialogs
  const [fileToDelete, setFileToDelete] = useState<string | null>(null);
  const [showDisconnectDialog, setShowDisconnectDialog] = useState(false);
  const [showForgetDialog, setShowForgetDialog] = useState(false);

  // Client-side recording duration interpolation
  const [displaySecs, setDisplaySecs] = useState(0);
  const recordingBaseRef = useRef<{ serverSecs: number; localMs: number } | null>(null);
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const isMountedRef = useRef(true);
  const statusPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Connection listener
  useEffect(() => {
    isMountedRef.current = true;

    const unsubscribe = BleService.addConnectionListener((device, isConn) => {
      if (!isMountedRef.current) return;

      if (device?.id === deviceId) {
        setIsConnected(isConn);
        if (isConn) {
          refreshAll();
        }
      } else if (!isConn && !device) {
        setIsConnected(false);
      }
    });

    // Auto-connect on mount
    if (!BleService.isConnected()) {
      handleConnect();
    } else {
      setIsConnected(true);
      refreshAll();
    }

    return () => {
      isMountedRef.current = false;
      unsubscribe();
      if (statusPollRef.current) clearInterval(statusPollRef.current);
      if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
      if (syncUnsubRef.current) syncUnsubRef.current();
    };
  }, [deviceId]);

  // Client-side recording timer: update displaySecs every 1s while recording
  useEffect(() => {
    const isRecording = status?.state === 'recording';

    if (isRecording) {
      // Sync baseline from BLE-reported elapsed seconds
      const serverSecs = status?.recordingInfo?.elapsedSecs ?? 0;
      recordingBaseRef.current = { serverSecs, localMs: Date.now() };
      setDisplaySecs(serverSecs);

      // Start 1s tick
      if (!recordingTimerRef.current) {
        recordingTimerRef.current = setInterval(() => {
          if (!recordingBaseRef.current) return;
          const elapsed = Math.floor((Date.now() - recordingBaseRef.current.localMs) / 1000);
          setDisplaySecs(recordingBaseRef.current.serverSecs + elapsed);
        }, 1000);
      }
    } else {
      // Not recording — stop timer
      if (recordingTimerRef.current) {
        clearInterval(recordingTimerRef.current);
        recordingTimerRef.current = null;
      }
      recordingBaseRef.current = null;
    }

    return () => {
      if (recordingTimerRef.current) {
        clearInterval(recordingTimerRef.current);
        recordingTimerRef.current = null;
      }
    };
  }, [status?.state, status?.recordingInfo?.elapsedSecs]);

  // Refresh file list when transitioning from recording → idle (e.g. physical button stop)
  const prevStateRef = useRef<string | undefined>();
  useEffect(() => {
    const prev = prevStateRef.current;
    prevStateRef.current = status?.state;
    if (prev === 'recording' && status?.state === 'idle') {
      refreshAll();
    }
  }, [status?.state, refreshAll]);

  // Status polling — 500ms when idle/recording, skip during upload (firmware pushes)
  useEffect(() => {
    if (isConnected && !isSyncing) {
      statusPollRef.current = setInterval(async () => {
        if (!isMountedRef.current || !BleService.isConnected()) return;
        try {
          const s = await BleService.getStatusV2();
          if (isMountedRef.current) setStatus(s);
        } catch {
          // Ignore poll errors
        }
      }, 500);
    } else {
      if (statusPollRef.current) {
        clearInterval(statusPollRef.current);
        statusPollRef.current = null;
      }
    }

    return () => {
      if (statusPollRef.current) clearInterval(statusPollRef.current);
    };
  }, [isConnected, isSyncing]);

  const refreshAll = useCallback(async () => {
    try {
      const s = await BleService.getStatusV2();
      if (isMountedRef.current) {
        setStatus(s);
        setClockSynced(s.clockSynced);
      }
    } catch (e: any) {
      console.warn('[V2] Status fetch failed:', e?.message);
    }
    try {
      const f = await BleService.listFilesV2();
      if (isMountedRef.current) setFiles(f);
    } catch (e: any) {
      console.warn('[V2] File list failed:', e?.message);
    }
  }, []);

  const handleConnect = async () => {
    if (isConnecting) return;
    setIsConnecting(true);
    try {
      await BleService.connectToDevice(deviceId);
      useDeviceStore.getState().updateDeviceLastConnected(deviceId);
    } catch (e: any) {
      showToast({ message: `Connection failed: ${e?.message}`, variant: 'error' });
    } finally {
      if (isMountedRef.current) setIsConnecting(false);
    }
  };

  const handleStartRecording = async () => {
    try {
      // Always sync clock before recording to ensure accurate timestamps
      try {
        await BleService.syncClockV2();
        if (isMountedRef.current) setClockSynced(true);
      } catch {
        // Non-fatal — proceed with recording even if sync fails
        console.warn('[V2] Pre-record clock sync failed');
      }
      await BleService.startRecordingV2();
      showToast({ message: 'Recording started', variant: 'success', duration: 2000 });
      const s = await BleService.getStatusV2();
      if (isMountedRef.current) setStatus(s);
    } catch (e: any) {
      showToast({ message: `Failed to start recording: ${e?.message}`, variant: 'error' });
    }
  };

  const handleStopRecording = async () => {
    try {
      await BleService.stopRecordingV2();
      showToast({ message: 'Recording stopped', variant: 'success', duration: 2000 });
      // Refresh status and files after a short delay to let firmware finalize
      setTimeout(refreshAll, 500);
    } catch (e: any) {
      showToast({ message: `Failed to stop recording: ${e?.message}`, variant: 'error' });
    }
  };

  const handleDeleteFile = async () => {
    if (!fileToDelete) return;
    try {
      await BleService.deleteFileV2(fileToDelete);
      showToast({ message: `${fileToDelete} deleted`, variant: 'success', duration: 2000 });
      setFileToDelete(null);
      const f = await BleService.listFilesV2();
      if (isMountedRef.current) setFiles(f);
    } catch (e: any) {
      showToast({ message: `Delete failed: ${e?.message}`, variant: 'error' });
      setFileToDelete(null);
    }
  };

  const handleSaveWifi = async () => {
    if (!wifiSsid.trim()) return;
    setWifiSaving(true);
    try {
      await BleService.setWiFiCredentials(wifiSsid.trim(), wifiPassword);
      showToast({ message: 'WiFi credentials saved to device', variant: 'success', duration: 2000 });
      setShowWifiModal(false);
      setWifiSsid('');
      setWifiPassword('');
    } catch (e: any) {
      showToast({ message: `Failed to save WiFi: ${e?.message}`, variant: 'error' });
    } finally {
      setWifiSaving(false);
    }
  };

  const handleSyncClock = async () => {
    try {
      await BleService.syncClockV2();
      setClockSynced(true);
      showToast({ message: 'Clock synced', variant: 'success', duration: 2000 });
    } catch (e: any) {
      showToast({ message: `Clock sync failed: ${e?.message}`, variant: 'error' });
    }
  };

  const handleStartSync = async () => {
    if (!user?.id) {
      showToast({ message: 'Not logged in', variant: 'error' });
      return;
    }
    try {
      const serverUrl = API_URL.startsWith('http') ? API_URL : `https://${API_URL}`;
      await BleService.setUserCredentials(user.id, DEVICE_API_KEY, serverUrl);

      // Show inline progress and subscribe to push notifications
      setSyncProgress(null);
      setIsSyncing(true);

      // Subscribe to device-pushed status updates
      syncUnsubRef.current = BleService.subscribeToStatus((s) => {
        if (!isMountedRef.current) return;
        setStatus(s);
        if (s.syncProgress) {
          setSyncProgress(s.syncProgress);
          if (s.syncProgress.result === 'success') {
            syncUnsubRef.current?.();
            syncUnsubRef.current = null;
            setIsSyncing(false);
            showToast({
              message: `Synced ${s.syncProgress.totalFiles} file${s.syncProgress.totalFiles === 1 ? '' : 's'} to cloud`,
              variant: 'success',
              duration: 3000,
            });
            setTimeout(refreshAll, 500);
          } else if (s.syncProgress.result === 'error') {
            syncUnsubRef.current?.();
            syncUnsubRef.current = null;
            setIsSyncing(false);
            showToast({
              message: 'Upload failed — check WiFi credentials',
              variant: 'error',
              duration: 4000,
            });
          }
        }
      });

      await BleService.startSync();
    } catch (e: any) {
      setIsSyncing(false);
      syncUnsubRef.current?.();
      syncUnsubRef.current = null;
      showToast({ message: `Failed to start sync: ${e?.message}`, variant: 'error' });
    }
  };

  const handleCancelSync = async () => {
    try {
      await BleService.cancelSync();
      syncUnsubRef.current?.();
      syncUnsubRef.current = null;
      setIsSyncing(false);
      setSyncProgress(null);
      showToast({ message: 'Sync cancelled', variant: 'success', duration: 2000 });
    } catch (e: any) {
      showToast({ message: `Cancel failed: ${e?.message}`, variant: 'error' });
    }
  };

  const handleDisconnect = async () => {
    setShowDisconnectDialog(false);
    await BleService.disconnect();
    setStatus(null);
    setFiles([]);
  };

  const handleForget = async () => {
    setShowForgetDialog(false);
    await BleService.disconnect();
    await useDeviceStore.getState().removeSavedDevice(deviceId);
    navigation.goBack();
  };

  const stateLabel = (s: V2Status['state']) => {
    switch (s) {
      case 'recording': return 'Recording';
      case 'uploading': return 'Uploading';
      default: return 'Idle';
    }
  };

  const stateColor = (s: V2Status['state']) => {
    switch (s) {
      case 'recording': return theme.colors.error;
      case 'uploading': return theme.colors.primary;
      default: return theme.colors.success;
    }
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const formatDuration = (secs: number) => {
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = secs % 60;
    if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const renderFileItem = ({ item }: { item: V2FileEntry }) => {
    return (
      <View style={[styles.fileRow, { borderBottomColor: theme.colors.border }]}>
        {item.synced ? (
          <CheckCircle size={16} color={theme.colors.success} />
        ) : (
          <FileText size={16} color={theme.colors.textSecondary} />
        )}
        <View style={styles.fileInfo}>
          <Text style={[styles.fileName, { color: theme.colors.textPrimary }]}>
            {item.name}
          </Text>
          <Text style={[styles.fileSize, { color: theme.colors.textTertiary }]}>
            {formatSize(item.size)}{item.synced ? ' · Synced' : ''}
          </Text>
        </View>
        <TouchableOpacity
          onPress={() => setFileToDelete(item.name)}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Trash2 size={20} color={theme.colors.error} />
        </TouchableOpacity>
      </View>
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 8, backgroundColor: isDark ? 'rgba(0,0,0,0.85)' : 'rgba(255,255,255,0.92)' }]}>
        <View style={styles.headerRow}>
          <BackButton onPress={() => navigation.goBack()} />
          <View style={styles.headerTitles}>
            <Text style={[styles.headerTitle, { color: theme.colors.textPrimary }]}>
              {deviceName}
            </Text>
            <Text style={[styles.headerSubtitle, { color: theme.colors.textTertiary }]}>
              {deviceId.substring(0, 17)}
            </Text>
          </View>
          <View style={{ width: 22 }} />
        </View>
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={[styles.content, { paddingTop: insets.top + 72 }]}>

        {/* Status Card — always visible */}
        <Card variant="default" padding="none" style={styles.card} header={null}>
          <View style={styles.statusGrid}>
            <View style={styles.statusItem}>
              <Circle size={12} color={isConnected ? stateColor(status?.state ?? 'idle') : theme.colors.error} fill={isConnected ? stateColor(status?.state ?? 'idle') : theme.colors.error} />
              <Text style={[styles.statusLabel, { color: theme.colors.textSecondary }]}>State</Text>
              <Text style={[styles.statusValue, { color: isConnected ? theme.colors.textPrimary : theme.colors.error }]}>
                {isConnected ? stateLabel(status?.state ?? 'idle') : 'Disconnected'}
              </Text>
            </View>
            <View style={styles.statusItem}>
              <Battery size={16} color={theme.colors.textSecondary} />
              <Text style={[styles.statusLabel, { color: theme.colors.textSecondary }]}>Battery</Text>
              <Text style={[styles.statusValue, { color: isConnected ? theme.colors.textPrimary : theme.colors.textTertiary }]}>
                {isConnected && status ? `${status.batteryMv} mV` : '—'}
              </Text>
            </View>
            <View style={styles.statusItem}>
              <HardDrive size={16} color={isConnected && status && !status.sdOk ? theme.colors.error : theme.colors.textSecondary} />
              <Text style={[styles.statusLabel, { color: isConnected && status && !status.sdOk ? theme.colors.error : theme.colors.textSecondary }]}>
                {isConnected && status && !status.sdOk ? 'SD Error' : 'SD Free'}
              </Text>
              <Text style={[styles.statusValue, { color: isConnected && status && !status.sdOk ? theme.colors.error : isConnected ? theme.colors.textPrimary : theme.colors.textTertiary }]}>
                {isConnected && status ? (status.sdOk ? `${status.freeMb} MB` : 'FAIL') : '—'}
              </Text>
            </View>
            <View style={styles.statusItem}>
              <FileText size={16} color={theme.colors.textSecondary} />
              <Text style={[styles.statusLabel, { color: theme.colors.textSecondary }]}>Files</Text>
              <Text style={[styles.statusValue, { color: isConnected ? theme.colors.textPrimary : theme.colors.textTertiary }]}>
                {isConnected && status ? status.fileCount : '—'}
              </Text>
            </View>
          </View>
        </Card>

        {/* WiFi Setup (inline) — only when connected */}
        {isConnected && showWifiModal && (
          <Card variant="default" style={styles.card} header={null}>
            <Text style={[styles.wifiLabel, { color: theme.colors.textSecondary }]}>
              Network Name
            </Text>
            <TextInput
              style={[styles.wifiInput, { color: theme.colors.textPrimary, borderColor: theme.colors.border, backgroundColor: theme.colors.muted }]}
              value={wifiSsid}
              onChangeText={setWifiSsid}
              placeholder="SSID"
              placeholderTextColor={theme.colors.textTertiary}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <Text style={[styles.wifiLabel, { color: theme.colors.textSecondary, marginTop: 12 }]}>
              Password
            </Text>
            <View style={styles.passwordInputWrapper}>
              <TextInput
                style={[styles.wifiInput, styles.passwordInput, { color: theme.colors.textPrimary, borderColor: theme.colors.border, backgroundColor: theme.colors.muted }]}
                value={wifiPassword}
                onChangeText={setWifiPassword}
                placeholder="Password"
                placeholderTextColor={theme.colors.textTertiary}
                secureTextEntry={!showPassword}
                autoCapitalize="none"
                autoCorrect={false}
              />
              <TouchableOpacity
                onPress={() => setShowPassword(!showPassword)}
                style={styles.eyeButtonInline}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                {showPassword
                  ? <EyeOff size={18} color={theme.colors.textTertiary} />
                  : <Eye size={18} color={theme.colors.textTertiary} />}
              </TouchableOpacity>
            </View>
            <View style={styles.wifiActions}>
              <Button
                variant="primary"
                onPress={handleSaveWifi}
                disabled={!wifiSsid.trim() || wifiSaving}>
                {wifiSaving ? 'Saving...' : 'Save to Device'}
              </Button>
              <Button
                variant="secondary"
                onPress={() => setShowWifiModal(false)}>
                Cancel
              </Button>
            </View>
          </Card>
        )}

        {/* Actions / Sync Progress */}
        {!showWifiModal && <View style={styles.actionSection}>
          {!isConnected ? (
            <Button
              variant="primary"
              onPress={handleConnect}
              disabled={isConnecting}>
              {isConnecting ? 'Connecting...' : 'Connect'}
            </Button>
          ) : isSyncing ? (
            <Card variant="default" padding="none" style={styles.card} header={null}>
              <View style={styles.syncInline}>
                <View style={styles.syncInlineHeader}>
                  <Upload size={16} color={theme.colors.primary} />
                  <Text style={[styles.syncInlineTitle, { color: theme.colors.textPrimary }]}>
                    {syncProgress
                      ? `Uploading ${syncProgress.currentFile} of ${syncProgress.totalFiles}`
                      : 'Connecting to WiFi...'}
                  </Text>
                </View>
                {syncProgress && (
                  <>
                    <View style={[styles.progressBar, { backgroundColor: theme.colors.muted }]}>
                      <View style={[
                        styles.progressFill,
                        {
                          width: `${syncProgress.bytesTotal > 0
                            ? Math.min(100, Math.round((syncProgress.bytesSent / syncProgress.bytesTotal) * 100))
                            : 0}%`,
                          backgroundColor: theme.colors.primary,
                        },
                      ]} />
                    </View>
                    <View style={styles.syncInlineFooter}>
                      <Text style={[styles.syncInlineBytes, { color: theme.colors.textTertiary }]}>
                        {formatSize(syncProgress.bytesSent)} / {formatSize(syncProgress.bytesTotal)}
                      </Text>
                      <Text style={[styles.syncInlineBytes, { color: theme.colors.textTertiary }]}>
                        {syncProgress.bytesTotal > 0
                          ? `${Math.round((syncProgress.bytesSent / syncProgress.bytesTotal) * 100)}%`
                          : '0%'}
                      </Text>
                    </View>
                  </>
                )}
                <TouchableOpacity onPress={handleCancelSync} style={styles.syncCancelButton}>
                  <XCircle size={14} color={theme.colors.error} />
                  <Text style={[styles.syncCancelText, { color: theme.colors.error }]}>Cancel</Text>
                </TouchableOpacity>
              </View>
            </Card>
          ) : status?.state === 'recording' ? (
            <View style={{ gap: 12 }}>
              <View style={styles.recordingInfo}>
                <Text style={[styles.recordingInfoText, { color: theme.colors.error }]}>
                  {formatDuration(displaySecs)}
                </Text>
                <Text style={[styles.recordingInfoText, { color: theme.colors.textTertiary }]}>
                  {formatSize(status.recordingInfo?.fileBytes ?? 0)}
                </Text>
              </View>
              <Button variant="danger" onPress={handleStopRecording}>
                Stop Recording
              </Button>
            </View>
          ) : (
            <View style={{ gap: 12 }}>
              <TouchableOpacity
                style={[styles.recordButton, { backgroundColor: theme.colors.primary, opacity: status?.state === 'uploading' ? 0.5 : 1 }]}
                onPress={handleStartRecording}
                disabled={status?.state === 'uploading'}>
                <Text style={[styles.recordButtonText, { color: theme.colors.primaryForeground }]}>Start Recording</Text>
                <Clock size={14} color={clockSynced ? '#22c55e' : '#f59e0b'} />
              </TouchableOpacity>
              <Button
                variant="secondary"
                onPress={handleStartSync}
                disabled={status?.state !== 'idle' || (status?.fileCount ?? 0) === 0}>
                Sync to Cloud
              </Button>
            </View>
          )}
        </View>}

        {/* Inclinometer — only when connected and has accel data */}
        {isConnected && !showWifiModal && !isSyncing && status?.accel && (
          <View style={styles.inclinometerRow}>
            <Inclinometer
              accelX={status.accel.x}
              accelY={status.accel.y}
              accelZ={status.accel.z}
              imuOk={status.imuOk}
              size={100}
              colors={{
                ring: theme.colors.border,
                dot: status.imuOk ? theme.colors.primary : theme.colors.error,
                crosshair: theme.colors.textTertiary,
                error: theme.colors.error,
                text: theme.colors.textPrimary,
                textSecondary: theme.colors.textTertiary,
              }}
            />
          </View>
        )}

        {/* File List — only when connected */}
        {isConnected && (
          <>
            <View style={styles.sectionHeader}>
              <Text style={[styles.sectionTitle, { color: theme.colors.textPrimary }]}>
                Files ({files.length})
              </Text>
            </View>

            {files.length === 0 ? (
              <Text style={[styles.emptyText, { color: theme.colors.textTertiary }]}>
                No files on device
              </Text>
            ) : (
              <Card variant="default" padding="none" style={styles.card} header={null}>
                <FlatList
                  data={[...files].sort((a, b) => {
                    const parse = (n: string) => {
                      const m = n.replace('.vtx', '').split('_');
                      return m.length === 4
                        ? new Date(+m[2], +m[0] - 1, +m[1]).getTime() + +m[3]
                        : 0;
                    };
                    return parse(b.name) - parse(a.name);
                  })}
                  renderItem={renderFileItem}
                  keyExtractor={(item) => item.name}
                  scrollEnabled={false}
                />
              </Card>
            )}
          </>
        )}

        {/* Quick Actions — inline row below files */}
        {isConnected && !showWifiModal && !isSyncing && (
          <View style={styles.quickActionsRow}>
            <TouchableOpacity
              style={[styles.quickAction, { borderColor: theme.colors.border, flex: 1 }]}
              onPress={handleSyncClock}>
              <Clock size={16} color={clockSynced ? theme.colors.success : theme.colors.warning} />
              <Text style={[styles.quickActionText, { color: theme.colors.textSecondary }]}>
                {clockSynced ? 'Clock Synced' : 'Sync Clock'}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.quickAction, { borderColor: theme.colors.border, flex: 1 }]}
              onPress={() => setShowWifiModal(true)}>
              <Wifi size={16} color={theme.colors.textSecondary} />
              <Text style={[styles.quickActionText, { color: theme.colors.textSecondary }]}>
                WiFi Setup
              </Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Secondary Actions */}
        <View style={styles.secondaryActions}>
          {isConnected && (
            <Button variant="secondary" onPress={() => setShowDisconnectDialog(true)}>
              Disconnect
            </Button>
          )}
          <Button variant="secondary" onPress={() => setShowForgetDialog(true)}>
            Forget Device
          </Button>
        </View>
      </ScrollView>

      {/* Delete File Dialog */}
      <ConfirmDialog
        visible={fileToDelete !== null}
        onDismiss={() => setFileToDelete(null)}
        title="Delete File"
        message={fileToDelete ? `Delete "${fileToDelete}" from device?` : ''}
        icon={<XCircle size={48} color={theme.colors.error} />}
        actions={[
          { label: 'Cancel', onPress: () => setFileToDelete(null), variant: 'default' },
          { label: 'Delete', onPress: handleDeleteFile, variant: 'danger' },
        ]}
      />

      {/* Disconnect Dialog */}
      <ConfirmDialog
        visible={showDisconnectDialog}
        onDismiss={() => setShowDisconnectDialog(false)}
        title="Disconnect"
        message="Disconnect from this device?"
        icon={<Bluetooth size={48} color={theme.colors.primary} />}
        actions={[
          { label: 'Cancel', onPress: () => setShowDisconnectDialog(false), variant: 'default' },
          { label: 'Disconnect', onPress: handleDisconnect, variant: 'danger' },
        ]}
      />

      {/* Forget Dialog */}
      <ConfirmDialog
        visible={showForgetDialog}
        onDismiss={() => setShowForgetDialog(false)}
        title="Forget Device"
        message={`Remove "${deviceName}" from saved devices? You can re-add it by scanning.`}
        icon={<Trash2 size={48} color={theme.colors.error} />}
        actions={[
          { label: 'Cancel', onPress: () => setShowForgetDialog(false), variant: 'default' },
          { label: 'Forget', onPress: handleForget, variant: 'danger' },
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
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerTitles: {
    flex: 1,
    marginLeft: 8,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '600',
  },
  headerSubtitle: {
    fontSize: 11,
    fontFamily: staticTheme.typography.mono,
    marginTop: 2,
  },
  scrollView: {
    flex: 1,
  },
  content: {
    padding: 24,
    paddingBottom: 48,
  },
  card: {
    marginBottom: 16,
  },
  statusGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    padding: 16,
  },
  statusItem: {
    width: '50%',
    alignItems: 'center',
    paddingVertical: 12,
    gap: 4,
  },
  statusLabel: {
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  statusValue: {
    fontSize: 18,
    fontWeight: '600',
    fontFamily: staticTheme.typography.mono,
  },
  inclinometerRow: {
    alignItems: 'center',
    marginBottom: 24,
  },
  quickActionsRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 16,
    marginBottom: 8,
  },
  recordButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderRadius: 12,
  },
  recordButtonText: {
    fontSize: 16,
    fontWeight: '600',
  },
  quickAction: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
  },
  quickActionText: {
    fontSize: 13,
    fontWeight: '500',
  },
  actionSection: {
    marginBottom: 24,
  },
  sectionHeader: {
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
  },
  emptyText: {
    textAlign: 'center',
    fontSize: 14,
    paddingVertical: 24,
  },
  fileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 12,
  },
  fileInfo: {
    flex: 1,
  },
  fileName: {
    fontSize: 14,
    fontFamily: staticTheme.typography.mono,
  },
  fileSize: {
    fontSize: 12,
    marginTop: 2,
  },
  syncInline: {
    padding: 16,
    gap: 10,
  },
  syncInlineHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  syncInlineTitle: {
    fontSize: 14,
    fontWeight: '600',
  },
  syncInlineFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  syncInlineBytes: {
    fontSize: 12,
    fontFamily: staticTheme.typography.mono,
  },
  syncCancelButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingTop: 4,
  },
  syncCancelText: {
    fontSize: 13,
    fontWeight: '500',
  },
  recordingInfo: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 4,
  },
  recordingInfoText: {
    fontSize: 15,
    fontWeight: '600',
    fontFamily: staticTheme.typography.mono,
  },
  wifiLabel: {
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  wifiInput: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
  },
  passwordInputWrapper: {
    position: 'relative',
  },
  passwordInput: {
    paddingRight: 44,
  },
  eyeButtonInline: {
    position: 'absolute',
    right: 12,
    top: 0,
    bottom: 0,
    justifyContent: 'center',
  },
  wifiActions: {
    marginTop: 16,
    gap: 8,
  },
  secondaryActions: {
    marginTop: 32,
    gap: 12,
  },
  progressBar: {
    width: '100%',
    height: 6,
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 3,
  },
});

export default DeviceDetailV2Screen;
