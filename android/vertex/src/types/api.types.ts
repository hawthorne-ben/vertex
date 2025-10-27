/**
 * API Response Type Definitions
 *
 * Types for Supabase and BLE device responses
 */

import { User } from '@supabase/supabase-js';
import { Device } from 'react-native-ble-plx';

// Supabase Auth
export interface AuthResponse {
  user: User | null;
  error: Error | null;
}

// BLE Device Types
export interface AdvertisementData {
  localName?: string;
  manufacturerData?: string;
  serviceUUIDs?: string[];
  txPowerLevel?: number;
  serviceData?: Record<string, string>;
}

export interface BleDevice extends Device {
  advertisementData?: AdvertisementData;
}

// IMU Sensor Data Types (Vertex device specific)
export interface IMUSensorData {
  timestamp: number;
  accelerometer: {
    x: number;
    y: number;
    z: number;
  };
  gyroscope: {
    x: number;
    y: number;
    z: number;
  };
  magnetometer?: {
    x: number;
    y: number;
    z: number;
  };
}

// Recording Types
export interface RecordingMetadata {
  fileName: string;
  startTime: number;
  endTime?: number;
  sampleCount: number;
  duration: number;
  deviceId: string;
  deviceName: string;
}

export interface RecordingResult {
  fileName: string;
  sampleCount: number;
  duration: number;
  filePath: string;
  metadata: RecordingMetadata;
}

// BLE Service Response Types
export interface ScanResult {
  device: BleDevice;
  rssi: number;
}

export interface ConnectionResult {
  device: BleDevice;
  success: boolean;
  error?: Error;
}

// Supabase Database Types (extend as needed)
export interface DatabaseRecording {
  id: string;
  user_id: string;
  file_name: string;
  file_path: string;
  device_id: string;
  device_name: string;
  start_time: string;
  end_time?: string;
  sample_count: number;
  duration: number;
  created_at: string;
  updated_at: string;
}

export interface DatabaseDevice {
  id: string;
  user_id: string;
  device_id: string;
  device_name: string;
  last_connected: string;
  created_at: string;
  updated_at: string;
}
