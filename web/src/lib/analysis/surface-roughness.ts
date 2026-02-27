/**
 * Surface Roughness Calculation
 *
 * Measures road-induced vibration using accel-x (longitudinal) and accel-z (vertical).
 * Both axes are used because on grades, gravity projects between them as the bike
 * pitches — using only accel-z would undercount roughness on steep climbs/descents.
 */

import * as C from './pedaling-efficiency-constants'
import type { SurfaceRoughnessSample, SurfaceRoughnessMetadata } from './surface-roughness-types'

/**
 * Calculate surface roughness RMS from HPF'd accel-x and accel-z windows
 *
 * @param accelXWindow - HPF'd longitudinal acceleration samples (m/s²)
 * @param accelZWindow - HPF'd vertical acceleration samples (m/s²)
 * @returns Raw RMS in m/s² and normalized 0-1 roughness score
 */
export function calculateRoughness(
  accelXWindow: number[],
  accelZWindow: number[]
): { roughnessRms: number; roughness: number } {
  const len = Math.min(accelXWindow.length, accelZWindow.length)
  if (len === 0) return { roughnessRms: 0, roughness: 0 }

  // Combined magnitude: sqrt(x² + z²) per sample, then RMS
  let sumSquares = 0
  for (let i = 0; i < len; i++) {
    const x = accelXWindow[i]
    const z = accelZWindow[i]
    sumSquares += x * x + z * z
  }

  const roughnessRms = Math.sqrt(sumSquares / len)
  const roughness = Math.min(1.0, roughnessRms / C.MAX_ROUGHNESS_RMS)

  return { roughnessRms, roughness }
}

/**
 * Calculate metadata summary from roughness samples
 */
export function calculateRoughnessMetadata(
  samples: SurfaceRoughnessSample[],
  sampleRate: number | null
): SurfaceRoughnessMetadata {
  if (samples.length === 0) {
    return {
      avgRoughness: 0,
      maxRoughness: 0,
      smoothSurfacePercent: 0,
      roughSurfacePercent: 0,
      totalSamples: 0,
      sampleRate,
    }
  }

  let sum = 0
  let max = 0
  let smoothCount = 0
  let roughCount = 0

  for (const s of samples) {
    sum += s.roughness
    if (s.roughness > max) max = s.roughness
    if (s.roughness < 0.3) smoothCount++
    if (s.roughness > 0.7) roughCount++
  }

  return {
    avgRoughness: sum / samples.length,
    maxRoughness: max,
    smoothSurfacePercent: (smoothCount / samples.length) * 100,
    roughSurfacePercent: (roughCount / samples.length) * 100,
    totalSamples: samples.length,
    sampleRate,
  }
}
