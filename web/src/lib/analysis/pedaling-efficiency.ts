/**
 * Ride Analytics Calculation (v6.0.0)
 *
 * Computes pedaling stability, surface roughness, AND riding position
 * from VTX + FIT data.
 *
 * Algorithm Overview:
 * 1. Sync VTX sensor data with FIT data by timestamp
 * 2. First pass (per-sample): BPF gyro-x/z and accel-x for stability,
 *    HPF accel-x/z for roughness, HPF accel-y for position
 * 3. Second pass (windowed): Compute time-domain RMS for stability,
 *    RMS for roughness, position detection
 * 4. Third pass: Downsample windowed output (2 Hz) to 5 Hz for output arrays
 *
 * v6.0.0 Changes:
 * - Time-domain RMS stability (replaces FFT spectral analysis)
 * - BPF already isolates pedaling band; RMS of BPF'd signal is sufficient
 * - Eliminates spectral leakage from cornering transients
 */

import { syncFitVtxData, calculateSampleRate } from '../sync/fit-vtx-sync'
import { HighPassFilter, BandPassFilter } from '../imu/signal-processing'
import { calculateStability } from './efficiency-calculation'
import { smoothGrades } from './efficiency-calculation'
import { calculateMetadata } from './efficiency-metadata'
import { calculateRoughness, calculateRoughnessMetadata } from './surface-roughness'
import { calculateRidingPosition, downsamplePositionByMajorityVote } from './riding-position-calculation'
import { calculateRidingPositionMetadata } from './riding-position-metadata'
import type { PedalingEfficiencyOutput, PedalingEfficiencyMetadata } from './efficiency-metadata'
import type { RidingPositionSample, RidingPositionMetadata } from './riding-position-types'
import type { SurfaceRoughnessSample, SurfaceRoughnessMetadata } from './surface-roughness-types'
import * as C from './pedaling-efficiency-constants'

// Re-export types for convenience
export type { PedalingEfficiencyOutput, PedalingEfficiencyMetadata }
export type { RidingPositionSample, RidingPositionMetadata }
export type { SurfaceRoughnessSample, SurfaceRoughnessMetadata }

// ============================================
// INPUT TYPES
// ============================================

export interface PedalingEfficiencyInput {
  vtxSamples: Array<{
    timestamp: string
    accel_x: number
    accel_y?: number
    accel_z?: number
    gyro_x?: number
    gyro_z?: number   // NEW: for yaw coherence
  }>
  fitSamples: Array<{
    timestamp: string
    grade?: number | null
    altitude?: number | null
    cadence?: number | null
    speed?: number | null
    power?: number | null
  }>
  options?: {
    hpfCutoff?: number
    windowSize?: number
    syncTolerance?: number
    includeDebug?: boolean
    // Position detection
    yAxisThreshold?: number
    rollBpfLow?: number
    rollBpfHigh?: number
    rollRmsThreshold?: number
    gyroWeight?: number
    accelWeight?: number
    // Stability weights
    stabilityRollWeight?: number
    stabilityYawWeight?: number
    stabilitySurgeWeight?: number
    // Stability BPF and thresholds
    stabilityBpfLow?: number
    stabilityBpfHigh?: number
    stableThreshold?: number
    unstableThreshold?: number
    // Stability ceiling normalization
    maxStabilityRms?: number
    maxStabilityRmsPerWatt?: number
    powerNormalize?: boolean
    // Surface roughness
    roughnessBaseCeiling?: number
    roughnessReferenceSpeedMs?: number
    roughnessSpeedExponent?: number
    roughnessSmoothThreshold?: number
    roughnessRoughThreshold?: number
  }
}

// ============================================
// MAIN CALCULATION FUNCTION
// ============================================

