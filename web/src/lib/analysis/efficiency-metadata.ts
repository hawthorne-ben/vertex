/**
 * Efficiency Metadata and Statistics
 *
 * Calculates summary statistics, percentiles, distributions, and debug info
 * for pedaling efficiency analysis results.
 */

import * as CONSTANTS from './pedaling-efficiency-constants'

// ============================================
// TYPE DEFINITIONS
// ============================================

export interface PedalingEfficiencyOutput {
  timestamp: string
  efficiency: number | null   // 0-1, higher = smoother, null when not pedaling
  efficiencyPercent: number | null  // 0-100, null when not pedaling
  isPedaling: boolean         // true when FIT cadence > 0
  cadence: number | null      // Cadence in RPM from FIT sensor
  rawAccel: number           // m/s^2, raw acceleration (magnitude)
  filteredAccel: number      // m/s^2, after high-pass filter (gravity removed)
  grade: number | null       // Percent slope (null if unavailable)
}

export interface PedalingEfficiencyMetadata {
  avgEfficiency: number | null // Average efficiency score 0-1 (null if never pedaling)
  avgEfficiencyPercent: number | null // Average efficiency 0-100 (null if never pedaling)
  smoothPercent: number       // % of pedaling time efficiency > 0.7
  roughPercent: number        // % of pedaling time efficiency < 0.5
  pedalingPercent: number     // % of time pedaling (cadence > 0)
  avgCadence: number | null   // Average cadence in RPM from FIT sensor
  totalSamples: number
  pedalingSamples: number     // Number of samples where pedaling was detected
  hasGrade: boolean
  sampleRate: number | null   // Detected Hz
  debug?: DebugStatistics     // Optional debug stats
}

export interface DebugStatistics {
  // Signal statistics
  rawAccelStats: PercentileStats
  filteredAccelStats: PercentileStats
  stdDevStats: PercentileStats

  // Cadence distribution (for pedaling segments only)
  cadenceDistribution: {
    min: number | null
    max: number | null
    mean: number | null
    histogram: Array<{ rpm: number; count: number }> // 10 RPM buckets
  }

