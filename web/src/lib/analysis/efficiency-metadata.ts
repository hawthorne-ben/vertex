/**
 * Stability Metadata and Statistics (v5.1.0)
 *
 * Calculates summary statistics, percentiles, distributions, and debug info
 * for pedaling stability analysis results.
 *
 * Renamed from "efficiency" to "stability" in v5.0.0.
 * Type names kept as PedalingEfficiency* for backwards compatibility with
 * existing API consumers and database schema.
 */

import * as CONSTANTS from './imu-constants'

// ============================================
// TYPE DEFINITIONS
// ============================================

export interface PedalingEfficiencyOutput {
  timestamp: string
  stability: number | null         // 0-1, higher = more stable (less motion)
  stabilityPercent: number | null  // 0-100
  isPedaling: boolean              // true when FIT cadence > 0
  cadence: number | null           // Cadence in RPM from FIT sensor
  cadenceHz: number | null         // f₀ used for this window
  cadenceEnergy: number | null     // Energy at f₀ (debug/tuning)
  weightedRms: number | null       // Weighted RMS before normalization (debug/tuning)
  rollRms: number | null           // Gyro-x cadence-band RMS (debug/tuning)
  yawRms: number | null            // Gyro-z cadence-band RMS (debug/tuning)
  surgeRms: number | null          // Accel-x cadence-band RMS (debug/tuning)
  grade: number | null             // Percent slope (null if unavailable)
}

export interface PedalingEfficiencyMetadata {
  avgStability: number | null      // Average stability score 0-1
  avgStabilityPercent: number | null
  stablePercent: number            // % of pedaling time stability > 0.7
  unstablePercent: number          // % of pedaling time stability < 0.5
  pedalingPercent: number          // % of time pedaling (cadence > 0)
  avgCadence: number | null        // Average cadence in RPM from FIT sensor
  totalSamples: number
  pedalingSamples: number
  hasGrade: boolean
  sampleRate: number | null
  debug?: DebugStatistics
}

export interface DebugStatistics {
  // Per-axis cadence-band RMS stats (pedaling samples only)
  rollRmsStats: PercentileStats
  yawRmsStats: PercentileStats
  surgeRmsStats: PercentileStats

  // Cadence distribution (for pedaling segments only)
  cadenceDistribution: {
    min: number | null
    max: number | null
    mean: number | null
    histogram: Array<{ rpm: number; count: number }>
  }

  // Sample windows for inspection
  sampleWindows: {
    highStability: PedalingEfficiencyOutput[]
    lowStability: PedalingEfficiencyOutput[]
  }
}

export interface PercentileStats {
  min: number
  p10: number
  p25: number
  p50: number  // median
  p75: number
  p90: number
  max: number
  mean: number
}

// ============================================
// METADATA CALCULATION
// ============================================

/**
 * Calculate summary metadata from stability samples
 */
export function calculateMetadata(
  samples: PedalingEfficiencyOutput[],
  grades: (number | null)[],
  sampleRate: number | null,
  includeDebug: boolean,
  options?: { stableThreshold?: number; unstableThreshold?: number }
): PedalingEfficiencyMetadata {
  if (samples.length === 0) {
    return {
      avgStability: null,
      avgStabilityPercent: null,
      stablePercent: 0,
      unstablePercent: 0,
      pedalingPercent: 0,
      avgCadence: null,
      totalSamples: 0,
      pedalingSamples: 0,
      hasGrade: false,
      sampleRate: null
    }
  }

  // Filter to only pedaling samples (where stability is not null)
  const pedalingSamples = samples.filter(s => s.stability !== null)
  const pedalingSampleCount = pedalingSamples.length

  let avgStability: number | null = null
  let avgStabilityPercent: number | null = null
  let stableCount = 0
  let unstableCount = 0

  if (pedalingSampleCount > 0) {
    avgStability = pedalingSamples.reduce((sum, s) => sum + (s.stability ?? 0), 0) / pedalingSampleCount
    avgStabilityPercent = avgStability * 100
    const stableThreshold = options?.stableThreshold ?? CONSTANTS.STABLE_THRESHOLD
    const unstableThreshold = options?.unstableThreshold ?? CONSTANTS.UNSTABLE_THRESHOLD
    stableCount = pedalingSamples.filter(s => (s.stability ?? 0) > stableThreshold).length
    unstableCount = pedalingSamples.filter(s => (s.stability ?? 0) < unstableThreshold).length
  }

  // Calculate average cadence from FIT sensor
  const cadenceSamples = samples.filter(s => s.cadence !== null && s.cadence! > 0)
  const avgCadence = cadenceSamples.length > 0
    ? cadenceSamples.reduce((sum, s) => sum + (s.cadence ?? 0), 0) / cadenceSamples.length
    : null

  const metadata: PedalingEfficiencyMetadata = {
    avgStability,
    avgStabilityPercent,
    stablePercent: pedalingSampleCount > 0 ? (stableCount / pedalingSampleCount) * 100 : 0,
    unstablePercent: pedalingSampleCount > 0 ? (unstableCount / pedalingSampleCount) * 100 : 0,
    pedalingPercent: (pedalingSampleCount / samples.length) * 100,
    avgCadence,
    totalSamples: samples.length,
    pedalingSamples: pedalingSampleCount,
    hasGrade: grades.some(g => g !== null),
    sampleRate
  }

  if (includeDebug) {
    metadata.debug = calculateDebugStatistics(
      samples,
      sampleRate ?? CONSTANTS.DEFAULT_SAMPLE_RATE_HZ
    )
  }

  return metadata
}

