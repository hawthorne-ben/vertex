/**
 * Pedaling Efficiency Analysis
 *
 * Measures pedaling smoothness by analyzing longitudinal acceleration (accel_x)
 * with gravity compensation using GPS grade data.
 *
 * Algorithm:
 * 1. Sync VTX accel_x with FIT grade by timestamp
 * 2. Pre-filter accel_x with low-pass filter (removes sensor noise)
 * 3. Compensate for gravity using grade: accel_comp = accel_filtered - sin(atan(grade/100)) * g
 * 4. Calculate rolling standard deviation of compensated acceleration
 * 5. Convert to efficiency score: efficiency = 1 / (1 + std_dev)
 */

import { syncFitVtxData, calculateSampleRate } from '../sync/fit-vtx-sync'
import { LowPassFilter } from '../imu/signal-processing'

export interface PedalingEfficiencyInput {
  vtxSamples: Array<{
    timestamp: string
    accel_x: number
  }>
  fitSamples: Array<{
    timestamp: string
    grade?: number | null
    altitude?: number | null
  }>
  options?: {
    lpfCutoff?: number      // Low-pass filter cutoff in Hz (default: 8)
    windowSize?: number     // Smoothness window in seconds (default: 3)
    syncTolerance?: number  // Max time diff for sync in ms (default: 100)
  }
}

export interface PedalingEfficiencyOutput {
  timestamp: string
  efficiency: number          // 0-1, higher = smoother (1 / (1 + std_dev))
  efficiencyPercent: number   // 0-100, same as efficiency * 100
  rawAccel: number           // m/s^2, raw longitudinal acceleration
  filteredAccel: number      // m/s^2, after low-pass filter
  compensatedAccel: number   // m/s^2, after gravity compensation
  grade: number | null       // Percent slope (null if unavailable)
}

export interface PedalingEfficiencyMetadata {
  avgEfficiency: number       // Average efficiency score 0-1
  avgEfficiencyPercent: number // Average efficiency 0-100
  smoothPercent: number       // % of time efficiency > 0.7
  roughPercent: number        // % of time efficiency < 0.5
  totalSamples: number
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

  const lpfCutoff = options.lpfCutoff ?? 8  // Hz
  const windowSize = options.windowSize ?? 3  // seconds
  const syncTolerance = options.syncTolerance ?? 100  // ms

  // Detect sample rate from VTX data
  const sampleRate = calculateSampleRate(vtxSamples, 10) ?? 25  // Default 25 Hz if detection fails

  // Sync VTX and FIT data by timestamp
  const synced = syncFitVtxData(
    fitSamples,
    vtxSamples,
    { tolerance: syncTolerance }
  )

  // Pre-process: smooth grade and setup low-pass filter
  const grades = smoothGrades(synced.map(s => s.fit?.grade ?? s.fit?.altitude ?? null), fitSamples, 10)
  const lpf = new LowPassFilter(lpfCutoff, sampleRate)

  // First pass: filter acceleration and compensate gravity
  const processedSamples: Array<{
    timestamp: string
    rawAccel: number
    filteredAccel: number
    compensatedAccel: number
    grade: number | null
  }> = []

  synced.forEach((point, idx) => {
    if (!point.vtx) return  // Skip points without VTX data

    const rawAccel = point.vtx.accel_x
    const filteredAccel = lpf.update(rawAccel)
    const grade = grades[idx]

    // Compensate gravity: accel_comp = accel - sin(atan(grade/100)) * g
    let compensatedAccel = filteredAccel
    if (grade !== null) {
      const gradeRadians = Math.atan(grade / 100)
      const gravityComponent = Math.sin(gradeRadians) * 9.81
      compensatedAccel = filteredAccel - gravityComponent
    }

    processedSamples.push({
      timestamp: point.vtx.timestamp,
      rawAccel,
      filteredAccel,
      compensatedAccel,
      grade
    })
  })

  // Second pass: calculate rolling standard deviation -> efficiency
  const windowSamples = Math.round(windowSize * sampleRate)
  const efficiencySamples: PedalingEfficiencyOutput[] = []

  for (let i = 0; i < processedSamples.length; i++) {
    const sample = processedSamples[i]

    // Calculate std dev over window centered on current sample
    const windowStart = Math.max(0, i - Math.floor(windowSamples / 2))
    const windowEnd = Math.min(processedSamples.length, i + Math.ceil(windowSamples / 2))
    const windowData = processedSamples.slice(windowStart, windowEnd)

    const stdDev = calculateStdDev(windowData.map(s => s.compensatedAccel))
    const efficiency = 1 / (1 + stdDev)  // 0-1 score

    efficiencySamples.push({
      timestamp: sample.timestamp,
      efficiency,
      efficiencyPercent: efficiency * 100,
      rawAccel: sample.rawAccel,
      filteredAccel: sample.filteredAccel,
      compensatedAccel: sample.compensatedAccel,
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
 * Calculate summary metadata
 */
function calculateMetadata(
  samples: PedalingEfficiencyOutput[],
  grades: (number | null)[],
  sampleRate: number | null
): PedalingEfficiencyMetadata {
  if (samples.length === 0) {
    return {
      avgEfficiency: 0,
      avgEfficiencyPercent: 0,
      smoothPercent: 0,
      roughPercent: 0,
      totalSamples: 0,
      hasCadence: false,
      hasGrade: false,
      sampleRate: null
    }
  }

  const avgEfficiency = samples.reduce((sum, s) => sum + s.efficiency, 0) / samples.length
  const smoothCount = samples.filter(s => s.efficiency > 0.7).length
  const roughCount = samples.filter(s => s.efficiency < 0.5).length

  return {
    avgEfficiency,
    avgEfficiencyPercent: avgEfficiency * 100,
    smoothPercent: (smoothCount / samples.length) * 100,
    roughPercent: (roughCount / samples.length) * 100,
    totalSamples: samples.length,
    hasCadence: false,  // Not implemented yet
    hasGrade: grades.some(g => g !== null),
    sampleRate
  }
}
