/**
 * Pure functions for chart data processing
 * Extracted from chart components for testability and reusability
 */

import uPlot from 'uplot'
import type { ChartStat } from '@/components/charts/UPlotBase'

export interface IMUSample {
  timestamp: string
  accel_x: number
  accel_y: number
  accel_z: number
  gyro_x: number
  gyro_y: number
  gyro_z: number
  roll?: number | null
  pitch?: number | null
  yaw?: number | null
}

export type IMUDataType = 'orientation' | 'accel' | 'gyro'

export interface ChartData {
  data: uPlot.AlignedData
  series: uPlot.Series[]
  yAxisLabel: string
  scales: Record<string, uPlot.Scale>
}

/** Unified config shape returned by all chart builders */
export interface ChartConfig {
  data: uPlot.AlignedData
  series: uPlot.Series[]
  scales: Record<string, uPlot.Scale>
  axes?: uPlot.Axis[]
  stats: ChartStat[]
}

/**
 * Filter samples by zoom range, insert gaps, and convert to uPlot timestamps
 * — all in a single pass with one Date parse per sample. Returns parallel
 * arrays: filtered samples (with nulls for gap markers) and uPlot timestamps
 * in seconds.
 */
export function filterAndGapSamples<T extends { timestamp: string }>(
  samples: T[],
  zoomRange?: { start: string; end: string } | null,
  gapThresholdMs: number = 10000,
): { timestamps: number[]; samples: (T | null)[] } {
  if (samples.length === 0) return { timestamps: [], samples: [] }

  const startMs = zoomRange ? new Date(zoomRange.start).getTime() : -Infinity
  const endMs = zoomRange ? new Date(zoomRange.end).getTime() : Infinity

  const out: (T | null)[] = []
  const timestamps: number[] = []
  let lastKeptMs = -Infinity

  for (let i = 0; i < samples.length; i++) {
    const ms = new Date(samples[i].timestamp).getTime()
    if (ms < startMs || ms > endMs) continue

    // Insert gap marker if there's a jump from the previous kept sample.
    // The tiny +0.001 keeps uPlot's x-axis monotonic across the null break.
    if (lastKeptMs !== -Infinity && ms - lastKeptMs > gapThresholdMs) {
      out.push(null)
      timestamps.push(timestamps[timestamps.length - 1] + 0.001)
    }

    out.push(samples[i])
    timestamps.push(ms / 1000)
    lastKeptMs = ms
  }

  return { timestamps, samples: out }
}

/**
 * Process IMU data for charting
 * Handles gap detection and format conversion
 */
