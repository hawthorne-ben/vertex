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

// IMU Device UUIDs (to be configured)
const IMU_SERVICE_UUID = 'YOUR_SERVICE_UUID'; // TODO: Get from firmware
const IMU_CHARACTERISTIC_UUID = 'YOUR_CHARACTERISTIC_UUID'; // TODO: Get from firmware

class BleService {
  private manager: BleManager;
  private connectedDevice: Device | null = null;

  constructor() {
    this.manager = new BleManager();
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
      const device = await this.manager.connectToDevice(deviceId);
      this.connectedDevice = device;
      
      // Discover services and characteristics
      await device.discoverAllServicesAndCharacteristics();
      
      console.log('Device connected successfully');
      return device;
    } catch (error) {
      console.error('Connection error:', error);
      throw error;
    }
  }

  /**
   * Subscribe to characteristic notifications
   * @param onDataReceived Callback when data is received
   */
  async subscribeToData(onDataReceived: (data: Uint8Array) => void): Promise<void> {
    if (!this.connectedDevice) {
      throw new Error('No device connected');
    }

    console.log('Subscribing to characteristic notifications...');

    try {
      const characteristic = await this.connectedDevice.monitorCharacteristicForService(
        IMU_SERVICE_UUID,
        IMU_CHARACTERISTIC_UUID,
        (error, characteristic) => {
          if (error) {
            console.error('Characteristic monitoring error:', error);
            return;
          }

          if (characteristic?.value) {
            // Convert base64 value to Uint8Array
            const data = this.base64ToUint8Array(characteristic.value);
            onDataReceived(data);
          }
        }
      );

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
      // Make sure services are discovered
      await this.connectedDevice.discoverAllServicesAndCharacteristics();

      const services = await this.connectedDevice.services();
      const serviceUUIDs = services.map(s => s.uuid);
      console.log('Available services:', serviceUUIDs);

      // Log characteristics for each service
      for (const service of services) {
        try {
          const chars = await service.characteristics();
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

    // First, list all available services for debugging
    const availableServices = await this.listAvailableServices();
    console.log('Device has', availableServices.length, 'services');

    try {
      // Try to read heart rate (for Whoop or HR devices)
      const heartRateData = await this.readHeartRate();
      if (heartRateData) {
        return heartRateData;
      }
    } catch (error: any) {
      console.log('Heart rate not available:', error?.message);
    }

    try {
      // Try to read IMU data
      const imuData = await this.readIMU();
      if (imuData) {
        return imuData;
      }
    } catch (error: any) {
      console.log('IMU data not available:', error?.message);
    }

    // If nothing worked, return info about available services
    throw new Error(`No sensor data available. Device has ${availableServices.length} services but none are readable. Available UUIDs: ${availableServices.slice(0, 3).join(', ')}`);
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
   * Read IMU sensor data (for custom IMU device)
   */
  private async readIMU(): Promise<any> {
    if (!this.connectedDevice) {
      throw new Error('No device connected');
    }

    try {
      // First check if the device has the IMU service
      const services = await this.connectedDevice.services();
      const hasIMUService = services.some(s => s.uuid.toLowerCase().includes(IMU_SERVICE_UUID.toLowerCase()));

      if (!hasIMUService) {
        throw new Error('IMU service not available');
      }

      const characteristic = await this.connectedDevice.readCharacteristicForService(
        IMU_SERVICE_UUID,
        IMU_CHARACTERISTIC_UUID
      );

      if (!characteristic.value) {
        throw new Error('No IMU data');
      }

      const data = this.base64ToUint8Array(characteristic.value);
      return this.parseIMU(data);
    } catch (error: any) {
      console.log('IMU read error:', error?.message || 'Unknown error');
      throw new Error('IMU service not available');
    }
  }

  /**
   * Parse IMU sensor data
   */
  private parseIMU(data: Uint8Array): any {
    // TODO: Implement based on your IMU data format
    // Expected format: [timestamp(4), grade(2), roll(2), Gx(2), Gy(2), Gz(2)]

    if (data.length < 14) {
      throw new Error('Invalid IMU data');
    }

    const grade = ((data[4] | (data[5] << 8)) / 100.0);
    const roll = ((data[6] | (data[7] << 8)) / 100.0);
    const accelX = this.signedInt16(data[8] | (data[9] << 8)) / 1000.0;
    const accelY = this.signedInt16(data[10] | (data[11] << 8)) / 1000.0;
    const accelZ = this.signedInt16(data[12] | (data[13] << 8)) / 1000.0;

    return {
      grade,
      roll,
      accelX,
      accelY,
      accelZ,
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
      await this.connectedDevice.cancelConnection();
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

