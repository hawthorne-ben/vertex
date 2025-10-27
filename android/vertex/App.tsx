/**
 * Sample React Native App
 * https://github.com/facebook/react-native
 *
 * @format
 */

import React, { useEffect } from 'react';
import { StatusBar, useColorScheme } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NavigationContainer } from '@react-navigation/native';
import { AuthProvider } from './src/contexts/AuthContext';
import AppNavigator from './src/navigation/AppNavigator';

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

function App() {
  const isDarkMode = useColorScheme() === 'dark';

  useEffect(() => {
    setupGlobalErrorHandlers();
  }, []);

  return (
    <SafeAreaProvider>
      <AuthProvider>
        <NavigationContainer key="main-nav">
          <StatusBar barStyle={isDarkMode ? 'light-content' : 'dark-content'} />
          <AppNavigator />
        </NavigationContainer>
      </AuthProvider>
    </SafeAreaProvider>
  );
}

export default App;