export function processIMUChartData(
  samples: IMUSample[],
  dataType: IMUDataType,
  zoomRange?: { start: string; end: string } | null
): ChartData {
  if (samples.length === 0) {
    return {
      data: [[], []] as uPlot.AlignedData,
      series: [{}],
      yAxisLabel: '',
      scales: { x: {}, y: {} }
    }
  }

  // Calculate gap threshold from sample density (parse first/last only)
  const firstTime = new Date(samples[0].timestamp).getTime()
  const lastTime = new Date(samples[samples.length - 1].timestamp).getTime()
  const totalDuration = lastTime - firstTime
  const expectedSpacing = totalDuration / samples.length
  const GAP_THRESHOLD_MS = Math.max(5000, expectedSpacing * 10)

  // Single-pass filter (no-op if zoomRange is null) + gap detection + uPlot conversion
  const { timestamps, samples: finalSamples } = filterAndGapSamples(samples, zoomRange, GAP_THRESHOLD_MS)

  // Build data arrays based on type
  let data: uPlot.AlignedData
  let series: uPlot.Series[]
  let yAxisLabel: string

  switch (dataType) {
    case 'orientation':
      data = [
        timestamps,
        finalSamples.map(s => s?.roll ?? null),
        finalSamples.map(s => s?.pitch ?? null),
        finalSamples.map(s => s?.yaw ?? null)
      ]
      series = [
        {},
        { label: 'Roll', stroke: 'hsl(220, 70%, 50%)', width: 2, spanGaps: false, points: { show: false } },
        { label: 'Pitch', stroke: 'hsl(145, 60%, 45%)', width: 2, spanGaps: false, points: { show: false } },
        { label: 'Yaw', stroke: 'hsl(10, 70%, 50%)', width: 2, spanGaps: false, points: { show: false } }
      ]
      yAxisLabel = '°'
      break

    case 'accel':
      data = [
        timestamps,
        finalSamples.map(s => s?.accel_x ?? null),
        finalSamples.map(s => s?.accel_y ?? null),
        finalSamples.map(s => s?.accel_z ?? null)
      ]
      series = [
        {},
        { label: 'X', stroke: 'hsl(10, 49%, 53%)', width: 2, spanGaps: false, points: { show: false } },
        { label: 'Y', stroke: 'hsl(145, 50%, 54%)', width: 2, spanGaps: false, points: { show: false } },
        { label: 'Z', stroke: 'hsl(205, 60%, 71%)', width: 2, spanGaps: false, points: { show: false } }
      ]
      yAxisLabel = 'm/s²'
      break

    case 'gyro':
      data = [
        timestamps,
        finalSamples.map(s => s?.gyro_x ?? null),
        finalSamples.map(s => s?.gyro_y ?? null),
        finalSamples.map(s => s?.gyro_z ?? null)
      ]
      series = [
        {},
        { label: 'X', stroke: 'hsl(10, 49%, 53%)', width: 2, spanGaps: false, points: { show: false } },
        { label: 'Y', stroke: 'hsl(145, 50%, 54%)', width: 2, spanGaps: false, points: { show: false } },
        { label: 'Z', stroke: 'hsl(205, 60%, 71%)', width: 2, spanGaps: false, points: { show: false } }
      ]
      yAxisLabel = 'deg/s'
      break
  }

  // Build scales
  const scales: Record<string, uPlot.Scale> = {
    x: {
      ...(zoomRange ? {
        range: [
          new Date(zoomRange.start).getTime() / 1000,
          new Date(zoomRange.end).getTime() / 1000
        ]
      } : {})
    },
    y: {
      auto: true,
      range: (u, dataMin, dataMax) => {
        if (dataMin === dataMax) {
          return [dataMin - 1, dataMax + 1]
        }
        const padding = (dataMax - dataMin) * 0.1
        return [dataMin - padding, dataMax + padding]
      }
    }
  }

  return { data, series, yAxisLabel, scales }
}

/**
 * Calculate statistics for IMU data
 */
export function calculateIMUStats(
  samples: IMUSample[],
  dataType: IMUDataType
): Array<{ axis: string; min: number; max: number; mean: number }> {
  if (samples.length === 0) return []

  const getValues = () => {
    switch (dataType) {
      case 'orientation':
        return {
          'Roll': samples.map(s => s.roll ?? 0),
          'Pitch': samples.map(s => s.pitch ?? 0),
          'Yaw': samples.map(s => s.yaw ?? 0)
        }
      case 'accel':
        return {
          'X': samples.map(s => s.accel_x),
          'Y': samples.map(s => s.accel_y),
          'Z': samples.map(s => s.accel_z)
        }
      case 'gyro':
        return {
          'X': samples.map(s => s.gyro_x),
          'Y': samples.map(s => s.gyro_y),
          'Z': samples.map(s => s.gyro_z)
        }
    }
  }

  const values = getValues()
  return Object.entries(values).map(([axis, vals]) => {
    let min = Infinity
    let max = -Infinity
    let sum = 0
    for (let i = 0; i < vals.length; i++) {
      const v = vals[i]
      if (v < min) min = v
      if (v > max) max = v
      sum += v
    }
    return { axis, min, max, mean: sum / vals.length }
  })
}

// ---------------------------------------------------------------------------
// Unified chart config builders
// ---------------------------------------------------------------------------

/**
 * Build chart config for IMU tabs (orientation, accelerometer, gyroscope).
 * Wraps existing processIMUChartData + calculateIMUStats.
 */
