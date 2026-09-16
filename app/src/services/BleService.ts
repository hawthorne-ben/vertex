/**
 * BLE Service for IMU Device Communication
 *
 * Handles:
 * - BLE device scanning
 * - Connection management
 * - Data subscription and reception
 * - Sensor polling for readings
 */

import { BleManager, Device, Characteristic, Service } from 'react-native-ble-plx';

// Standard BLE Service UUIDs
const HEART_RATE_SERVICE = '0000180d-0000-1000-8000-00805f9b34fb';
const HEART_RATE_MEASUREMENT = '00002a37-0000-1000-8000-00805f9b34fb';
const BATTERY_SERVICE = '0000180f-0000-1000-8000-00805f9b34fb';
const BATTERY_LEVEL = '00002a19-0000-1000-8000-00805f9b34fb';

// IMU Device UUIDs (matches firmware sensor_notify)
const IMU_SERVICE_UUID = '12345678-1234-5678-1234-56789abcdef0';
const IMU_CHARACTERISTIC_UUID = '12345678-1234-5678-1234-56789abcdef1';
const CONFIG_CHARACTERISTIC_UUID = '12345678-1234-5678-1234-56789abcdef2';

// V2 additional characteristics (same service UUID)
const V2_FILE_LIST_CHARACTERISTIC_UUID = '12345678-1234-5678-1234-56789abcdef3';

// V2 commands (matches firmware V2)
const CMD_V2_GET_STATUS = 0x01;
const CMD_V2_START_RECORDING = 0x02;
const CMD_V2_STOP_RECORDING = 0x03;
const CMD_V2_LIST_FILES = 0x04;
const CMD_V2_DELETE_FILE = 0x06;
const CMD_V2_SET_WIFI = 0x08;
const CMD_V2_SYNC_CLOCK = 0x09;
const CMD_V2_SET_USER = 0x0B;
const CMD_V2_START_SYNC = 0x0C;
const CMD_V2_CANCEL_SYNC = 0x0D;
const CMD_V2_LOG_READ = 0x0f;
const CMD_V2_LOG_SET_LEVEL = 0x10;
const CMD_V2_LOG_STATUS = 0x11;
const CMD_V2_LOG_CLEAR = 0x12;

// Diagnostic log severities. Values are the firmware's wire contract
// (log_ring.h) — persisted in NVS and sent over BLE, so append only.
export const V2_LOG_LEVELS = ['DEBUG', 'INFO', 'WARN', 'ERROR'] as const;
export type V2LogLevel = (typeof V2_LOG_LEVELS)[number];
const CMD_V2_TIME_RESPONSE = 0x0E;

// Device → phone notification opcodes on the file-list characteristic
const NOTIFY_TIME_REQUEST = 0xf0;
// [0xF1][next_pos u64][gap u64][total u64][min_level u8][len u8][text] — the
// device's diagnostic-log reply. Shares the file-list characteristic with
// listings and time requests, so every consumer must check the leading opcode.
const NOTIFY_LOG_DATA = 0xf1;

export interface V2SyncProgress {
  currentFile: number;
  totalFiles: number;
  bytesSent: number;
  bytesTotal: number;
  result: 'in_progress' | 'success' | 'error';
}

export interface V2RecordingInfo {
  elapsedSecs: number;
  fileBytes: number;
}

export interface V2Status {
  state: 'idle' | 'recording' | 'uploading' | 'fault';
  batteryMv: number;
  fileCount: number;
  freeMb: number;
  clockSynced: boolean;
  sdOk: boolean;
  imuOk: boolean;
  /** Card below SD_WARN_MB (~12 h of recording left at 10 MB/hour). */
  spaceLow: boolean;
  /** Card below SD_CRITICAL_MB — the device stops recording at this point. */
  spaceCritical: boolean;
  accel?: { x: number; y: number; z: number }; // milli-g
  syncProgress?: V2SyncProgress;
  recordingInfo?: V2RecordingInfo;
}

/** One chunk of the device's diagnostic ring. */
export interface V2LogChunk {
  /** Position to pass to the next read, in total_written space. */
  nextPos: bigint;
  /** Bytes overwritten before this reader saw them. Nonzero means data lost. */
  gap: bigint;
  /** Bytes the device has ever written — monotonic across reboots and wraps. */
  totalWritten: bigint;
  /** Minimum severity the device is currently persisting to SD. */
  minLevel: number;
  /** Decoded text. Always ends on a complete line; may be empty. */
  text: string;
}

export interface V2FileEntry {
  name: string;
  size: number;
  synced: boolean;
}

type ConnectionListener = (device: Device | null, isConnected: boolean) => void;

class BleService {
  private manager: BleManager;
  private connectedDevice: Device | null = null;
  private activeSubscriptions: any[] = [];
  // The one and only clock-sync responder subscription. Ownership lives here,
  // in the service, for the lifetime of the connection — NOT in a screen.
  //
  // Why this must be a singleton: Subscription.remove() from
  // react-native-ble-plx calls cancelTransaction(), which tears down the
  // notification setup for the whole characteristic. There is no refcounting
  // across two transactions on the same characteristic, so if two monitors are
  // registered on V2_FILE_LIST_CHARACTERISTIC_UUID, whichever is removed first
  // silently disables notifications for the survivor too. The survivor's JS
  // listener stays registered and its subscription object still looks alive,
  // so nothing reports an error — the device simply stops being heard.
  //
  // That is the 2026-09-13 ride: 98 consecutive sync timeouts with BLE
  // connected and the 2 Hz status poll (a different characteristic) flowing
  // normally, ending only when a full reconnect rebuilt the CCCD, after which
  // 101 consecutive syncs succeeded. See notes/VALIDATION_PLAN.md.
  private timeResponderUnsub: (() => void) | null = null;
  private isHandlingDisconnection: boolean = false;
  private isConnecting: boolean = false;
  private connectionListeners: ConnectionListener[] = [];

  constructor() {
    this.manager = new BleManager();

    // Set up global error handler to prevent crashes
    this.manager.setLogLevel('Verbose');

    // Add global error handler for BLE errors
    // This prevents crashes from unhandled disconnection errors
    if (global.ErrorUtils) {
      const originalHandler = global.ErrorUtils.getGlobalHandler();
      global.ErrorUtils.setGlobalHandler((error: any, isFatal?: boolean) => {
        const errorMsg = error?.message || '';
        const errorName = error?.name || '';

        // Check if this is a BLE-related error that should not crash the app
        if (errorMsg.includes('DisconnectionRouter') ||
            errorMsg.includes('CompositeException') ||
            errorMsg.includes('BleDisconnectedException') ||
            errorMsg.includes('NullPointerException') && errorMsg.includes('PromiseImpl') ||
            errorMsg.includes('SafePromise') ||
            errorMsg.includes('BlePlxModule') ||
            errorMsg.includes('monitorCharacteristic') ||
            errorName === 'CompositeException' ||
            errorName === 'BleError') {
          console.log('Caught BLE error (prevented crash):', errorMsg || errorName);
          // Don't crash - just handle the disconnection gracefully
          if (this.connectedDevice) {
            this.cleanupSubscriptions();
            this.connectedDevice = null;
            this.notifyConnectionListeners(null, false);
          }
          return;
        }
        // For other errors, call the original handler
        if (originalHandler) {
          originalHandler(error, isFatal);
        }
      });
    }
  }

