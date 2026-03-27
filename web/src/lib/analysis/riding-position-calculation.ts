/**
 * Riding Position Calculation
 *
 * Detects standing vs. seated based on Y-axis (lateral) rocking motion
 */

import * as CONSTANTS from './imu-constants'

/**
 * Calculate riding position from Y-axis acceleration and optional gyro roll rate
 *
 * Uses weighted fusion of two signals:
 * - Accel Y-axis stdDev (lateral rocking)
 * - Gyro X-axis RMS (roll rate from band-pass filter)
 *
 * Each signal is normalized to 0–1 against its threshold, then combined
 * with configurable weights. Standing if combined score >= 1.0.
 * Falls back to accel-only when gyro data is not available.
 */
export function calculateRidingPosition(
  yAxisWindow: number[],
  isPedaling: boolean,
  yAxisThreshold: number = CONSTANTS.Y_AXIS_STANDING_THRESHOLD,
  options?: {
    rollRms?: number
    rollThreshold?: number
    yawRms?: number
    yawThreshold?: number
    gyroWeight?: number
    accelWeight?: number
    rollWeight?: number
    yawWeight?: number
  }
): { position: 'standing' | 'seated' | null; rockingMagnitude: number; rollRms?: number; yawRms?: number; accelScore?: number; gyroScore?: number; combinedScore?: number } {

  // Not pedaling - return null (matches efficiency behavior)
  if (!isPedaling) {
    return {
      position: null,
      rockingMagnitude: 0,
      rollRms: undefined,
      yawRms: undefined,
    }
  }

  // Calculate Y-axis rocking magnitude (std dev of Y-axis in window)
  const rockingMagnitude = calculateStdDev(yAxisWindow)

  const rollRms = options?.rollRms
  const yawRms = options?.yawRms
  const hasRoll = rollRms !== undefined && rollRms !== null
  const hasYaw = yawRms !== undefined && yawRms !== null
  const hasGyro = hasRoll || hasYaw
  const gyroWeight = options?.gyroWeight ?? CONSTANTS.POSITION_GYRO_WEIGHT
  const accelWeight = options?.accelWeight ?? CONSTANTS.POSITION_ACCEL_WEIGHT
  const rollThreshold = options?.rollThreshold ?? CONSTANTS.ROLL_RMS_STANDING_THRESHOLD
  const yawThreshold = options?.yawThreshold ?? CONSTANTS.YAW_RMS_STANDING_THRESHOLD
  const rollWeight = options?.rollWeight ?? CONSTANTS.POSITION_ROLL_WEIGHT
  const yawWeight = options?.yawWeight ?? CONSTANTS.POSITION_YAW_WEIGHT

  let position: 'standing' | 'seated'
  let accelScore: number
  let gyroScore: number | undefined
  let combinedScore: number

  if (hasGyro && gyroWeight > 0) {
    accelScore = rockingMagnitude / yAxisThreshold

    // Gyro score: weighted blend of roll and yaw, each normalized to its threshold
    const rollScore = hasRoll ? (rollRms / rollThreshold) : 0
    const yawScore = hasYaw ? (yawRms / yawThreshold) : 0

    // Normalize weights if only one gyro axis is available
    let effectiveRollWeight = rollWeight
    let effectiveYawWeight = yawWeight
    if (!hasRoll) {
      effectiveRollWeight = 0
      effectiveYawWeight = 1
    } else if (!hasYaw) {
      effectiveRollWeight = 1
      effectiveYawWeight = 0
    }

    gyroScore = effectiveRollWeight * rollScore + effectiveYawWeight * yawScore

    combinedScore = accelWeight * accelScore + gyroWeight * gyroScore
    position = combinedScore >= 1.0 ? 'standing' : 'seated'
  } else {
    // Fallback: accel-only path (no gyro data or gyro weight is 0)
    accelScore = rockingMagnitude / yAxisThreshold
    combinedScore = accelScore
    position = rockingMagnitude >= yAxisThreshold ? 'standing' : 'seated'
  }

  return {
    position,
    rockingMagnitude,
    rollRms: hasRoll ? rollRms : undefined,
    yawRms: hasYaw ? yawRms : undefined,
    accelScore,
    gyroScore,
    combinedScore,
  }
}

/**
 * Helper: Calculate standard deviation
 */
function calculateStdDev(values: number[]): number {
  if (values.length === 0) return 0

  const mean = values.reduce((sum, val) => sum + val, 0) / values.length
  const variance = values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / values.length
  return Math.sqrt(variance)
}

/**
 * Downsample position data using majority vote
 *
 * @param samples - High-frequency position samples
 * @param bucketMs - Bucket size in milliseconds (e.g., 1000 for 1 Hz)
 * @returns Downsampled samples with majority position per bucket
 */
export function downsamplePositionByMajorityVote(
  samples: Array<{ timestamp: string; position: 'standing' | 'seated' | null; rockingMagnitude: number; rollRms?: number; yawRms?: number; cadence: number | null }>,
  bucketMs: number = 1000
): Array<{ timestamp: string; position: 'standing' | 'seated' | null; rockingMagnitude: number; rollRms?: number; yawRms?: number; cadence: number | null }> {

  if (samples.length === 0) return []

  const buckets: Map<number, typeof samples> = new Map()

  // Group samples into time buckets
  for (const sample of samples) {
    const timestamp = new Date(sample.timestamp).getTime()
    const bucketKey = Math.floor(timestamp / bucketMs) * bucketMs

    if (!buckets.has(bucketKey)) {
      buckets.set(bucketKey, [])
    }
    buckets.get(bucketKey)!.push(sample)
  }

  // For each bucket, determine majority position
  const downsampled: typeof samples = []

  for (const [bucketKey, bucketSamples] of buckets) {
    // Count position occurrences
    const counts = {
      standing: 0,
      seated: 0,
      null: 0
    }

    let sumRocking = 0
    let sumRollRms = 0
    let rollRmsCount = 0
    let sumYawRms = 0
    let yawRmsCount = 0
    let sumCadence = 0
    let cadenceCount = 0

    for (const s of bucketSamples) {
      if (s.position === 'standing') counts.standing++
      else if (s.position === 'seated') counts.seated++
      else counts.null++

      sumRocking += s.rockingMagnitude
      if (s.rollRms !== undefined) {
        sumRollRms += s.rollRms
        rollRmsCount++
      }
      if (s.yawRms !== undefined) {
        sumYawRms += s.yawRms
        yawRmsCount++
      }
      if (s.cadence !== null) {
        sumCadence += s.cadence
        cadenceCount++
      }
    }

    // Determine majority position
    let majorityPosition: 'standing' | 'seated' | null
    if (counts.null > counts.standing && counts.null > counts.seated) {
      majorityPosition = null
    } else if (counts.standing > counts.seated) {
      majorityPosition = 'standing'
    } else {
      majorityPosition = 'seated'
    }

    // Use middle sample's timestamp
    const middleSample = bucketSamples[Math.floor(bucketSamples.length / 2)]

    downsampled.push({
      timestamp: middleSample.timestamp,
      position: majorityPosition,
      rockingMagnitude: sumRocking / bucketSamples.length,
      rollRms: rollRmsCount > 0 ? sumRollRms / rollRmsCount : undefined,
      yawRms: yawRmsCount > 0 ? sumYawRms / yawRmsCount : undefined,
      cadence: cadenceCount > 0 ? sumCadence / cadenceCount : null
    })
  }

  return downsampled.sort((a, b) =>
    new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  )
}
