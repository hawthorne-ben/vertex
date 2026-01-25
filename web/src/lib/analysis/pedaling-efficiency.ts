/**
 * Pedaling Efficiency Analysis
 *
 * Measures pedaling smoothness by analyzing acceleration oscillations from pedaling forces.
 * Uses FFT-based pedaling detection to avoid false positives when stationary.
 *
 * Algorithm:
 * 1. Sync VTX acceleration data with FIT data by timestamp
 * 2. Calculate 3-axis acceleration magnitude (captures pedaling forces regardless of bike orientation)
 * 3. Apply high-pass filter (cutoff ~0.5 Hz) to remove gravity and constant components
 * 4. Detect pedaling with FFT: analyze frequency spectrum for cadence range (40-130 RPM)
 * 5. Calculate confidence based on peak-to-median ratio and signal variance
 * 6. Calculate rolling standard deviation of filtered acceleration
 * 7. Convert to efficiency score: efficiency = exp(-k * std_dev), only when confidence > threshold
 *
 * Key improvements over naive approach:
 * - No reliance on noisy GPS grade for gravity compensation
 * - High-pass filter removes all constant components (gravity, sensor bias)
 * - 3-axis magnitude captures pedaling forces in any direction
 * - FFT detects actual pedaling vs stationary periods
 * - Returns null efficiency when not confidently pedaling
 */

import { syncFitVtxData, calculateSampleRate } from '../sync/fit-vtx-sync'
import { HighPassFilter } from '../imu/signal-processing'

export interface PedalingEfficiencyInput {
  vtxSamples: Array<{
    timestamp: string
    accel_x: number
    accel_y?: number  // Optional, for magnitude calculation
    accel_z?: number  // Optional, for magnitude calculation
  }>
  fitSamples: Array<{
    timestamp: string
    grade?: number | null
    altitude?: number | null
  }>
  options?: {
    hpfCutoff?: number           // High-pass filter cutoff in Hz (default: 0.5, removes gravity)
    windowSize?: number          // Smoothness window in seconds (default: 3)
    syncTolerance?: number       // Max time diff for sync in ms (default: 100)
    fftWindowSize?: number       // FFT window for cadence detection in seconds (default: 10)
    confidenceThreshold?: number // Min confidence to report efficiency (default: 0.2)
    minCadence?: number          // Min reasonable cadence in RPM (default: 40)
    maxCadence?: number          // Max reasonable cadence in RPM (default: 130)
    useMagnitude?: boolean       // Use 3-axis magnitude vs just accel_x (default: true)
    includeDebug?: boolean       // Include debug statistics in response (default: false)
  }
}

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
    highConfidencePedaling: PedalingEfficiencyOutput[]  // 10s of high confidence
    lowConfidence: PedalingEfficiencyOutput[]           // 10s of low confidence
    highEfficiency: PedalingEfficiencyOutput[]          // 10s of smooth pedaling
    lowEfficiency: PedalingEfficiencyOutput[]           // 10s of rough pedaling
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

/**
 * Calculate pedaling efficiency from VTX and FIT data
 */