  /**
   * Add a connection state listener
   */
  addConnectionListener(listener: ConnectionListener): () => void {
    this.connectionListeners.push(listener);
    // Immediately notify with current state
    listener(this.connectedDevice, this.connectedDevice !== null);
    // Return unsubscribe function
    return () => {
      const index = this.connectionListeners.indexOf(listener);
      if (index > -1) {
        this.connectionListeners.splice(index, 1);
      }
    };
  }

  /**
   * Notify all listeners of connection state change
   */
  private notifyConnectionListeners(device: Device | null, isConnected: boolean): void {
    console.log('[BLE] Notifying listeners - isConnected:', isConnected, 'device:', device?.name);
    for (const listener of this.connectionListeners) {
      try {
        listener(device, isConnected);
      } catch (error) {
        console.error('[BLE] Error in connection listener:', error);
      }
    }
  }

  /**
   * Clean up all active subscriptions.
   *
   * Every caller is a connection ending or being replaced, so the clock-sync
   * responder goes with them — its monitor belongs to the device that is going
   * away. ensureTimeResponder() re-registers it on the next connect.
   */
  private cleanupSubscriptions(): void {
    this.teardownTimeResponder();
    for (const subscription of this.activeSubscriptions) {
      try {
        if (subscription && typeof subscription.remove === 'function') {
          subscription.remove();
        }
      } catch (error) {
        // Ignore cleanup errors
      }
    }
    this.activeSubscriptions = [];
  }

  /**
   * Check if a device is a Vertex IMU device
   */
  isVertexDevice(device: Device): boolean {
    return device.name?.includes('Vertex') || device.name === 'Vertex-IMU';
  }

  /**
   * Check if a device is a V2 firmware device
   */
  isV2Device(device: Device): boolean {
    return device.name?.includes('Vertex-V2') ?? false;
  }

  /**
   * Check if the currently connected device is V2
   */
  isV2Connected(): boolean {
    return this.connectedDevice?.name?.includes('Vertex-V2') ?? false;
  }

  /**
   * Scan for BLE devices
   * @param onDeviceFound Callback when a device is found
   */
  async scanForDevices(onDeviceFound: (device: Device) => void): Promise<void> {
    try {
      const state = await this.manager.state();

      if (state !== 'PoweredOn') {
        console.error('Bluetooth is not powered on. Current state:', state);
        return;
      }

      this.manager.startDeviceScan(null, null, (error, device) => {
        if (error) {
          console.error('Scan error:', error.message);
          return;
        }

        if (device) {
          // Log EVERY device discovered for debugging
          console.log('[BLE SCAN] Device found:', device.name || 'UNNAMED', 'ID:', device.id);
          onDeviceFound(device);
        }
      });
    } catch (error) {
      console.error('Failed to start scan:', error);
    }
  }

  /**
   * Stop scanning for devices
   */
  stopScanning(): void {
    this.manager.stopDeviceScan();
  }

  /**
   * Connect to a specific device
   * @param deviceId The ID of the device to connect to
   */
  async connectToDevice(deviceId: string): Promise<Device> {
    try {
      // Prevent multiple simultaneous connection attempts
      if (this.isConnecting) {
        console.warn('[BLE] Already connecting, rejecting new attempt');
        throw new Error('Connection already in progress');
      }

      this.isConnecting = true;
      console.log('[BLE] Connecting to device:', deviceId);

      // Check if already connected to this device
      if (this.connectedDevice?.id === deviceId) {
        console.log('[BLE] Already connected to this device');
        try {
          const isConnected = await this.connectedDevice.isConnected().catch(() => false);
          if (isConnected) {
            console.log('[BLE] Device is still connected, reusing connection');
            this.isConnecting = false;
            return this.connectedDevice;
          }
        } catch (checkError) {
          console.warn('[BLE] Error checking connection status:', checkError);
        }
        console.log('[BLE] Device was disconnected, cleaning up');
        this.connectedDevice = null;
      }

      // If connected to a different device, just clear the reference
      // Don't call disconnect() as it might trigger native crashes
      if (this.connectedDevice && this.connectedDevice.id !== deviceId) {
        console.log('[BLE] Clearing previous device connection');
        this.cleanupSubscriptions();
        this.connectedDevice = null;
      }

      // Use the library's built-in timeout option (5 seconds)
      // This avoids race conditions with manual Promise.race() timeouts
      const device = await this.manager.connectToDevice(deviceId, {
        timeout: 5000,
      }).catch((err: any) => {
        this.isConnecting = false;
        // Handle the error properly - the library should provide an error object
        const errorMessage = err?.message || err?.toString() || 'Connection failed';
        throw new Error(errorMessage);
      });

      this.connectedDevice = device;
      console.log('[BLE] Device connected successfully');

      // Request larger MTU for 56-byte sensor data packets
      try {
        await device.requestMTU(185);
        console.log('[BLE] MTU negotiated');
      } catch (mtuError: any) {
        console.warn('[BLE] MTU negotiation failed:', mtuError?.message);
      }

      // Set up disconnection handler with error boundary
      try {
        device.onDisconnected((error, disconnectedDevice) => {
          try {
            if (this.isHandlingDisconnection) {
              return;
            }
            this.isHandlingDisconnection = true;

            if (error) {
              console.log('[BLE] Device disconnected:', error.message);
            } else {
              console.log('[BLE] Device disconnected normally');
            }

            this.cleanupSubscriptions();
            this.connectedDevice = null;

            // Notify listeners of disconnection
            this.notifyConnectionListeners(null, false);

            setTimeout(() => {
              this.isHandlingDisconnection = false;
            }, 100);
          } catch (handlerError) {
            console.error('[BLE] Disconnect handler error:', handlerError);
          }
        });
      } catch (setupError) {
        console.error('[BLE] Failed to setup disconnect handler:', setupError);
      }

      // Discover services with error handling
      try {
        await device.discoverAllServicesAndCharacteristics();
        console.log('[BLE] Services discovered');
      } catch (discoverError: any) {
        console.error('[BLE] Service discovery error:', discoverError?.message);
        // Continue anyway - some devices work without full discovery
      }

      // Auto clock sync for V2 devices
      if (this.isV2Device(device)) {
        try {
          await this.syncClockV2();
          console.log('[BLE] V2 clock synced on connect');
        } catch (syncError: any) {
          console.warn('[BLE] V2 clock sync failed:', syncError?.message);
        }

        // Answer periodic clock-sync requests for as long as we stay
        // connected (VTX v1.2). Registered here rather than on-demand so a
        // recording started from the device button is still covered.
        //
        // Deliberately NOT pushed onto activeSubscriptions: that array is
        // cleaned up on several paths that are not true disconnects, and
        // removing this monitor disables notifications on the characteristic
        // for any other monitor too. Its lifetime is managed explicitly by
        // ensureTimeResponder/teardownTimeResponder instead.
        this.ensureTimeResponder();
      }

      // Notify listeners AFTER services discovered and clock synced
      // so that refreshAll() sees the fully-ready connection
      this.notifyConnectionListeners(device, true);

      this.isConnecting = false; // Clear flag on success
      return device;
    } catch (error: any) {
      console.error('[BLE] Connection error:', error?.message || error);
      this.connectedDevice = null;
      this.isConnecting = false; // Clear flag on error

      // Ensure we always throw a proper Error object
      const errorMessage = error?.message || error?.toString() || 'Unknown connection error';
      throw new Error(`Failed to connect: ${errorMessage}`);
    }
  }

