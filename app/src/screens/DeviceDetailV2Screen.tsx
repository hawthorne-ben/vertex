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
  ActivityIndicator,
  Platform,
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
  ScrollText,
} from 'lucide-react-native';
import { theme as staticTheme } from '../styles/theme';
import { useTheme } from '../contexts/ThemeContext';
import { useToast } from '../contexts/ToastContext';
import { BackButton, Button, Card, ConfirmDialog, Modal } from '../components/ui';
import Inclinometer from '../components/Inclinometer';
import { API_URL, DEVICE_API_KEY } from '@env';
import BleService, {
  V2Status,
  V2FileEntry,
  V2SyncProgress,
  V2_LOG_LEVELS,
} from '../services/BleService';
import NotificationService from '../services/NotificationService';
import { useAuth } from '../contexts/AuthContext';
import { RootStackParamList } from '../navigation/AppNavigator';
import { useDeviceStore } from '../stores/deviceStore';

// One parsed line from the diagnostic ring.
// Wire form is "<millis> <L> <tag> <msg>" (firmware/imu_manager_v2/log_ring.h).
interface ParsedLogLine {
  millis: number | null;
  level: number | null; // index into V2_LOG_LEVELS
  tag: string;
  message: string;
  /** Gap markers and unparseable records — always shown, never filtered out. */
  notice: boolean;
  /** Index of the boot session this line belongs to. */
  session: number;
}

const LEVEL_INDEX: Record<string, number> = { D: 0, I: 1, W: 2, E: 3 };

// Format raw millis() as uptime. The device has no wall clock in the log —
// millis() is deliberate (it is the same time base as IMU sample timestamps,
// and it never lies about being unavailable the way an unsynced clock does).
const formatUptime = (ms: number): string => {
  const totalSec = Math.floor(ms / 1000);
  const msPart = ms % 1000;
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const sec = totalSec % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(sec).padStart(2, '0');
  const mmm = String(msPart).padStart(3, '0');
  return h > 0 ? `${h}:${mm}:${ss}.${mmm}` : `${mm}:${ss}.${mmm}`;
};

// Parse raw lines and assign each to a boot session.
//
// millis() restarts at 0 on every boot, so a ring spanning several rides has
// timestamps that appear to run backwards. The firmware writes a "SYS boot"
// line at ERROR on each startup precisely so sessions can be told apart; this
// splits on that marker, and also on any backwards time jump in case the boot
// line itself was overwritten by a wrap.
const parseLogLines = (lines: string[]): ParsedLogLine[] => {
  const out: ParsedLogLine[] = [];
  let session = 0;
  let prevMillis: number | null = null;

  for (const raw of lines) {
    const m = /^(\d+) ([DIWE]) (\S+) ([\s\S]*)$/.exec(raw);
    if (!m) {
      // Gap markers and anything malformed. Never hidden by the view filter:
      // a suppressed gap notice would misrepresent the history as continuous.
      out.push({ millis: null, level: null, tag: '', message: raw, notice: true, session });
      continue;
    }

    const millis = Number(m[1]);
    const tag = m[3];
    const message = m[4];
    const isBoot = tag === 'SYS' && message.startsWith('boot');

    if (out.length > 0 && (isBoot || (prevMillis !== null && millis < prevMillis))) {
      session += 1;
    }
    prevMillis = millis;

    out.push({
      millis,
      level: LEVEL_INDEX[m[2]] ?? null,
      tag,
      message,
      notice: false,
      session,
    });
  }
  return out;
};

const logLineColor = (line: ParsedLogLine, theme: any): string => {
  if (line.notice) return theme.colors.warning;
  switch (line.level) {
    case 3:
      return theme.colors.error;
    case 2:
      return theme.colors.warning;
    case 1:
      return theme.colors.textPrimary;
    default:
      return theme.colors.textSecondary;
  }
};

type DeviceDetailV2RouteProp = RouteProp<RootStackParamList, 'DeviceDetailV2'>;
type NavigationProp = NativeStackNavigationProp<RootStackParamList>;

