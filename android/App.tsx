/**
 * Sample React Native App
 * https://github.com/facebook/react-native
 *
 * @format
 */

import React, { useEffect, useState } from 'react';
import { StatusBar, useColorScheme } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NavigationContainer, NavigationContainerRef } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AuthProvider } from './src/contexts/AuthContext';
import { ThemeProvider, useTheme } from './src/contexts/ThemeContext';
import { ToastProvider } from './src/contexts/ToastContext';
import AppNavigator from './src/navigation/AppNavigator';
import BleService from './src/services/BleService';
import RecordingService from './src/services/RecordingService';
import VTXFileService from './src/services/VTXFileService';
import { ConfirmDialog } from './src/components/ui';
import { AlertCircle } from 'lucide-react-native';
import notifee, { EventType } from '@notifee/react-native';

// Global error handlers to prevent crashes
const setupGlobalErrorHandlers = () => {
  // Handle unhandled promise rejections
  const originalHandler = global.Promise;
  if (typeof originalHandler !== 'undefined') {
    const originalReject = originalHandler.reject;

    // Catch unhandled rejections
    if (typeof (global as any).HermesInternal === 'object') {
      // Hermes engine
      (global as any).__handleUnhandledPromiseRejection = (reason: any) => {
        console.error('[Unhandled Promise Rejection]', reason);
        // Don't crash the app
      };
    }
  }

  // Catch JS errors
  const originalErrorHandler = ErrorUtils.getGlobalHandler();
  ErrorUtils.setGlobalHandler((error: Error, isFatal?: boolean) => {
    console.error('[Global Error Handler]', error, 'Fatal:', isFatal);
    if (originalErrorHandler) {
      originalErrorHandler(error, isFatal);
    }
    // Prevent app crash for non-fatal errors
    if (!isFatal) {
      return;
    }
  });
};

// Auto-connect to most recently connected device
const SAVED_DEVICES_KEY = '@vertex_saved_devices';

interface SavedDevice {
  id: string;
  name: string;
  lastConnected?: string;
}

const autoConnectToDevice = async () => {
  try {
    const saved = await AsyncStorage.getItem(SAVED_DEVICES_KEY);
    if (!saved) {
      console.log('[AutoConnect] No saved devices found');
      return;
    }

    const devices: SavedDevice[] = JSON.parse(saved);
    if (devices.length === 0) {
      console.log('[AutoConnect] No devices in list');
      return;
    }

    // Find most recently connected device
    const sortedDevices = devices
      .filter(d => d.lastConnected)
      .sort((a, b) => {
        const aTime = new Date(a.lastConnected!).getTime();
        const bTime = new Date(b.lastConnected!).getTime();
        return bTime - aTime;
      });

    if (sortedDevices.length === 0) {
      console.log('[AutoConnect] No devices with lastConnected timestamp');
      return;
    }

    const deviceToConnect = sortedDevices[0];
    console.log('[AutoConnect] Attempting to connect to:', deviceToConnect.name, deviceToConnect.id);

    // Attempt connection
    await BleService.connectToDevice(deviceToConnect.id);
    console.log('[AutoConnect] Successfully connected to:', deviceToConnect.name);
  } catch (error) {
    console.log('[AutoConnect] Failed to auto-connect:', error);
    // Fail silently - user can manually connect if needed
  }
};

