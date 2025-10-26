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

class BleService {
  private manager: BleManager;
  private connectedDevice: Device | null = null;
  private activeSubscriptions: any[] = [];
  private isHandlingDisconnection: boolean = false;

  constructor() {
    this.manager = new BleManager();

    // Set up global error handler to prevent crashes
    this.manager.setLogLevel('Verbose');

    // Add global error handler for BLE errors
    // This prevents crashes from unhandled disconnection errors
    if (global.ErrorUtils) {
      const originalHandler = global.ErrorUtils.getGlobalHandler();
      global.ErrorUtils.setGlobalHandler((error: any, isFatal?: boolean) => {
        // Check if this is a BLE disconnection error
        if (error?.message?.includes('DisconnectionRouter') ||
            error?.message?.includes('CompositeException') ||
            error?.name === 'CompositeException') {
          console.log('Caught BLE disconnection error (prevented crash):', error.message);
          // Don't crash - just handle the disconnection gracefully
          if (this.connectedDevice) {
            this.cleanupSubscriptions();
            this.connectedDevice = null;
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
   * Clean up all active subscriptions
   */
  private cleanupSubscriptions(): void {
    console.log(`Cleaning up ${this.activeSubscriptions.length} active subscriptions...`);
    for (const subscription of this.activeSubscriptions) {
      try {
        if (subscription && typeof subscription.remove === 'function') {
          subscription.remove();
        }
      } catch (error) {
        // Ignore cleanup errors
        console.log('Subscription cleanup error (safe to ignore)');
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
    console.log('Starting BLE scan...');
    
    try {
      // Check Bluetooth state first
      const state = await this.manager.state();
      console.log('Bluetooth state:', state);
      
      if (state !== 'PoweredOn') {
        console.error('Bluetooth is not powered on. Current state:', state);
        return;
      }

      this.manager.startDeviceScan(null, null, (error, device) => {
        if (error) {
          console.error('Scan error:', error);
          console.error('Error reason:', error?.reason);
          console.error('Error message:', error?.message);
          return;
        }

        if (device) {
          console.log(`Found device: ${device.name || device.id}, RSSI: ${device.rssi}`);
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
    console.log('Stopping BLE scan...');
    this.manager.stopDeviceScan();
  }

  /**
   * Connect to a specific device
   * @param deviceId The ID of the device to connect to
   */
  async connectToDevice(deviceId: string): Promise<Device> {
    console.log(`Connecting to device: ${deviceId}`);

    try {
      // Add timeout for connection
      const connectionPromise = this.manager.connectToDevice(deviceId, {
        timeout: 10000, // 10 second timeout
      });

      const device = await connectionPromise;
      this.connectedDevice = device;

      // Request larger MTU for 56-byte sensor data packets (MTU = payload + 3 bytes overhead)
      try {
        await device.requestMTU(185);
      } catch (mtuError: any) {
        console.warn('MTU negotiation failed:', mtuError?.message);
      }

      // Set up disconnection handler
      device.onDisconnected((error, disconnectedDevice) => {
        if (this.isHandlingDisconnection) {
          return; // Already handling disconnection
        }
        this.isHandlingDisconnection = true;

        console.log('Device disconnected:', disconnectedDevice?.id);
        if (error) {
          console.log('Disconnection reason:', error.message);
        }

        // Clean up all active subscriptions
        this.cleanupSubscriptions();
        this.connectedDevice = null;

        // Reset disconnection flag after a short delay
        setTimeout(() => {
          this.isHandlingDisconnection = false;
        }, 100);
      });

      try {
        await device.discoverAllServicesAndCharacteristics();
      } catch (discoverError: any) {
        console.error('Service discovery error:', discoverError?.message);
      }

      return device;
    } catch (error: any) {
      console.error('Connection error:', error?.message || error);
      this.connectedDevice = null;
      throw new Error(`Failed to connect: ${error?.message || 'Unknown error'}`);
    }
  }

  /**
   * Subscribe to IMU notifications for continuous streaming
   * Subscribes to the IMU characteristic and receives automatic 1Hz updates
   * @param onDataReceived Callback when IMU data is received (parsed IMU data)
   * @param onError Optional callback for errors
   */
  async subscribeToIMUStream(
    onDataReceived: (data: any) => void,
    onError?: (error: Error) => void
  ): Promise<void> {
    if (!this.connectedDevice) {
      throw new Error('No device connected');
    }

    try {
      const services = await this.manager.servicesForDevice(this.connectedDevice.id);
      const hasIMUService = services.some(s => s.uuid.toLowerCase() === IMU_SERVICE_UUID.toLowerCase());

      if (!hasIMUService) {
        throw new Error('IMU service not available. Device may not be a Vertex IMU.');
      }

      const subscription = this.connectedDevice.monitorCharacteristicForService(
        IMU_SERVICE_UUID,
        IMU_CHARACTERISTIC_UUID,
        (error, characteristic) => {
          if (error) {
            console.error('IMU stream monitoring error:', error);
            if (onError) {
              onError(new Error(`Stream error: ${error.message}`));
            }
            return;
          }

          if (characteristic?.value) {
            try {
              const data = this.base64ToUint8Array(characteristic.value);
              const parsedData = this.parseIMU(data);
              onDataReceived(parsedData);
            } catch (parseError: any) {
              console.error('IMU parse error:', parseError);
              if (onError) {
                onError(new Error(`Parse error: ${parseError.message}`));
              }
            }
          }
        }
      );

      this.activeSubscriptions.push(subscription);
    } catch (error: any) {
      console.error('IMU subscription error:', error);
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

    console.log('Subscribing to characteristic notifications...');

    try {
      const subscription = this.connectedDevice.monitorCharacteristicForService(
        IMU_SERVICE_UUID,
        IMU_CHARACTERISTIC_UUID,
        (error, characteristic) => {
          if (error) {
            console.error('Characteristic monitoring error:', error);
            // Don't throw - just log the error to prevent crashes
            return;
          }

          if (characteristic?.value) {
            try {
              // Convert base64 value to Uint8Array
              const data = this.base64ToUint8Array(characteristic.value);
              onDataReceived(data);
            } catch (parseError) {
              console.error('Error parsing characteristic data:', parseError);
            }
          }
        }
      );

      // Track this subscription
      this.activeSubscriptions.push(subscription);
      console.log('Successfully subscribed to characteristic');
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
      // Wait a bit for services to be ready
      await new Promise(resolve => setTimeout(resolve, 500));

      // Get services using servicesForDevice which is more reliable
      const services = await this.manager.servicesForDevice(this.connectedDevice.id);
      const serviceUUIDs = services.map(s => s.uuid);
      console.log('Available services:', serviceUUIDs);

      // Log characteristics for each service
      for (const service of services) {
        try {
          const chars = await this.manager.characteristicsForDevice(
            this.connectedDevice.id,
            service.uuid
          );
          console.log(`Service ${service.uuid} has ${chars.length} characteristics:`,
            chars.map(c => c.uuid).join(', '));
        } catch (error) {
          console.log(`Could not get characteristics for service ${service.uuid}`);
        }
      }

      return serviceUUIDs;
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
  private parseIMU(data: Uint8Array): any {
    if (data.length < 56) {
      throw new Error(`Invalid IMU data length: ${data.length} bytes (expected 56)`);
    }

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

    console.log(`IMU: Roll=${roll.toFixed(1)}° Pitch=${pitch.toFixed(1)}° Yaw=${yaw.toFixed(1)}° | Cal: S=${calSys} G=${calGyro} A=${calAccel} M=${calMag}`);

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
      console.log('Disconnecting from device...');

      // Clean up all subscriptions first
      this.cleanupSubscriptions();

      try {
        await this.connectedDevice.cancelConnection();
      } catch (error) {
        console.log('Disconnect error (safe to ignore):', error);
      }

      this.connectedDevice = null;
      console.log('Disconnected');
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
   * Cleanup resources
   */
  destroy(): void {
    this.stopScanning();
    this.disconnect();
    this.manager.destroy();
  }
}

export default new BleService();