  /**
   * Subscribe to IMU notifications for continuous streaming
   * Subscribes to the IMU characteristic and receives automatic 1Hz updates
   * @param onDataReceived Callback when IMU data is received (parsed IMU data)
   * @param onError Optional callback for errors
   * @returns Subscription object with remove() method
   */
  async subscribeToIMUStream(
    onDataReceived: (data: any) => void,
    onError?: (error: Error) => void
  ): Promise<any> {
    if (!this.connectedDevice) {
      throw new Error('No device connected');
    }

    // Reset notification tracking
    this.lastNotificationTime = 0;
    this.notificationCount = 0;
    this.notificationRates = [];

    try {
      const services = await this.manager.servicesForDevice(this.connectedDevice.id);
      const hasIMUService = services.some(s => s.uuid.toLowerCase() === IMU_SERVICE_UUID.toLowerCase());

      if (!hasIMUService) {
        throw new Error('IMU service not available. Device may not be a Vertex IMU.');
      }

      let subscription: any = null;

      try {
        subscription = this.connectedDevice.monitorCharacteristicForService(
          IMU_SERVICE_UUID,
          IMU_CHARACTERISTIC_UUID,
          (error, characteristic) => {
            // Wrap entire callback in try-catch to prevent native crashes
            try {
              if (error) {
                const errorMsg = error.message || 'Unknown BLE error';

                // Filter out expected cancellation errors (normal cleanup)
                const isCancellation =
                  errorMsg.includes('cancelled') ||
                  errorMsg.includes('Cancelled') ||
                  errorMsg.includes('canceled') ||
                  errorMsg.includes('Canceled');

                // Only log unexpected errors
                if (!isCancellation) {
                  console.error('[BLE] Stream error:', errorMsg);
                }

                // Clean up subscription on error
                if (subscription) {
                  try {
                    const index = this.activeSubscriptions.indexOf(subscription);
                    if (index > -1) {
                      this.activeSubscriptions.splice(index, 1);
                    }
                    subscription.remove();
                  } catch (cleanupError) {
                    // Ignore cleanup errors
                  }
                }

                // Only notify caller of unexpected errors (not cancellations)
                if (onError && !isCancellation) {
                  onError(new Error(`Stream error: ${errorMsg}`));
                }
                return;
              }

              if (characteristic?.value) {
                try {
                  const data = this.base64ToUint8Array(characteristic.value);
                  const parsedData = this.parseIMU(data);
                  onDataReceived(parsedData);
                } catch (parseError: any) {
                  // Log and skip malformed packets — don't propagate to onError
                  // since parse errors are transient (e.g. partial BLE notification)
                  console.warn('[BLE] Skipping malformed packet:', parseError.message);
                }
              }
            } catch (callbackError: any) {
              // Catch any errors in the callback to prevent crashes
              console.error('[BLE] Callback error (prevented crash):', callbackError.message);
              if (onError) {
                try {
                  onError(new Error('BLE callback error'));
                } catch (e) {
                  // Ignore errors in error handler
                }
              }
            }
          }
        );

        if (subscription) {
          this.activeSubscriptions.push(subscription);
          return subscription; // Return the subscription object
        } else {
          throw new Error('Failed to create subscription');
        }
      } catch (monitorError: any) {
        // If monitorCharacteristicForService itself throws, handle it
        console.error('[BLE] Monitor setup error:', monitorError.message);
        throw new Error(`Failed to setup monitoring: ${monitorError.message}`);
      }
    } catch (error: any) {
      console.error('[BLE] Subscription error:', error.message);
      throw new Error(`Failed to subscribe to IMU stream: ${error.message}`);
    }
  }

  /**
   * Subscribe to characteristic notifications (legacy method)
   * @param onDataReceived Callback when data is received
   */
  async subscribeToData(onDataReceived: (data: Uint8Array) => void): Promise<void> {
    if (!this.connectedDevice) {
      throw new Error('No device connected');
    }

    try {
      const subscription = this.connectedDevice.monitorCharacteristicForService(
        IMU_SERVICE_UUID,
        IMU_CHARACTERISTIC_UUID,
        (error, characteristic) => {
          if (error) {
            console.error('Characteristic monitoring error:', error);
            return;
          }

          if (characteristic?.value) {
            try {
              const data = this.base64ToUint8Array(characteristic.value);
              onDataReceived(data);
            } catch (parseError) {
              console.error('Error parsing characteristic data:', parseError);
            }
          }
        }
      );

      this.activeSubscriptions.push(subscription);
    } catch (error) {
      console.error('Subscription error:', error);
      throw error;
    }
  }

  /**
   * List all available services and characteristics on the connected device
   */
  async listAvailableServices(): Promise<string[]> {
    if (!this.connectedDevice) {
      throw new Error('No device connected');
    }

    try {
      await new Promise(resolve => setTimeout(resolve, 500));

      const services = await this.manager.servicesForDevice(this.connectedDevice.id);
      return services.map(s => s.uuid);
    } catch (error) {
      console.error('Error listing services:', error);
      return [];
    }
  }

  /**
   * Poll sensor for a single reading
   * Attempts to read from available sensors (HR for Whoop, IMU for custom device)
   */
  async pollSensor(): Promise<any> {
    if (!this.connectedDevice) {
      throw new Error('No device connected');
    }

    console.log('Polling sensor...');

    try {
      // Try to read IMU data first (most common use case)
      const imuData = await this.readIMU();
      if (imuData) {
        return imuData;
      }
    } catch (error: any) {
      console.log('IMU data not available:', error?.message);
    }

    try {
      // Try to read heart rate (for Whoop or HR devices)
      const heartRateData = await this.readHeartRate();
      if (heartRateData) {
        return heartRateData;
      }
    } catch (error: any) {
      console.log('Heart rate not available:', error?.message);
    }

    // If nothing worked, throw error
    throw new Error('No sensor data available. Device may not have readable sensors.');
  }

