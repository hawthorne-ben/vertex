/**
 * Braking Detection
 *
 * Detects braking events from IMU accelerometer data using pitch analysis.
 *
 * Algorithm:
 * 1. LPF raw accel_x and accel_z to remove vibration/pedaling noise
 * 2. Compute pitch = atan2(smooth_x, smooth_z) — tilt of gravity vector
 * 3. Long rolling average of pitch = grade baseline (slow-changing road grade)
 * 4. Delta = pitch - baseline = braking component (fast transient)
 * 5. braking_decel = g * sin(delta) — convert pitch deviation to m/s²
 * 6. Threshold + scale to 0-100 intensity
 *
 * Key insight: grade changes slowly (10-30s), braking changes fast (<5s).
 * Both shift accel_x via gravity projection, but they're separated by frequency.
 */

import * as C from './imu-constants'
import type { BrakingSample, BrakingMetadata } from './braking-types'

const G = 9.81 // m/s²

export interface BrakingConfig {
  threshold?: number        // Min deceleration to register (m/s²)
  maxDeceleration?: number  // Ceiling for 0-100 scaling (m/s²)
}

/**
 * Calculate braking intensity from a window of per-sample braking deceleration values.
 * Uses PEAK value in window (not mean) to capture short hard brakes.
 *
 * @param brakingDecelWindow - Per-sample braking deceleration values (m/s², positive = braking)
 * @param config - Threshold and scaling config
 * @returns Braking detection result for this window
 */
export function calculateBraking(
  brakingDecelWindow: number[],
  estimatedGradePercent: number,
  config?: BrakingConfig
): { isBraking: boolean; brakingIntensity: number; brakingDecelerationMs2: number; estimatedGradePercent: number } {
  const threshold = config?.threshold ?? C.BRAKING_THRESHOLD_MS2
  const maxDecel = config?.maxDeceleration ?? C.BRAKING_MAX_MS2

  if (brakingDecelWindow.length === 0) {
    return { isBraking: false, brakingIntensity: 0, brakingDecelerationMs2: 0, estimatedGradePercent }
  }

  // Peak braking deceleration in window
  let peak = 0
  for (let i = 0; i < brakingDecelWindow.length; i++) {
    if (brakingDecelWindow[i] > peak) peak = brakingDecelWindow[i]
  }

  const isBraking = peak >= threshold
  const brakingIntensity = isBraking
    ? Math.min(100, (peak / maxDecel) * 100)
    : 0

  return {
    isBraking,
    brakingIntensity,
    brakingDecelerationMs2: peak,
    estimatedGradePercent,
  }
}

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