// Sort key from a recording filename: "M_D_YYYY_msInDay.vtx".
//
// Mirrors vtxFilenameSortKey() in firmware/imu_manager_v2/vtx_format.h. The
// previous version split on '_' without stripping the directory prefix, so a
// name like "/vtx/9_6_2026_123.vtx" still yielded 4 parts and +'/vtx/9' was
// NaN — every key became NaN, every comparison false, and the list rendered in
// arbitrary order. Firmware now strips the prefix before sending; this handles
// it too, so an older device build cannot reintroduce the bug.
//
// Returns -1 for unparseable names so they sort last rather than randomly.
function fileSortKey(name: string): number {
  const bare = (name.split('/').pop() ?? name).replace(/\.vtx$/i, '');
  const parts = bare.split('_');
  if (parts.length !== 4) return -1;
  const [mon, day, year, ms] = parts.map(Number);
  if (![mon, day, year, ms].every(Number.isFinite)) return -1;
  if (mon < 1 || mon > 12 || day < 1 || day > 31 || year < 2000) return -1;
  return Date.UTC(year, mon - 1, day) + ms;
}

// mm:ss (or h:mm:ss past an hour) for the recording notification.
function formatDuration(totalSecs: number): string {
  const h = Math.floor(totalSecs / 3600);
  const m = Math.floor((totalSecs % 3600) / 60);
  const sec = totalSecs % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
}

