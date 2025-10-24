/**
 * Type definitions for IMU-FIT file association system
 */

export interface TimeRange {
  start: Date
  end: Date
  duration: number // milliseconds
}

export interface AssociationOverlap {
  start: Date
  end: Date
  duration: number // milliseconds
  imuCoverage: number // percentage of IMU data in overlap
  fitCoverage: number // percentage of FIT data in overlap
}

export interface AssociationResult {
  success: boolean
  confidence: number // 0.0 to 1.0
  overlap: AssociationOverlap
  method: 'time' | 'gps' | 'pattern'
  errors?: string[]
  warnings?: string[]
}

export interface AssociationConfig {
  minOverlapMinutes: number // minimum overlap required
  maxTimeDriftMinutes: number // maximum acceptable time drift
  confidenceThreshold: number // minimum confidence for auto-association
  enableGPSValidation: boolean
  enablePatternMatching: boolean
}

export interface ImuDataPoint {
  timestamp: string | Date
  accel_x?: number
  accel_y?: number
  accel_z?: number
  gyro_x?: number
  gyro_y?: number
  gyro_z?: number
  mag_x?: number
  mag_y?: number
  mag_z?: number
}

export interface FitDataPoint {
  timestamp: string | Date
  latitude?: number
  longitude?: number
  altitude?: number
  speed_ms?: number
  power_watts?: number
  heart_rate?: number
  cadence?: number
  temperature?: number
  grade?: number
}

export interface FitSessionData {
  start_time: string | Date
  timestamp: string | Date
  total_elapsed_time?: number
  total_distance?: number
  total_ascent?: number
  total_descent?: number
  max_speed?: number
  avg_speed?: number
  max_power?: number
  avg_power?: number
  max_heart_rate?: number
  avg_heart_rate?: number
  max_cadence?: number
  avg_cadence?: number
}

export interface AssociationMetadata {
  imuFileId: string
  fitFileId: string
  method: 'time' | 'gps' | 'pattern'
  confidence: number
  overlapStart: Date
  overlapEnd: Date
  overlapDurationMinutes: number
  imuCoverage: number
  fitCoverage: number
  createdAt: Date
  updatedAt: Date
}

export interface AssociationValidationResult {
  valid: boolean
  errors: string[]
  warnings: string[]
  suggestions?: string[]
}