// Recovery check component that uses themed dialogs
const RecoveryCheck: React.FC<{ onComplete: () => void }> = ({ onComplete }) => {
  const { theme } = useTheme();
  const [showRecoveryDialog, setShowRecoveryDialog] = useState(false);
  const [showSuccessDialog, setShowSuccessDialog] = useState(false);
  const [showErrorDialog, setShowErrorDialog] = useState(false);
  const [recoveryMessage, setRecoveryMessage] = useState('');
  const [interruptedSession, setInterruptedSession] = useState<any>(null);

  useEffect(() => {
    console.log('[RecoveryCheck] Component mounted, checking for interrupted session...');

    const checkForRecovery = async () => {
      try {
        console.log('[RecoveryCheck] Calling checkForInterruptedSession...');
        const session = await RecordingService.checkForInterruptedSession();
        console.log('[RecoveryCheck] Result:', session ? 'Session found' : 'No session');

        if (session) {
          console.log('[RecoveryCheck] Found interrupted session:', session.id);
          console.log('[RecoveryCheck] File path:', session.filePath);
          console.log('[RecoveryCheck] Checking if file is corrupted...');

          const isCorrupted = await VTXFileService.isVTXFileCorrupted(session.filePath);
          console.log('[RecoveryCheck] Is corrupted:', isCorrupted);

          if (isCorrupted) {
            console.log('[RecoveryCheck] File is corrupted, showing recovery dialog');
            setInterruptedSession(session);
            setShowRecoveryDialog(true);
          } else {
            console.log('[RecoveryCheck] Session interrupted but file is fine, clearing session');
            await RecordingService.clearPersistedSession();
            onComplete();
          }
        } else {
          console.log('[RecoveryCheck] No interrupted session found, completing');
          onComplete();
        }
      } catch (error) {
        console.error('[RecoveryCheck] Recovery check failed:', error);
        onComplete();
      }
    };

    checkForRecovery();
  }, []);

  const handleRecover = async () => {
    try {
      const result = await VTXFileService.recoverCorruptedVTXFile(interruptedSession.filePath);

      if (result.success) {
        setRecoveryMessage(`Recovered ${result.recoveredSampleCount.toLocaleString()} samples`);
        setShowSuccessDialog(true);
      } else {
        setRecoveryMessage(result.error || 'Unknown error');
        setShowErrorDialog(true);
      }

      await RecordingService.clearPersistedSession();
    } catch (err: any) {
      setRecoveryMessage(err.message);
      setShowErrorDialog(true);
    }
  };

  const handleDiscard = async () => {
    try {
      await VTXFileService.deleteRecording(interruptedSession.filePath);
      await RecordingService.clearPersistedSession();
    } catch (err) {
      console.error('[App] Failed to discard:', err);
    }
    onComplete();
  };

  return (
    <>
      <ConfirmDialog
        visible={showRecoveryDialog}
        onDismiss={() => {}}
        backdropDismiss={false}
        title="Interrupted Recording Found"
        message={`Found an incomplete recording from ${interruptedSession?.deviceName}. Would you like to recover the data?`}
        icon={<AlertCircle size={48} color={theme.colors.warning} />}
        actions={[
          {
            label: 'Discard',
            onPress: handleDiscard,
            variant: 'danger',
          },
          {
            label: 'Recover',
            onPress: handleRecover,
            variant: 'primary',
          },
        ]}
      />

      <ConfirmDialog
        visible={showSuccessDialog}
        onDismiss={onComplete}
        title="Recovery Successful"
        message={recoveryMessage}
        actions={[
          {
            label: 'OK',
            onPress: onComplete,
            variant: 'primary',
          },
        ]}
      />

      <ConfirmDialog
        visible={showErrorDialog}
        onDismiss={onComplete}
        title="Recovery Failed"
        message={recoveryMessage}
        icon={<AlertCircle size={48} color={theme.colors.error} />}
        actions={[
          {
            label: 'OK',
            onPress: onComplete,
            variant: 'default',
          },
        ]}
      />
    </>
  );
};

function App() {
  const isDarkMode = useColorScheme() === 'dark';
  const navigationRef = React.useRef<NavigationContainerRef<any>>(null);
  const [isCheckingRecovery, setIsCheckingRecovery] = useState(true);

  useEffect(() => {
    setupGlobalErrorHandlers();

    // Clear any stale recording state from app crash/restart
    RecordingService.initialize();

    autoConnectToDevice();

    // Handle notification press events
    const unsubscribe = notifee.onForegroundEvent(({ type, detail }) => {
      if (type === EventType.PRESS && detail.notification?.data) {
        const { screen, deviceId, deviceName } = detail.notification.data;

        if (screen === 'Record' && navigationRef.current) {
          // Navigate to RecordScreen with device info
          navigationRef.current.navigate('Record', {
            deviceId: deviceId as string,
            deviceName: deviceName as string,
          });
        }
      }
    });

    return () => {
      unsubscribe();
    };
  }, []);

  // Handle notification press when app is in background/quit
  useEffect(() => {
    notifee.getInitialNotification().then((initialNotification) => {
      if (initialNotification?.notification?.data) {
        const { screen, deviceId, deviceName } = initialNotification.notification.data;

        if (screen === 'Record' && navigationRef.current) {
          // Small delay to ensure navigation is ready
          setTimeout(() => {
            navigationRef.current?.navigate('Record', {
              deviceId: deviceId as string,
              deviceName: deviceName as string,
            });
          }, 500);
        }
      }
    });
  }, []);

  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <ToastProvider>
          <AuthProvider>
            <NavigationContainer ref={navigationRef} key="main-nav">
              <StatusBar barStyle={isDarkMode ? 'light-content' : 'dark-content'} />
              <AppNavigator />
            </NavigationContainer>

            {/* Recovery check on app startup */}
            {isCheckingRecovery && (
              <RecoveryCheck onComplete={() => setIsCheckingRecovery(false)} />
            )}
          </AuthProvider>
        </ToastProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

export default App;