export function calculatePedalingEfficiency(
  input: PedalingEfficiencyInput
): { samples: PedalingEfficiencyOutput[]; metadata: PedalingEfficiencyMetadata } {
  const {
    vtxSamples,
    fitSamples,
    options = {}
  } = input

  const hpfCutoff = options.hpfCutoff ?? 0.5  // Hz - removes gravity and other DC components
  const windowSize = options.windowSize ?? 3  // seconds
  const syncTolerance = options.syncTolerance ?? 100  // ms
  const fftWindowSize = options.fftWindowSize ?? 10  // seconds
  const confidenceThreshold = options.confidenceThreshold ?? 0.15  // Very sensitive - mountain biking is rough
  const minCadence = options.minCadence ?? 40  // RPM
  const maxCadence = options.maxCadence ?? 130  // RPM
  const useMagnitude = options.useMagnitude ?? true  // Use 3-axis magnitude by default
  const includeDebug = options.includeDebug ?? false

  // Detect sample rate from VTX data
  const sampleRate = calculateSampleRate(vtxSamples, 10) ?? 25  // Default 25 Hz if detection fails

  // Sync VTX and FIT data by timestamp
  const synced = syncFitVtxData(
    fitSamples,
    vtxSamples,
    { tolerance: syncTolerance }
  )

  // Pre-process: smooth grade for metadata (optional)
  const grades = smoothGrades(synced.map(s => s.fit?.grade ?? s.fit?.altitude ?? null), fitSamples, 10)

  // Setup high-pass filter to remove gravity and constant components
  const hpf = new HighPassFilter(hpfCutoff, sampleRate)

  // First pass: calculate acceleration magnitude and apply high-pass filter
  const processedSamples: Array<{
    timestamp: string
    rawAccel: number
    filteredAccel: number  // High-pass filtered (gravity removed)
    grade: number | null
  }> = []

  synced.forEach((point, idx) => {
    if (!point.vtx) return  // Skip points without VTX data

    // Calculate raw acceleration (magnitude or just x-axis)
    let rawAccel: number
    if (useMagnitude && point.vtx.accel_y !== undefined && point.vtx.accel_z !== undefined) {
      // Use 3-axis magnitude to capture pedaling forces regardless of bike orientation
      const x = point.vtx.accel_x
      const y = point.vtx.accel_y
      const z = point.vtx.accel_z
      rawAccel = Math.sqrt(x * x + y * y + z * z)
    } else {
      // Fallback to just x-axis if y/z not available
      rawAccel = point.vtx.accel_x
    }

    // Apply high-pass filter to remove gravity and other constant components
    // This keeps only the oscillating component from pedaling
    const filteredAccel = hpf.update(rawAccel)
    const grade = grades[idx]

    processedSamples.push({
      timestamp: point.vtx.timestamp,
      rawAccel,
      filteredAccel,
      grade
    })
  })

  // Second pass: calculate rolling FFT for pedaling detection + efficiency
  const windowSamples = Math.round(windowSize * sampleRate)
  const fftWindowSamples = Math.round(fftWindowSize * sampleRate)
  const efficiencySamples: PedalingEfficiencyOutput[] = []

  for (let i = 0; i < processedSamples.length; i++) {
    const sample = processedSamples[i]

    // FFT window for pedaling detection (larger window for frequency resolution)
    const fftWindowStart = Math.max(0, i - Math.floor(fftWindowSamples / 2))
    const fftWindowEnd = Math.min(processedSamples.length, i + Math.ceil(fftWindowSamples / 2))
    const fftWindowData = processedSamples.slice(fftWindowStart, fftWindowEnd)

    // Detect pedaling with FFT
    const { confidence, cadence } = detectPedalingWithFFT(
      fftWindowData,
      sampleRate,
      minCadence,
      maxCadence
    )

    // Efficiency window (smaller window for smoothness calculation)
    const effWindowStart = Math.max(0, i - Math.floor(windowSamples / 2))
    const effWindowEnd = Math.min(processedSamples.length, i + Math.ceil(windowSamples / 2))
    const effWindowData = processedSamples.slice(effWindowStart, effWindowEnd)

    // Calculate std dev of high-pass filtered acceleration
    // This measures the variability in pedaling force oscillations
    const stdDev = calculateStdDev(effWindowData.map(s => s.filteredAccel))

    // Improved efficiency formula with better scaling for mountain biking
    // Mountain biking has higher baseline variance due to terrain
    // Uses exponential decay: efficiency = exp(-k * stdDev)
    // Tuned so that:
    // - stdDev ~0.5 m/s^2 (very smooth) -> ~85% efficiency
    // - stdDev ~1.0 m/s^2 (smooth) -> ~70% efficiency
    // - stdDev ~2.0 m/s^2 (moderate) -> ~50% efficiency
    // - stdDev ~4.0 m/s^2 (rough) -> ~25% efficiency
    const k = 0.18  // Tuning parameter (lower = more generous scoring for rough terrain)
    let rawEfficiency = Math.exp(-k * stdDev)

    // Apply floor to prevent extremely low scores from noise
    rawEfficiency = Math.max(0.15, rawEfficiency)

    // Only report efficiency if we're confident we're pedaling
    const efficiency = confidence >= confidenceThreshold ? rawEfficiency : null
    const efficiencyPercent = efficiency !== null ? efficiency * 100 : null

    efficiencySamples.push({
      timestamp: sample.timestamp,
      efficiency,
      efficiencyPercent,
      confidence,
      detectedCadence: cadence,
      rawAccel: sample.rawAccel,
      filteredAccel: sample.filteredAccel,
      grade: sample.grade
    })
  }

  // Calculate metadata
  const metadata = calculateMetadata(
    efficiencySamples,
    processedSamples,
    grades,
    sampleRate,
    includeDebug,
    confidenceThreshold
  )

  return { samples: efficiencySamples, metadata }
}

