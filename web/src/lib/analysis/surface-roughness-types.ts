/**
 * Surface Roughness Types
 *
 * Output types for surface roughness analysis (road vibration measurement)
 */

export interface SurfaceRoughnessSample {
  timestamp: string
  roughness: number | null  // 0-1 normalized score (null when not moving)
  roughnessRms: number      // Raw RMS value in m/s²
  speed: number | null      // From FIT, m/s
}

export interface SurfaceRoughnessMetadata {
  avgRoughness: number
  maxRoughness: number
  smoothSurfacePercent: number   // % time below roughness 0.3
  roughSurfacePercent: number    // % time above roughness 0.7
  totalSamples: number
  sampleRate: number | null
}
