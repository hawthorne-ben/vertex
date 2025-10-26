/**
 * BLE Service for IMU Device Communication
 * 
 * Handles:
 * - BLE device scanning
 * - Connection management
 * - Data subscription and reception
 * - Automatic reconnection
 */

import { BleManager, Device, Characteristic, Service } from 'react-native-ble-plx';

class BleService {
  private manager: BleManager;
  private connectedDevice: Device | null = null;
  private serviceUUID: string = 'YOUR_SERVICE_UUID'; // TODO: Get from firmware
  private characteristicUUID: string = 'YOUR_CHARACTERISTIC_UUID'; // TODO: Get from firmware

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
        this.serviceUUID,
        this.characteristicUUID,
        (error, characteristic) => {
          if (error) {
            console.error('Characteristic monitoring error:', error);
            return;
          }

          if (characteristic?.value) {
            // Convert base64 value to Uint8Array
            const base64Value = characteristic.value;
            const buffer = Buffer.from(base64Value, 'base64');
            const data = new Uint8Array(buffer);
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

