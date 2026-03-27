/**
 * Surface Roughness Calculation
 *
 * Measures road-induced vibration using accel-x (longitudinal) and accel-z (vertical).
 * Both axes are used because on grades, gravity projects between them as the bike
 * pitches — using only accel-z would undercount roughness on steep climbs/descents.
 *
 * Speed normalization: vibration scales with speed, so the RMS ceiling is
 * scaled as baseCeiling * (speed/refSpeed)^exponent. Exponent is tunable.
 * No speed (stopped) → null roughness (like stability with no cadence).
 */

import * as C from './imu-constants'
import type { SurfaceRoughnessSample, SurfaceRoughnessMetadata } from './surface-roughness-types'

export interface RoughnessSpeedConfig {
  baseCeiling?: number       // RMS ceiling at reference speed
  referenceSpeedMs?: number  // Reference speed for ceiling (m/s)
  speedExponent?: number     // Power law exponent (1.0 = linear, 2.0 = energy, 0.5 = sqrt)
}

/**
 * Compute the speed-adjusted RMS ceiling for roughness normalization.
 * ceiling = baseCeiling * (speed / refSpeed) ^ exponent
 *
 * Exponent guide:
 *  0.5 = sqrt (conservative correction)
 *  1.0 = linear (RMS amplitude scales ~linearly with speed)
 *  2.0 = quadratic (energy scaling, too aggressive for RMS)
 */
function getSpeedAdjustedCeiling(
  speedMs: number,
  config: RoughnessSpeedConfig
): number {
  const baseCeiling = config.baseCeiling ?? C.ROUGHNESS_BASE_CEILING
  const refSpeed = config.referenceSpeedMs ?? C.ROUGHNESS_REFERENCE_SPEED_MS
  const exponent = config.speedExponent ?? C.ROUGHNESS_SPEED_EXPONENT

  const ratio = speedMs / refSpeed
  return baseCeiling * Math.pow(ratio, exponent)
}

/**
 * Calculate surface roughness RMS from HPF'd accel-x and accel-z windows
 *
 * @param accelXWindow - HPF'd longitudinal acceleration samples (m/s²)
 * @param accelZWindow - HPF'd vertical acceleration samples (m/s²)
 * @param speed - Speed in m/s for this window (null/0 = not moving, skip roughness)
 * @param speedConfig - Speed-scaled ceiling configuration
 * @returns Raw RMS and normalized 0-1 roughness score (null if not moving)
 */
export function calculateRoughness(
  accelXWindow: number[],
  accelZWindow: number[],
  speed: number | null,
  speedConfig?: RoughnessSpeedConfig
): { roughnessRms: number; roughness: number | null } {
  const len = Math.min(accelXWindow.length, accelZWindow.length)
  if (len === 0) return { roughnessRms: 0, roughness: null }

  // Combined magnitude: sqrt(x² + z²) per sample, then RMS
  let sumSquares = 0
  for (let i = 0; i < len; i++) {
    const x = accelXWindow[i]
    const z = accelZWindow[i]
    sumSquares += x * x + z * z
  }

  const roughnessRms = Math.sqrt(sumSquares / len)

  // Not moving → no roughness score (like stability with no cadence)
  if (speed === null || speed <= 0) {
    return { roughnessRms, roughness: null }
  }

  // Speed-adjusted ceiling
  const ceiling = getSpeedAdjustedCeiling(speed, speedConfig ?? {})
  const roughness = Math.min(1.0, roughnessRms / ceiling)

  return { roughnessRms, roughness }
}

/**
 * Calculate metadata summary from roughness samples
 * Only includes samples where roughness is not null (rider was moving)
 */
export function calculateRoughnessMetadata(
  samples: SurfaceRoughnessSample[],
  sampleRate: number | null,
  options?: { smoothThreshold?: number; roughThreshold?: number }
): SurfaceRoughnessMetadata {
  const smoothThreshold = options?.smoothThreshold ?? C.ROUGHNESS_SMOOTH_THRESHOLD
  const roughThreshold = options?.roughThreshold ?? C.ROUGHNESS_ROUGH_THRESHOLD

  // Only count samples where roughness was computed (rider moving)
  const movingSamples = samples.filter(s => s.roughness !== null)

  if (movingSamples.length === 0) {
    return {
      avgRoughness: 0,
      maxRoughness: 0,
      smoothSurfacePercent: 0,
      roughSurfacePercent: 0,
      totalSamples: samples.length,
      sampleRate,
    }
  }

  let sum = 0
  let max = 0
  let smoothCount = 0
  let roughCount = 0

  for (const s of movingSamples) {
    const r = s.roughness!
    sum += r
    if (r > max) max = r
    if (r < smoothThreshold) smoothCount++
    if (r > roughThreshold) roughCount++
  }

  return {
    avgRoughness: sum / movingSamples.length,
    maxRoughness: max,
    smoothSurfacePercent: (smoothCount / movingSamples.length) * 100,
    roughSurfacePercent: (roughCount / movingSamples.length) * 100,
    totalSamples: samples.length,
    sampleRate,
  }
}
