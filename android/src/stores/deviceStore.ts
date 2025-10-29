/**
 * Device Store
 *
 * Global state for device connection, battery, and sensor data
 */

import { create } from 'zustand';

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

export interface DeviceConfig {
  sampleRate: number; // Hz
  ledMode: number; // 0=Off, 1=Status, 2=Always On
  powerMode: number; // 0=Low Power, 1=Normal, 2=High Performance
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

  // Device config
  deviceConfig: DeviceConfig | null;

  // Actions
  setDevice: (deviceId: string, deviceName: string) => void;
  setConnectionStatus: (isConnected: boolean, isConnecting?: boolean) => void;
  setConnectionError: (error: string | null) => void;
  setBattery: (level: number | null, voltage: number | null, isCharging?: boolean | null) => void;
  setLatestReading: (reading: SensorReading) => void;
  setSampleRate: (rate: number) => void;
  setDeviceConfig: (config: DeviceConfig) => void;
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
  deviceConfig: null,
};

export const useDeviceStore = create<DeviceState>((set) => ({
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

  setDeviceConfig: (config) =>
    set({ deviceConfig: config }),

  reset: () =>
    set(initialState),
}));
