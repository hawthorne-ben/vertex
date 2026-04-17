/**
 * Braking Detection
 *
 * Detects braking events from IMU accelerometer data using pitch analysis,
 * with optional gyroscope pitch-rate correlation for confidence adjustment.
 *
 * Algorithm:
 * 1. Pre-pass: zero-phase Butterworth LPF on accel_x/accel_z (5 Hz cutoff)
 * 2. Compute pitch = atan2(smooth_x, smooth_z) — tilt of gravity vector
 * 3. Zero-phase EMA on pitch = grade baseline (lag-free)
 * 4. Delta = baseline - pitch = braking component (fast transient)
 * 5. braking_decel = g * sin(delta) — convert pitch deviation to m/s²
 * 6. Gyro correlation: boost if gyro_y confirms sustained pitch, penalize if oscillatory
 * 7. Threshold + scale to 0-100 intensity
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
 * Optionally uses gyro pitch rate to adjust confidence and reject terrain transitions.
 *
 * @param brakingDecelWindow - Per-sample braking deceleration values (m/s², positive = braking)
 * @param estimatedGradePercent - Mean grade in window
 * @param config - Threshold and scaling config
 * @param gyroContext - Optional gyro_y data for correlation + terrain rejection
 */
export function calculateBraking(
  brakingDecelWindow: number[],
  estimatedGradePercent: number,
  config?: BrakingConfig,
  gyroContext?: {
    /** Per-sample gyro_y inside the braking window (deg/s) */
    window: number[]
    /** Wider gyro_y context around the window for terrain integration (deg/s) */
    integralWindow: number[]
    /** Sample rate of gyro data (Hz) */
    sampleRate: number
  },
): { isBraking: boolean; brakingIntensity: number; brakingDecelerationMs2: number; estimatedGradePercent: number } {
  const threshold = config?.threshold ?? C.BRAKING_THRESHOLD_MS2
  const maxDecel = config?.maxDeceleration ?? C.BRAKING_MAX_MS2

  if (brakingDecelWindow.length === 0) {
    return { isBraking: false, brakingIntensity: 0, brakingDecelerationMs2: 0, estimatedGradePercent }
  }

  // Peak braking deceleration in window
  let peak = 0
  let peakIdx = 0
  for (let i = 0; i < brakingDecelWindow.length; i++) {
    if (brakingDecelWindow[i] > peak) {
      peak = brakingDecelWindow[i]
      peakIdx = i
    }
  }

  // Gyro pitch rate analysis
  if (gyroContext && gyroContext.window.length === brakingDecelWindow.length) {
    // Terrain rejection: integrate gyro_y over wider window. A net rotation
    // means the bike is tilting to a new pitch (crest/dip), not oscillating
    // around an existing pitch (braking).
    const netRotationDeg = integrateGyro(gyroContext.integralWindow, gyroContext.sampleRate)
    if (Math.abs(netRotationDeg) >= C.BRAKING_GYRO_INTEGRAL_THRESHOLD_DEG) {
      peak = peak * C.BRAKING_TERRAIN_TRANSITION_PENALTY
    } else {
      // Only apply pitch-rate correlation when terrain is stable
      const gyroFactor = computeGyroCorrelation(gyroContext.window, peakIdx)
      peak = peak * gyroFactor
    }
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
 * Integrate gyro pitch rate (deg/s) over an array of samples.
 * Returns net angular displacement in degrees.
 *
 * Trapezoidal integration: sum * dt where dt = 1/sampleRate.
 * For braking (oscillation around an angle), this is ~0.
 * For terrain transitions (rotation to a new angle), this is the rotation magnitude.
 */
function integrateGyro(gyroWindow: number[], sampleRate: number): number {
  if (gyroWindow.length === 0) return 0
  let sum = 0
  for (let i = 0; i < gyroWindow.length; i++) {
    sum += gyroWindow[i]
  }
  return sum / sampleRate
}

/**
 * Compute gyro correlation factor for braking confidence.
 *
 * Braking: gyro_y shows sustained negative pitch rate (nose dives forward),
 *   correlating with deceleration. Factor > 1.0 (boost).
 * Bump: gyro_y oscillates rapidly (positive-negative-positive) as front then
 *   rear wheel hit the obstacle. Factor < 1.0 (penalty).
 * Neutral: gyro_y is quiet. Factor = 1.0 (no adjustment).
 */
function computeGyroCorrelation(gyroWindow: number[], peakIdx: number): number {
  const n = gyroWindow.length
  if (n < 3) return 1.0

  // Analyze gyro_y around the peak (±30% of window)
  const margin = Math.max(2, Math.floor(n * 0.3))
  const start = Math.max(0, peakIdx - margin)
  const end = Math.min(n, peakIdx + margin + 1)

  let sumAbsRate = 0
  let signChanges = 0
  let sustainedNegative = 0

  for (let i = start; i < end; i++) {
    const rate = gyroWindow[i]
    sumAbsRate += Math.abs(rate)

    // Negative gyro_y = forward pitch rotation = braking
    if (rate < -C.BRAKING_GYRO_PITCH_RATE_MIN) {
      sustainedNegative++
    }

    // Count sign reversals (oscillation indicator)
    if (i > start && Math.sign(gyroWindow[i]) !== Math.sign(gyroWindow[i - 1]) && Math.sign(gyroWindow[i]) !== 0) {
      signChanges++
    }
  }

  const windowLen = end - start
  const meanAbsRate = sumAbsRate / windowLen

  // Quiet gyro — no useful signal, stay neutral
  if (meanAbsRate < C.BRAKING_GYRO_PITCH_RATE_MIN) {
    return 1.0
  }

  // Oscillatory pattern: multiple sign changes = bump, not braking
  const oscillationRatio = signChanges / windowLen
  if (oscillationRatio > 0.3) {
    return 1.0 - C.BRAKING_GYRO_OSCILLATION_PENALTY
  }

  // Sustained negative pitch rate = braking confirmation
  const sustainedRatio = sustainedNegative / windowLen
  if (sustainedRatio > 0.4) {
    return 1.0 + C.BRAKING_GYRO_CORRELATION_BOOST
  }

  return 1.0
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