export function buildIMUChartConfig(
  samples: IMUSample[],
  dataType: IMUDataType,
  zoomRange?: { start: string; end: string } | null
): ChartConfig {
  const chartData = processIMUChartData(samples, dataType, zoomRange)
  const rawStats = calculateIMUStats(samples, dataType)

  const stats: ChartStat[] = rawStats.map((s, i) => {
    const seriesEntry = chartData.series[i + 1]
    const color = typeof seriesEntry?.stroke === 'string' ? seriesEntry.stroke : '#888'
    return {
      label: s.axis,
      color,
      avg: s.mean,
      max: s.max,
      unit: chartData.yAxisLabel,
    }
  })

  return {
    data: chartData.data,
    series: chartData.series,
    scales: chartData.scales,
    stats,
  }
}

/**
 * Build chart config for pedaling efficiency (scatter plot, 0-100%).
 */
export function buildEfficiencyChartConfig(
  samples: Array<{ timestamp: string; value: number | null }>,
  zoomRange?: { start: string; end: string } | null
): ChartConfig {
  if (samples.length === 0) {
    return { data: [[], []] as uPlot.AlignedData, series: [{}], scales: { x: {}, y: {} }, stats: [] }
  }

  // Single-pass filter + gap detection + uPlot conversion
  const { timestamps, samples: final } = filterAndGapSamples(samples, zoomRange)
  if (timestamps.length === 0) {
    return { data: [[], []] as uPlot.AlignedData, series: [{}], scales: { x: {}, y: {} }, stats: [] }
  }

  const data: uPlot.AlignedData = [timestamps, final.map(s => s?.value ?? null)]

  const series: uPlot.Series[] = [
    {},
    {
      label: 'Stability %',
      stroke: 'hsl(145, 70%, 50%)',
      width: 0,
      spanGaps: false,
      points: { show: true, size: 4, fill: 'hsl(145, 70%, 50%)', stroke: 'hsl(145, 70%, 50%)' }
    }
  ]

  const scales: Record<string, uPlot.Scale> = {
    x: {
      ...(zoomRange ? {
        range: [new Date(zoomRange.start).getTime() / 1000, new Date(zoomRange.end).getTime() / 1000]
      } : {})
    },
    y: {
      auto: true,
      range: (u, dataMin, dataMax) => {
        const padding = (dataMax - dataMin) * 0.1
        return [Math.max(0, dataMin - padding), Math.min(100, dataMax + padding)]
      }
    }
  }

  // Stats: aggregate non-null values from the filtered/gapped samples
  let statsMax = -Infinity
  let statsSum = 0
  let statsCount = 0
  for (let i = 0; i < final.length; i++) {
    const s = final[i]
    if (s == null) continue
    const v = s.value
    if (v == null) continue
    if (v > statsMax) statsMax = v
    statsSum += v
    statsCount++
  }
  const stats: ChartStat[] = statsCount > 0 ? [{
    label: 'Stability',
    color: 'hsl(145, 70%, 50%)',
    avg: statsSum / statsCount,
    max: statsMax,
    unit: '%',
  }] : []

  return { data, series, scales, stats }
}

/**
 * Build chart config for riding position.
 * Two series: Seated (green, flat at y=0) and Standing (red, flat at y=1).
 * Each series is null when the rider is in the other position, creating
 * colored bands that are visually distinct even at full zoom.
 */
