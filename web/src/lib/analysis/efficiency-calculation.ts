/**
 * Stability Calculation (v6.0.0)
 *
 * Time-domain RMS stability: measures how much oscillation the rider produces
 * in the BPF'd (0.3-10 Hz) gyro signals within a sliding window.
 * Less motion = more stable. Same approach as position detection (which works).
 *
 * The BPF already isolates the human/pedaling band and rejects DC (gravity,
 * sustained lean) and high-frequency noise. Cornering is a slow sustained lean
 * whose fundamental is well below the 0.3 Hz cutoff — the BPF attenuates it.
 *
 * Per-axis: time-domain RMS of BPF'd signal in the STFT window.
 * Fused: weighted RMS normalized against a ceiling constant.
 * stability = max(0, 1 - weightedRms / MAX_STABILITY_RMS)
 */

import * as C from './pedaling-efficiency-constants'

/**
 * Per-axis RMS result
 */
export interface AxisCadenceRms {
  cadenceRms: number      // Time-domain RMS of BPF'd signal (rad/s or m/s²)
  cadenceEnergy: number   // Reserved for future spectral use (always 0)
}

/**
 * Result from multi-axis stability calculation
 */
export interface StabilityResult {
  stability: number           // 0-1, higher = more stable (less motion)
  rollRms: number             // Gyro-x BPF'd RMS
  yawRms: number              // Gyro-z BPF'd RMS
  surgeRms: number            // Accel-x BPF'd RMS
  cadenceEnergy: number       // Reserved (always 0)
  weightedRms: number         // Weighted RMS before normalization (for debug)
}

/**
 * Compute time-domain RMS of a BPF'd signal window.
 *
 * The BPF (0.3-10 Hz) has already isolated the pedaling band and rejected
 * DC offset, gravity, and sustained cornering lean. RMS of this signal
 * directly measures oscillation amplitude.
 *
 * @param samples - BPF'd signal for this window (e.g., 75 samples at 25 Hz)
 * @param _cadenceHz - unused (kept for interface compatibility)
 * @param _sampleRate - unused (kept for interface compatibility)
 * @returns RMS amplitude of BPF'd signal
 */
export function computeAxisCadenceRms(
  samples: number[],
  _cadenceHz: number,
  _sampleRate: number
): AxisCadenceRms {
  if (samples.length === 0) {
    return { cadenceRms: 0, cadenceEnergy: 0 }
  }

  let sumSquares = 0
  for (let i = 0; i < samples.length; i++) {
    sumSquares += samples[i] * samples[i]
  }

  const cadenceRms = Math.sqrt(sumSquares / samples.length)

  return { cadenceRms, cadenceEnergy: 0 }
}

/**
 * Compute multi-axis stability from three BPF'd signal windows
 *
 * @param rollWindow - BPF'd gyro-x samples for this STFT window
 * @param yawWindow - BPF'd gyro-z samples for this STFT window
 * @param surgeWindow - BPF'd accel-x samples for this STFT window
 * @param cadenceHz - f₀ from FIT cadence (passed through, unused in v6)
 * @param sampleRate - VTX sample rate (passed through, unused in v6)
 * @param options - Weights, ceiling, and power normalization settings
 * @returns Fused stability score and per-axis breakdown
 */
