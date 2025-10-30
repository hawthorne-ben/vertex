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

// Configuration commands (matches firmware)
const CMD_SET_SAMPLE_RATE = 0x01;
const CMD_CALIBRATE = 0x02;
const CMD_POWER_MODE = 0x03;
const CMD_RESET = 0x04;
const CMD_LED_MODE = 0x05;
const CMD_QUERY_CONFIG = 0xFF;

type ConnectionListener = (device: Device | null, isConnected: boolean) => void;

class BleService {
  private manager: BleManager;
  private connectedDevice: Device | null = null;
  private activeSubscriptions: any[] = [];
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
   * Clean up all active subscriptions
   */
  private cleanupSubscriptions(): void {
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

      // Notify listeners of connection
      this.notifyConnectionListeners(device, true);

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
                  console.error('[BLE] Parse error:', parseError.message);
                  if (onError) {
                    onError(new Error(`Parse error: ${parseError.message}`));
                  }
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
   * FIRMWARE FORMAT (56 bytes):
   * - Timestamp (4 bytes) - uint32_t milliseconds since boot
   * - Euler Angles (12 bytes) - 3x float (roll, pitch, yaw in degrees)
   * - Acceleration (12 bytes) - 3x float (x, y, z in m/s²)
   * - Gyroscope (12 bytes) - 3x float (x, y, z in rad/s)
   * - Magnetometer (12 bytes) - 3x float (x, y, z in µT)
   * - Calibration (4 bytes) - 4x uint8_t (sys, gyro, accel, mag: 0-3)
   */
  // Performance tracking for 10Hz validation
  private lastNotificationTime: number = 0;
  private notificationCount: number = 0;
  private notificationRates: number[] = [];

  private parseIMU(data: Uint8Array): any {
    if (data.length < 60) {
      throw new Error(`Invalid IMU data length: ${data.length} bytes (expected 60)`);
    }

    // Track notification rate for 10Hz validation
    const now = Date.now();
    if (this.lastNotificationTime > 0) {
      const deltaMs = now - this.lastNotificationTime;
      const rate = 1000 / deltaMs; // Hz
      this.notificationRates.push(rate);

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

    // Magnetometer (12 bytes)
    const magX = view.getFloat32(offset, true);
    offset += 4;
    const magY = view.getFloat32(offset, true);
    offset += 4;
    const magZ = view.getFloat32(offset, true);
    offset += 4;

    // Calibration (4 bytes)
    const calSys = data[offset++];
    const calGyro = data[offset++];
    const calAccel = data[offset++];
    const calMag = data[offset++];

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
        `Mag: ${magX.toFixed(1)},${magY.toFixed(1)},${magZ.toFixed(1)} | ` +
        `Cal: S=${calSys} G=${calGyro} A=${calAccel} M=${calMag} | ` +
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
      magX,
      magY,
      magZ,
      calibration: {
        system: calSys,
        gyro: calGyro,
        accel: calAccel,
        mag: calMag,
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
   * Set device sample rate
   * @param hz Desired frequency in Hz (1-50Hz)
   */
  async setSampleRate(hz: number): Promise<void> {
    if (!this.connectedDevice) {
      throw new Error('No device connected');
    }

    // Validate range
    if (hz < 1 || hz > 50) {
      throw new Error('Sample rate must be between 1-50 Hz');
    }

    const intervalMs = Math.round(1000 / hz);
    console.log(`[CONFIG] Setting sample rate to ${hz} Hz (${intervalMs} ms)`);

    // Build command: [CMD_SET_SAMPLE_RATE, intervalMs (4 bytes, little-endian)]
    const command = new Uint8Array(5);
    command[0] = CMD_SET_SAMPLE_RATE;
    const view = new DataView(command.buffer);
    view.setUint32(1, intervalMs, true); // little-endian

    await this.writeConfigCommand(command);
  }

  /**
   * Trigger device calibration
   */
  async triggerCalibration(): Promise<void> {
    if (!this.connectedDevice) {
      throw new Error('No device connected');
    }

    console.log('[CONFIG] Triggering calibration');
    const command = new Uint8Array([CMD_CALIBRATE]);
    await this.writeConfigCommand(command);
  }

  /**
   * Set device power mode
   * @param mode 0=low, 1=normal, 2=high performance
   */
  async setPowerMode(mode: number): Promise<void> {
    if (!this.connectedDevice) {
      throw new Error('No device connected');
    }

    if (mode < 0 || mode > 2) {
      throw new Error('Power mode must be 0 (low), 1 (normal), or 2 (high)');
    }

    const modeNames = ['LOW', 'NORMAL', 'HIGH'];
    console.log(`[CONFIG] Setting power mode to ${modeNames[mode]}`);

    const command = new Uint8Array([CMD_POWER_MODE, mode]);
    await this.writeConfigCommand(command);
  }

  /**
   * Reset the device (soft reset)
   */
  async resetDevice(): Promise<void> {
    if (!this.connectedDevice) {
      throw new Error('No device connected');
    }

    console.log('[CONFIG] Resetting device');
    const command = new Uint8Array([CMD_RESET]);
    await this.writeConfigCommand(command);

    // Device will disconnect after reset
    this.connectedDevice = null;
    this.notifyConnectionListeners(null, false);
  }

  /**
   * Set LED mode
   * @param mode 0=off, 1=status, 2=always-on
   */
  async setLEDMode(mode: number): Promise<void> {
    if (!this.connectedDevice) {
      throw new Error('No device connected');
    }

    if (mode < 0 || mode > 2) {
      throw new Error('LED mode must be 0 (off), 1 (status), or 2 (always-on)');
    }

    const modeNames = ['OFF', 'STATUS', 'ALWAYS-ON'];
    console.log(`[CONFIG] Setting LED mode to ${modeNames[mode]}`);

    const command = new Uint8Array([CMD_LED_MODE, mode]);
    await this.writeConfigCommand(command);
  }

  /**
   * Query device configuration
   * Returns current device settings
   */
  async queryConfiguration(): Promise<any> {
    if (!this.connectedDevice) {
      throw new Error('No device connected');
    }

    console.log('[CONFIG] Querying device configuration');
    const command = new Uint8Array([CMD_QUERY_CONFIG]);
    await this.writeConfigCommand(command);

    // The device will send a notification response
    // For now, we'll just trigger the command
    // A complete implementation would subscribe to notifications first
    return { status: 'Query sent - check device logs for response' };
  }

  /**
   * Write a configuration command to the device
   * @param command Uint8Array containing command bytes
   */
  private async writeConfigCommand(command: Uint8Array): Promise<void> {
    if (!this.connectedDevice) {
      throw new Error('No device connected');
    }

    try {
      // Convert Uint8Array to base64 for BLE library
      const base64Value = btoa(String.fromCharCode(...command));

      await this.connectedDevice.writeCharacteristicWithResponseForService(
        IMU_SERVICE_UUID,
        CONFIG_CHARACTERISTIC_UUID,
        base64Value
      );

      console.log(`[CONFIG] Command written successfully (${command.length} bytes)`);
    } catch (error: any) {
      console.error('[CONFIG] Write error:', error?.message);
      throw new Error(`Failed to write config command: ${error?.message || 'Unknown error'}`);
    }
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