export function buildPositionChartConfig(
  samples: Array<{ timestamp: string; value: number | null }>,
  zoomRange?: { start: string; end: string } | null
): ChartConfig {
  if (samples.length === 0) {
    return { data: [[], []] as uPlot.AlignedData, series: [{}], scales: { x: {}, y: {} }, stats: [] }
  }

  const { timestamps, samples: final } = filterAndGapSamples(samples, zoomRange)
  if (timestamps.length === 0) {
    return { data: [[], []] as uPlot.AlignedData, series: [{}], scales: { x: {}, y: {} }, stats: [] }
  }

  // Split into two series: seated (value=0) and standing (value=1)
  const seatedValues = final.map(s => {
    if (s == null) return null
    const v = s.value
    if (v == null) return null
    return v < 0.5 ? 0 : null
  })
  const standingValues = final.map(s => {
    if (s == null) return null
    const v = s.value
    if (v == null) return null
    return v >= 0.5 ? 1 : null
  })

  const data: uPlot.AlignedData = [timestamps, seatedValues, standingValues]

  const series: uPlot.Series[] = [
    {},
    {
      label: 'Seated',
      stroke: 'hsl(145, 70%, 50%)',
      fill: 'hsla(145, 70%, 50%, 0.15)',
      width: 2,
      spanGaps: false,
      points: { show: true, size: 4, fill: 'hsl(145, 70%, 50%)' },
      value: (u, v) => v != null ? 'Seated' : '-',
    },
    {
      label: 'Standing',
      stroke: 'hsl(0, 84%, 60%)',
      fill: 'hsla(0, 84%, 60%, 0.15)',
      width: 2,
      spanGaps: false,
      points: { show: true, size: 4, fill: 'hsl(0, 84%, 60%)' },
      value: (u, v) => v != null ? 'Standing' : '-',
    }
  ]

  const scales: Record<string, uPlot.Scale> = {
    x: {
      ...(zoomRange ? {
        range: [new Date(zoomRange.start).getTime() / 1000, new Date(zoomRange.end).getTime() / 1000]
      } : {})
    },
    y: { range: [-0.3, 1.3] }
  }

  const axes: uPlot.Axis[] = [
    {
      side: 3,
      size: 70,
      space: 40,
      values: (u, vals) => vals.map(v => {
        if (Math.abs(v) < 0.15) return 'Seated'
        if (Math.abs(v - 1) < 0.15) return 'Standing'
        return ''
      }),
    }
  ]

  // Aggregate position counts from filtered/gapped samples in one pass
  let standingCount = 0
  let totalCount = 0
  for (let i = 0; i < final.length; i++) {
    const s = final[i]
    if (s == null || s.value == null) continue
    if (s.value >= 0.5) standingCount++
    totalCount++
  }
  const seatedCount = totalCount - standingCount
  const standingPct = totalCount > 0 ? (standingCount / totalCount) * 100 : 0
  const seatedPct = totalCount > 0 ? (seatedCount / totalCount) * 100 : 0

  const stats: ChartStat[] = [
    {
      label: 'Seated',
      color: 'hsl(145, 70%, 50%)',
      avg: seatedPct,
      max: null,
      unit: '%',
      avgPrefix: '',
    },
    {
      label: 'Standing',
      color: 'hsl(0, 84%, 60%)',
      avg: standingPct,
      max: null,
      unit: '%',
      avgPrefix: '',
    },
  ]

  return { data, series, scales, axes, stats }
}

/**
 * Build chart config for surface roughness (scatter plot, 0-100%).
 */
export function buildRoughnessChartConfig(
  samples: Array<{ timestamp: string; value: number | null }>,
  zoomRange?: { start: string; end: string } | null
): ChartConfig {
  if (samples.length === 0) {
    return { data: [[], []] as uPlot.AlignedData, series: [{}], scales: { x: {}, y: {} }, stats: [] }
  }

  const { timestamps, samples: final } = filterAndGapSamples(samples, zoomRange)
  if (timestamps.length === 0) {
    return { data: [[], []] as uPlot.AlignedData, series: [{}], scales: { x: {}, y: {} }, stats: [] }
  }

  const data: uPlot.AlignedData = [timestamps, final.map(s => s?.value ?? null)]

  const series: uPlot.Series[] = [
    {},
    {
      label: 'Roughness %',
      stroke: 'hsl(25, 95%, 53%)',
      width: 0,
      spanGaps: false,
      points: { show: true, size: 4, fill: 'hsl(25, 95%, 53%)', stroke: 'hsl(25, 95%, 53%)' }
    }
  ]

  const scales: Record<string, uPlot.Scale> = {
    x: {
      ...(zoomRange ? {
        range: [new Date(zoomRange.start).getTime() / 1000, new Date(zoomRange.end).getTime() / 1000]
      } : {})
    },
    y: {
      auto: true,
      range: (u, dataMin, dataMax) => {
        const padding = (dataMax - dataMin) * 0.1
        return [Math.max(0, dataMin - padding), Math.min(100, dataMax + padding)]
      }
    }
  }

  let statsMax = -Infinity
  let statsSum = 0
  let statsCount = 0
  for (let i = 0; i < final.length; i++) {
    const s = final[i]
    if (s == null) continue
    const v = s.value
    if (v == null) continue
    if (v > statsMax) statsMax = v
    statsSum += v
    statsCount++
  }
  const stats: ChartStat[] = statsCount > 0 ? [{
    label: 'Roughness',
    color: 'hsl(25, 95%, 53%)',
    avg: statsSum / statsCount,
    max: statsMax,
    unit: '%',
  }] : []

  return { data, series, scales, stats }
}