  /**
   * Read heart rate from device (Whoop, fitness trackers)
   * Uses notification/indication if read is not supported
   */
  private async readHeartRate(): Promise<any> {
    if (!this.connectedDevice) {
      throw new Error('No device connected');
    }

    try {
      // Make sure services are discovered
      await this.connectedDevice.discoverAllServicesAndCharacteristics();

      // Check if the device has the heart rate service
      const services = await this.connectedDevice.services();
      const hrService = services.find(s => s.uuid.toLowerCase() === HEART_RATE_SERVICE.toLowerCase());

      if (!hrService) {
        console.log('Heart rate service not found in available services');
        throw new Error('Heart rate service not available');
      }

      // Check if the characteristic exists
      const characteristics = await hrService.characteristics();
      const hrChar = characteristics.find(c => c.uuid.toLowerCase() === HEART_RATE_MEASUREMENT.toLowerCase());

      if (!hrChar) {
        console.log('Heart rate measurement characteristic not found');
        throw new Error('Heart rate characteristic not available');
      }

      console.log('Heart rate characteristic found. Readable:', hrChar.isReadable, 'Notifiable:', hrChar.isNotifiable);

      // If readable, try to read directly
      if (hrChar.isReadable) {
        const value = await hrChar.read();
        if (value.value) {
          const data = this.base64ToUint8Array(value.value);
          return this.parseHeartRate(data);
        }
      }

      // If notifiable, subscribe and wait for one notification
      if (hrChar.isNotifiable || hrChar.isIndicatable) {
        console.log('Using notification method to get heart rate');

        return new Promise((resolve, reject) => {
          let isResolved = false;

          const timeout = setTimeout(() => {
            if (!isResolved) {
              isResolved = true;
              reject(new Error('Timeout waiting for heart rate notification. Make sure the device is actively measuring.'));
            }
          }, 10000); // 10 second timeout

          hrChar.monitor((error, characteristic) => {
            if (isResolved) return; // Already handled

            if (error) {
              clearTimeout(timeout);
              isResolved = true;
              reject(error);
              return;
            }

            if (characteristic?.value) {
              clearTimeout(timeout);
              isResolved = true;

              const data = this.base64ToUint8Array(characteristic.value);
              resolve(this.parseHeartRate(data));
            }
          });

          // Note: We don't manually remove the subscription
          // Let it clean up naturally to avoid crashes
        });
      }

      throw new Error('Heart rate characteristic does not support read or notify');
    } catch (error: any) {
      console.log('Heart rate read error:', error?.message || 'Unknown error');
      throw new Error('Heart rate service not available: ' + (error?.message || 'Unknown error'));
    }
  }

  /**
   * Parse heart rate measurement data
   * Format: https://www.bluetooth.com/specifications/specs/heart-rate-service-1-0/
   */
  private parseHeartRate(data: Uint8Array): any {
    if (data.length < 2) {
      throw new Error('Invalid heart rate data');
    }

    const flags = data[0];
    const hrFormat = flags & 0x01; // 0 = uint8, 1 = uint16
    const sensorContact = (flags >> 1) & 0x03; // Sensor contact status
    const contactDetected = sensorContact === 3;

    let heartRate: number;
    if (hrFormat === 0) {
      // Heart rate as uint8
      heartRate = data[1];
    } else {
      // Heart rate as uint16 (little endian)
      heartRate = data[1] | (data[2] << 8);
    }

    console.log(`Heart Rate: ${heartRate} BPM, Contact: ${contactDetected}`);

    return {
      heartRate,
      contactDetected,
      raw: Array.from(data).map(b => b.toString(16).padStart(2, '0')).join(' '),
    };
  }

  /**
   * Read battery level from device
   */
  async readBatteryLevel(): Promise<number | null> {
    if (!this.connectedDevice) {
      return null;
    }

    try {
      // First check if the device has the battery service
      const services = await this.connectedDevice.services();
      const hasBatteryService = services.some(s => s.uuid.toLowerCase() === BATTERY_SERVICE.toLowerCase());

      if (!hasBatteryService) {
        console.log('Battery service not available on this device');
        return null;
      }

      const characteristic = await this.connectedDevice.readCharacteristicForService(
        BATTERY_SERVICE,
        BATTERY_LEVEL
      );

      if (!characteristic.value) {
        return null;
      }

      const data = this.base64ToUint8Array(characteristic.value);
      const batteryLevel = data[0]; // Battery level is a single uint8 (0-100%)

      console.log(`Battery Level: ${batteryLevel}%`);
      return batteryLevel;
    } catch (error: any) {
      console.log('Battery service error:', error?.message || 'Unknown error');
      return null;
    }
  }

  /**
   * Read IMU sensor data via notification (for custom IMU device)
   * Subscribes to notifications and waits for one packet
   */
  private async readIMU(): Promise<any> {
    if (!this.connectedDevice) {
      throw new Error('No device connected');
    }

    try {
      // Check if device is still connected
      const isConnected = await this.connectedDevice.isConnected();
      if (!isConnected) {
        throw new Error('Device is not connected');
      }

      // First check if the device has the IMU service
      const services = await this.manager.servicesForDevice(this.connectedDevice.id);
      const hasIMUService = services.some(s => s.uuid.toLowerCase() === IMU_SERVICE_UUID.toLowerCase());

      if (!hasIMUService) {
        throw new Error('IMU service not available. Device may not be a Vertex IMU.');
      }

      console.log('Subscribing to IMU notifications...');

      return new Promise((resolve, reject) => {
        let isResolved = false;
        let subscription: any = null;

        const cleanup = () => {
          if (subscription) {
            try {
              // Remove from active subscriptions list
              const index = this.activeSubscriptions.indexOf(subscription);
              if (index > -1) {
                this.activeSubscriptions.splice(index, 1);
              }
              subscription.remove();
            } catch (e) {
              console.log('Subscription cleanup error (safe to ignore):', e);
            }
            subscription = null;
          }
        };

        const timeout = setTimeout(() => {
          if (!isResolved) {
            isResolved = true;
            cleanup();
            reject(new Error('Timeout waiting for sensor data. Device may have disconnected or is not responding.'));
          }
        }, 5000); // 5 second timeout

        try {
          subscription = this.connectedDevice!.monitorCharacteristicForService(
            IMU_SERVICE_UUID,
            IMU_CHARACTERISTIC_UUID,
            (error, characteristic) => {
              if (isResolved) return; // Already handled

              if (error) {
                clearTimeout(timeout);
                isResolved = true;
                cleanup();
                const errorMsg = error.message || 'Unknown BLE error';
                // Check if it's a disconnection error
                if (errorMsg.toLowerCase().includes('disconnect') ||
                    errorMsg.toLowerCase().includes('not connected')) {
                  reject(new Error('Device disconnected'));
                } else {
                  reject(new Error(`BLE error: ${errorMsg}`));
                }
                return;
              }

              if (characteristic?.value) {
                clearTimeout(timeout);
                isResolved = true;

                const data = this.base64ToUint8Array(characteristic.value);
                console.log(`Received IMU data: ${data.length} bytes`);

                // Clean up subscription before resolving
                cleanup();
                resolve(this.parseIMU(data));
              }
            }
          );

          // Track this subscription
          if (subscription) {
            this.activeSubscriptions.push(subscription);
          }

          // IMPORTANT: Trigger a read to activate the onRead callback in firmware
          // The firmware only sends data when read is requested
          console.log('Triggering read to request sensor data...');
          this.connectedDevice!.readCharacteristicForService(
            IMU_SERVICE_UUID,
            IMU_CHARACTERISTIC_UUID
          ).then((char) => {
            console.log('Read triggered successfully, notification should follow');
          }).catch((readError) => {
            console.log('Read trigger error (firmware will handle via notification):', readError?.message);
            // Don't reject here - the notification callback will handle the response
          });
        } catch (subError: any) {
          clearTimeout(timeout);
          if (!isResolved) {
            isResolved = true;
            reject(new Error(`Failed to subscribe: ${subError?.message || 'Unknown error'}`));
          }
        }
      });
    } catch (error: any) {
      console.log('IMU read error:', error?.message || 'Unknown error');
      throw new Error('IMU service not available: ' + (error?.message || 'Unknown error'));
    }
  }

