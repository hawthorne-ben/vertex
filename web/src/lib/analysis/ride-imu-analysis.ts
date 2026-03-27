/**
 * Ride IMU Analysis (v7.0.0)
 *
 * Single-pass computation of all IMU-derived metrics from VTX + FIT data:
 * stability, surface roughness, riding position, braking detection.
 *
 * Algorithm Overview:
 * 1. Sync VTX sensor data with FIT data by timestamp
 * 2. First pass (per-sample at native Hz):
 *    - BPF gyro-x/z and accel-x for stability
 *    - HPF accel-x/z for roughness
 *    - HPF accel-y for position
 *    - LPF accel-x/z → pitch → grade baseline → braking deceleration
 * 3. Second pass (windowed, 3s window, 0.5s hop):
 *    - RMS for stability, RMS for roughness, peak braking deceleration
 * 4. Third pass: Interpolate to 5 Hz output + position detection
 */

import { syncFitVtxData, calculateSampleRate } from '../sync/fit-vtx-sync'
import { HighPassFilter, BandPassFilter, LowPassFilter } from '../imu/signal-processing'
import { calculateStability } from './efficiency-calculation'
import { smoothGrades } from './efficiency-calculation'
import { calculateMetadata } from './efficiency-metadata'
import { calculateRoughness, calculateRoughnessMetadata } from './surface-roughness'
import { calculateBraking, calculateBrakingMetadata } from './braking-detection'
import { calculateRidingPosition, downsamplePositionByMajorityVote } from './riding-position-calculation'
import { calculateRidingPositionMetadata } from './riding-position-metadata'
import type { PedalingEfficiencyOutput, PedalingEfficiencyMetadata } from './efficiency-metadata'
import type { RidingPositionSample, RidingPositionMetadata } from './riding-position-types'
import type { SurfaceRoughnessSample, SurfaceRoughnessMetadata } from './surface-roughness-types'
import type { BrakingSample, BrakingMetadata } from './braking-types'
import * as C from './imu-constants'

const G = 9.81 // m/s²

// Re-export types for convenience
export type { PedalingEfficiencyOutput, PedalingEfficiencyMetadata }
export type { RidingPositionSample, RidingPositionMetadata }
export type { SurfaceRoughnessSample, SurfaceRoughnessMetadata }
export type { BrakingSample, BrakingMetadata }

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
    positionWindowSeconds?: number
    yAxisThreshold?: number
    rollBpfLow?: number
    rollBpfHigh?: number
    rollRmsThreshold?: number
    yawBpfLow?: number
    yawBpfHigh?: number
    yawRmsThreshold?: number
    gyroWeight?: number
    accelWeight?: number
    positionRollWeight?: number
    positionYawWeight?: number
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
    // Braking detection
    brakingLpfHz?: number
    brakingGradeWindowSeconds?: number
    brakingThresholdMs2?: number
    brakingMaxMs2?: number
  }
}

// ============================================
// MAIN CALCULATION FUNCTION
// ============================================

