// Device and sensor data types

export interface IMUDevice {
  id: string;
  name: string;
  rssi?: number;
  advertisementData?: any;
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

