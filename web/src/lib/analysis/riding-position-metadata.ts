/**
 * Riding Position Metadata Calculation
 *
 * Calculates summary statistics for riding position analysis
 */

import type { RidingPositionSample, RidingPositionMetadata } from './riding-position-types'

/**
 * Calculate metadata and statistics from riding position samples
 */
export function calculateRidingPositionMetadata(
  samples: RidingPositionSample[],
  sampleRate: number | null
): RidingPositionMetadata {

  if (samples.length === 0) {
    return {
      standingPercent: 0,
      seatedPercent: 0,
      totalSamples: 0,
      pedalingSamples: 0,
      avgCadenceStanding: null,
      avgCadenceSeated: null,
      avgConfidence: 0,
      sampleRate
    }
  }

  // Count positions
  let standingCount = 0
  let seatedCount = 0
  let pedalingCount = 0

  let standingCadenceSum = 0
  let standingCadenceCount = 0
  let seatedCadenceSum = 0
  let seatedCadenceCount = 0

  let confidenceSum = 0

  for (const sample of samples) {
    confidenceSum += sample.confidence

    if (sample.position !== null) {
      pedalingCount++

      if (sample.position === 'standing') {
        standingCount++
        if (sample.detectedCadence !== null) {
          standingCadenceSum += sample.detectedCadence
          standingCadenceCount++
        }
      } else if (sample.position === 'seated') {
        seatedCount++
        if (sample.detectedCadence !== null) {
          seatedCadenceSum += sample.detectedCadence
          seatedCadenceCount++
        }
      }
    }
  }

  // Calculate percentages relative to pedaling time (not total time)
  const standingPercent = pedalingCount > 0 ? (standingCount / pedalingCount) * 100 : 0
  const seatedPercent = pedalingCount > 0 ? (seatedCount / pedalingCount) * 100 : 0

  return {
    standingPercent,
    seatedPercent,
    totalSamples: samples.length,
    pedalingSamples: pedalingCount,
    avgCadenceStanding: standingCadenceCount > 0 ? standingCadenceSum / standingCadenceCount : null,
    avgCadenceSeated: seatedCadenceCount > 0 ? seatedCadenceSum / seatedCadenceCount : null,
    avgConfidence: samples.length > 0 ? confidenceSum / samples.length : 0,
    sampleRate
  }
}
