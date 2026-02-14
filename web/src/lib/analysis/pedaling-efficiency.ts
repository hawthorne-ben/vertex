/**
 * Ride Analytics Calculation
 *
 * Computes BOTH pedaling efficiency AND riding position from VTX + FIT data.
 * Shares pedaling detection logic (FFT, confidence) to avoid duplicate work.
 *
 * Algorithm Overview:
 * 1. Sync VTX acceleration data with FIT data by timestamp
 * 2. Calculate 3-axis acceleration magnitude + extract Y-axis for rocking detection
 * 3. Apply high-pass filter (cutoff ~0.5 Hz) to remove gravity and constant components
 * 4. Detect pedaling with FFT: analyze frequency spectrum for cadence range (40-130 RPM)
 * 5. Calculate confidence based on peak-to-median ratio and signal variance
 * 6. **EFFICIENCY:** Calculate std dev → efficiency score (only when pedaling detected)
 * 7. **POSITION:** Calculate Y-axis rocking → standing vs. seated (only when pedaling detected)
 * 8. Return both analyses with matching gaps (same confidence thresholds)
 *
 * Version 1.2.0 Changes:
 * - Added riding position detection (standing vs. seated)
 * - Refactored to compute both metrics in single pass
 * - Shared pedaling detection for consistency and performance
 */

import { syncFitVtxData, calculateSampleRate } from '../sync/fit-vtx-sync'
import { HighPassFilter } from '../imu/signal-processing'
import { detectPedalingWithFFT } from './pedaling-detection'
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
  }>
  options?: {
    hpfCutoff?: number           // High-pass filter cutoff in Hz (default: 0.5)
    windowSize?: number          // Smoothness window in seconds (default: 3)
    syncTolerance?: number       // Max time diff for sync in ms (default: 100)
    fftWindowSize?: number       // FFT window for cadence detection in seconds (default: 10)
    confidenceThreshold?: number // Min confidence to report efficiency (default: 0.15)
    minCadence?: number          // Min reasonable cadence in RPM (default: 40)
    maxCadence?: number          // Max reasonable cadence in RPM (default: 130)
    useMagnitude?: boolean       // Use 3-axis magnitude vs just accel_x (default: true)
    includeDebug?: boolean       // Include debug statistics in response (default: false)
    yAxisThreshold?: number      // Y-axis rocking threshold for standing detection (default: 0.8)
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
  const fftWindowSize = options.fftWindowSize ?? CONSTANTS.FFT_WINDOW_SECONDS
  const confidenceThreshold = options.confidenceThreshold ?? CONSTANTS.CONFIDENCE_THRESHOLD
  const minCadence = options.minCadence ?? CONSTANTS.MIN_CADENCE_RPM
  const maxCadence = options.maxCadence ?? CONSTANTS.MAX_CADENCE_RPM
  const useMagnitude = options.useMagnitude ?? CONSTANTS.USE_MAGNITUDE
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

  // Setup high-pass filter to remove gravity and constant components
  const hpf = new HighPassFilter(hpfCutoff, sampleRate)

  // ============================================
  // FIRST PASS: Calculate acceleration magnitude and apply HPF
  // ============================================

  const processedSamples: Array<{
    timestamp: string
    rawAccel: number
    filteredAccel: number  // High-pass filtered (gravity removed)
    yAxis: number  // Y-axis acceleration for rocking detection
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

    // Extract Y-axis for riding position detection (lateral rocking)
    const yAxis = point.vtx.accel_y ?? 0

    processedSamples.push({
      timestamp: point.vtx.timestamp,
      rawAccel,
      filteredAccel,
      yAxis,
      grade
    })
  })

  // ============================================
  // SECOND PASS: Calculate rolling FFT for pedaling detection + efficiency + position
  // ============================================

  const windowSamples = Math.round(windowSize * sampleRate)
  const fftWindowSamples = Math.round(fftWindowSize * sampleRate)
  const yAxisThreshold = options.yAxisThreshold ?? CONSTANTS.Y_AXIS_STANDING_THRESHOLD
  const efficiencySamples: PedalingEfficiencyOutput[] = []
  const positionSamples: RidingPositionSample[] = []

  for (let i = 0; i < processedSamples.length; i++) {
    const sample = processedSamples[i]

    // FFT window for pedaling detection (larger window for frequency resolution)
    const fftWindowStart = Math.max(0, i - Math.floor(fftWindowSamples / 2))
    const fftWindowEnd = Math.min(processedSamples.length, i + Math.ceil(fftWindowSamples / 2))
    const fftWindowData = processedSamples.slice(fftWindowStart, fftWindowEnd)

    // Detect pedaling with FFT (includes all tuning fixes)
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
    const stdDev = calculateStdDev(effWindowData.map(s => s.filteredAccel))

    // Calculate efficiency with rescaling (includes tuning fix)
    const rawEfficiency = calculateEfficiency(stdDev)

    // TUNING FIX: Only report efficiency when BOTH confidence AND cadence are detected
    // This prevents showing 100% efficiency when stationary
    const efficiency = (confidence >= confidenceThreshold && cadence !== null)
      ? rawEfficiency
      : null
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

    // ============================================
    // RIDING POSITION DETECTION
    // ============================================

    // Extract Y-axis window for rocking detection (same size as efficiency window)
    const yAxisWindow = effWindowData.map(s => s.yAxis)

    // Calculate riding position from Y-axis lateral rocking
    const { position, rockingMagnitude } = calculateRidingPosition(
      yAxisWindow,
      confidence,
      cadence,
      confidenceThreshold,
      yAxisThreshold
    )

    positionSamples.push({
      timestamp: sample.timestamp,
      position,
      confidence,
      rockingMagnitude,
      detectedCadence: cadence
    })
  }

  // ============================================
  // DOWNSAMPLE POSITION TO 1 HZ
  // ============================================

  // Position changes slowly, downsample to 1 Hz using majority vote
  // This reduces storage and matches GPS frequency
  const downsampledPosition = downsamplePositionByMajorityVote(positionSamples, 1000)

  // ============================================
  // CALCULATE METADATA
  // ============================================

  const efficiencyMetadata = calculateMetadata(
    efficiencySamples,
    processedSamples,
    grades,
    sampleRate,
    includeDebug,
    confidenceThreshold
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