/**
 * Build chart config for braking analysis.
 * Two series: Estimated Grade (%) and Braking Intensity (0-100).
 */
export function buildBrakingChartConfig(
  samples: Array<{ timestamp: string; value: number | null; estimatedGradePercent?: number; brakingDecelerationMs2?: number; fitGradePercent?: number | null }>,
  zoomRange?: { start: string; end: string } | null
): ChartConfig {
  if (samples.length === 0) {
    return { data: [[], []] as uPlot.AlignedData, series: [{}], scales: { x: {}, y: {} }, stats: [] }
  }

  const { timestamps, samples: final } = filterAndGapSamples(samples, zoomRange)
  if (timestamps.length === 0) {
    return { data: [[], []] as uPlot.AlignedData, series: [{}], scales: { x: {}, y: {} }, stats: [] }
  }

  const data: uPlot.AlignedData = [
    timestamps,
    final.map(s => s?.estimatedGradePercent ?? null),
    final.map(s => s?.fitGradePercent ?? null),
    final.map(s => s?.brakingDecelerationMs2 ?? null),
  ]

  const series: uPlot.Series[] = [
    {},
    {
      label: 'Grade (IMU)',
      stroke: 'hsl(220, 60%, 55%)',
      width: 1.5,
      scale: 'grade',
      spanGaps: false,
      points: { show: false },
    },
    {
      label: 'Grade (FIT)',
      stroke: 'hsl(180, 60%, 45%)',
      width: 1.5,
      scale: 'grade',
      dash: [6, 4],
      spanGaps: true,
      points: { show: false },
    },
    {
      label: 'Braking Force',
      stroke: 'hsl(0, 84%, 60%)',
      fill: 'hsla(0, 84%, 60%, 0.12)',
      width: 2,
      scale: 'braking',
      spanGaps: false,
      points: { show: false },
    },
  ]

  const scales: Record<string, uPlot.Scale> = {
    x: {
      ...(zoomRange ? {
        range: [new Date(zoomRange.start).getTime() / 1000, new Date(zoomRange.end).getTime() / 1000]
      } : {})
    },
    grade: {
      auto: true,
      range: (u, dataMin, dataMax) => {
        const padding = (dataMax - dataMin) * 0.15
        return [dataMin - padding, dataMax + padding]
      },
    },
    braking: {
      auto: true,
      range: (u, dataMin, dataMax) => {
        return [0, Math.max(dataMax * 1.1, 1)]
      },
    },
  }

  const axes: uPlot.Axis[] = [
    {
      scale: 'grade',
      side: 3,
      size: 60,
      values: (u, vals) => vals.map(v => `${v.toFixed(0)}%`),
      stroke: 'hsl(220, 60%, 55%)',
      grid: { show: true },
    },
    {
      scale: 'braking',
      side: 1,
      size: 60,
      values: (u, vals) => vals.map(v => `${v.toFixed(1)}`),
      stroke: 'hsl(0, 84%, 60%)',
      grid: { show: false },
    },
  ]

  // Compute all braking-chart stats in a single pass over the filtered samples.
  let gradeMax = -Infinity, gradeSum = 0, gradeCount = 0
  let fitGradeMax = -Infinity, fitGradeSum = 0, fitGradeCount = 0
  let brakingMax = -Infinity, brakingSum = 0, brakingCount = 0
  for (let i = 0; i < final.length; i++) {
    const s = final[i]
    if (s == null) continue
    if (s.estimatedGradePercent != null) {
      const v = s.estimatedGradePercent
      if (v > gradeMax) gradeMax = v
      gradeSum += v
      gradeCount++
    }
    if (s.fitGradePercent != null) {
      const v = s.fitGradePercent
      if (v > fitGradeMax) fitGradeMax = v
      fitGradeSum += v
      fitGradeCount++
    }
    if (s.brakingDecelerationMs2 != null && s.brakingDecelerationMs2 > 0) {
      const v = s.brakingDecelerationMs2
      if (v > brakingMax) brakingMax = v
      brakingSum += v
      brakingCount++
    }
  }

  const stats: ChartStat[] = []
  if (gradeCount > 0) {
    stats.push({
      label: 'Grade (IMU)',
      color: 'hsl(220, 60%, 55%)',
      avg: gradeSum / gradeCount,
      max: gradeMax,
      unit: '%',
    })
  }
  if (fitGradeCount > 0) {
    stats.push({
      label: 'Grade (FIT)',
      color: 'hsl(180, 60%, 45%)',
      avg: fitGradeSum / fitGradeCount,
      max: fitGradeMax,
      unit: '%',
    })
  }
  if (brakingCount > 0) {
    stats.push({
      // Must match the series label so UPlotBase can resolve series index by label
      label: 'Braking Force',
      color: 'hsl(0, 84%, 60%)',
      avg: brakingSum / brakingCount,
      max: brakingMax,
      unit: ' m/s²',
    })
  }

  return { data, series, scales, axes, stats }
}