export function calculatePedalingEfficiency(
  input: PedalingEfficiencyInput
): {
  efficiency: { samples: PedalingEfficiencyOutput[]; metadata: PedalingEfficiencyMetadata };
  position: { samples: RidingPositionSample[]; metadata: RidingPositionMetadata; rawSamples?: RidingPositionSample[] };
  roughness: { samples: SurfaceRoughnessSample[]; metadata: SurfaceRoughnessMetadata };
  braking: { samples: BrakingSample[]; metadata: BrakingMetadata };
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

  // Position: HPF for Y-axis + BPF for gyro roll + BPF for gyro yaw
  const yAxisHpf = new HighPassFilter(options.hpfCutoff ?? C.ROUGHNESS_HPF_CUTOFF_HZ, sampleRate)
  const rollBpfLow = options.rollBpfLow ?? C.ROLL_BPF_LOW_HZ
  const rollBpfHigh = options.rollBpfHigh ?? C.ROLL_BPF_HIGH_HZ
  const positionRollBpf = new BandPassFilter(rollBpfLow, rollBpfHigh, sampleRate)
  const yawBpfLow = options.yawBpfLow ?? C.YAW_BPF_LOW_HZ
  const yawBpfHigh = options.yawBpfHigh ?? C.YAW_BPF_HIGH_HZ
  const positionYawBpf = new BandPassFilter(yawBpfLow, yawBpfHigh, sampleRate)

  // Braking: LPF accel-x/z for clean pitch, then long EMA for grade baseline
  const brakingLpfHz = options.brakingLpfHz ?? C.BRAKING_LPF_HZ
  const brakingLpfX = new LowPassFilter(brakingLpfHz, sampleRate)
  const brakingLpfZ = new LowPassFilter(brakingLpfHz, sampleRate)
  const gradeWindowSamples = Math.round((options.brakingGradeWindowSeconds ?? C.BRAKING_GRADE_WINDOW_SECONDS) * sampleRate)
  // EMA alpha for grade baseline: approximate a rolling avg of N samples
  const gradeAlpha = 2.0 / (gradeWindowSamples + 1)

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
    filteredYaw: number   // BPF'd gyro-z for position
    // Braking signals
    brakingDecel: number      // braking deceleration (m/s², positive = braking)
    estimatedGradePct: number // IMU-derived grade from pitch baseline (%)
    // FIT data
    grade: number | null
    cadence: number | null
    speed: number | null
    power: number | null
  }

  const processedSamples: ProcessedSample[] = []

  // Track last known FIT values (FIT is 1 Hz, VTX is 25+ Hz)
  let lastKnownCadence: number | null = null
  let lastKnownSpeed: number | null = null
  let lastKnownPower: number | null = null

  // Braking: EMA grade baseline (pitch in radians)
  let gradeBaseline: number | null = null

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

    // Braking: LPF accel → pitch → deviation from grade baseline
    // Z reads negative (gravity = -9.81 on up axis), negate so pitch=0 on flat ground
    const smoothX = brakingLpfX.update(accelX)
    const smoothZ = brakingLpfZ.update(-accelZ)
    const pitch = Math.atan2(smoothX, smoothZ) // radians, positive = tilted forward
    if (gradeBaseline === null) {
      gradeBaseline = pitch
    } else {
      gradeBaseline = gradeAlpha * pitch + (1 - gradeAlpha) * gradeBaseline
    }
    // Braking makes accel_x go negative (deceleration force), so pitch goes negative.
    // Negate so that deceleration is positive.
    const brakingPitch = gradeBaseline - pitch // positive when pitch drops below baseline = braking
    const brakingDecel = G * Math.sin(brakingPitch) // m/s², positive = deceleration
    // Clamp grade baseline to ±π/4 (~±100%) before tan() to prevent explosion near ±π/2
    const clampedBaseline = Math.max(-Math.PI / 4, Math.min(Math.PI / 4, gradeBaseline))
    const estimatedGradePct = Math.tan(clampedBaseline) * 100

    processedSamples.push({
      timestamp: point.vtx.timestamp,
      // Stability: BPF each axis into human band
      bpfRoll: hasGyroData ? rollBpf.update(gyroX) : 0,
      bpfYaw: hasGyroZ ? yawBpf.update(gyroZ) : 0,
      bpfSurge: surgeBpf.update(accelX),
      // Roughness: HPF accel-x and accel-z
      hpfAccelX: roughnessHpfX.update(accelX),
      hpfAccelZ: roughnessHpfZ.update(accelZ),
      // Position
      yAxis: yAxisHpf.update(accelY),
      filteredRoll: hasGyroData ? positionRollBpf.update(gyroX) : 0,
      filteredYaw: hasGyroZ ? positionYawBpf.update(gyroZ) : 0,
      // Braking
      brakingDecel: Math.max(0, brakingDecel), // only positive (deceleration)
      estimatedGradePct,
      // FIT data
      grade: grades[idx] ?? null,
      cadence,
      speed,
      power,
    })
  })

  // ============================================
  // SECOND PASS: Windowed aggregation for stability + roughness
  // ============================================

  const windowSamples = Math.round(C.WINDOW_SECONDS * sampleRate)
  const hopSamples = Math.round(C.WINDOW_HOP_SECONDS * sampleRate)

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

  // Window results at ~2 Hz (one per hop)
  interface WindowResult {
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
    // Braking
    isBraking: boolean
    brakingIntensity: number
    brakingDecelerationMs2: number
    estimatedGradePercent: number
  }

  const windowResults: WindowResult[] = []

  for (let windowStart = 0; windowStart + windowSamples <= processedSamples.length; windowStart += hopSamples) {
    const windowEnd = windowStart + windowSamples
    const windowData = processedSamples.slice(windowStart, windowEnd)
    const centerIdx = windowStart + Math.floor(windowSamples / 2)
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

    // Braking: peak deceleration in window
    const brakingWindow = windowData.map(s => s.brakingDecel)
    const meanGrade = windowData.reduce((s, d) => s + d.estimatedGradePct, 0) / windowData.length
    const brakingResult = calculateBraking(brakingWindow, meanGrade, {
      threshold: options.brakingThresholdMs2,
      maxDeceleration: options.brakingMaxMs2,
    })

    windowResults.push({
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
      isBraking: brakingResult.isBraking,
      brakingIntensity: brakingResult.brakingIntensity,
      brakingDecelerationMs2: brakingResult.brakingDecelerationMs2,
      estimatedGradePercent: brakingResult.estimatedGradePercent,
    })
  }

  // ============================================
  // THIRD PASS: Output at OUTPUT_SAMPLE_RATE_HZ + position detection
  // ============================================

  const efficiencySamples: PedalingEfficiencyOutput[] = []
  const roughnessSamples: SurfaceRoughnessSample[] = []
  const brakingSamples: BrakingSample[] = []
  const positionSamples: RidingPositionSample[] = []

  // Position detection config
  const yAxisThreshold = options.yAxisThreshold ?? C.Y_AXIS_STANDING_THRESHOLD
  const rollRmsThreshold = options.rollRmsThreshold ?? C.ROLL_RMS_STANDING_THRESHOLD
  const yawRmsThreshold = options.yawRmsThreshold ?? C.YAW_RMS_STANDING_THRESHOLD
  const positionGyroWeight = options.gyroWeight ?? C.POSITION_GYRO_WEIGHT
  const positionAccelWeight = options.accelWeight ?? C.POSITION_ACCEL_WEIGHT
  const positionRollWeight = options.positionRollWeight ?? C.POSITION_ROLL_WEIGHT
  const positionYawWeight = options.positionYawWeight ?? C.POSITION_YAW_WEIGHT
  const positionWindowSamples = Math.round((options.positionWindowSeconds ?? C.POSITION_WINDOW_SECONDS) * sampleRate)

  // Step through at output rate (e.g. every 20th sample at 100Hz input → 5Hz output)
  const outputStep = Math.max(1, Math.round(sampleRate / C.OUTPUT_SAMPLE_RATE_HZ))

  for (let i = 0; i < processedSamples.length; i += outputStep) {
    const sample = processedSamples[i]

    // Interpolate window results to this sample index
    const interpolated = interpolateWindowResult(windowResults, i)

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

    brakingSamples.push({
      timestamp: sample.timestamp,
      isBraking: interpolated.isBraking,
      brakingIntensity: interpolated.brakingIntensity,
      brakingDecelerationMs2: interpolated.brakingDecelerationMs2,
      estimatedGradePercent: interpolated.estimatedGradePercent,
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
    let yawRms: number | undefined
    if (hasGyroData) {
      const rollWindow = posWindowData.map(s => s.filteredRoll)
      const rollSumSq = rollWindow.reduce((sum, v) => sum + v * v, 0)
      rollRms = Math.sqrt(rollSumSq / rollWindow.length)
    }
    if (hasGyroZ) {
      const yawWindow = posWindowData.map(s => s.filteredYaw)
      const yawSumSq = yawWindow.reduce((sum, v) => sum + v * v, 0)
      yawRms = Math.sqrt(yawSumSq / yawWindow.length)
    }

    const positionResult = calculateRidingPosition(
      yAxisWindow,
      isPedaling,
      yAxisThreshold,
      (hasGyroData || hasGyroZ) ? {
        rollRms,
        rollThreshold: rollRmsThreshold,
        yawRms,
        yawThreshold: yawRmsThreshold,
        gyroWeight: positionGyroWeight,
        accelWeight: positionAccelWeight,
        rollWeight: positionRollWeight,
        yawWeight: positionYawWeight,
      } : undefined
    )

    positionSamples.push({
      timestamp: sample.timestamp,
      position: positionResult.position,
      rockingMagnitude: positionResult.rockingMagnitude,
      rollRms: positionResult.rollRms,
      yawRms: positionResult.yawRms,
      cadence: sample.cadence,
      ...(includeDebug ? {
        accelScore: positionResult.accelScore,
        gyroScore: positionResult.gyroScore,
        combinedScore: positionResult.combinedScore,
      } : {}),
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

  const brakingMetadata = calculateBrakingMetadata(brakingSamples, outputRate)

  return {
    efficiency: { samples: efficiencySamples, metadata: efficiencyMetadata },
    position: {
      samples: downsampledPosition,
      metadata: positionMetadata,
      ...(includeDebug ? { rawSamples: positionSamples } : {}),
    },
    roughness: { samples: roughnessSamples, metadata: roughnessMetadata },
    braking: { samples: brakingSamples, metadata: brakingMetadata },
  }
}

// ============================================
// WINDOW INTERPOLATION
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
  isBraking: boolean
  brakingIntensity: number
  brakingDecelerationMs2: number
  estimatedGradePercent: number
}

/**
 * Linearly interpolate window results (at ~2 Hz) to a specific sample index (25 Hz)
 */
function interpolateWindowResult(
  windowResults: Array<{ centerIdx: number } & InterpolatedResult>,
  sampleIdx: number
): InterpolatedResult {
  if (windowResults.length === 0) {
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
      isBraking: false,
      brakingIntensity: 0,
      brakingDecelerationMs2: 0,
      estimatedGradePercent: 0,
    }
  }

  // Find the two bracketing windows
  let leftIdx = -1
  let rightIdx = -1

  for (let i = 0; i < windowResults.length; i++) {
    if (windowResults[i].centerIdx <= sampleIdx) {
      leftIdx = i
    }
    if (windowResults[i].centerIdx >= sampleIdx && rightIdx === -1) {
      rightIdx = i
    }
  }

  // Clamp to edges
  if (leftIdx === -1) leftIdx = 0
  if (rightIdx === -1) rightIdx = windowResults.length - 1

  const left = windowResults[leftIdx]
  const right = windowResults[rightIdx]

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

  // Braking interpolation
  const isBraking = (t < 0.5 ? left : right).isBraking
  const brakingIntensity = lerp(left.brakingIntensity, right.brakingIntensity, t)
  const brakingDecelerationMs2 = lerp(left.brakingDecelerationMs2, right.brakingDecelerationMs2, t)
  const estimatedGradePercent = lerp(left.estimatedGradePercent, right.estimatedGradePercent, t)

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
      isBraking,
      brakingIntensity,
      brakingDecelerationMs2,
      estimatedGradePercent,
    }
  }

  // Nearest-neighbor for pedaling/non-pedaling boundary
  const nearest = t < 0.5 ? left : right
  return {
    ...nearest,
    roughness,
    roughnessRms,
    isBraking,
    brakingIntensity,
    brakingDecelerationMs2,
    estimatedGradePercent,
  }
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}
