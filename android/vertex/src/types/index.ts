// Re-export all types for convenient imports
export * from './api.types';
export * from './components.types';
export * from './errors.types';
export * from './navigation.types';
export * from './theme.types';

// Device and sensor data types
import { AdvertisementData } from './api.types';

export interface IMUDevice {
  id: string;
  name: string;
  rssi?: number;
  advertisementData?: AdvertisementData;
}

export interface SensorReading {
  timestamp_ms: number;
  grade_percent: number;
  roll_deg: number;
  accel_x_g: number;
  accel_y_g: number;
  accel_z_g: number;
}

export interface LoggingSession {
  isActive: boolean;
  sessionStartTime?: Date;
  fileName?: string;
  recordCount: number;
}

export interface LogFile {
  fileName: string;
  filePath: string;
  createdAt: Date;
  recordCount: number;
  duration_ms: number;
}
