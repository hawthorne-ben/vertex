/**
 * Device Store
 *
 * Global state for device connection, battery, and sensor data
 */

import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';

const SAVED_DEVICES_KEY = '@vertex_saved_devices';

export interface SensorReading {
  timestamp: number;
  accelX: number;
  accelY: number;
  accelZ: number;
  gyroX: number;
  gyroY: number;
  gyroZ: number;
  quatW: number;
  quatX: number;
  quatY: number;
  quatZ: number;
  temperature: number;
}

export interface SavedDevice {
  id: string;
  name: string;
  lastConnected?: string;
  firmwareVersion?: 'v1' | 'v2';
}

export interface DeviceState {
  // Connection
  deviceId: string | null;
  deviceName: string | null;
  isConnected: boolean;
  isConnecting: boolean;
  connectionError: string | null;

  // Battery
  batteryLevel: number | null; // 0-100 percentage
  batteryVoltage: number | null; // Voltage value
  isCharging: boolean | null;

  // Sensor data
  latestReading: SensorReading | null;
  sampleRate: number | null; // Hz (actual measured rate)

  // Saved devices
  savedDevices: SavedDevice[];

  // Actions
  setDevice: (deviceId: string | null, deviceName: string | null) => void;
  setConnectionStatus: (isConnected: boolean, isConnecting?: boolean) => void;
  setConnectionError: (error: string | null) => void;
  setBattery: (level: number | null, voltage: number | null, isCharging?: boolean | null) => void;
  setLatestReading: (reading: SensorReading) => void;
  setSampleRate: (rate: number) => void;
  loadSavedDevices: () => Promise<void>;
  addSavedDevice: (device: SavedDevice) => Promise<void>;
  removeSavedDevice: (deviceId: string) => Promise<void>;
  updateDeviceLastConnected: (deviceId: string) => Promise<void>;
  reset: () => void;
}

const initialState = {
  deviceId: null,
  deviceName: null,
  isConnected: false,
  isConnecting: false,
  connectionError: null,
  batteryLevel: null,
  batteryVoltage: null,
  isCharging: null,
  latestReading: null,
  sampleRate: null,
  savedDevices: [],
};

export const useDeviceStore = create<DeviceState>((set, get) => ({
  ...initialState,

  setDevice: (deviceId, deviceName) =>
    set({ deviceId, deviceName, connectionError: null }),

  setConnectionStatus: (isConnected, isConnecting = false) =>
    set({ isConnected, isConnecting, connectionError: isConnected ? null : undefined }),

  setConnectionError: (error) =>
    set({ connectionError: error }),

  setBattery: (level, voltage, isCharging = null) =>
    set({ batteryLevel: level, batteryVoltage: voltage, isCharging }),

  setLatestReading: (reading) =>
    set({ latestReading: reading }),

  setSampleRate: (rate) =>
    set({ sampleRate: rate }),

  loadSavedDevices: async () => {
    try {
      const saved = await AsyncStorage.getItem(SAVED_DEVICES_KEY);
      if (saved) {
        const devices = JSON.parse(saved);
        set({ savedDevices: devices });
      }
    } catch (error) {
      console.error('[deviceStore] Error loading saved devices:', error);
    }
  },

  addSavedDevice: async (device) => {
    try {
      const currentDevices = get().savedDevices;
      // Check if device already exists
      const exists = currentDevices.some(d => d.id === device.id);
      if (exists) {
        console.log('[deviceStore] Device already saved:', device.id);
        return;
      }

      const updatedDevices = [...currentDevices, device];
      await AsyncStorage.setItem(SAVED_DEVICES_KEY, JSON.stringify(updatedDevices));
      set({ savedDevices: updatedDevices });
      console.log('[deviceStore] Device saved:', device.name);
    } catch (error) {
      console.error('[deviceStore] Error saving device:', error);
      throw error;
    }
  },

  removeSavedDevice: async (deviceId) => {
    try {
      const currentDevices = get().savedDevices;
      const updatedDevices = currentDevices.filter(d => d.id !== deviceId);
      await AsyncStorage.setItem(SAVED_DEVICES_KEY, JSON.stringify(updatedDevices));
      set({ savedDevices: updatedDevices });
      console.log('[deviceStore] Device removed:', deviceId);
    } catch (error) {
      console.error('[deviceStore] Error removing device:', error);
      throw error;
    }
  },

  updateDeviceLastConnected: async (deviceId) => {
    try {
      const currentDevices = get().savedDevices;
      const updatedDevices = currentDevices.map(d =>
        d.id === deviceId
          ? { ...d, lastConnected: new Date().toISOString() }
          : d
      );
      await AsyncStorage.setItem(SAVED_DEVICES_KEY, JSON.stringify(updatedDevices));
      set({ savedDevices: updatedDevices });
    } catch (error) {
      console.error('[deviceStore] Error updating last connected:', error);
    }
  },

  reset: () =>
    set(initialState),
}));
