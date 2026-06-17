/**
 * Braking Detection
 *
 * Braking is detected inline in ride-imu-analysis.ts by point-sampling the
 * causal BPF output at 5 Hz. This file provides only the metadata aggregation
 * function used after braking samples are produced.
 */

import * as C from './imu-constants'
import type { BrakingSample, BrakingMetadata } from './braking-types'

/**
 * Calculate braking metadata summary from braking samples.
 */
export function calculateBrakingMetadata(
  samples: BrakingSample[],
  sampleRate: number | null
): BrakingMetadata {
  if (samples.length === 0) {
    return {
      totalBrakingEvents: 0,
      totalBrakingSeconds: 0,
      avgBrakingIntensity: 0,
      maxBrakingIntensity: 0,
      maxBrakingDecelerationMs2: 0,
      brakingPercent: 0,
      totalSamples: 0,
      sampleRate,
    }
  }

  const brakingSamples = samples.filter(s => s.isBraking)
  const rate = sampleRate ?? C.OUTPUT_SAMPLE_RATE_HZ

  let maxIntensity = 0
  let maxDecel = 0
  let sumIntensity = 0

  // Count distinct braking events (consecutive braking = one event)
  let totalEvents = 0
  let wasBraking = false

  for (const s of samples) {
    if (s.isBraking) {
      sumIntensity += s.brakingIntensity
      if (s.brakingIntensity > maxIntensity) maxIntensity = s.brakingIntensity
      if (s.brakingDecelerationMs2 > maxDecel) maxDecel = s.brakingDecelerationMs2
      if (!wasBraking) totalEvents++
      wasBraking = true
    } else {
      wasBraking = false
    }
  }

  return {
    totalBrakingEvents: totalEvents,
    totalBrakingSeconds: brakingSamples.length / rate,
    avgBrakingIntensity: brakingSamples.length > 0 ? sumIntensity / brakingSamples.length : 0,
    maxBrakingIntensity: maxIntensity,
    maxBrakingDecelerationMs2: maxDecel,
    brakingPercent: (brakingSamples.length / samples.length) * 100,
    totalSamples: samples.length,
    sampleRate,
  }
}