  // Sample windows for inspection
  sampleWindows: {
    highEfficiency: PedalingEfficiencyOutput[]          // 5s of smooth pedaling
    lowEfficiency: PedalingEfficiencyOutput[]           // 5s of rough pedaling
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
 * Calculate summary metadata from efficiency samples
 */
export function calculateMetadata(
  samples: PedalingEfficiencyOutput[],
  processedSamples: Array<{ rawAccel: number; filteredAccel: number }>,
  grades: (number | null)[],
  sampleRate: number | null,
  includeDebug: boolean
): PedalingEfficiencyMetadata {
  if (samples.length === 0) {
    return {
      avgEfficiency: null,
      avgEfficiencyPercent: null,
      smoothPercent: 0,
      roughPercent: 0,
      pedalingPercent: 0,
      avgCadence: null,
      totalSamples: 0,
      pedalingSamples: 0,
      hasGrade: false,
      sampleRate: null
    }
  }

  // Filter to only pedaling samples (where efficiency is not null)
  const pedalingSamples = samples.filter(s => s.efficiency !== null)
  const pedalingSampleCount = pedalingSamples.length

  let avgEfficiency: number | null = null
  let avgEfficiencyPercent: number | null = null
  let smoothCount = 0
  let roughCount = 0

  if (pedalingSampleCount > 0) {
    avgEfficiency = pedalingSamples.reduce((sum, s) => sum + (s.efficiency ?? 0), 0) / pedalingSampleCount
    avgEfficiencyPercent = avgEfficiency * 100
    smoothCount = pedalingSamples.filter(s => (s.efficiency ?? 0) > CONSTANTS.SMOOTH_THRESHOLD).length
    roughCount = pedalingSamples.filter(s => (s.efficiency ?? 0) < CONSTANTS.ROUGH_THRESHOLD).length
  }

  // Calculate average cadence from FIT sensor
  const cadenceSamples = samples.filter(s => s.cadence !== null && s.cadence! > 0)
  const avgCadence = cadenceSamples.length > 0
    ? cadenceSamples.reduce((sum, s) => sum + (s.cadence ?? 0), 0) / cadenceSamples.length
    : null

  const metadata: PedalingEfficiencyMetadata = {
    avgEfficiency,
    avgEfficiencyPercent,
    smoothPercent: pedalingSampleCount > 0 ? (smoothCount / pedalingSampleCount) * 100 : 0,
    roughPercent: pedalingSampleCount > 0 ? (roughCount / pedalingSampleCount) * 100 : 0,
    pedalingPercent: (pedalingSampleCount / samples.length) * 100,
    avgCadence,
    totalSamples: samples.length,
    pedalingSamples: pedalingSampleCount,
    hasGrade: grades.some(g => g !== null),
    sampleRate
  }

  // Add debug statistics if requested
  if (includeDebug) {
    metadata.debug = calculateDebugStatistics(
      samples,
      processedSamples,
      sampleRate ?? CONSTANTS.DEFAULT_SAMPLE_RATE_HZ
    )
  }

  return metadata
}

// ============================================
// DEBUG STATISTICS
// ============================================

/**
 * Calculate debug statistics for analysis
 */
function calculateDebugStatistics(
  samples: PedalingEfficiencyOutput[],
  processedSamples: Array<{ rawAccel: number; filteredAccel: number }>,
  sampleRate: number
): DebugStatistics {
  // Calculate percentile stats for various metrics
  const rawAccelStats = calculatePercentileStats(processedSamples.map(s => Math.abs(s.rawAccel)))
  const filteredAccelStats = calculatePercentileStats(processedSamples.map(s => Math.abs(s.filteredAccel)))

  // Calculate std dev for each sample's window (reconstruct from efficiency)
  const stdDevValues = samples.map(s => {
    if (s.efficiency === null || s.efficiency === 0) return 0
    // Inverse of efficiency = exp(-k * stdDev) → stdDev = -ln(efficiency) / k
    return -Math.log(Math.max(0.1, s.efficiency)) / CONSTANTS.EFFICIENCY_DECAY_CONSTANT
  })
  const stdDevStats = calculatePercentileStats(stdDevValues)

  // Cadence distribution (for pedaling samples only)
  const cadenceSamples = samples.filter(s => s.cadence !== null && s.cadence! > 0)
  const cadences = cadenceSamples.map(s => s.cadence!)

  const cadenceDistribution = {
    min: cadences.length > 0 ? Math.min(...cadences) : null,
    max: cadences.length > 0 ? Math.max(...cadences) : null,
    mean: cadences.length > 0 ? cadences.reduce((sum, c) => sum + c, 0) / cadences.length : null,
    histogram: createCadenceHistogram(cadences)
  }

  // Find sample windows for inspection
  const windowSize = Math.floor(CONSTANTS.DEBUG_WINDOW_SECONDS * sampleRate)

  const sampleWindows = {
    highEfficiency: findBestWindow(samples.filter(s => s.efficiency !== null), windowSize, s => s.efficiency ?? 0, true),
    lowEfficiency: findBestWindow(samples.filter(s => s.efficiency !== null), windowSize, s => s.efficiency ?? 0, false)
  }

  return {
    rawAccelStats,
    filteredAccelStats,
    stdDevStats,
    cadenceDistribution,
    sampleWindows
  }
}

// ============================================
// PERCENTILE STATISTICS
// ============================================

/**
 * Calculate percentile statistics for a dataset
 */
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

/**
 * Create histogram of cadence values in 10 RPM buckets
 */
function createCadenceHistogram(cadences: number[]): Array<{ rpm: number; count: number }> {
  if (cadences.length === 0) return []

  const buckets = new Map<number, number>()

  for (const cadence of cadences) {
    const bucket = Math.floor(cadence / 10) * 10  // Round down to nearest 10
    buckets.set(bucket, (buckets.get(bucket) || 0) + 1)
  }

  return Array.from(buckets.entries())
    .map(([rpm, count]) => ({ rpm, count }))
    .sort((a, b) => a.rpm - b.rpm)
}

/**
 * Find best window of samples based on a metric
 */
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