  /**
   * Parse IMU sensor data
   *
   * FIRMWARE FORMAT (47 bytes - 6DoF, no magnetometer):
   * - Timestamp (4 bytes) - uint32_t milliseconds since boot
   * - Euler Angles (12 bytes) - 3x float (roll, pitch, yaw in degrees)
   * - Acceleration (12 bytes) - 3x float (x, y, z in m/s²)
   * - Gyroscope (12 bytes) - 3x float (x, y, z in deg/s)
   * - Calibration (3 bytes) - 3x uint8_t (sys, gyro, accel: 0-3)
   * - Battery Voltage (4 bytes) - float (volts)
   *
   * NOTE: Magnetometer removed - using 6DoF mode for cleaner orientation
   * Yaw drift will be corrected using GPS velocity in post-processing
   */
  // Performance tracking for 10Hz validation
  private lastNotificationTime: number = 0;
  private notificationCount: number = 0;
  private notificationRates: number[] = [];

  private parseIMU(data: Uint8Array): any {
    if (data.length < 47) {
      throw new Error(`Invalid IMU data length: ${data.length} bytes (expected 47)`);
    }

    // Track notification rate for 10Hz validation
    const now = Date.now();
    if (this.lastNotificationTime > 0) {
      const deltaMs = now - this.lastNotificationTime;
      if (deltaMs > 0) {
        const rate = 1000 / deltaMs; // Hz
        this.notificationRates.push(rate);
      }

      // Keep last 50 samples for average calculation
      if (this.notificationRates.length > 50) {
        this.notificationRates.shift();
      }
    }
    this.lastNotificationTime = now;
    this.notificationCount++;

    // Create DataView for easier parsing
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    let offset = 0;

    // Timestamp (4 bytes)
    const timestamp = view.getUint32(offset, true); // little endian
    offset += 4;

    // Euler angles (12 bytes)
    const roll = view.getFloat32(offset, true);
    offset += 4;
    const pitch = view.getFloat32(offset, true);
    offset += 4;
    const yaw = view.getFloat32(offset, true);
    offset += 4;

    // Acceleration (12 bytes)
    const accelX = view.getFloat32(offset, true);
    offset += 4;
    const accelY = view.getFloat32(offset, true);
    offset += 4;
    const accelZ = view.getFloat32(offset, true);
    offset += 4;

    // Gyroscope (12 bytes)
    const gyroX = view.getFloat32(offset, true);
    offset += 4;
    const gyroY = view.getFloat32(offset, true);
    offset += 4;
    const gyroZ = view.getFloat32(offset, true);
    offset += 4;

    // Magnetometer removed - using 6DoF mode

    // Calibration (3 bytes - no mag calibration)
    const calSys = data[offset++];
    const calGyro = data[offset++];
    const calAccel = data[offset++];

    // Battery voltage (4 bytes)
    const batteryVoltage = view.getFloat32(offset, true);
    offset += 4;

    // Log every 10th packet (1Hz logging at 10Hz rate)
    if (this.notificationCount % 10 === 0) {
      const avgRate = this.notificationRates.length > 0
        ? (this.notificationRates.reduce((a, b) => a + b, 0) / this.notificationRates.length).toFixed(1)
        : '0.0';

      console.log(
        `[${timestamp}] @${avgRate}Hz | ` +
        `Euler: R=${roll.toFixed(1)}° P=${pitch.toFixed(1)}° Y=${yaw.toFixed(1)}° | ` +
        `Accel: ${accelX.toFixed(2)},${accelY.toFixed(2)},${accelZ.toFixed(2)} | ` +
        `Gyro: ${gyroX.toFixed(2)},${gyroY.toFixed(2)},${gyroZ.toFixed(2)} | ` +
        `Cal: S=${calSys} G=${calGyro} A=${calAccel} | ` +
        `Batt: ${batteryVoltage.toFixed(2)}V`
      );
    }

    return {
      timestamp,
      roll,
      pitch,
      yaw,
      accelX,
      accelY,
      accelZ,
      gyroX,
      gyroY,
      gyroZ,
      // Magnetometer removed - using 6DoF mode
      calibration: {
        system: calSys,
        gyro: calGyro,
        accel: calAccel,
        // mag removed
      },
      batteryVoltage,
      raw: Array.from(data).map(b => b.toString(16).padStart(2, '0')).join(' '),
    };
  }

  /**
   * Convert base64 string to Uint8Array
   */
  private base64ToUint8Array(base64: string): Uint8Array {
    const binaryString = atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes;
  }

  /**
   * Convert unsigned 16-bit integer to signed
   */
  private signedInt16(value: number): number {
    return value > 32767 ? value - 65536 : value;
  }

  // --- V2 Device Methods ---

  /**
   * Sync clock with V2 device — sends current timestamp
   */
  async syncClockV2(): Promise<void> {
    if (!this.connectedDevice) throw new Error('No device connected');

    const now = BigInt(Date.now());
    const command = new Uint8Array(9);
    command[0] = CMD_V2_SYNC_CLOCK;
    const view = new DataView(command.buffer);
    view.setBigInt64(1, now, true); // little-endian int64

    await this.writeConfigCommand(command);
  }

