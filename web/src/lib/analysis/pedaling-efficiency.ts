/**
 * Ride Analytics Calculation
 *
 * Computes BOTH pedaling efficiency AND riding position from VTX + FIT data.
 *
 * Algorithm Overview:
 * 1. Sync VTX acceleration data with FIT data by timestamp
 * 2. Calculate 3-axis acceleration magnitude
 * 3. Apply EMA high-pass filter to magnitude (removes gravity) for efficiency stdDev
 * 4. Apply EMA high-pass filter to Y-axis for riding position detection (lateral rocking)
 * 5. Pedaling detection: FIT cadence > 0 = pedaling
 * 6. **EFFICIENCY:** Calculate std dev → efficiency score (only when pedaling)
 * 7. **POSITION:** Calculate Y-axis rocking → standing vs. seated (only when pedaling)
 *
 * Version 3.0.0 Changes:
 * - Use FIT cadence for pedaling detection (removed FFT/BPF entirely)
 * - EMA HPF on magnitude for efficiency (same filter type as Y-axis)
 */

import { syncFitVtxData, calculateSampleRate } from '../sync/fit-vtx-sync'
import { HighPassFilter } from '../imu/signal-processing'
import { calculateEfficiency, calculateStdDev, smoothGrades } from './efficiency-calculation'
import { calculateMetadata } from './efficiency-metadata'
import { calculateRidingPosition, downsamplePositionByMajorityVote } from './riding-position-calculation'
import { calculateRidingPositionMetadata } from './riding-position-metadata'
import type { PedalingEfficiencyOutput, PedalingEfficiencyMetadata } from './efficiency-metadata'
import type { RidingPositionSample, RidingPositionMetadata } from './riding-position-types'
import * as CONSTANTS from './pedaling-efficiency-constants'

// Re-export types for convenience
export type { PedalingEfficiencyOutput, PedalingEfficiencyMetadata }
export type { RidingPositionSample, RidingPositionMetadata }

// ============================================
// INPUT TYPES
// ============================================

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
    cadence?: number | null  // FIT cadence in RPM
  }>
  options?: {
    hpfCutoff?: number           // High-pass filter cutoff in Hz (default: 0.5)
    windowSize?: number          // Smoothness window in seconds (default: 3)
    syncTolerance?: number       // Max time diff for sync in ms (default: 100)
    includeDebug?: boolean       // Include debug statistics in response (default: false)
    yAxisThreshold?: number      // Y-axis rocking threshold for standing detection (default: 2.2)
  }
}

// ============================================
// MAIN CALCULATION FUNCTION
// ============================================

/**
 * Calculate ride analytics (efficiency + position) from VTX and FIT data
 *
 * @param input - VTX samples, FIT samples, and optional configuration
 * @returns Both efficiency and position analyses with metadata
 */