/**
 * Smooth grade data with moving average
 * Handles both direct grade field and altitude-derived grade
 */
function smoothGrades(
  grades: (number | null)[],
  fitSamples: Array<{ altitude?: number | null }>,
  windowSeconds: number
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

    // Simple elevation difference / distance (assumes 1 sample/sec for FIT)
    // This is rough - ideally we'd use actual distance between GPS points
    const dAlt = alt2 - alt1
    const dDist = 1  // Approximate 1m per sample (at 1 sample/sec, ~1 m/s speed)
    const grade = (dAlt / dDist) * 100

    // Clamp to reasonable range
    calculatedGrades.push(Math.max(-30, Math.min(30, grade)))
  }

  return movingAverage(calculatedGrades, windowSeconds * 2)
}

/**
 * Moving average filter for grade smoothing
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

/**
 * Calculate standard deviation
 */
function calculateStdDev(values: number[]): number {
  if (values.length === 0) return 0

  const mean = values.reduce((sum, v) => sum + v, 0) / values.length
  const squaredDiffs = values.map(v => Math.pow(v - mean, 2))
  const variance = squaredDiffs.reduce((sum, v) => sum + v, 0) / values.length

  return Math.sqrt(variance)
}

/**
 * Calculate percentile statistics for a dataset
 */
