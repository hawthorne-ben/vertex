/**
 * Braking Detection Types
 *
 * Output types for braking event detection from IMU pitch analysis.
 */

export interface BrakingSample {
  timestamp: string
  isBraking: boolean
  brakingIntensity: number        // 0-100 scale
  brakingDecelerationMs2: number  // peak deceleration in window (m/s²)
  estimatedGradePercent: number   // IMU-derived grade from pitch baseline
  fitGradePercent: number | null  // FIT grade (independent reference, lags by ~5-10s)
}

export interface BrakingMetadata {
  totalBrakingEvents: number       // distinct braking episodes
  totalBrakingSeconds: number      // cumulative time spent braking
  avgBrakingIntensity: number      // mean intensity during braking (0-100)
  maxBrakingIntensity: number      // peak intensity (0-100)
  maxBrakingDecelerationMs2: number // peak raw deceleration
  brakingPercent: number           // % of ride time spent braking
  totalSamples: number
  sampleRate: number | null
}