  /**
   * Respond to periodic clock-sync requests from a V2 device (VTX v1.2).
   *
   * The device notifies [0xF0][t1 uint32] every 60s while recording; we reply
   * with [0x0E][t2 int64][t3 int64] where t2 is the moment the request was
   * observed and t3 the moment the reply is handed to the BLE stack. The
   * device pairs these with its own t1/t4 to cancel transport delay.
   *
   * Timing is the whole point of this handler, so it does as little as
   * possible between the two stamps and never awaits anything before t3.
   *
   * PRIVATE AND IDEMPOTENT. Call ensureTimeResponder() instead — a second
   * monitor on this characteristic does not add redundancy, it creates a
   * second transaction whose teardown disables the first (see
   * timeResponderUnsub). Callers outside the service have no way to know
   * whether one is already live, which is why this is no longer public.
   */
  private subscribeToTimeRequests(): () => void {
    if (!this.connectedDevice) return () => {};

    const subscription = this.connectedDevice.monitorCharacteristicForService(
      IMU_SERVICE_UUID,
      V2_FILE_LIST_CHARACTERISTIC_UUID,
      (error, characteristic) => {
        // t2 first — before base64 decode, before any branching. Anything
        // done ahead of this is charged to the device's measured RTT.
        const t2 = Date.now();
        if (error || !characteristic?.value) return;

        const data = this.base64ToUint8Array(characteristic.value);
        // Not a time request — this characteristic also carries file listings.
        if (data.length < 1 || data[0] !== NOTIFY_TIME_REQUEST) return;

        // Build the reply, stamp t3 as late as possible, and fire. We do not
        // await the write before stamping: awaiting would put the BLE write
        // latency inside the phone's own reported processing window, which is
        // exactly the quantity t3 - t2 is supposed to exclude.
        const reply = new Uint8Array(17);
        reply[0] = CMD_V2_TIME_RESPONSE;
        const view = new DataView(reply.buffer);
        view.setBigInt64(1, BigInt(t2), true);

        const t3 = Date.now();
        view.setBigInt64(9, BigInt(t3), true);

        this.writeConfigCommand(reply).catch((err) => {
          // A dropped reply just means the device records a miss, which it
          // treats as normal. Nothing to recover here.
          console.warn('[BLE] Time response write failed:', err?.message);
        });
      }
    );

    return () => subscription?.remove();
  }

  /**
   * Ensure the clock-sync responder is live. Safe to call any number of times
   * from anywhere: if one is already registered this is a no-op, so a screen
   * mounting, remounting, or navigating back never creates a second monitor.
   *
   * This is the ONLY supported way to start the responder.
   */
  ensureTimeResponder(): void {
    if (this.timeResponderUnsub) return;   // already live — do not double-subscribe
    if (!this.connectedDevice) return;     // nothing to subscribe to yet
    if (!this.isV2Device(this.connectedDevice)) return;

    try {
      this.timeResponderUnsub = this.subscribeToTimeRequests();
      console.log('[BLE] V2 time-request responder active');
    } catch (error: any) {
      // Non-fatal: the device treats an unanswered request as a normal miss.
      this.timeResponderUnsub = null;
      console.warn('[BLE] Time responder setup failed:', error?.message);
    }
  }

  /**
   * Tear down the clock-sync responder. Only the disconnect path should call
   * this — a screen going away is NOT a reason to stop answering the device,
   * which keeps asking every 60 s for as long as it is recording.
   */
  private teardownTimeResponder(): void {
    if (!this.timeResponderUnsub) return;
    try {
      this.timeResponderUnsub();
    } catch (error) {
      // Removing a subscription for an already-dead connection throws; the
      // connection is going away regardless.
    }
    this.timeResponderUnsub = null;
  }

  /**
   * Get V2 device status
   */
  async getStatusV2(): Promise<V2Status> {
    if (!this.connectedDevice) throw new Error('No device connected');

    return new Promise<V2Status>((resolve, reject) => {
      let isResolved = false;

      const timeout = setTimeout(() => {
        if (!isResolved) {
          isResolved = true;
          subscription?.remove();
          reject(new Error('Timeout waiting for V2 status'));
        }
      }, 3000);

      const subscription = this.connectedDevice!.monitorCharacteristicForService(
        IMU_SERVICE_UUID,
        IMU_CHARACTERISTIC_UUID,
        (error, characteristic) => {
          if (isResolved) return;
          if (error) {
            clearTimeout(timeout);
            isResolved = true;
            subscription?.remove();
            reject(error);
            return;
          }
          if (characteristic?.value) {
            clearTimeout(timeout);
            isResolved = true;
            subscription?.remove();

            const data = this.base64ToUint8Array(characteristic.value);
            if (data.length < 8) {
              reject(new Error('Invalid V2 status response'));
              return;
            }

            const status = this.parseV2Status(data);
            resolve(status);
          }
        }
      );

      // Send status request command
      const command = new Uint8Array([CMD_V2_GET_STATUS]);
      this.writeConfigCommand(command).catch((err) => {
        if (!isResolved) {
          clearTimeout(timeout);
          isResolved = true;
          subscription?.remove();
          reject(err);
        }
      });
    });
  }

  /**
   * Subscribe to status push notifications (device sends during upload).
   * Returns unsubscribe function.
   */
  subscribeToStatus(callback: (status: V2Status) => void): () => void {
    if (!this.connectedDevice) return () => {};

    const subscription = this.connectedDevice.monitorCharacteristicForService(
      IMU_SERVICE_UUID,
      IMU_CHARACTERISTIC_UUID,
      (error, characteristic) => {
        if (error || !characteristic?.value) return;
        const data = this.base64ToUint8Array(characteristic.value);
        if (data.length < 8) return;

        const status = this.parseV2Status(data);
        callback(status);
      }
    );

    return () => subscription?.remove();
  }

  /**
   * Start recording on V2 device
   */
  async startRecordingV2(): Promise<void> {
    if (!this.connectedDevice) throw new Error('No device connected');
    await this.writeConfigCommand(new Uint8Array([CMD_V2_START_RECORDING]));
  }

  /**
   * Parse V2 status packet from raw BLE data
   * Base (15 bytes): state(1) + battery_mv(2) + file_count(2) + free_mb(2) + clock_synced(1)
   *                  + flags(1) + accel_x(2) + accel_y(2) + accel_z(2)
   * Recording (+8 = 23): + rec_secs(4) + rec_bytes(4)
   * Uploading (+11 = 26): + current_file(1) + total_files(1) + bytes_sent(4) + bytes_total(4) + result(1)
   */
  private parseV2Status(data: Uint8Array): V2Status {
    const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
    // 3 = STATE_FAULT: IMU or SD failed init, recording refused (firmware
    // config.h DeviceState). Without this entry an unmapped value falls
    // through to 'idle', which would show a faulted device as healthy.
    const stateMap: Record<number, V2Status['state']> = {
      0: 'idle', 1: 'recording', 2: 'uploading', 3: 'fault',
    };
    const status: V2Status = {
      state: stateMap[data[0]] || 'idle',
      batteryMv: dv.getUint16(1, true),
      fileCount: dv.getUint16(3, true),
      freeMb: dv.getUint16(5, true),
      clockSynced: data[7] === 1,
      sdOk: true,
      imuOk: true,
      spaceLow: false,
      spaceCritical: false,
    };

    if (data.length >= 15) {
      const flags = data[8];
      status.sdOk = (flags & 0x01) !== 0;
      status.imuOk = (flags & 0x02) !== 0;
      // bit2/bit3: card below SD_WARN_MB / SD_CRITICAL_MB. At 10 MB/hour the
      // device stops itself at critical, so this is advance notice, not an
      // error — surface it before the ride, not after.
      status.spaceLow = (flags & 0x04) !== 0;
      status.spaceCritical = (flags & 0x08) !== 0;
      status.accel = {
        x: dv.getInt16(9, true),
        y: dv.getInt16(11, true),
        z: dv.getInt16(13, true),
      };

      if (data.length >= 26) {
        const resultMap: Record<number, V2SyncProgress['result']> = { 0: 'in_progress', 1: 'success', 2: 'error' };
        status.syncProgress = {
          currentFile: data[15],
          totalFiles: data[16],
          bytesSent: dv.getUint32(17, true),
          bytesTotal: dv.getUint32(21, true),
          result: resultMap[data[25]] || 'in_progress',
        };
      } else if (data.length >= 23 && status.state === 'recording') {
        status.recordingInfo = {
          elapsedSecs: dv.getUint32(15, true),
          fileBytes: dv.getUint32(19, true),
        };
      }
    } else if (data.length >= 8) {
      // Legacy 8-byte packet (pre-flags firmware) — fallback
    }

    return status;
  }

