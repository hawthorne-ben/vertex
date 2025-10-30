/**
 * Notification Service
 *
 * Manages system notifications for recording status and connection state
 */

import notifee, { AndroidImportance, AndroidStyle, EventType } from '@notifee/react-native';
import { Platform } from 'react-native';

class NotificationService {
  private channelId = 'recording-status';
  private recordingNotificationId = 'recording-notification';
  private isInitialized = false;

  /**
   * Initialize notification channels
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    try {
      // Create notification channel for Android
      await notifee.createChannel({
        id: this.channelId,
        name: 'Recording Status',
        importance: AndroidImportance.LOW, // Low importance = no sound, persistent
        description: 'Shows recording status and device connection',
      });

      this.isInitialized = true;
      console.log('[NotificationService] Initialized');
    } catch (error) {
      console.error('[NotificationService] Failed to initialize:', error);
    }
  }

  /**
   * Request notification permissions (Android 13+)
   */
  async requestPermissions(): Promise<boolean> {
    if (Platform.OS !== 'android') return true;

    try {
      const settings = await notifee.requestPermission();
      return settings.authorizationStatus >= 1; // AUTHORIZED or PROVISIONAL
    } catch (error) {
      console.error('[NotificationService] Failed to request permissions:', error);
      return false;
    }
  }

  /**
   * Show or update persistent recording notification
   */
  async showRecordingNotification(
    isConnected: boolean,
    deviceName: string | null,
    recordingTime: string,
    sampleCount: number,
    deviceId?: string
  ): Promise<void> {
    await this.initialize();

    try {
      const connectionStatus = isConnected ? 'Connected' : 'Disconnected';
      const deviceText = deviceName || 'No device';

      await notifee.displayNotification({
        id: this.recordingNotificationId,
        title: `Recording - ${deviceText}`,
        body: `${connectionStatus} • ${recordingTime} • ${sampleCount.toLocaleString()} samples`,
        android: {
          channelId: this.channelId,
          importance: AndroidImportance.LOW,
          ongoing: true, // Makes it persistent (can't swipe away)
          onlyAlertOnce: true, // Don't make sound/vibration on updates
          style: {
            type: AndroidStyle.BIGTEXT,
            text: `${connectionStatus} • ${recordingTime} • ${sampleCount.toLocaleString()} samples`,
          },
          color: isConnected ? '#22c55e' : '#ef4444',
          progress: {
            indeterminate: true, // Shows recording in progress
          },
          pressAction: {
            id: 'open-record-screen',
            launchActivity: 'default', // Opens main activity
          },
          // Store device info for navigation
          data: {
            screen: 'Record',
            deviceId: deviceId || '',
            deviceName: deviceName || 'Unknown Device',
          },
        },
      });
    } catch (error) {
      console.error('[NotificationService] Failed to show recording notification:', error);
    }
  }

  /**
   * Update recording notification (more efficient than full display)
   */
  async updateRecordingNotification(
    isConnected: boolean,
    deviceName: string | null,
    recordingTime: string,
    sampleCount: number,
    deviceId?: string
  ): Promise<void> {
    // For now, just use the same method as show
    // Notifee will update existing notification with same ID
    await this.showRecordingNotification(isConnected, deviceName, recordingTime, sampleCount, deviceId);
  }

  /**
   * Hide persistent recording notification
   */
  async hideRecordingNotification(): Promise<void> {
    try {
      await notifee.cancelNotification(this.recordingNotificationId);
    } catch (error) {
      console.error('[NotificationService] Failed to hide recording notification:', error);
    }
  }

  /**
   * Show connection lost notification (one-time alert)
   */
  async showConnectionLostNotification(deviceName: string | null): Promise<void> {
    await this.initialize();

    try {
      const deviceText = deviceName || 'Device';

      await notifee.displayNotification({
        title: 'Connection Lost',
        body: `${deviceText} disconnected during recording`,
        android: {
          channelId: this.channelId,
          importance: AndroidImportance.HIGH, // High importance = sound/vibration
          color: '#ef4444',
        },
      });
    } catch (error) {
      console.error('[NotificationService] Failed to show connection lost notification:', error);
    }
  }

  /**
   * Show connection restored notification (one-time alert)
   */
  async showConnectionRestoredNotification(deviceName: string | null): Promise<void> {
    await this.initialize();

    try {
      const deviceText = deviceName || 'Device';

      await notifee.displayNotification({
        title: 'Connection Restored',
        body: `${deviceText} reconnected`,
        android: {
          channelId: this.channelId,
          importance: AndroidImportance.DEFAULT, // Default importance = sound but no heads-up
          color: '#22c55e',
        },
      });
    } catch (error) {
      console.error('[NotificationService] Failed to show connection restored notification:', error);
    }
  }

  /**
   * Cancel all notifications
   */
  async cancelAllNotifications(): Promise<void> {
    try {
      await notifee.cancelAllNotifications();
    } catch (error) {
      console.error('[NotificationService] Failed to cancel all notifications:', error);
    }
  }
}

export default new NotificationService();