// Firmware refuses to record for a handful of reasons; the status flags say
// which. Without this the UI reports success for a recording that never began.
function describeRefusal(s: V2Status): string {
  if (s.state === 'fault') {
    if (!s.imuOk) return 'Device fault: IMU not responding';
    if (!s.sdOk) return 'Device fault: SD card not detected';
    return 'Device fault — recording unavailable';
  }
  if (s.spaceCritical) return `SD card full (${s.freeMb} MB free)`;
  if (s.spaceLow) return `Not enough space to start (${s.freeMb} MB free)`;
  if (s.state === 'uploading') return 'Upload in progress';
  return 'Device did not start recording';
}

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
  const timeReqUnsubRef = useRef<(() => void) | null>(null);
  const [files, setFiles] = useState<V2FileEntry[]>([]);
  const [clockSynced, setClockSynced] = useState(false);
  // Distinguishes "sync has not run yet" from "sync ran and failed". Without
  // this the warning shows during the normal one-second window between
  // connecting and syncing, which reads as a fault.
  const [clockSyncAttempted, setClockSyncAttempted] = useState(false);

  // WiFi setup
  const [showWifiModal, setShowWifiModal] = useState(false);

  // Diagnostic log streaming. The reader position is held against
  // total_written (not a raw ring offset), so it stays valid while the device
  // wraps underneath — the same contract the firmware and vtx_ble.py use.
  const [showLogModal, setShowLogModal] = useState(false);
  const [logLines, setLogLines] = useState<string[]>([]);
  const [logLoading, setLogLoading] = useState(false);
  const [logError, setLogError] = useState<string | null>(null);
  const [logLevel, setLogLevel] = useState<number | null>(null);
  const [logBytesLost, setLogBytesLost] = useState(0);
  // VIEW filter — what this screen shows. Entirely separate from the device
  // level below: this one is free and reversible, that one changes what the
  // firmware persists to SD and cannot recover what it already discarded.
  const [logViewFilter, setLogViewFilter] = useState(0);
  const [showLogClearDialog, setShowLogClearDialog] = useState(false);
  const [logAtBottom, setLogAtBottom] = useState(true);
  const logPosRef = useRef<bigint>(0n);
  const logScrollRef = useRef<ScrollView | null>(null);
  // Set while a programmatic scrollToEnd is animating. onScroll fires
  // throughout that animation with the offset still far from the bottom, which
  // would immediately undo the state the tap just set — so those events are
  // ignored until the animation lands.
  const logAutoScrollingRef = useRef(false);
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
  // Android needs a foreground service to keep the process alive while the
  // phone is pocketed, or Doze throttles the BLE callback that answers the
  // device's 60 s clock-sync requests — the responder dies and the ride loses
  // drift correction. iOS relies on the `bluetooth-central` background mode
  // instead. This mirrors what RecordScreen already does for V1; the V2 flow
  // was built on a new screen and never inherited it.
  useEffect(() => {
    const recording = status?.state === 'recording';
    if (recording) {
      NotificationService.showRecordingNotification(
        isConnected,
        deviceName ?? 'Vertex-V2',
        formatDuration(displaySecs),
        status?.recordingInfo?.fileBytes ?? 0,
        deviceId
      );
    } else {
      // Must stop the service, not just cancel the notification — Android
      // re-posts a foreground service's notification if the service lives on.
      NotificationService.stopRecordingNotification();
    }
  }, [status?.state, isConnected]);

  // Keep the notification's elapsed time current without restarting the
  // service — updateRecordingNotification reuses the existing one.
  //
  // `status?.state` MUST be in the dependency array even though it is only
  // read in a guard. With only [displaySecs], this effect closed over a stale
  // `status` from the previous render: a tick landing just after the state
  // flipped to idle would still see 'recording', call update(), and recreate
  // the notification the hide effect had just dismissed. That is the
  // "notification survives stop" bug.
  useEffect(() => {
    if (status?.state !== 'recording') return;
    NotificationService.updateRecordingNotification(
      isConnected,
      deviceName ?? 'Vertex-V2',
      formatDuration(displaySecs),
      status?.recordingInfo?.fileBytes ?? 0,
      deviceId
    );
  }, [displaySecs, status?.state, isConnected]);

  // Stop the service if the screen unmounts mid-recording.
  useEffect(() => () => { NotificationService.stopRecordingNotification(); }, []);

  // Periodic clock-sync responder. The device notifies [0xF0][t1] every 60 s
  // while recording and needs a reply within CLOCK_SYNC_TIMEOUT_MS (2 s), so
  // this must be live for the whole session — not just while the record screen
  // happens to be doing something. Resubscribes on reconnect because the
  // monitor is bound to the connected device.
  useEffect(() => {
    if (!isConnected) {
      timeReqUnsubRef.current?.();
      timeReqUnsubRef.current = null;
      return;
    }
    timeReqUnsubRef.current = BleService.subscribeToTimeRequests();
    return () => {
      timeReqUnsubRef.current?.();
      timeReqUnsubRef.current = null;
    };
  }, [isConnected]);

  useEffect(() => {
    NotificationService.requestPermissions().then((granted) => {
      if (granted) NotificationService.initialize();
    });
  }, []);

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
  //
  // Also paused while the diagnostic log is open: the 2 Hz status poll and the
  // log drain share one BLE link, and the poll's notifications compete with the
  // log chunks for it. Status is not interesting while reading the log, and the
  // poll resumes as soon as the modal closes.
  useEffect(() => {
    if (isConnected && !isSyncing && !showLogModal) {
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
  }, [isConnected, isSyncing, showLogModal]);

  const refreshAll = useCallback(async () => {
    try {
      const s = await BleService.getStatusV2();
      if (isMountedRef.current) {
        setStatus(s);
        setClockSynced(s.clockSynced);
      }

      // Sync the clock if the device has not got one yet. Nothing did this
      // before: the screen only *read* clockSynced, so a freshly booted device
      // sat showing "Clock not synced" until the user pressed record — which
      // fixed it as a side effect, and made the warning look like a reason not
      // to record. Sync is idempotent and costs one BLE write, so doing it here
      // is cheap; the pre-record sync stays as the freshness guarantee.
      if (!s.clockSynced) {
        try {
          await BleService.syncClockV2();
          if (isMountedRef.current) setClockSynced(true);
        } catch (e: any) {
          console.warn('[V2] Connect-time clock sync failed:', e?.message);
        } finally {
          if (isMountedRef.current) setClockSyncAttempted(true);
        }
      } else if (isMountedRef.current) {
        setClockSyncAttempted(true);
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


  // A generic block: any state or condition where firmware will refuse.
  // Keeping this in one place means a new blocking condition needs one edit,
  // not one per call site.
  const canRecord =
    status?.state === 'idle' && status?.sdOk !== false &&
    status?.imuOk !== false && !status?.spaceCritical;

  const handleStartRecording = async () => {
    try {
      // Always sync clock before recording to ensure accurate timestamps
      // Re-sync before every recording. The connect-time sync may be hours
      // stale, and the file's start_timestamp is written at open — so this is
      // the last moment it can be corrected.
      try {
        await BleService.syncClockV2();
        if (isMountedRef.current) setClockSynced(true);
      } catch {
        // Non-fatal: the recording is still worth having, its wall-clock
        // timestamps just may not be. The banner reflects that.
        console.warn('[V2] Pre-record clock sync failed');
        if (isMountedRef.current) setClockSynced(false);
      }
      await BleService.startRecordingV2();

      // The BLE write resolving only means the command was delivered. Firmware
      // refuses to start when the IMU or SD card is unhealthy, or when there
      // is not enough space left for a useful session — so confirm the device
      // actually entered RECORDING before telling the user it did.
      const s = await BleService.getStatusV2();
      if (isMountedRef.current) setStatus(s);

      if (s.state === 'recording') {
        showToast({ message: 'Recording started', variant: 'success', duration: 2000 });
      } else {
        showToast({ message: describeRefusal(s), variant: 'error' });
      }
    } catch (e: any) {
      showToast({ message: `Failed to start recording: ${e?.message}`, variant: 'error' });
    }
  };

  const handleStopRecording = async () => {
    try {
      await BleService.stopRecordingV2();
      // Dismiss straight away. The state-driven effect would also do this once
      // the next poll reports idle, but that is up to 500 ms of a notification
      // for a recording the user has already stopped. Idempotent, so the
      // effect firing afterwards is harmless.
      NotificationService.stopRecordingNotification();
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

  // Drain everything the device has from the current reader position. Each
  // reply carries the position to resume from, so this walks forward until the
  // device reports nothing further rather than guessing a chunk count.
  const drainLog = useCallback(async (reset: boolean) => {
    if (!BleService.isConnected()) {
      setLogError('Device disconnected');
      return;
    }
    setLogLoading(true);
    setLogError(null);
    try {
      if (reset) {
        // 0 is clamped up to the oldest surviving byte by the device, which
        // reports the resulting gap rather than silently resyncing.
        logPosRef.current = 0n;
        setLogLines([]);
        setLogBytesLost(0);
        // The list is being rebuilt, so any previous scroll position is gone.
        // Re-pin to the bottom rather than leaving logAtBottom describing a
        // viewport that no longer exists — otherwise the pill can linger (or
        // stay hidden) against freshly loaded content.
        setLogAtBottom(true);
      }

      const collected: string[] = [];
      let lost = 0;
      // Bounded so a device writing faster than we read cannot spin forever.
      for (let i = 0; i < 200; i++) {
        const chunk = await BleService.readLogV2(logPosRef.current);
        setLogLevel(chunk.minLevel);

        if (chunk.gap > 0n) {
          lost += Number(chunk.gap);
          collected.push(`--- ${chunk.gap} bytes overwritten before they were read ---`);
        }
        if (chunk.text) {
          collected.push(...chunk.text.split('\n').filter(l => l.trim().length > 0));
        }

        const done =
          chunk.nextPos === logPosRef.current && !chunk.text;
        logPosRef.current = chunk.nextPos;
        if (done || chunk.nextPos >= chunk.totalWritten) break;
      }

      if (collected.length > 0) {
        setLogLines(prev => [...prev, ...collected]);
      }
      if (lost > 0) {
        setLogBytesLost(prev => prev + lost);
      }
    } catch (err: any) {
      setLogError(err?.message ?? 'Failed to read log');
    } finally {
      setLogLoading(false);
    }
  }, []);

  // Parse once per change, then apply the view filter. Notices (gap markers,
  // malformed records) always survive the filter: hiding a gap would present
  // the history as continuous when it is not.
  const parsedLogLines = React.useMemo(() => parseLogLines(logLines), [logLines]);
  const visibleLogLines = React.useMemo(
    () =>
      parsedLogLines.filter(
        l => l.notice || (l.level !== null && l.level >= logViewFilter),
      ),
    [parsedLogLines, logViewFilter],
  );

  const handleOpenLog = useCallback(async () => {
    setShowLogModal(true);
    await drainLog(true);
  }, [drainLog]);

  const handleCloseLog = useCallback(() => {
    setShowLogModal(false);
  }, []);

  // Write the device's minimum level. This is a DEVICE setting, persisted in
  // NVS: it changes what the firmware records to SD from now on and survives a
  // reboot. Distinct from logViewFilter, which only affects this screen.
  const applyLogLevel = useCallback(async (next: number) => {
    try {
      const chunk = await BleService.setLogLevelV2(next);
      setLogLevel(chunk.minLevel);
      showToast({
        message: `Device now records ${V2_LOG_LEVELS[chunk.minLevel]} and above`,
        variant: 'success',
        duration: 2500,
      });
    } catch (err: any) {
      showToast({
        message: err?.message ?? 'Failed to set log level',
        variant: 'error',
      });
    }
  }, [showToast]);

  // Clear the device ring. Destructive and unrecoverable — the diagnostic
  // history is the whole point of the feature, so it is confirmed first and
  // never offered as a bare tap.
  const handleClearLog = useCallback(async () => {
    setShowLogClearDialog(false);
    setLogLoading(true);
    try {
      await BleService.clearLogV2();
      // Reset local view state to match the device's now-empty ring.
      logPosRef.current = 0n;
      setLogLines([]);
      setLogBytesLost(0);
      setLogError(null);
      showToast({ message: 'Diagnostic log cleared', variant: 'success', duration: 2000 });
    } catch (err: any) {
      showToast({
        message: err?.message ?? 'Failed to clear log',
        variant: 'error',
      });
    } finally {
      setLogLoading(false);
    }
  }, [showToast]);

  // DEBUG on/off is the only choice: the device always records INFO and above,
  // and the firmware clamps anything more restrictive. No confirmation needed
  // in either direction — turning DEBUG off keeps every event-level line, and
  // turning it on only costs ring capacity.
  const handleToggleDebug = useCallback(() => {
    applyLogLevel(logLevel === 0 ? 1 : 0);
  }, [logLevel, applyLogLevel]);

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

  // No longer bound to a button — clock sync runs automatically on connect and
  // before each recording. Kept as a manual escape hatch for debugging a device
  // whose clock will not take.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
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
                style={[styles.recordButton, { backgroundColor: theme.colors.primary, opacity: canRecord ? 1 : 0.5 }]}
                onPress={handleStartRecording}
                disabled={!canRecord}>
                <Text style={[styles.recordButtonText, { color: theme.colors.primaryForeground }]}>
                  {status?.state === 'fault' ? 'Device Fault' :
                   status?.spaceCritical ? 'SD Card Full' : 'Start Recording'}
                </Text>
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
                {(status?.fileCount ?? 0) > files.length
                  ? `Files (${files.length} of ${status?.fileCount} on device)`
                  : `Files (${files.length})`}
              </Text>
            </View>

            {files.length === 0 ? (
              <Text style={[styles.emptyText, { color: theme.colors.textTertiary }]}>
                No files on device
              </Text>
            ) : (
              <Card variant="default" padding="none" style={styles.card} header={null}>
                <FlatList
                  data={[...files].sort((a, b) => fileSortKey(b.name) - fileSortKey(a.name))}
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
          <>
            {/* Clock sync is plumbing: it runs on connect and again before
                every recording, so there is nothing for the user to operate.
                Surface it only when it has never succeeded — that is the one
                case where it changes what the data means (timestamps fall back
                to the firmware's default epoch). Passive warning, not a CTA.

                On its own row: WiFi Setup and Diagnostic Log are a half-width
                pair, and adding a third flex child would shrink both to a
                third whenever this warning happened to be showing. */}
            {clockSyncAttempted && !clockSynced && (
              <View style={styles.quickActionsRow}>
                <View style={[styles.quickAction, { borderColor: theme.colors.warning, flex: 1 }]}>
                  <Clock size={16} color={theme.colors.warning} />
                  <Text style={[styles.quickActionText, { color: theme.colors.warning }]}>
                    Clock not synced
                  </Text>
                </View>
              </View>
            )}
            <View style={styles.quickActionsRow}>
              <TouchableOpacity
                style={[styles.quickAction, { borderColor: theme.colors.border, flex: 1 }]}
                onPress={() => setShowWifiModal(true)}>
                <Wifi size={16} color={theme.colors.textSecondary} />
                <Text style={[styles.quickActionText, { color: theme.colors.textSecondary }]}>
                  WiFi Setup
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.quickAction, { borderColor: theme.colors.border, flex: 1 }]}
                onPress={handleOpenLog}>
                <ScrollText size={16} color={theme.colors.textSecondary} />
                <Text style={[styles.quickActionText, { color: theme.colors.textSecondary }]}>
                  Diagnostic Log
                </Text>
              </TouchableOpacity>
            </View>
          </>
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

      {/* Diagnostic Log — modelled on the Scan for Devices leaf */}
      <Modal
        visible={showLogModal}
        onClose={handleCloseLog}
        title="Diagnostic Log"
        // Action row uses the same control shape as the level chips below:
        // Button's own padding (16/24 at md, 8/16 at sm) forced the two-word
        // labels to wrap once three sat in one row.
        footer={
          <View style={styles.logActions}>
            <TouchableOpacity
              style={[styles.logActionChip, { borderColor: theme.colors.border }]}
              disabled={logLoading}
              onPress={() => drainLog(false)}>
              <Text
                numberOfLines={1}
                style={[styles.logChipText, { color: theme.colors.textSecondary }]}>
                Refresh
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.logActionChip, { borderColor: theme.colors.border }]}
              disabled={logLoading}
              onPress={() => drainLog(true)}>
              <Text
                numberOfLines={1}
                style={[styles.logChipText, { color: theme.colors.textSecondary }]}>
                Reload All
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.logActionChip, { borderColor: theme.colors.error }]}
              disabled={logLoading}
              onPress={() => setShowLogClearDialog(true)}>
              <Text
                numberOfLines={1}
                style={[styles.logChipText, { color: theme.colors.error }]}>
                Delete All
              </Text>
            </TouchableOpacity>
          </View>
        }>
        {/* VIEW filter — local to this screen. Changing it costs nothing and
            hides nothing permanently. */}
        <Text style={[styles.logSectionLabel, { color: theme.colors.textSecondary }]}>
          Show
        </Text>
        <View style={styles.logChipRow}>
          {V2_LOG_LEVELS.map((name, idx) => {
            const active = logViewFilter === idx;
            return (
              <TouchableOpacity
                key={`view-${name}`}
                style={[
                  styles.logChip,
                  {
                    borderColor: active ? theme.colors.primary : theme.colors.border,
                    backgroundColor: active ? theme.colors.primary : 'transparent',
                  },
                ]}
                onPress={() => setLogViewFilter(idx)}>
                <Text
                  style={[
                    styles.logChipText,
                    { color: active ? theme.colors.background : theme.colors.textSecondary },
                  ]}>
                  {idx === 0 ? 'All' : `${name}+`}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* DEVICE recording level — persisted in NVS.
            INFO and above is always recorded (~18 KB over a 3 h ride against a
            10 MB ring), so the only real choice is whether DEBUG is included —
            it is the one tier that scales with loop rate (~2.3 MB per 3 h). A
            single toggle, styled as a peer of the Show chips above. */}
        <TouchableOpacity
          style={[
            styles.logDebugToggle,
            {
              borderColor: logLevel === 0 ? theme.colors.warning : theme.colors.border,
              backgroundColor: logLevel === 0 ? theme.colors.warning : 'transparent',
            },
          ]}
          disabled={logLoading || logLevel === null}
          onPress={handleToggleDebug}>
          <Text
            numberOfLines={1}
            style={[
              styles.logChipText,
              { color: logLevel === 0 ? theme.colors.background : theme.colors.textSecondary },
            ]}>
            Debug logging
          </Text>
        </TouchableOpacity>

        {logLoading && (
          <View style={[styles.logIndicator, { backgroundColor: theme.colors.muted }]}>
            <ActivityIndicator size="small" color={theme.colors.primary} />
            <Text style={[styles.logIndicatorText, { color: theme.colors.textSecondary }]}>
              Reading log from device...
            </Text>
          </View>
        )}

        {logError && (
          <View style={[styles.logIndicator, { backgroundColor: theme.colors.muted }]}>
            <AlertCircle size={16} color={theme.colors.error} />
            <Text style={[styles.logIndicatorText, { color: theme.colors.error }]}>
              {logError}
            </Text>
          </View>
        )}

        {/* Overwritten bytes are surfaced, never silently skipped — the ring
            reports what it lost so a gap in the history is visible rather than
            reading as a clean but incomplete record. */}
        {logBytesLost > 0 && (
          <View style={[styles.logIndicator, { backgroundColor: theme.colors.muted }]}>
            <AlertCircle size={16} color={theme.colors.warning} />
            <Text style={[styles.logIndicatorText, { color: theme.colors.warning }]}>
              {`${logBytesLost.toLocaleString()} bytes overwritten before they were read`}
            </Text>
          </View>
        )}

        <ScrollView
          ref={logScrollRef}
          style={styles.logList}
          // Pin to bottom only when already there: auto-scrolling while the
          // user has scrolled up to read would fight them.
          onScroll={e => {
            // Ignore the events emitted while a "jump to latest" animation is
            // in flight; they report the in-between offsets, not the user's
            // intent.
            if (logAutoScrollingRef.current) return;
            const { layoutMeasurement, contentOffset, contentSize } = e.nativeEvent;
            const distanceFromBottom =
              contentSize.height - (contentOffset.y + layoutMeasurement.height);
            setLogAtBottom(distanceFromBottom < 40);
          }}
          scrollEventThrottle={16}
          onContentSizeChange={() => {
            if (logAtBottom) {
              logScrollRef.current?.scrollToEnd({ animated: false });
            }
          }}>
          {visibleLogLines.length === 0 && !logLoading && !logError && (
            <Text style={[styles.logEmptyText, { color: theme.colors.textSecondary }]}>
              {logLines.length > 0
                ? `Nothing at ${V2_LOG_LEVELS[logViewFilter]} or above. Lower the Show filter to see more.`
                : 'No entries yet.'}
            </Text>
          )}
          {visibleLogLines.map((line, i) => (
            <View key={`${line.session}-${i}-${line.millis ?? 'n'}`}>
              {/* Session break: millis() restarts at each boot, so without this
                  a multi-ride log looks like time runs backwards. */}
              {i > 0 && line.session !== visibleLogLines[i - 1].session && (
                <View style={[styles.logSessionDivider, { borderTopColor: theme.colors.border }]}>
                  <Text style={[styles.logSessionText, { color: theme.colors.textTertiary }]}>
                    {`session ${line.session + 1} — device restarted`}
                  </Text>
                </View>
              )}
              <View style={styles.logRow}>
                {!line.notice && line.millis !== null && (
                  <Text style={[styles.logTime, { color: theme.colors.textTertiary }]}>
                    {formatUptime(line.millis)}
                  </Text>
                )}
                <Text
                  style={[styles.logMessage, { color: logLineColor(line, theme) }]}
                  selectable>
                  {line.notice ? line.message : `${line.tag}  ${line.message}`}
                </Text>
              </View>
            </View>
          ))}
        </ScrollView>

        {!logAtBottom && visibleLogLines.length > 0 && (
          <TouchableOpacity
            style={[styles.logJumpButton, { backgroundColor: theme.colors.muted, borderColor: theme.colors.border }]}
            onPress={() => {
              logAutoScrollingRef.current = true;
              setLogAtBottom(true);
              logScrollRef.current?.scrollToEnd({ animated: true });
              // Re-arm once the animation has landed. Slightly longer than the
              // ~300ms RN scroll animation so the trailing events are covered.
              setTimeout(() => {
                logAutoScrollingRef.current = false;
              }, 450);
            }}>
            <Text style={[styles.logChipText, { color: theme.colors.textSecondary }]}>
              Jump to latest
            </Text>
          </TouchableOpacity>
        )}
      </Modal>

      {/* Clearing is unrecoverable — the ring is the only copy. */}
      <ConfirmDialog
        visible={showLogClearDialog}
        onDismiss={() => setShowLogClearDialog(false)}
        title="Delete Diagnostic Log?"
        message="Erases the device's entire diagnostic history, including anything recorded on earlier rides. This cannot be undone."
        icon={<Trash2 size={48} color={theme.colors.error} />}
        actions={[
          { label: 'Cancel', onPress: () => setShowLogClearDialog(false), variant: 'default' },
          { label: 'Delete All', onPress: handleClearLog, variant: 'danger' },
        ]}
      />



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
  logSectionLabel: {
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  logChipRow: {
    flexDirection: 'row',
    gap: 6,
  },
  logChip: {
    flex: 1,
    paddingVertical: 6,
    borderRadius: 6,
    borderWidth: 1,
    alignItems: 'center',
  },
  logChipText: {
    fontSize: 12,
    fontWeight: '600',
  },
  // Same shape as logChip above, with the top margin that separates it from
  // the Show row and bottom margin before the log list.
  logDebugToggle: {
    marginTop: 12,
    marginBottom: 12,
    paddingVertical: 6,
    borderRadius: 6,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  logTime: {
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace' }),
    fontSize: 10,
    lineHeight: 16,
    minWidth: 62,
  },
  logMessage: {
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace' }),
    fontSize: 11,
    lineHeight: 16,
    flex: 1,
  },
  logSessionDivider: {
    borderTopWidth: 1,
    marginTop: 8,
    paddingTop: 6,
    marginBottom: 4,
  },
  logSessionText: {
    fontSize: 10,
    fontStyle: 'italic',
  },
  logJumpButton: {
    position: 'absolute',
    bottom: 76,
    alignSelf: 'center',
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 16,
    borderWidth: 1,
  },
  logIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    padding: 12,
    borderRadius: 8,
    marginBottom: 12,
  },
  logIndicatorText: {
    fontSize: 13,
    flexShrink: 1,
  },
  logList: {
    maxHeight: 400,
  },
  logEmptyText: {
    textAlign: 'center',
    fontSize: 14,
    padding: 32,
  },
  logLine: {
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace' }),
    fontSize: 11,
    lineHeight: 16,
    marginBottom: 2,
  },
  logActions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
  },
  // Matches logChip above: same height, radius and text size, so the action row
  // reads as a peer of the level toggles rather than a heavier control.
  // numberOfLines={1} on the labels keeps "Reload All" and "Delete All" on one
  // line at narrow widths instead of wrapping.
  logActionChip: {
    flex: 1,
    paddingVertical: 6,
    paddingHorizontal: 4,
    borderRadius: 6,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
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