  /**
   * Stop recording on V2 device
   */
  async stopRecordingV2(): Promise<void> {
    if (!this.connectedDevice) throw new Error('No device connected');
    await this.writeConfigCommand(new Uint8Array([CMD_V2_STOP_RECORDING]));
  }

  /**
   * List files on V2 device
   */
  async listFilesV2(): Promise<V2FileEntry[]> {
    if (!this.connectedDevice) throw new Error('No device connected');

    return new Promise<V2FileEntry[]>((resolve, reject) => {
      let isResolved = false;

      const timeout = setTimeout(() => {
        if (!isResolved) {
          isResolved = true;
          subscription?.remove();
          reject(new Error('Timeout waiting for file list'));
        }
      }, 5000);

      const subscription = this.connectedDevice!.monitorCharacteristicForService(
        IMU_SERVICE_UUID,
        V2_FILE_LIST_CHARACTERISTIC_UUID,
        (error, characteristic) => {
          if (isResolved) return;
          if (error) {
            clearTimeout(timeout);
            isResolved = true;
            subscription?.remove();
            reject(error);
            return;
          }
          if (characteristic?.value) {
            const data = this.base64ToUint8Array(characteristic.value);

            // This characteristic also carries device-initiated notifications:
            // 0xF0 time requests (every 60s while recording) and 0xF1 log
            // replies. Either one arriving mid-listing used to resolve this
            // promise with whatever it parsed to — a 0xF1 packet reads as
            // "241 files on SD" with 0 entries, so the caller would see an
            // empty recording list and no error. Skip and keep listening; the
            // 5s timeout still bounds the wait.
            if (data.length >= 1 &&
                (data[0] === NOTIFY_TIME_REQUEST || data[0] === NOTIFY_LOG_DATA)) {
              return;
            }

            clearTimeout(timeout);
            isResolved = true;
            subscription?.remove();

            const files: V2FileEntry[] = [];

            // Parse: totalCount(1) + packedCount(1) + [name_len(1) + name(N) + size(4)] per file
            let offset = 0;
            if (data.length < 2) { resolve(files); return; }
            const _totalCount = data[offset++];  // Total files on SD (for info)
            const packedCount = data[offset++];   // Files in this response

            for (let i = 0; i < packedCount && offset < data.length; i++) {
              const nameLen = data[offset++];
              if (offset + nameLen + 4 + 1 > data.length) break;

              const name = String.fromCharCode(...data.slice(offset, offset + nameLen));
              offset += nameLen;

              const dv = new DataView(data.buffer, data.byteOffset + offset, 4);
              const size = dv.getUint32(0, true);
              offset += 4;

              const synced = data[offset++] === 1;

              files.push({ name, size, synced });
            }

            resolve(files);
          }
        }
      );

      // Send list files command
      const command = new Uint8Array([CMD_V2_LIST_FILES]);
      this.writeConfigCommand(command).catch((err) => {
        if (!isResolved) {
          clearTimeout(timeout);
          isResolved = true;
          subscription?.remove();
          reject(err);
        }
      });
    });
  }

  /**
   * Delete a file on V2 device
   */
  async deleteFileV2(filename: string): Promise<void> {
    if (!this.connectedDevice) throw new Error('No device connected');

    const nameBytes = new TextEncoder().encode(filename);
    const command = new Uint8Array(1 + nameBytes.length);
    command[0] = CMD_V2_DELETE_FILE;
    command.set(nameBytes, 1);

    await this.writeConfigCommand(command);
  }

  /**
   * Set WiFi credentials on V2 device
   * Payload: [CMD][SSID\0PASSWORD]
   */
  async setWiFiCredentials(ssid: string, password: string): Promise<void> {
    if (!this.connectedDevice) throw new Error('No device connected');

    const encoder = new TextEncoder();
    const ssidBytes = encoder.encode(ssid);
    const passBytes = encoder.encode(password);
    // Format: CMD + SSID + \0 + PASSWORD
    const command = new Uint8Array(1 + ssidBytes.length + 1 + passBytes.length);
    command[0] = CMD_V2_SET_WIFI;
    command.set(ssidBytes, 1);
    command[1 + ssidBytes.length] = 0; // null separator
    command.set(passBytes, 1 + ssidBytes.length + 1);

    await this.writeConfigCommand(command);
  }

  /**
   * Set user/API credentials on V2 device
   * Payload: [CMD][userId\0apiKey\0serverUrl]
   */
  async setUserCredentials(userId: string, apiKey: string, serverUrl: string): Promise<void> {
    if (!this.connectedDevice) throw new Error('No device connected');

    const encoder = new TextEncoder();
    const userBytes = encoder.encode(userId);
    const keyBytes = encoder.encode(apiKey);
    const urlBytes = encoder.encode(serverUrl);
    // Format: CMD + userId + \0 + apiKey + \0 + serverUrl
    const command = new Uint8Array(1 + userBytes.length + 1 + keyBytes.length + 1 + urlBytes.length);
    command[0] = CMD_V2_SET_USER;
    let offset = 1;
    command.set(userBytes, offset); offset += userBytes.length;
    command[offset++] = 0;
    command.set(keyBytes, offset); offset += keyBytes.length;
    command[offset++] = 0;
    command.set(urlBytes, offset);

    await this.writeConfigCommand(command);
  }

  /**
   * Trigger WiFi sync (upload all files to cloud)
   */
  async startSync(): Promise<void> {
    if (!this.connectedDevice) throw new Error('No device connected');
    await this.writeConfigCommand(new Uint8Array([CMD_V2_START_SYNC]));
  }

  /**
   * Cancel ongoing WiFi sync
   */
  async cancelSync(): Promise<void> {
    if (!this.connectedDevice) throw new Error('No device connected');
    await this.writeConfigCommand(new Uint8Array([CMD_V2_CANCEL_SYNC]));
  }

