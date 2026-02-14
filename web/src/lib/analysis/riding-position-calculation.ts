/**
 * Riding Position Calculation
 *
 * Detects standing vs. seated based on Y-axis (lateral) rocking motion
 */

import * as CONSTANTS from './pedaling-efficiency-constants'

/**
 * Calculate riding position from Y-axis acceleration data
 *
 * @param yAxisWindow - Array of Y-axis acceleration values in the analysis window
 * @param confidence - Pedaling detection confidence (from FFT)
 * @param cadence - Detected cadence (from FFT)
 * @param confidenceThreshold - Minimum confidence to report position
 * @param yAxisThreshold - Y-axis magnitude threshold for standing detection
 * @returns Position ('standing', 'seated', or null if not pedaling)
 */
export function calculateRidingPosition(
  yAxisWindow: number[],
  confidence: number,
  cadence: number | null,
  confidenceThreshold: number = CONSTANTS.CONFIDENCE_THRESHOLD,
  yAxisThreshold: number = CONSTANTS.Y_AXIS_STANDING_THRESHOLD
): { position: 'standing' | 'seated' | null; rockingMagnitude: number } {

  // Not pedaling - return null (matches efficiency behavior)
  if (confidence < confidenceThreshold || cadence === null) {
    return {
      position: null,
      rockingMagnitude: 0
    }
  }

  // Calculate Y-axis rocking magnitude (std dev of Y-axis in window)
  const rockingMagnitude = calculateStdDev(yAxisWindow)

  // Determine position based on lateral rocking
  // Standing creates significant side-to-side motion not present when seated
  // Threshold needs to be higher - most seated riding has Y-axis stddev < 0.8
  const position = rockingMagnitude >= yAxisThreshold ? 'standing' : 'seated'

  return {
    position,
    rockingMagnitude
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
  samples: Array<{ timestamp: string; position: 'standing' | 'seated' | null; rockingMagnitude: number; confidence: number; detectedCadence: number | null }>,
  bucketMs: number = 1000
): Array<{ timestamp: string; position: 'standing' | 'seated' | null; rockingMagnitude: number; confidence: number; detectedCadence: number | null }> {

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
    let sumConfidence = 0
    let sumCadence = 0
    let cadenceCount = 0

    for (const s of bucketSamples) {
      if (s.position === 'standing') counts.standing++
      else if (s.position === 'seated') counts.seated++
      else counts.null++

      sumRocking += s.rockingMagnitude
      sumConfidence += s.confidence
      if (s.detectedCadence !== null) {
        sumCadence += s.detectedCadence
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
      confidence: sumConfidence / bucketSamples.length,
      detectedCadence: cadenceCount > 0 ? sumCadence / cadenceCount : null
    })
  }

  return downsampled.sort((a, b) =>
    new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  )
}
