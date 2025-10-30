/**
 * Sample React Native App
 * https://github.com/facebook/react-native
 *
 * @format
 */

import React, { useEffect } from 'react';
import { StatusBar, useColorScheme } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NavigationContainer, NavigationContainerRef } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AuthProvider } from './src/contexts/AuthContext';
import { ThemeProvider } from './src/contexts/ThemeContext';
import { ToastProvider } from './src/contexts/ToastContext';
import AppNavigator from './src/navigation/AppNavigator';
import BleService from './src/services/BleService';
import RecordingService from './src/services/RecordingService';
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

function App() {
  const isDarkMode = useColorScheme() === 'dark';
  const navigationRef = React.useRef<NavigationContainerRef<any>>(null);

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
          </AuthProvider>
        </ToastProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

export default App;