/**
 * Build chart config for a single FIT metric (power, HR, cadence, speed).
 * Applies 3-sample rolling average smoothing.
 */
export function buildFitMetricChartConfig(
  samples: Array<{ timestamp: string; value: number | null }>,
  config: { label: string; unit: string; color: string },
): ChartConfig {
  if (samples.length === 0 || !samples.some(s => s.value !== null)) {
    return { data: [[], []] as uPlot.AlignedData, series: [{}], scales: { x: {}, y: {} }, stats: [] }
  }

  const timestamps = samples.map(s => new Date(s.timestamp).getTime() / 1000)
  const rawValues = samples.map(s => s.value)

  // 3-sample rolling average
  const values = rawValues.map((val, idx) => {
    if (val === null) return null
    const window: number[] = []
    if (idx > 0 && rawValues[idx - 1] !== null) window.push(rawValues[idx - 1]!)
    window.push(val)
    if (idx < rawValues.length - 1 && rawValues[idx + 1] !== null) window.push(rawValues[idx + 1]!)
    return window.reduce((a, b) => a + b, 0) / window.length
  })

  const data: uPlot.AlignedData = [timestamps, values as any]

  const series: uPlot.Series[] = [
    { label: 'Time' },
    {
      label: config.label,
      stroke: config.color,
      width: 2,
      scale: 'y',
      spanGaps: false,
      points: { show: true, size: 4, fill: config.color },
      value: (u, v) => v == null ? '-' : `${v.toFixed(config.label === 'Speed' ? 1 : 0)}${config.unit}`
    }
  ]

  const scales: Record<string, uPlot.Scale> = {
    x: {},
    y: {
      auto: true,
      range: (u, dataMin, dataMax) => {
        if (!isFinite(dataMin) || !isFinite(dataMax)) return [0, 100]
        const padding = (dataMax - dataMin) * 0.1
        return [Math.max(0, dataMin - padding), dataMax + padding]
      }
    }
  }

  const validValues = rawValues.filter((v): v is number => v !== null)
  let fitMax = -Infinity
  let fitSum = 0
  for (let i = 0; i < validValues.length; i++) {
    const v = validValues[i]
    if (v > fitMax) fitMax = v
    fitSum += v
  }
  const stats: ChartStat[] = validValues.length > 0 ? [{
    label: config.label,
    color: config.color,
    avg: fitSum / validValues.length,
    max: fitMax,
    unit: config.unit,
  }] : []

  return { data, series, scales, stats }
}
