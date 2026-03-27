/**
 * Riding Position Detection Types
 *
 * Output types for riding position analysis (standing vs. seated)
 */

export interface RidingPositionSample {
  timestamp: string
  position: 'standing' | 'seated' | null  // null when not pedaling
  rockingMagnitude: number  // Y-axis oscillation amplitude
  rollRms?: number  // Gyro-derived roll rate RMS (deg/s)
  yawRms?: number   // Gyro-derived yaw rate RMS (deg/s)
  cadence: number | null  // RPM from FIT sensor
  // Debug diagnostics (populated for debug endpoint, omitted in production DB storage)
  accelScore?: number       // rockingMagnitude / yAxisThreshold (0-1 normalized)
  gyroScore?: number        // rollWeight * (rollRms/rollThreshold) + yawWeight * (yawRms/yawThreshold)
  combinedScore?: number    // weighted fusion score (>=1.0 = standing)
}

export interface RidingPositionMetadata {
  // Position distribution
  standingPercent: number  // % of ride spent standing while pedaling
  seatedPercent: number    // % of ride spent seated while pedaling
  totalSamples: number
  pedalingSamples: number

  // Cadence breakdown
  avgCadenceStanding: number | null  // Average cadence when standing
  avgCadenceSeated: number | null    // Average cadence when seated

  // Detection quality
  sampleRate: number | null
}
