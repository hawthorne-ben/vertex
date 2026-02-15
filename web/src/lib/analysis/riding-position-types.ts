/**
 * Riding Position Detection Types
 *
 * Output types for riding position analysis (standing vs. seated)
 */

export interface RidingPositionSample {
  timestamp: string
  position: 'standing' | 'seated' | null  // null when not pedaling
  rockingMagnitude: number  // Y-axis oscillation amplitude
  cadence: number | null  // RPM from FIT sensor
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