export function calculatePedalingEfficiency(
  input: PedalingEfficiencyInput
): {
  efficiency: { samples: PedalingEfficiencyOutput[]; metadata: PedalingEfficiencyMetadata };
  position: { samples: RidingPositionSample[]; metadata: RidingPositionMetadata };
  roughness: { samples: SurfaceRoughnessSample[]; metadata: SurfaceRoughnessMetadata };
} {
  const {
    vtxSamples,
    fitSamples,
    options = {}
  } = input

  const syncTolerance = options.syncTolerance ?? C.SYNC_TOLERANCE_MS
  const includeDebug = options.includeDebug ?? false

  // Detect sample rate from VTX data
  const sampleRate = calculateSampleRate(vtxSamples, 10) ?? C.DEFAULT_SAMPLE_RATE_HZ

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
    C.GRADE_SMOOTH_WINDOW_SECONDS
  )

  // ============================================
  // FILTERS
  // ============================================

  // Stability: BPF for each axis (0.3-10 Hz human band)
  const stabilityBpfLow = options.stabilityBpfLow ?? C.STABILITY_BPF_LOW_HZ
  const stabilityBpfHigh = options.stabilityBpfHigh ?? C.STABILITY_BPF_HIGH_HZ
  const rollBpf = new BandPassFilter(stabilityBpfLow, stabilityBpfHigh, sampleRate)   // gyro-x
  const yawBpf = new BandPassFilter(stabilityBpfLow, stabilityBpfHigh, sampleRate)    // gyro-z
  const surgeBpf = new BandPassFilter(stabilityBpfLow, stabilityBpfHigh, sampleRate)  // accel-x

  // Roughness: HPF for accel-x and accel-z
  const roughnessHpfX = new HighPassFilter(C.ROUGHNESS_HPF_CUTOFF_HZ, sampleRate)
  const roughnessHpfZ = new HighPassFilter(C.ROUGHNESS_HPF_CUTOFF_HZ, sampleRate)

  // Position: HPF for Y-axis + BPF for gyro roll (existing)
  const yAxisHpf = new HighPassFilter(options.hpfCutoff ?? C.ROUGHNESS_HPF_CUTOFF_HZ, sampleRate)
  const rollBpfLow = options.rollBpfLow ?? C.ROLL_BPF_LOW_HZ
  const rollBpfHigh = options.rollBpfHigh ?? C.ROLL_BPF_HIGH_HZ
  const positionRollBpf = new BandPassFilter(rollBpfLow, rollBpfHigh, sampleRate)

  // Detect if gyro data is present
  const hasGyroData = vtxSamples.slice(0, 5).some(s => s.gyro_x !== undefined && s.gyro_x !== null)
  const hasGyroZ = vtxSamples.slice(0, 5).some(s => s.gyro_z !== undefined && s.gyro_z !== null)

  // ============================================
  // FIRST PASS: Per-sample filtering
  // ============================================

  interface ProcessedSample {
    timestamp: string
    // Stability signals (BPF'd)
    bpfRoll: number       // gyro-x BPF'd
    bpfYaw: number        // gyro-z BPF'd
    bpfSurge: number      // accel-x BPF'd
    // Roughness signals (HPF'd)
    hpfAccelX: number
    hpfAccelZ: number
    // Position signals
    yAxis: number         // HPF'd accel-y
    filteredRoll: number  // BPF'd gyro-x for position (narrower band)
    // FIT data
    grade: number | null
    cadence: number | null
    speed: number | null
    power: number | null
  }

  const processedSamples: ProcessedSample[] = []

  // Track last known FIT values (FIT is 1 Hz, VTX is 25 Hz)
  let lastKnownCadence: number | null = null
  let lastKnownSpeed: number | null = null
  let lastKnownPower: number | null = null

  synced.forEach((point, idx) => {
    if (!point.vtx) return

    // Update carried-forward FIT values
    const fitCadence = (point.fit as any)?.cadence
    if (fitCadence !== undefined && fitCadence !== null) {
      lastKnownCadence = fitCadence
    }
    const fitSpeed = (point.fit as any)?.speed
    if (fitSpeed !== undefined && fitSpeed !== null) {
      lastKnownSpeed = fitSpeed
    }
    const fitPower = (point.fit as any)?.power
    if (fitPower !== undefined && fitPower !== null) {
      lastKnownPower = fitPower
    }

    const cadence = point.fit ? ((point.fit as any)?.cadence ?? null) : lastKnownCadence
    const speed = point.fit ? ((point.fit as any)?.speed ?? null) : lastKnownSpeed
    const power = point.fit ? ((point.fit as any)?.power ?? null) : lastKnownPower

    const accelX = point.vtx.accel_x
    const accelY = point.vtx.accel_y ?? 0
    const accelZ = point.vtx.accel_z ?? 0
    const gyroX = point.vtx.gyro_x ?? 0
    const gyroZ = (point.vtx as any).gyro_z ?? 0

    processedSamples.push({
      timestamp: point.vtx.timestamp,
      // Stability: BPF each axis into human band
      bpfRoll: hasGyroData ? rollBpf.update(gyroX) : 0,
      bpfYaw: hasGyroZ ? yawBpf.update(gyroZ) : 0,
      bpfSurge: surgeBpf.update(accelX),
      // Roughness: HPF accel-x and accel-z
      hpfAccelX: roughnessHpfX.update(accelX),
      hpfAccelZ: roughnessHpfZ.update(accelZ),
      // Position: unchanged from v4
      yAxis: yAxisHpf.update(accelY),
      filteredRoll: hasGyroData ? positionRollBpf.update(gyroX) : 0,
      // FIT data
      grade: grades[idx] ?? null,
      cadence,
      speed,
      power,
    })
  })

  // ============================================
  // SECOND PASS: Windowed STFT for stability + roughness
  // ============================================

  const stftWindowSamples = Math.round(C.STFT_WINDOW_SECONDS * sampleRate)
  const stftHopSamples = Math.round(C.STFT_HOP_SECONDS * sampleRate)

  // Stability weights
  const stabilityWeights = {
    roll: options.stabilityRollWeight ?? C.STABILITY_ROLL_WEIGHT,
    yaw: options.stabilityYawWeight ?? C.STABILITY_YAW_WEIGHT,
    surge: options.stabilitySurgeWeight ?? C.STABILITY_SURGE_WEIGHT,
  }

  // If no gyro-z, redistribute yaw weight to roll
  if (!hasGyroZ) {
    stabilityWeights.roll += stabilityWeights.yaw
    stabilityWeights.yaw = 0
  }
  // If no gyro at all, only surge (accel-x) is available
  if (!hasGyroData) {
    stabilityWeights.surge = 1.0
    stabilityWeights.roll = 0
    stabilityWeights.yaw = 0
  }

  // STFT results at ~2 Hz (one per hop)
  interface StftResult {
    centerIdx: number     // Index into processedSamples for this window center
    timestamp: string
    stability: number | null
    stabilityPercent: number | null
    isPedaling: boolean
    cadence: number | null
    cadenceHz: number | null
    cadenceEnergy: number | null
    weightedRms: number | null
    rollRms: number | null
    yawRms: number | null
    surgeRms: number | null
    grade: number | null
    // Roughness
    roughness: number | null
    roughnessRms: number
    speed: number | null
  }

  const stftResults: StftResult[] = []

  for (let windowStart = 0; windowStart + stftWindowSamples <= processedSamples.length; windowStart += stftHopSamples) {
    const windowEnd = windowStart + stftWindowSamples
    const windowData = processedSamples.slice(windowStart, windowEnd)
    const centerIdx = windowStart + Math.floor(stftWindowSamples / 2)
    const centerSample = processedSamples[centerIdx]

    // Determine cadence for this window (median of non-null cadences)
    const windowCadences = windowData
      .map(s => s.cadence)
      .filter((c): c is number => c !== null && c > 0)
    const medianCadence = windowCadences.length > 0
      ? windowCadences.sort((a, b) => a - b)[Math.floor(windowCadences.length / 2)]
      : null
    const isPedaling = medianCadence !== null && medianCadence > 0

    // Stability (only when pedaling)
    let stability: number | null = null
    let stabilityPercent: number | null = null
    let cadenceHz: number | null = null
    let cadenceEnergy: number | null = null
    let weightedRms: number | null = null
    let rollRms: number | null = null
    let yawRms: number | null = null
    let surgeRms: number | null = null

    if (isPedaling && medianCadence !== null) {
      cadenceHz = medianCadence / 60

      const rollWindow = windowData.map(s => s.bpfRoll)
      const yawWindow = windowData.map(s => s.bpfYaw)
      const surgeWindow = windowData.map(s => s.bpfSurge)

      const result = calculateStability(
        rollWindow,
        yawWindow,
        surgeWindow,
        cadenceHz,
        sampleRate,
        {
          weights: stabilityWeights,
          maxStabilityRms: options.maxStabilityRms,
          maxStabilityRmsPerWatt: options.maxStabilityRmsPerWatt,
          powerNormalize: options.powerNormalize,
          power: centerSample.power,
        }
      )

      stability = result.stability
      stabilityPercent = result.stability * 100
      rollRms = result.rollRms
      yawRms = result.yawRms
      surgeRms = result.surgeRms
      cadenceEnergy = result.cadenceEnergy
      weightedRms = result.weightedRms
    }

    // Speed: use center sample's speed
    const speed = centerSample.speed

    // Roughness (only when moving, speed-normalized ceiling)
    const accelXWindow = windowData.map(s => s.hpfAccelX)
    const accelZWindow = windowData.map(s => s.hpfAccelZ)
    const roughnessResult = calculateRoughness(accelXWindow, accelZWindow, speed, {
      baseCeiling: options.roughnessBaseCeiling,
      referenceSpeedMs: options.roughnessReferenceSpeedMs,
      speedExponent: options.roughnessSpeedExponent,
    })

    stftResults.push({
      centerIdx,
      timestamp: centerSample.timestamp,
      stability,
      stabilityPercent,
      isPedaling,
      cadence: medianCadence,
      cadenceHz,
      cadenceEnergy,
      weightedRms,
      rollRms,
      yawRms,
      surgeRms,
      grade: centerSample.grade,
      roughness: roughnessResult.roughness,
      roughnessRms: roughnessResult.roughnessRms,
      speed,
    })
  }

  // ============================================
  // THIRD PASS: Output at OUTPUT_SAMPLE_RATE_HZ + position detection
  // ============================================

  const efficiencySamples: PedalingEfficiencyOutput[] = []
  const roughnessSamples: SurfaceRoughnessSample[] = []
  const positionSamples: RidingPositionSample[] = []

  // Position detection config (unchanged from v4)
  const yAxisThreshold = options.yAxisThreshold ?? C.Y_AXIS_STANDING_THRESHOLD
  const rollRmsThreshold = options.rollRmsThreshold ?? C.ROLL_RMS_STANDING_THRESHOLD
  const positionGyroWeight = options.gyroWeight ?? C.POSITION_GYRO_WEIGHT
  const positionAccelWeight = options.accelWeight ?? C.POSITION_ACCEL_WEIGHT
  const positionWindowSamples = Math.round(C.POSITION_WINDOW_SECONDS * sampleRate)

  // Step through at output rate (e.g. every 20th sample at 100Hz input → 5Hz output)
  const outputStep = Math.max(1, Math.round(sampleRate / C.OUTPUT_SAMPLE_RATE_HZ))

  for (let i = 0; i < processedSamples.length; i += outputStep) {
    const sample = processedSamples[i]

    // Interpolate STFT results to this sample index
    const interpolated = interpolateStftResult(stftResults, i)

    efficiencySamples.push({
      timestamp: sample.timestamp,
      stability: interpolated.stability,
      stabilityPercent: interpolated.stabilityPercent,
      isPedaling: interpolated.isPedaling,
      cadence: interpolated.cadence,
      cadenceHz: interpolated.cadenceHz,
      cadenceEnergy: interpolated.cadenceEnergy,
      weightedRms: interpolated.weightedRms,
      rollRms: interpolated.rollRms,
      yawRms: interpolated.yawRms,
      surgeRms: interpolated.surgeRms,
      grade: sample.grade,
    })

    roughnessSamples.push({
      timestamp: sample.timestamp,
      roughness: interpolated.roughness,
      roughnessRms: interpolated.roughnessRms,
      speed: sample.speed,
    })

    // ============================================
    // RIDING POSITION DETECTION
    // ============================================

    const posWindowStart = Math.max(0, i - Math.floor(positionWindowSamples / 2))
    const posWindowEnd = Math.min(processedSamples.length, i + Math.ceil(positionWindowSamples / 2))
    const posWindowData = processedSamples.slice(posWindowStart, posWindowEnd)

    const yAxisWindow = posWindowData.map(s => s.yAxis)
    const isPedaling = sample.cadence !== null && sample.cadence > 0

    let rollRms: number | undefined
    if (hasGyroData) {
      const rollWindow = posWindowData.map(s => s.filteredRoll)
      const sumSquares = rollWindow.reduce((sum, v) => sum + v * v, 0)
      rollRms = Math.sqrt(sumSquares / rollWindow.length)
    }

    const positionResult = calculateRidingPosition(
      yAxisWindow,
      isPedaling,
      yAxisThreshold,
      hasGyroData ? {
        rollRms,
        rollThreshold: rollRmsThreshold,
        gyroWeight: positionGyroWeight,
        accelWeight: positionAccelWeight,
      } : undefined
    )

    positionSamples.push({
      timestamp: sample.timestamp,
      position: positionResult.position,
      rockingMagnitude: positionResult.rockingMagnitude,
      rollRms: positionResult.rollRms,
      cadence: sample.cadence
    })
  }

  // ============================================
  // DOWNSAMPLE & METADATA
  // ============================================

  const downsampledPosition = downsamplePositionByMajorityVote(positionSamples, 1000)

  const outputRate = C.OUTPUT_SAMPLE_RATE_HZ

  const efficiencyMetadata = calculateMetadata(
    efficiencySamples,
    grades,
    outputRate,
    includeDebug,
    { stableThreshold: options.stableThreshold, unstableThreshold: options.unstableThreshold }
  )

  const positionMetadata = calculateRidingPositionMetadata(
    downsampledPosition,
    outputRate
  )

  const roughnessMetadata = calculateRoughnessMetadata(roughnessSamples, outputRate, {
    smoothThreshold: options.roughnessSmoothThreshold,
    roughThreshold: options.roughnessRoughThreshold,
  })

  return {
    efficiency: { samples: efficiencySamples, metadata: efficiencyMetadata },
    position: { samples: downsampledPosition, metadata: positionMetadata },
    roughness: { samples: roughnessSamples, metadata: roughnessMetadata },
  }
}