export function calculatePedalingEfficiency(
  input: PedalingEfficiencyInput
): {
  efficiency: { samples: PedalingEfficiencyOutput[]; metadata: PedalingEfficiencyMetadata };
  position: { samples: RidingPositionSample[]; metadata: RidingPositionMetadata };
} {
  const {
    vtxSamples,
    fitSamples,
    options = {}
  } = input

  // Extract options with defaults from constants
  const hpfCutoff = options.hpfCutoff ?? CONSTANTS.HPF_CUTOFF_HZ
  const windowSize = options.windowSize ?? CONSTANTS.EFFICIENCY_WINDOW_SECONDS
  const syncTolerance = options.syncTolerance ?? CONSTANTS.SYNC_TOLERANCE_MS
  const includeDebug = options.includeDebug ?? false

  // Detect sample rate from VTX data
  const sampleRate = calculateSampleRate(vtxSamples, 10) ?? CONSTANTS.DEFAULT_SAMPLE_RATE_HZ

  // Sync VTX and FIT data by timestamp
  const synced = syncFitVtxData(
    fitSamples,
    vtxSamples,
    { tolerance: syncTolerance }
  )

  // Pre-process: smooth grade for metadata
  const grades = smoothGrades(
    synced.map(s => s.fit?.grade ?? s.fit?.altitude ?? null),
    fitSamples,
    CONSTANTS.GRADE_SMOOTH_WINDOW_SECONDS
  )

  // EMA HPF for magnitude (removes gravity, keeps pedaling dynamics)
  const magHpf = new HighPassFilter(hpfCutoff, sampleRate)

  // Separate HPF for Y-axis position detection (lateral rocking has different frequency content)
  const yAxisHpf = new HighPassFilter(hpfCutoff, sampleRate)

  // ============================================
  // FIRST PASS: Calculate acceleration magnitude and apply HPF
  // ============================================

  const processedSamples: Array<{
    timestamp: string
    rawAccel: number
    filteredAccel: number  // High-pass filtered (gravity removed)
    yAxis: number  // Y-axis acceleration for rocking detection
    grade: number | null
    cadence: number | null  // FIT cadence (carried forward between FIT samples)
  }> = []

  // Track last known cadence to carry forward between FIT samples
  // FIT is 1 Hz, VTX is 25 Hz — most VTX samples won't have a FIT match
  let lastKnownCadence: number | null = null

  synced.forEach((point, idx) => {
    if (!point.vtx) return  // Skip points without VTX data

    // Calculate raw acceleration magnitude
    const x = point.vtx.accel_x
    const y = point.vtx.accel_y ?? 0
    const z = point.vtx.accel_z ?? 0
    const rawAccel = Math.sqrt(x * x + y * y + z * z)

    // Apply EMA HPF to magnitude (removes gravity component ~9.81)
    const filteredAccel = magHpf.update(rawAccel)
    const grade = grades[idx]

    // Extract cadence from synced FIT point, carry forward for VTX-only points
    const fitCadence = (point.fit as any)?.cadence
    if (fitCadence !== undefined && fitCadence !== null) {
      lastKnownCadence = fitCadence
    }
    const cadence = point.fit ? ((point.fit as any)?.cadence ?? null) : lastKnownCadence

    // HPF on Y-axis for riding position detection
    const yAxis = yAxisHpf.update(point.vtx.accel_y ?? 0)

    processedSamples.push({
      timestamp: point.vtx.timestamp,
      rawAccel,
      filteredAccel,
      yAxis,
      grade,
      cadence
    })
  })

  // ============================================
  // SECOND PASS: Calculate efficiency + position per sample
  // ============================================

  const windowSamples = Math.round(windowSize * sampleRate)
  const yAxisThreshold = options.yAxisThreshold ?? CONSTANTS.Y_AXIS_STANDING_THRESHOLD
  const efficiencySamples: PedalingEfficiencyOutput[] = []
  const positionSamples: RidingPositionSample[] = []

  for (let i = 0; i < processedSamples.length; i++) {
    const sample = processedSamples[i]

    // Pedaling detection: FIT cadence > 0
    const isPedaling = sample.cadence !== null && sample.cadence > 0

    // Efficiency window (for smoothness calculation)
    const effWindowStart = Math.max(0, i - Math.floor(windowSamples / 2))
    const effWindowEnd = Math.min(processedSamples.length, i + Math.ceil(windowSamples / 2))
    const effWindowData = processedSamples.slice(effWindowStart, effWindowEnd)

    // Calculate std dev of high-pass filtered acceleration
    const stdDev = calculateStdDev(effWindowData.map(s => s.filteredAccel))

    // Calculate efficiency (only when pedaling)
    const rawEfficiency = calculateEfficiency(stdDev)
    const efficiency = isPedaling ? rawEfficiency : null
    const efficiencyPercent = efficiency !== null ? efficiency * 100 : null

    efficiencySamples.push({
      timestamp: sample.timestamp,
      efficiency,
      efficiencyPercent,
      isPedaling,
      cadence: sample.cadence,
      rawAccel: sample.rawAccel,
      filteredAccel: sample.filteredAccel,
      grade: sample.grade
    })

    // ============================================
    // RIDING POSITION DETECTION
    // ============================================

    // Extract Y-axis window for rocking detection (same size as efficiency window)
    const yAxisWindow = effWindowData.map(s => s.yAxis)

    // Calculate riding position from Y-axis lateral rocking
    const { position, rockingMagnitude } = calculateRidingPosition(
      yAxisWindow,
      isPedaling,
      yAxisThreshold
    )

    positionSamples.push({
      timestamp: sample.timestamp,
      position,
      rockingMagnitude,
      cadence: sample.cadence
    })
  }

  // ============================================
  // DOWNSAMPLE POSITION TO 1 HZ
  // ============================================

  // Position changes slowly, downsample to 1 Hz using majority vote
  const downsampledPosition = downsamplePositionByMajorityVote(positionSamples, 1000)

  // ============================================
  // CALCULATE METADATA
  // ============================================

  const efficiencyMetadata = calculateMetadata(
    efficiencySamples,
    processedSamples,
    grades,
    sampleRate,
    includeDebug
  )

  const positionMetadata = calculateRidingPositionMetadata(
    downsampledPosition,
    sampleRate
  )

  return {
    efficiency: { samples: efficiencySamples, metadata: efficiencyMetadata },
    position: { samples: downsampledPosition, metadata: positionMetadata }
  }
}