// ============================================
// DEBUG STATISTICS
// ============================================

function calculateDebugStatistics(
  samples: PedalingEfficiencyOutput[],
  sampleRate: number
): DebugStatistics {
  const pedalingSamples = samples.filter(s => s.stability !== null)

  const rollRmsStats = calculatePercentileStats(
    pedalingSamples.map(s => s.rollRms ?? 0)
  )
  const yawRmsStats = calculatePercentileStats(
    pedalingSamples.map(s => s.yawRms ?? 0)
  )
  const surgeRmsStats = calculatePercentileStats(
    pedalingSamples.map(s => s.surgeRms ?? 0)
  )

  // Cadence distribution
  const cadenceSamples = samples.filter(s => s.cadence !== null && s.cadence! > 0)
  const cadences = cadenceSamples.map(s => s.cadence!)

  const cadenceDistribution = {
    min: cadences.length > 0 ? Math.min(...cadences) : null,
    max: cadences.length > 0 ? Math.max(...cadences) : null,
    mean: cadences.length > 0 ? cadences.reduce((sum, c) => sum + c, 0) / cadences.length : null,
    histogram: createCadenceHistogram(cadences)
  }

  const windowSize = Math.floor(CONSTANTS.DEBUG_WINDOW_SECONDS * sampleRate)

  const sampleWindows = {
    highStability: findBestWindow(pedalingSamples, windowSize, s => s.stability ?? 0, true),
    lowStability: findBestWindow(pedalingSamples, windowSize, s => s.stability ?? 0, false)
  }

  return {
    rollRmsStats,
    yawRmsStats,
    surgeRmsStats,
    cadenceDistribution,
    sampleWindows
  }
}

// ============================================
// PERCENTILE STATISTICS
// ============================================

export function calculatePercentileStats(values: number[]): PercentileStats {
  if (values.length === 0) {
    return { min: 0, p10: 0, p25: 0, p50: 0, p75: 0, p90: 0, max: 0, mean: 0 }
  }

  const sorted = [...values].sort((a, b) => a - b)
  const n = sorted.length
  const mean = values.reduce((sum, v) => sum + v, 0) / n

  const percentile = (p: number) => {
    const index = Math.floor((p / 100) * (n - 1))
    return sorted[index]
  }

  return {
    min: sorted[0],
    p10: percentile(10),
    p25: percentile(25),
    p50: percentile(50),
    p75: percentile(75),
    p90: percentile(90),
    max: sorted[n - 1],
    mean
  }
}

// ============================================
// UTILITY FUNCTIONS
// ============================================

function createCadenceHistogram(cadences: number[]): Array<{ rpm: number; count: number }> {
  if (cadences.length === 0) return []

  const buckets = new Map<number, number>()

  for (const cadence of cadences) {
    const bucket = Math.floor(cadence / 10) * 10
    buckets.set(bucket, (buckets.get(bucket) || 0) + 1)
  }

  return Array.from(buckets.entries())
    .map(([rpm, count]) => ({ rpm, count }))
    .sort((a, b) => a.rpm - b.rpm)
}

function findBestWindow(
  samples: PedalingEfficiencyOutput[],
  windowSize: number,
  metric: (s: PedalingEfficiencyOutput) => number,
  maximize: boolean
): PedalingEfficiencyOutput[] {
  if (samples.length === 0 || windowSize > samples.length) {
    return samples.slice(0, Math.min(windowSize, samples.length))
  }

  let bestScore = maximize ? -Infinity : Infinity
  let bestStart = 0

  for (let i = 0; i <= samples.length - windowSize; i++) {
    const window = samples.slice(i, i + windowSize)
    const score = window.reduce((sum, s) => sum + metric(s), 0) / windowSize

    if ((maximize && score > bestScore) || (!maximize && score < bestScore)) {
      bestScore = score
      bestStart = i
    }
  }

  return samples.slice(bestStart, bestStart + windowSize)
}
