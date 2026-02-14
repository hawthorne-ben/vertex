/**
 * @format
 */

import { AppRegistry, Platform } from 'react-native';
import notifee from '@notifee/react-native';
import App from './App';
import { name as appName } from './app.json';

// Register foreground service task before app component (Android only).
// The returned promise stays pending until RecordingService resolves it on stop.
// iOS uses UIBackgroundModes instead of foreground services.
if (Platform.OS === 'android') {
  notifee.registerForegroundService(() => {
    return new Promise((resolve) => {
      global.__stopForegroundService = resolve;
    });
  });
}

AppRegistry.registerComponent(appName, () => App);
