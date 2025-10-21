/**
 * IMU data types and interfaces for sensor data processing
 */

export interface IMUSample {
  timestamp: Date
  accel_x: number      // m/s^2
  accel_y: number
  accel_z: number
  gyro_x: number       // rad/s
  gyro_y: number
  gyro_z: number
  mag_x?: number       // microtesla (optional)
  mag_y?: number
  mag_z?: number
  quat_w?: number      // quaternion (optional)
  quat_x?: number
  quat_y?: number
  quat_z?: number
}

export interface ParsedIMUData {
  samples: IMUSample[]
  startTime: Date
  endTime: Date
  sampleCount: number
  sampleRate: number
  duration: number     // seconds
}

export interface IMUDataFile {
  id: string
  user_id: string
  filename: string
  storage_path: string
  file_size_bytes: number
  start_time?: string
  end_time?: string
  sample_count?: number
  sample_rate?: number
  status: 'uploaded' | 'parsing' | 'ready' | 'error'
  error_message?: string
  parsed_at?: string
  created_at: string
}

export type IMUFileStatus = IMUDataFile['status']

