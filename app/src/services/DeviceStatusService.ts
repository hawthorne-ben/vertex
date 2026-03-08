/**
 * Device Status Service
 *
 * Centralized service for polling device status (connection, battery, sensor data)
 * Updates the deviceStore in real-time
 */

import BleService from './BleService';
import { useDeviceStore } from '../stores/deviceStore';

class DeviceStatusService {
  private pollingInterval: NodeJS.Timeout | null = null;
  private batteryPollingInterval: NodeJS.Timeout | null = null;
  private streamSubscription: any = null;
  private connectionListener: (() => void) | null = null;
  private isPolling = false;

  /**
   * Start monitoring device status
   */
  startMonitoring(deviceId: string, deviceName: string): void {
    if (this.isPolling) {
      console.warn('[DeviceStatusService] Already monitoring');
      return;
    }

    console.warn('[DeviceStatusService] Starting monitoring for', deviceName, deviceId);
    this.isPolling = true;

    // Set device info
    useDeviceStore.getState().setDevice(deviceId, deviceName);

    // Initial connection status
    const connectedDevice = BleService.getConnectedDevice();
    const isConnected = connectedDevice?.id === deviceId;
    console.warn('[DeviceStatusService] Initial connection status:', isConnected);
    useDeviceStore.getState().setConnectionStatus(isConnected);

    // Listen for immediate connection changes (in addition to polling)
    this.connectionListener = BleService.addConnectionListener((device, isConn) => {
      const monitoredDeviceId = useDeviceStore.getState().deviceId;
      console.log('[DeviceStatusService] Connection listener fired - device:', device?.id, 'isConn:', isConn, 'monitoredDeviceId:', monitoredDeviceId);

      if (device?.id === monitoredDeviceId || (!device && !isConn)) {
        // Update store immediately on connection/disconnection
        console.log('[DeviceStatusService] Updating store - isConnected:', isConn);
        useDeviceStore.getState().setConnectionStatus(isConn);

        // Clear device info on disconnect
        if (!isConn) {
          useDeviceStore.getState().setDevice(null, null);
        }
      } else {
        console.log('[DeviceStatusService] Ignoring connection event - device mismatch');
      }
    });

    // Monitor connection status (fallback polling for reliability)
    this.startConnectionPolling();

    // Monitor battery status
    this.startBatteryPolling();

    // Note: We DON'T start sensor stream here - RecordScreen manages its own stream
    // to avoid conflicts with recording
  }

  /**
   * Stop monitoring device status
   */
  stopMonitoring(): void {
    console.log('[DeviceStatusService] Stopping monitoring');
    this.isPolling = false;

    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }

    if (this.batteryPollingInterval) {
      clearInterval(this.batteryPollingInterval);
      this.batteryPollingInterval = null;
    }

    if (this.streamSubscription) {
      this.streamSubscription.remove();
      this.streamSubscription = null;
    }

    if (this.connectionListener) {
      this.connectionListener();
      this.connectionListener = null;
    }
  }

  /**
   * Poll connection status every 2 seconds
   */
  private startConnectionPolling(): void {
    const checkConnection = () => {
      try {
        const deviceId = useDeviceStore.getState().deviceId;
        if (!deviceId) return;

        // Check if connected device matches our deviceId
        const connectedDevice = BleService.getConnectedDevice();
        const isConnected = connectedDevice?.id === deviceId;

        useDeviceStore.getState().setConnectionStatus(isConnected);
      } catch (error: any) {
        console.warn('[DeviceStatusService] Connection check failed:', error.message);
        useDeviceStore.getState().setConnectionStatus(false);
        useDeviceStore.getState().setConnectionError(error.message);
      }
    };

    // Initial check
    checkConnection();

    // Poll every 2 seconds
    this.pollingInterval = setInterval(checkConnection, 2000);
  }

  /**
   * Poll battery status every 10 seconds
   */
  private startBatteryPolling(): void {
    const checkBattery = async () => {
      try {
        const deviceId = useDeviceStore.getState().deviceId;
        if (!deviceId) return;

        const batteryLevel = await BleService.readBatteryLevel();
        if (batteryLevel !== null) {
          // BleService only returns percentage, not voltage
          useDeviceStore.getState().setBattery(batteryLevel, null);
        }
      } catch (error: any) {
        console.warn('[DeviceStatusService] Battery read failed:', error.message);
      }
    };

    // Initial check
    checkBattery();

    // Poll every 10 seconds
    this.batteryPollingInterval = setInterval(checkBattery, 10000);
  }

  /**
   * Check if currently monitoring
   */
  isMonitoring(): boolean {
    return this.isPolling;
  }
}

export default new DeviceStatusService();
