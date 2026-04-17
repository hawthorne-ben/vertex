/**
 * Ride IMU Analysis (v8.0.0)
 *
 * Multi-pass computation of all IMU-derived metrics from VTX + FIT data:
 * stability, surface roughness, riding position, braking detection.
 *
 * Algorithm Overview:
 * 1. Sync VTX sensor data with FIT data by timestamp
 * 2. Braking pre-pass (zero-phase, whole-array):
 *    - Forward-backward Butterworth on accel_x/z (5 Hz cutoff, zero phase lag)
 *    - Compute pitch from filtered accel
 *    - Forward-backward EMA on pitch for lag-free grade baseline
 *    - Braking decel = pitch deviation from baseline, with gyro_y correlation
 * 3. First pass (per-sample at native Hz):
 *    - BPF gyro-x/z and accel-x for stability
 *    - HPF accel-x/z for roughness
 *    - HPF accel-y for position
 * 4. Second pass (windowed):
 *    - 3s window / 0.5s hop: RMS for stability, RMS for roughness
 *    - 0.75s window / 0.2s hop: peak braking deceleration (separate, shorter window)
 * 5. Third pass: Interpolate to 5 Hz output + position detection
 */

import { syncFitVtxData, calculateSampleRate } from '../sync/fit-vtx-sync'
import { HighPassFilter, BandPassFilter, filtfilt, filtfiltEma } from '../imu/signal-processing'
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
    gyro_y?: number   // pitch rate for braking correlation
    gyro_z?: number   // yaw for position/stability
  }>
  fitSamples: Array<{
    timestamp: string
    grade?: number | null
    altitude?: number | null
    distance?: number | null
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
    brakingGradeLpfHz?: number
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

  // Pre-process: smooth grade at FIT cadence (~1 Hz), then expand to synced timeline.
  // Computes grade from altitude/distance when the FIT file lacks a grade field.
  const fitGradesSmoothed = smoothGrades(
    fitSamples as Array<{ grade?: number | null; altitude?: number | null; distance?: number | null }>,
    C.GRADE_SMOOTH_WINDOW_SECONDS
  )

  // Build a fit timestamp → smoothed grade lookup, then carry-forward across
  // the synced timeline (which has many VTX-only points between FIT samples).
  const fitTimeToGrade = new Map<number, number | null>()
  for (let i = 0; i < fitSamples.length; i++) {
    const ts = new Date(fitSamples[i].timestamp).getTime()
    fitTimeToGrade.set(ts, fitGradesSmoothed[i] ?? null)
  }

  const grades: (number | null)[] = new Array(synced.length).fill(null)
  let lastGrade: number | null = null
  for (let i = 0; i < synced.length; i++) {
    if (synced[i].fit) {
      const ts = synced[i].timestamp
      if (fitTimeToGrade.has(ts)) {
        lastGrade = fitTimeToGrade.get(ts) ?? null
      }
    }
    grades[i] = lastGrade
  }

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

  // Detect if gyro data is present
  const hasGyroData = vtxSamples.slice(0, 5).some(s => s.gyro_x !== undefined && s.gyro_x !== null)
  const hasGyroZ = vtxSamples.slice(0, 5).some(s => s.gyro_z !== undefined && s.gyro_z !== null)
  const hasGyroY = vtxSamples.slice(0, 5).some(s => s.gyro_y !== undefined && s.gyro_y !== null)

  // ============================================
  // BRAKING PRE-PASS: zero-phase filtering (whole-array, no phase lag)
  // ============================================

  const brakingLpfHz = options.brakingLpfHz ?? C.BRAKING_LPF_HZ
  const brakingGradeLpfHz = options.brakingGradeLpfHz ?? C.BRAKING_GRADE_LPF_HZ
  const speedLpfHz = C.BRAKING_SPEED_LPF_HZ

  // Collect raw accel arrays from synced data (only VTX-bearing points).
  // Also carry forward FIT speed at the dense (VTX) cadence so we can compute
  // longitudinal-acceleration compensation aligned with the IMU samples.
  const rawAccelX: number[] = []
  const rawAccelZ: number[] = []
  const rawGyroY: number[] = []
  const rawSpeedArray: number[] = []  // m/s, carry-forward from FIT (1 Hz → dense)
  const fitGradeArray: Array<number | null> = []  // FIT grade aligned with dense index

  let prepassLastSpeed = 0  // carry-forward seed
  synced.forEach((point, idx) => {
    // Update carry-forward speed from any point with FIT data
    if (point.fit) {
      const s = (point.fit as any)?.speed
      if (s !== undefined && s !== null) prepassLastSpeed = s
    }
    if (!point.vtx) return
    rawAccelX.push(point.vtx.accel_x)
    rawAccelZ.push(-(point.vtx.accel_z ?? 0))  // negate: BNO055 Z reads -9.81 on up axis
    rawGyroY.push(point.vtx.gyro_y ?? 0)
    rawSpeedArray.push(prepassLastSpeed)
    fitGradeArray.push(grades[idx] ?? null)
  })

  // Forward-backward Butterworth on accel (zero-phase, 5 Hz cutoff)
  const smoothAccelX = filtfilt(rawAccelX, brakingLpfHz, sampleRate)
  const smoothAccelZ = filtfilt(rawAccelZ, brakingLpfHz, sampleRate)

  // Smooth FIT speed with zero-phase EMA, then compute dv/dt per sample.
  // Convert to pitch-equivalent radians: a forward inertial acceleration of `a`
  // bleeds onto accel_x identically to a nose-up tilt of arcsin(a/g).
  const smoothSpeed = filtfiltEma(rawSpeedArray, speedLpfHz, sampleRate)
  const pitchInertial = new Array<number>(smoothSpeed.length).fill(0)
  for (let i = 1; i < smoothSpeed.length - 1; i++) {
    const dvdt = (smoothSpeed[i + 1] - smoothSpeed[i - 1]) * (sampleRate / 2)  // central diff
    const ratio = Math.max(-1, Math.min(1, dvdt / G))
    pitchInertial[i] = Math.asin(ratio)
  }
  pitchInertial[0] = pitchInertial[1] ?? 0
  pitchInertial[pitchInertial.length - 1] = pitchInertial[pitchInertial.length - 2] ?? 0

  // Compute raw pitch from zero-phase-filtered accel, then subtract the
  // inertial component. Whatever remains is true geometric pitch (grade + tilt).
  const pitchArray = new Array<number>(smoothAccelX.length)
  for (let i = 0; i < smoothAccelX.length; i++) {
    const rawPitch = Math.atan2(smoothAccelX[i], smoothAccelZ[i])
    pitchArray[i] = rawPitch - pitchInertial[i]
  }

  // Forward-backward EMA on compensated pitch → grade baseline (lag-free)
  const gradeBaselineRaw = filtfiltEma(pitchArray, brakingGradeLpfHz, sampleRate)

  // Per-ride static offset: median of compensated pitch = mounting offset.
  // (After longitudinal compensation, residual constant bias is the bike-to-IMU
  // mounting tilt. On a closed loop the median is unbiased; with net elevation
  // change it's biased by ~half the average grade — still a useful first-order
  // correction for typical rides.)
  const pitchOffsetRad = computeMedian(pitchArray)
  const gradeBaseline = gradeBaselineRaw.map(p => p - pitchOffsetRad)

  // Braking deceleration = pitch deviation from grade baseline
  const brakingDecelArray = new Array<number>(pitchArray.length)
  const estimatedGradePctArray = new Array<number>(pitchArray.length)
  for (let i = 0; i < pitchArray.length; i++) {
    const brakingPitch = gradeBaseline[i] - (pitchArray[i] - pitchOffsetRad)
    brakingDecelArray[i] = Math.max(0, G * Math.sin(brakingPitch))
    const clamped = Math.max(-Math.PI / 4, Math.min(Math.PI / 4, gradeBaseline[i]))
    estimatedGradePctArray[i] = Math.tan(clamped) * 100
  }

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
    // FIT data
    grade: number | null
    cadence: number | null
    speed: number | null
    power: number | null
  }

  const processedSamples: ProcessedSample[] = []

  // Track last known FIT values (FIT is 1 Hz, VTX is 104 Hz)
  let lastKnownCadence: number | null = null
  let lastKnownSpeed: number | null = null
  let lastKnownPower: number | null = null

  synced.forEach((point, idx) => {
    // Update carried-forward FIT values from ANY point with FIT data
    // (including FIT-only points where vtx is null)
    if (point.fit) {
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
    }

    // Skip points without VTX data (can't compute IMU metrics)
    if (!point.vtx) return

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
      // Position
      yAxis: yAxisHpf.update(accelY),
      filteredRoll: hasGyroData ? positionRollBpf.update(gyroX) : 0,
      filteredYaw: hasGyroZ ? positionYawBpf.update(gyroZ) : 0,
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

  // Window results at ~2 Hz (one per hop) — stability + roughness only
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
  }

  const windowResults: WindowResult[] = []

  for (let windowStart = 0; windowStart + windowSamples <= processedSamples.length; windowStart += hopSamples) {
    const windowEnd = windowStart + windowSamples
    const windowData = processedSamples.slice(windowStart, windowEnd)
    const centerIdx = windowStart + Math.floor(windowSamples / 2)
    const centerSample = processedSamples[centerIdx]

    // Cadence is a slow signal carried forward from FIT (~1 Hz), so the center
    // sample's cadence is representative of the whole 3s window. Avoids the
    // O(k log k) per-window sort the median version did.
    const centerCadence = centerSample.cadence
    const windowCadence = centerCadence !== null && centerCadence > 0 ? centerCadence : null
    const isPedaling = windowCadence !== null

    // Stability (only when pedaling)
    let stability: number | null = null
    let stabilityPercent: number | null = null
    let cadenceHz: number | null = null
    let cadenceEnergy: number | null = null
    let weightedRms: number | null = null
    let rollRms: number | null = null
    let yawRms: number | null = null
    let surgeRms: number | null = null

    if (isPedaling && windowCadence !== null) {
      cadenceHz = windowCadence / 60

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

    windowResults.push({
      centerIdx,
      timestamp: centerSample.timestamp,
      stability,
      stabilityPercent,
      isPedaling,
      cadence: windowCadence,
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
  // BRAKING WINDOWED PASS: shorter windows from pre-pass arrays
  // ============================================

  const brakingWindowSamples = Math.round(C.BRAKING_WINDOW_SECONDS * sampleRate)
  const brakingHopSamples = Math.round(C.BRAKING_WINDOW_HOP_SECONDS * sampleRate)
  const gyroIntegralHalfWidth = Math.round((C.BRAKING_GYRO_INTEGRAL_WINDOW_SECONDS * sampleRate) / 2)

  interface BrakingWindowResult {
    centerIdx: number
    isBraking: boolean
    brakingIntensity: number
    brakingDecelerationMs2: number
    estimatedGradePercent: number
    fitGradePercent: number | null
  }

  const brakingWindowResults: BrakingWindowResult[] = []
  const nBrakingSamples = brakingDecelArray.length

  for (let windowStart = 0; windowStart + brakingWindowSamples <= nBrakingSamples; windowStart += brakingHopSamples) {
    const windowEnd = windowStart + brakingWindowSamples
    const centerIdx = windowStart + Math.floor(brakingWindowSamples / 2)

    const decelWindow = brakingDecelArray.slice(windowStart, windowEnd)
    const meanGrade = estimatedGradePctArray.slice(windowStart, windowEnd)
      .reduce((s, v) => s + v, 0) / (windowEnd - windowStart)

    // FIT grade at window center (lagged independent reference for visualization)
    const fitGradePercent = fitGradeArray[centerIdx] ?? null

    // Gyro context for terrain rejection + pitch-rate correlation
    let gyroContext: { window: number[]; integralWindow: number[]; sampleRate: number } | undefined
    if (hasGyroY) {
      const integralStart = Math.max(0, centerIdx - gyroIntegralHalfWidth)
      const integralEnd = Math.min(nBrakingSamples, centerIdx + gyroIntegralHalfWidth + 1)
      gyroContext = {
        window: rawGyroY.slice(windowStart, windowEnd),
        integralWindow: rawGyroY.slice(integralStart, integralEnd),
        sampleRate,
      }
    }

    const result = calculateBraking(decelWindow, meanGrade, {
      threshold: options.brakingThresholdMs2,
      maxDeceleration: options.brakingMaxMs2,
    }, gyroContext)

    brakingWindowResults.push({
      centerIdx,
      isBraking: result.isBraking,
      brakingIntensity: result.brakingIntensity,
      brakingDecelerationMs2: result.brakingDecelerationMs2,
      estimatedGradePercent: result.estimatedGradePercent,
      fitGradePercent,
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

  // Two-pointer cursors that advance with `i`. Both windowResults[] and
  // brakingWindowResults[] are sorted by centerIdx, and `i` is monotonic, so
  // we never need to walk backward. This makes the third pass O(n) instead of
  // O(n × windows).
  let stabWinCursor = 0
  let brakWinCursor = 0

  for (let i = 0; i < processedSamples.length; i += outputStep) {
    const sample = processedSamples[i]

    // Interpolate stability/roughness from windowResults
    const interpolated = interpolateAtCursor(windowResults, i, stabWinCursor, EMPTY_INTERPOLATED)
    stabWinCursor = interpolated.cursor

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

    // Braking: interpolate from dedicated braking window results
    const brakingInterp = interpolateBrakingAtCursor(brakingWindowResults, i, brakWinCursor)
    brakWinCursor = brakingInterp.cursor
    brakingSamples.push({
      timestamp: sample.timestamp,
      isBraking: brakingInterp.isBraking,
      brakingIntensity: brakingInterp.brakingIntensity,
      brakingDecelerationMs2: brakingInterp.brakingDecelerationMs2,
      estimatedGradePercent: brakingInterp.estimatedGradePercent,
      fitGradePercent: brakingInterp.fitGradePercent,
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
}

const EMPTY_INTERPOLATED: InterpolatedResult & { cursor: number } = {
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
  cursor: 0,
}

/**
 * Two-pointer interpolation: caller passes a cursor that we advance forward
 * across the sorted windowResults array. Returns the interpolated result plus
 * the new cursor position to thread into the next call.
 *
 * This is O(1) amortized when sampleIdx moves monotonically (which it does in
 * the third pass), making the entire pass O(n) instead of O(n × windows).
 */
function interpolateAtCursor<T extends { centerIdx: number } & InterpolatedResult>(
  windowResults: T[],
  sampleIdx: number,
  cursor: number,
  empty: InterpolatedResult & { cursor: number },
): InterpolatedResult & { cursor: number } {
  if (windowResults.length === 0) return empty

  // Advance cursor forward while the next window's center is still <= sampleIdx
  while (cursor + 1 < windowResults.length && windowResults[cursor + 1].centerIdx <= sampleIdx) {
    cursor++
  }

  const left = windowResults[cursor]
  const rightIdx = cursor + 1 < windowResults.length ? cursor + 1 : cursor
  const right = windowResults[rightIdx]

  // Edge cases: same window, or sampleIdx outside window range entirely
  if (left.centerIdx === right.centerIdx || sampleIdx <= left.centerIdx) {
    return { ...left, cursor }
  }
  if (sampleIdx >= right.centerIdx) {
    return { ...right, cursor }
  }

  const t = (sampleIdx - left.centerIdx) / (right.centerIdx - left.centerIdx)

  // Roughness interpolation: only if both sides have values (both moving)
  let roughness: number | null
  if (left.roughness !== null && right.roughness !== null) {
    roughness = lerp(left.roughness, right.roughness, t)
  } else {
    roughness = (t < 0.5 ? left : right).roughness
  }
  const roughnessRms = lerp(left.roughnessRms, right.roughnessRms, t)

  // Stability: interpolate only if both sides are pedaling, otherwise nearest-neighbor
  if (left.stability !== null && right.stability !== null) {
    return {
      stability: lerp(left.stability, right.stability, t),
      stabilityPercent: lerp(left.stabilityPercent!, right.stabilityPercent!, t),
      isPedaling: true,
      cadence: left.cadence,
      cadenceHz: left.cadenceHz,
      cadenceEnergy: lerp(left.cadenceEnergy!, right.cadenceEnergy!, t),
      weightedRms: lerp(left.weightedRms!, right.weightedRms!, t),
      rollRms: lerp(left.rollRms!, right.rollRms!, t),
      yawRms: lerp(left.yawRms!, right.yawRms!, t),
      surgeRms: lerp(left.surgeRms!, right.surgeRms!, t),
      roughness,
      roughnessRms,
      cursor,
    }
  }

  const nearest = t < 0.5 ? left : right
  return { ...nearest, roughness, roughnessRms, cursor }
}

interface InterpolatedBrakingResult {
  isBraking: boolean
  brakingIntensity: number
  brakingDecelerationMs2: number
  estimatedGradePercent: number
  fitGradePercent: number | null
}

const EMPTY_BRAKING_INTERPOLATED: InterpolatedBrakingResult & { cursor: number } = {
  isBraking: false,
  brakingIntensity: 0,
  brakingDecelerationMs2: 0,
  estimatedGradePercent: 0,
  fitGradePercent: null,
  cursor: 0,
}

/**
 * Two-pointer braking interpolation. Same monotonic-cursor pattern as
 * interpolateAtCursor but for the braking-specific window shape.
 */
function interpolateBrakingAtCursor<T extends { centerIdx: number } & InterpolatedBrakingResult>(
  results: T[],
  sampleIdx: number,
  cursor: number,
): InterpolatedBrakingResult & { cursor: number } {
  if (results.length === 0) return EMPTY_BRAKING_INTERPOLATED

  while (cursor + 1 < results.length && results[cursor + 1].centerIdx <= sampleIdx) {
    cursor++
  }

  const left = results[cursor]
  const rightIdx = cursor + 1 < results.length ? cursor + 1 : cursor
  const right = results[rightIdx]

  if (left.centerIdx === right.centerIdx || sampleIdx <= left.centerIdx) {
    return { ...left, cursor }
  }
  if (sampleIdx >= right.centerIdx) {
    return { ...right, cursor }
  }

  const t = (sampleIdx - left.centerIdx) / (right.centerIdx - left.centerIdx)
  const brakingDecelerationMs2 = lerp(left.brakingDecelerationMs2, right.brakingDecelerationMs2, t)
  const brakingIntensity = lerp(left.brakingIntensity, right.brakingIntensity, t)
  const estimatedGradePercent = lerp(left.estimatedGradePercent, right.estimatedGradePercent, t)
  const fitGradePercent = (t < 0.5 ? left : right).fitGradePercent
  const isBraking = brakingIntensity > 0

  return { isBraking, brakingIntensity, brakingDecelerationMs2, estimatedGradePercent, fitGradePercent, cursor }
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

/**
 * Compute the median of a numeric array. Used for the per-ride pitch offset
 * calibration: median compensated pitch ≈ static mounting offset.
 *
 * Uses an in-place quickselect-style approach via sort. For 100k+ samples this
 * is still fast enough (~10ms), but if it ever becomes a bottleneck, swap to
 * a proper Floyd-Rivest selection.
 */
function computeMedian(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = Array.from(values).sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid]
}