function calculatePercentileStats(values: number[]): PercentileStats {
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
    // Inverse of: efficiency = exp(-0.35 * stdDev)
    // stdDev = -ln(efficiency) / 0.35
    return -Math.log(Math.max(0.1, s.efficiency)) / 0.35
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

  // Find sample windows for inspection (5 seconds each)
  const windowSize = Math.floor(5 * sampleRate)

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

/**
 * Detect pedaling using FFT on high-pass filtered acceleration
 * Returns confidence (0-1) and detected cadence in RPM
 */
function detectPedalingWithFFT(
  samples: Array<{ filteredAccel: number }>,
  sampleRate: number,
  minCadence: number,
  maxCadence: number
): { confidence: number; cadence: number | null } {
  if (samples.length < 32) {
    return { confidence: 0, cadence: null }
  }

  // Extract high-pass filtered accelerations (gravity already removed)
  // No need to remove DC component since HPF already did that
  const signal = samples.map(s => s.filteredAccel)

  // Check for sufficient variance - stationary bike has very low variance
  const variance = signal.reduce((sum, v) => sum + v * v, 0) / signal.length
  const stdDev = Math.sqrt(variance)

  // If variance is very low, we're likely stationary
  // RELAXED THRESHOLD: 0.05 instead of 0.1 to be more sensitive
  if (stdDev < 0.05) {
    return { confidence: 0, cadence: null }
  }

  // Apply FFT (simple DFT for now - could optimize with FFT library)
  const N = signal.length
  const spectrum: Array<{ freq: number; power: number }> = []

  // Only compute frequencies in cadence range
  const minFreq = minCadence / 60  // Convert RPM to Hz
  const maxFreq = maxCadence / 60

  for (let k = 0; k < N / 2; k++) {
    const freq = k * sampleRate / N

    // Skip DC and frequencies outside cadence range
    if (freq < 0.1 || freq < minFreq || freq > maxFreq) {
      continue
    }

    let real = 0
    let imag = 0

    for (let n = 0; n < N; n++) {
      const angle = -2 * Math.PI * k * n / N
      real += signal[n] * Math.cos(angle)
      imag += signal[n] * Math.sin(angle)
    }

    // Power spectrum magnitude (normalized by N)
    const power = Math.sqrt(real * real + imag * imag) / N
    spectrum.push({ freq, power })
  }

  if (spectrum.length === 0) {
    return { confidence: 0, cadence: null }
  }

  // Find peak in cadence frequency range
  let peakIdx = 0
  let peakPower = 0

  for (let i = 0; i < spectrum.length; i++) {
    if (spectrum[i].power > peakPower) {
      peakPower = spectrum[i].power
      peakIdx = i
    }
  }

  // Calculate power statistics
  const powers = spectrum.map(s => s.power)
  const totalPower = powers.reduce((sum, v) => sum + v, 0)
  const avgPower = totalPower / powers.length

  // Sort to find median (more robust to outliers than mean)
  const sortedPowers = [...powers].sort((a, b) => a - b)
  const medianPower = sortedPowers[Math.floor(sortedPowers.length / 2)]

  // Confidence metrics:
  // 1. Peak must be significantly above median (strong periodic component)
  // 2. Overall signal variance must be reasonable (not stationary)
  const peakToMedian = medianPower > 0 ? peakPower / medianPower : 0
  const peakToAvg = avgPower > 0 ? peakPower / avgPower : 0

  // RELAXED THRESHOLDS based on real-world mountain biking data:
  // Mountain biking acceleration is much less periodic than road cycling
  // - Terrain variations add noise to the signal
  // - Rider shifts weight, adjusts to obstacles
  // - Still pedaling, just not perfectly smooth

  let confidence = 0
  const cadence = spectrum[peakIdx] ? spectrum[peakIdx].freq * 60 : null

  // Method 1: Strong periodic signal (road cycling, smooth trail)
  if (peakToMedian > 2.5 && stdDev > 0.15) {
    confidence = Math.min(1.0, (peakToMedian - 2.5) / 3.0)
    if (peakToMedian > 5.0) confidence = Math.min(1.0, confidence + 0.2)
  }
  // Method 2: Moderate signal but reasonable cadence detected (mountain biking)
  else if (peakToMedian > 1.5 && stdDev > 0.2 && cadence && cadence >= 50 && cadence <= 110) {
    // Lower confidence but still detect as pedaling
    confidence = Math.min(0.6, (peakToMedian - 1.5) / 2.0)
  }
  // Method 3: Sufficient variance with any reasonable peak (very rough terrain)
  else if (stdDev > 0.5 && peakToMedian > 1.2 && cadence && cadence >= 40 && cadence <= 120) {
    confidence = Math.min(0.4, (peakToMedian - 1.2) / 2.0)
  }

  return { confidence, cadence }
}

/**
 * Calculate summary metadata
 */
function calculateMetadata(
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
    smoothCount = pedalingSamples.filter(s => (s.efficiency ?? 0) > 0.7).length
    roughCount = pedalingSamples.filter(s => (s.efficiency ?? 0) < 0.5).length
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
    metadata.debug = calculateDebugStatistics(samples, processedSamples, confidenceThreshold, sampleRate ?? 25)
  }

  return metadata
}