// ============================================
// STFT INTERPOLATION
// ============================================

interface InterpolatedResult {
  stability: number | null
  stabilityPercent: number | null
  isPedaling: boolean
  cadence: number | null
  cadenceHz: number | null
  cadenceEnergy: number | null
  weightedRms: number | null
  rollRms: number | null
  yawRms: number | null
  surgeRms: number | null
  roughness: number | null
  roughnessRms: number
}

/**
 * Linearly interpolate STFT results (at ~2 Hz) to a specific sample index (25 Hz)
 */
function interpolateStftResult(
  stftResults: Array<{ centerIdx: number } & InterpolatedResult>,
  sampleIdx: number
): InterpolatedResult {
  if (stftResults.length === 0) {
    return {
      stability: null,
      stabilityPercent: null,
      isPedaling: false,
      cadence: null,
      cadenceHz: null,
      cadenceEnergy: null,
      weightedRms: null,
      rollRms: null,
      yawRms: null,
      surgeRms: null,
      roughness: null,
      roughnessRms: 0,
    }
  }

  // Find the two bracketing STFT windows
  let leftIdx = -1
  let rightIdx = -1

  for (let i = 0; i < stftResults.length; i++) {
    if (stftResults[i].centerIdx <= sampleIdx) {
      leftIdx = i
    }
    if (stftResults[i].centerIdx >= sampleIdx && rightIdx === -1) {
      rightIdx = i
    }
  }

  // Clamp to edges
  if (leftIdx === -1) leftIdx = 0
  if (rightIdx === -1) rightIdx = stftResults.length - 1

  const left = stftResults[leftIdx]
  const right = stftResults[rightIdx]

  // If same window or at edges, just return that window's value
  if (leftIdx === rightIdx || left.centerIdx === right.centerIdx) {
    return left
  }

  // Linear interpolation factor
  const t = (sampleIdx - left.centerIdx) / (right.centerIdx - left.centerIdx)

  // Roughness interpolation: only if both sides have values (both moving)
  let roughness: number | null = null
  if (left.roughness !== null && right.roughness !== null) {
    roughness = lerp(left.roughness, right.roughness, t)
  } else {
    // Nearest-neighbor at moving/stopped boundary
    roughness = (t < 0.5 ? left : right).roughness
  }
  const roughnessRms = lerp(left.roughnessRms, right.roughnessRms, t)

  // For stability: interpolate only if both sides are pedaling
  // If one side is not pedaling, use nearest-neighbor
  if (left.stability !== null && right.stability !== null) {
    return {
      stability: lerp(left.stability, right.stability, t),
      stabilityPercent: lerp(left.stabilityPercent!, right.stabilityPercent!, t),
      isPedaling: true,
      cadence: left.cadence,  // Discrete, don't interpolate
      cadenceHz: left.cadenceHz,
      cadenceEnergy: lerp(left.cadenceEnergy!, right.cadenceEnergy!, t),
      weightedRms: lerp(left.weightedRms!, right.weightedRms!, t),
      rollRms: lerp(left.rollRms!, right.rollRms!, t),
      yawRms: lerp(left.yawRms!, right.yawRms!, t),
      surgeRms: lerp(left.surgeRms!, right.surgeRms!, t),
      roughness,
      roughnessRms,
    }
  }

  // Nearest-neighbor for pedaling/non-pedaling boundary
  const nearest = t < 0.5 ? left : right
  return {
    ...nearest,
    roughness,
    roughnessRms,
  }
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}