export function calculateStability(
  rollWindow: number[],
  yawWindow: number[],
  surgeWindow: number[],
  cadenceHz: number,
  sampleRate: number,
  options?: {
    weights?: { roll: number; yaw: number; surge: number }
    maxStabilityRms?: number
    maxStabilityRmsPerWatt?: number
    powerNormalize?: boolean
    power?: number | null
  }
): StabilityResult {
  const wRoll = options?.weights?.roll ?? C.STABILITY_ROLL_WEIGHT
  const wYaw = options?.weights?.yaw ?? C.STABILITY_YAW_WEIGHT
  const wSurge = options?.weights?.surge ?? C.STABILITY_SURGE_WEIGHT

  const roll = computeAxisCadenceRms(rollWindow, cadenceHz, sampleRate)
  const yaw = computeAxisCadenceRms(yawWindow, cadenceHz, sampleRate)
  const surge = computeAxisCadenceRms(surgeWindow, cadenceHz, sampleRate)

  // Weighted fusion of per-axis RMS
  const weightedRms = wRoll * roll.cadenceRms
                    + wYaw * yaw.cadenceRms
                    + wSurge * surge.cadenceRms

  // Determine ceiling and apply optional power normalization
  const powerNormalize = options?.powerNormalize ?? C.POWER_NORMALIZE_STABILITY
  const power = options?.power ?? null

  let normalizedRms: number
  let maxRms: number

  if (powerNormalize && power !== null && power > 0) {
    normalizedRms = weightedRms / power
    maxRms = options?.maxStabilityRmsPerWatt ?? C.MAX_STABILITY_RMS_PER_WATT
  } else {
    normalizedRms = weightedRms
    maxRms = options?.maxStabilityRms ?? C.MAX_STABILITY_RMS
  }

  // Inverted: more motion = lower score
  const stability = Math.max(0, 1 - normalizedRms / maxRms)

  return {
    stability,
    rollRms: roll.cadenceRms,
    yawRms: yaw.cadenceRms,
    surgeRms: surge.cadenceRms,
    cadenceEnergy: 0,
    weightedRms,
  }
}

/**
 * Calculate standard deviation of a dataset
 * (Kept for riding position detection which still uses it)
 */
export function calculateStdDev(values: number[]): number {
  if (values.length === 0) return 0

  const mean = values.reduce((sum, v) => sum + v, 0) / values.length
  const squaredDiffs = values.map(v => Math.pow(v - mean, 2))
  const variance = squaredDiffs.reduce((sum, v) => sum + v, 0) / values.length

  return Math.sqrt(variance)
}

/**
 * Smooth grade data with moving average
 *
 * Handles both direct grade field and altitude-derived grade.
 * Grade data is noisy from GPS, so we apply generous smoothing.
 */
export function smoothGrades(
  grades: (number | null)[],
  fitSamples: Array<{ altitude?: number | null }>,
  windowSeconds: number = C.GRADE_SMOOTH_WINDOW_SECONDS
): (number | null)[] {
  // If we have direct grade values, smooth them
  const hasDirectGrade = grades.some(g => g !== null && g !== undefined)

  if (hasDirectGrade) {
    return movingAverage(grades, windowSeconds * 2)  // Rough estimate: 2 samples/sec for FIT
  }

  // Otherwise, calculate from altitude
  const altitudes = fitSamples.map(s => s.altitude ?? null)
  const calculatedGrades: (number | null)[] = [null]  // First point has no grade

  for (let i = 1; i < altitudes.length; i++) {
    const alt1 = altitudes[i - 1]
    const alt2 = altitudes[i]

    if (alt1 === null || alt2 === null) {
      calculatedGrades.push(null)
      continue
    }

    const dAlt = alt2 - alt1
    const dDist = 1
    const grade = (dAlt / dDist) * 100

    calculatedGrades.push(
      Math.max(-C.MAX_GRADE_PERCENT, Math.min(C.MAX_GRADE_PERCENT, grade))
    )
  }

  return movingAverage(calculatedGrades, windowSeconds * 2)
}

/**
 * Moving average filter for smoothing noisy data
 */
function movingAverage(
  data: (number | null)[],
  windowSize: number
): (number | null)[] {
  const result: (number | null)[] = []

  for (let i = 0; i < data.length; i++) {
    const start = Math.max(0, i - Math.floor(windowSize / 2))
    const end = Math.min(data.length, i + Math.ceil(windowSize / 2))
    const window = data.slice(start, end).filter(v => v !== null) as number[]

    if (window.length === 0) {
      result.push(null)
    } else {
      const avg = window.reduce((sum, v) => sum + v, 0) / window.length
      result.push(avg)
    }
  }

  return result
}
