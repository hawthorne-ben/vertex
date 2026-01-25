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
  const confidenceThreshold = options.confidenceThreshold ?? 0.2  // Lower threshold = more sensitive
  const minCadence = options.minCadence ?? 40  // RPM
  const maxCadence = options.maxCadence ?? 130  // RPM
  const useMagnitude = options.useMagnitude ?? true  // Use 3-axis magnitude by default

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

    // Improved efficiency formula with better scaling
    // Uses exponential decay: efficiency = exp(-k * stdDev)
    // Tuned so that:
    // - stdDev ~0.5 m/s^2 (smooth) -> ~90% efficiency
    // - stdDev ~1.5 m/s^2 (moderate) -> ~60% efficiency
    // - stdDev ~3.0 m/s^2 (rough) -> ~30% efficiency
    const k = 0.35  // Tuning parameter (lower = more generous scoring)
    let rawEfficiency = Math.exp(-k * stdDev)

    // Apply floor to prevent extremely low scores from noise
    rawEfficiency = Math.max(0.1, rawEfficiency)

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
  const metadata = calculateMetadata(efficiencySamples, grades, sampleRate)

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
  if (stdDev < 0.1) {  // Threshold: less than 0.1 m/s^2 std dev = stationary
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

  // Combine metrics: need both strong peak AND sufficient variance
  // peakToMedian > 2 = strong periodic signal
  // stdDev > 0.3 = sufficient movement (not stationary)
  let confidence = 0

  if (peakToMedian > 2.0 && stdDev > 0.3) {
    // Scale confidence based on how strong the peak is
    confidence = Math.min(1.0, (peakToMedian - 2.0) / 3.0)  // Normalize 2-5 range to 0-1

    // Bonus for very strong peaks
    if (peakToMedian > 5.0) {
      confidence = Math.min(1.0, confidence + 0.2)
    }
  }

  // Detected cadence from peak frequency
  const cadence = spectrum[peakIdx] ? spectrum[peakIdx].freq * 60 : null  // Convert Hz to RPM

  return { confidence, cadence }
}

/**
 * Calculate summary metadata
 */
function calculateMetadata(
  samples: PedalingEfficiencyOutput[],
  grades: (number | null)[],
  sampleRate: number | null
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

  return {
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
}
