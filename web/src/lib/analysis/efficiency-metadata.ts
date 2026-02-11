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
  confidence: number          // 0-1, confidence that we're actually pedaling
  detectedCadence: number | null  // Detected cadence in RPM from FFT
  rawAccel: number           // m/s^2, raw acceleration (magnitude or accel_x)
  filteredAccel: number      // m/s^2, after high-pass filter (gravity removed)
  grade: number | null       // Percent slope (null if unavailable)
}

export interface PedalingEfficiencyMetadata {
  avgEfficiency: number | null // Average efficiency score 0-1 (null if never pedaling)
  avgEfficiencyPercent: number | null // Average efficiency 0-100 (null if never pedaling)
  smoothPercent: number       // % of pedaling time efficiency > 0.7
  roughPercent: number        // % of pedaling time efficiency < 0.5
  pedalingPercent: number     // % of time confidently pedaling
  avgConfidence: number       // Average confidence score 0-1
  avgDetectedCadence: number | null // Average detected cadence in RPM
  totalSamples: number
  pedalingSamples: number     // Number of samples where pedaling was detected
  hasCadence: boolean
  hasGrade: boolean
  sampleRate: number | null   // Detected Hz
  debug?: DebugStatistics     // Optional debug stats
}

export interface DebugStatistics {
  // Signal statistics
  rawAccelStats: PercentileStats
  filteredAccelStats: PercentileStats
  stdDevStats: PercentileStats

  // Confidence distribution
  confidenceStats: PercentileStats
  confidenceDistribution: {
    veryLow: number    // % with confidence < 0.1
    low: number        // % with confidence 0.1-0.3
    medium: number     // % with confidence 0.3-0.6
    high: number       // % with confidence > 0.6
  }

  // Cadence distribution (for pedaling segments only)
  cadenceDistribution: {
    min: number | null
    max: number | null
    mean: number | null
    histogram: Array<{ rpm: number; count: number }> // 10 RPM buckets
  }