  /**
   * Disconnect from the current device
   */
  async disconnect(): Promise<void> {
    if (this.connectedDevice) {
      this.cleanupSubscriptions();

      try {
        await this.connectedDevice.cancelConnection();
      } catch (error) {
        // Ignore disconnection errors
      }

      this.connectedDevice = null;

      // Notify listeners of disconnection
      this.notifyConnectionListeners(null, false);
    }
  }

  /**
   * Check if a device is connected
   */
  isConnected(): boolean {
    return this.connectedDevice !== null;
  }

  /**
   * Get the currently connected device
   */
  getConnectedDevice(): Device | null {
    return this.connectedDevice;
  }

  /**
   * Write a command to the config characteristic
   */
  private async writeConfigCommand(command: Uint8Array): Promise<void> {
    if (!this.connectedDevice) {
      throw new Error('No device connected');
    }

    const base64Value = btoa(String.fromCharCode(...command));
    await this.connectedDevice.writeCharacteristicWithResponseForService(
      IMU_SERVICE_UUID,
      CONFIG_CHARACTERISTIC_UUID,
      base64Value
    );
  }

  /**
   * Read one chunk of the device's diagnostic log ring.
   *
   * Readers hold a position against total_written, not a raw ring offset, so a
   * stored position stays valid while the writer wraps underneath. Pass 0n to
   * start from the oldest surviving byte; the device clamps that up to the
   * oldest survivor and reports the resulting gap.
   *
   * A nonzero `gap` means the writer lapped this reader and those bytes are
   * gone. It is surfaced, never silently skipped — same principle as the
   * dropped-sample handling in the parser: flag the loss, do not paper over it.
   */
  async readLogV2(fromPos: bigint): Promise<V2LogChunk> {
    if (!this.connectedDevice) {
      throw new Error('No device connected');
    }

    return new Promise<V2LogChunk>((resolve, reject) => {
      let isResolved = false;

      const timeout = setTimeout(() => {
        if (!isResolved) {
          isResolved = true;
          subscription?.remove();
          reject(new Error('Timeout waiting for log data'));
        }
      }, 5000);

      const subscription = this.connectedDevice!.monitorCharacteristicForService(
        IMU_SERVICE_UUID,
        V2_FILE_LIST_CHARACTERISTIC_UUID,
        (error, characteristic) => {
          if (isResolved) return;
          if (error) {
            clearTimeout(timeout);
            isResolved = true;
            subscription?.remove();
            reject(error);
            return;
          }
          if (!characteristic?.value) return;

          const data = this.base64ToUint8Array(characteristic.value);
          // Shared characteristic: ignore listings and time requests.
          if (data.length < 1 || data[0] !== NOTIFY_LOG_DATA) return;

          clearTimeout(timeout);
          isResolved = true;
          subscription?.remove();

          // [0xF1][next_pos u64][gap u64][total u64][min_level u8][len u8][text]
          if (data.length < 27) {
            reject(new Error(`Short log packet: ${data.length} bytes`));
            return;
          }
          const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
          const nextPos = dv.getBigUint64(1, true);
          const gap = dv.getBigUint64(9, true);
          const totalWritten = dv.getBigUint64(17, true);
          const minLevel = data[25];
          const textLen = data[26];
          const bytes = data.slice(27, 27 + textLen);
          // The firmware trims each chunk to the last complete line, so a
          // decode here never lands mid-record.
          const text = String.fromCharCode(...bytes);

          resolve({ nextPos, gap, totalWritten, minLevel, text });
        }
      );

      const payload = new Uint8Array(9);
      payload[0] = CMD_V2_LOG_READ;
      new DataView(payload.buffer).setBigUint64(1, fromPos, true);
      this.writeConfigCommand(payload).catch(err => {
        if (!isResolved) {
          clearTimeout(timeout);
          isResolved = true;
          subscription?.remove();
          reject(err);
        }
      });
    });
  }

  /**
   * Query log position and level without transferring any log data.
   */
  async getLogStatusV2(): Promise<V2LogChunk> {
    return this.readLogCommandV2(new Uint8Array([CMD_V2_LOG_STATUS]));
  }

  /**
   * Set the minimum severity the device persists to SD. Stored in NVS, so it
   * survives a reboot — raising it to ERROR quiets the ring until it is
   * lowered again.
   */
  async setLogLevelV2(level: number): Promise<V2LogChunk> {
    if (level < 0 || level > 3) {
      throw new Error(`Invalid log level: ${level}`);
    }
    return this.readLogCommandV2(new Uint8Array([CMD_V2_LOG_SET_LEVEL, level]));
  }

  /**
   * Clear the device's diagnostic ring.
   *
   * The device rewinds its header to empty and resets this reader's position;
   * the 10 MB region itself is not erased (that would stall the loop for
   * minutes over SPI), but nothing can read past total_written, so the stale
   * bytes are unreachable rather than merely hidden.
   */
  async clearLogV2(): Promise<V2LogChunk> {
    return this.readLogCommandV2(new Uint8Array([CMD_V2_LOG_CLEAR]));
  }

  /**
   * Shared request/response for the log commands that reply with a 0xF1 packet
   * carrying no text (status and set-level).
   */
  private async readLogCommandV2(payload: Uint8Array): Promise<V2LogChunk> {
    if (!this.connectedDevice) {
      throw new Error('No device connected');
    }

    return new Promise<V2LogChunk>((resolve, reject) => {
      let isResolved = false;

      const timeout = setTimeout(() => {
        if (!isResolved) {
          isResolved = true;
          subscription?.remove();
          reject(new Error('Timeout waiting for log response'));
        }
      }, 5000);

      const subscription = this.connectedDevice!.monitorCharacteristicForService(
        IMU_SERVICE_UUID,
        V2_FILE_LIST_CHARACTERISTIC_UUID,
        (error, characteristic) => {
          if (isResolved) return;
          if (error) {
            clearTimeout(timeout);
            isResolved = true;
            subscription?.remove();
            reject(error);
            return;
          }
          if (!characteristic?.value) return;

          const data = this.base64ToUint8Array(characteristic.value);
          if (data.length < 1 || data[0] !== NOTIFY_LOG_DATA) return;

          clearTimeout(timeout);
          isResolved = true;
          subscription?.remove();

          if (data.length < 27) {
            reject(new Error(`Short log packet: ${data.length} bytes`));
            return;
          }
          const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
          resolve({
            nextPos: dv.getBigUint64(1, true),
            gap: dv.getBigUint64(9, true),
            totalWritten: dv.getBigUint64(17, true),
            minLevel: data[25],
            text: '',
          });
        }
      );

      this.writeConfigCommand(payload).catch(err => {
        if (!isResolved) {
          clearTimeout(timeout);
          isResolved = true;
          subscription?.remove();
          reject(err);
        }
      });
    });
  }

  /**
   * Cleanup resources
   */
  destroy(): void {
    this.stopScanning();
    this.disconnect();
    this.manager.destroy();
  }
}

export default new BleService();