  // Sample windows for inspection
  sampleWindows: {
    highConfidencePedaling: PedalingEfficiencyOutput[]  // 5s of high confidence
    lowConfidence: PedalingEfficiencyOutput[]           // 5s of low confidence
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
 *
 * @param samples - Efficiency output samples
 * @param processedSamples - Processed acceleration data
 * @param grades - Grade data
 * @param sampleRate - Sample rate in Hz
 * @param includeDebug - Whether to include debug statistics
 * @param confidenceThreshold - Threshold for pedaling detection
 * @returns Metadata object
 */
export function calculateMetadata(
  samples: PedalingEfficiencyOutput[],
  processedSamples: Array<{ rawAccel: number; filteredAccel: number }>,
  grades: (number | null)[],
  sampleRate: number | null,
  includeDebug: boolean,
  confidenceThreshold: number
): PedalingEfficiencyMetadata {
  if (samples.length === 0) {
    return {
      avgEfficiency: null,
      avgEfficiencyPercent: null,
      smoothPercent: 0,
      roughPercent: 0,
      pedalingPercent: 0,
      avgConfidence: 0,
      avgDetectedCadence: null,
      totalSamples: 0,
      pedalingSamples: 0,
      hasCadence: false,
      hasGrade: false,
      sampleRate: null
    }
  }

  // Filter to only pedaling samples (where efficiency is not null)
  const pedalingSamples = samples.filter(s => s.efficiency !== null)
  const pedalingSampleCount = pedalingSamples.length

  // Calculate averages
  const avgConfidence = samples.reduce((sum, s) => sum + s.confidence, 0) / samples.length

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

  // Calculate average detected cadence
  const cadenceSamples = samples.filter(s => s.detectedCadence !== null)
  const avgDetectedCadence = cadenceSamples.length > 0
    ? cadenceSamples.reduce((sum, s) => sum + (s.detectedCadence ?? 0), 0) / cadenceSamples.length
    : null

  const metadata: PedalingEfficiencyMetadata = {
    avgEfficiency,
    avgEfficiencyPercent,
    smoothPercent: pedalingSampleCount > 0 ? (smoothCount / pedalingSampleCount) * 100 : 0,
    roughPercent: pedalingSampleCount > 0 ? (roughCount / pedalingSampleCount) * 100 : 0,
    pedalingPercent: (pedalingSampleCount / samples.length) * 100,
    avgConfidence,
    avgDetectedCadence,
    totalSamples: samples.length,
    pedalingSamples: pedalingSampleCount,
    hasCadence: avgDetectedCadence !== null,
    hasGrade: grades.some(g => g !== null),
    sampleRate
  }

  // Add debug statistics if requested
  if (includeDebug) {
    metadata.debug = calculateDebugStatistics(
      samples,
      processedSamples,
      confidenceThreshold,
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
  confidenceThreshold: number,
  sampleRate: number
): DebugStatistics {
  // Calculate percentile stats for various metrics
  const rawAccelStats = calculatePercentileStats(processedSamples.map(s => Math.abs(s.rawAccel)))
  const filteredAccelStats = calculatePercentileStats(processedSamples.map(s => Math.abs(s.filteredAccel)))
  const confidenceStats = calculatePercentileStats(samples.map(s => s.confidence))

  // Calculate std dev for each sample's window (reconstruct from efficiency)
  const stdDevValues = samples.map(s => {
    if (s.efficiency === null || s.efficiency === 0) return 0
    // Inverse of rescaled efficiency formula
    // First undo rescaling: [RESCALE_MIN, RESCALE_MAX] → [EFFICIENCY_FLOOR, 1.0]
    const rawEff = CONSTANTS.EFFICIENCY_FLOOR +
      (s.efficiency - CONSTANTS.RESCALE_MIN) *
      (1.0 - CONSTANTS.EFFICIENCY_FLOOR) /
      (CONSTANTS.RESCALE_MAX - CONSTANTS.RESCALE_MIN)

    // Then invert: efficiency = exp(-k * stdDev) → stdDev = -ln(efficiency) / k
    return -Math.log(Math.max(0.1, rawEff)) / CONSTANTS.EFFICIENCY_DECAY_CONSTANT
  })
  const stdDevStats = calculatePercentileStats(stdDevValues)

  // Confidence distribution
  const veryLow = samples.filter(s => s.confidence < 0.1).length / samples.length * 100
  const low = samples.filter(s => s.confidence >= 0.1 && s.confidence < 0.3).length / samples.length * 100
  const medium = samples.filter(s => s.confidence >= 0.3 && s.confidence < 0.6).length / samples.length * 100
  const high = samples.filter(s => s.confidence >= 0.6).length / samples.length * 100

  // Cadence distribution (for pedaling samples only)
  const cadenceSamples = samples.filter(s => s.detectedCadence !== null)
  const cadences = cadenceSamples.map(s => s.detectedCadence!)

  const cadenceDistribution = {
    min: cadences.length > 0 ? Math.min(...cadences) : null,
    max: cadences.length > 0 ? Math.max(...cadences) : null,
    mean: cadences.length > 0 ? cadences.reduce((sum, c) => sum + c, 0) / cadences.length : null,
    histogram: createCadenceHistogram(cadences)
  }

  // Find sample windows for inspection
  const windowSize = Math.floor(CONSTANTS.DEBUG_WINDOW_SECONDS * sampleRate)

  const sampleWindows = {
    highConfidencePedaling: findBestWindow(samples, windowSize, s => s.confidence, true),
    lowConfidence: findBestWindow(samples, windowSize, s => s.confidence, false),
    highEfficiency: findBestWindow(samples.filter(s => s.efficiency !== null), windowSize, s => s.efficiency ?? 0, true),
    lowEfficiency: findBestWindow(samples.filter(s => s.efficiency !== null), windowSize, s => s.efficiency ?? 0, false)
  }

  return {
    rawAccelStats,
    filteredAccelStats,
    stdDevStats,
    confidenceStats,
    confidenceDistribution: { veryLow, low, medium, high },
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
