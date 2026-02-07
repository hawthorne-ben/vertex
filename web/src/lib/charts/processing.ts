/**
 * Pure functions for chart data processing
 * Extracted from chart components for testability and reusability
 */

import uPlot from 'uplot'

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

export type IMUDataType = 'orientation' | 'accel' | 'gyro' | 'smoothedAccel' | 'smoothedGyro' | 'trueOrientation'

export interface ChartData {
  data: uPlot.AlignedData
  series: uPlot.Series[]
  yAxisLabel: string
  scales: Record<string, uPlot.Scale>
}

/**
 * Detect gaps in time series data
 * Inserts null values where gaps exceed threshold
 */
export function insertGaps<T extends { timestamp: string }>(
  samples: T[],
  gapThresholdMs: number = 10000
): (T | null)[] {
  if (samples.length === 0) return []

  const result: (T | null)[] = []

  for (let i = 0; i < samples.length; i++) {
    result.push(samples[i])

    if (i < samples.length - 1) {
      const currentTime = new Date(samples[i].timestamp).getTime()
      const nextTime = new Date(samples[i + 1].timestamp).getTime()
      const gap = nextTime - currentTime

      if (gap > gapThresholdMs) {
        result.push(null)
      }
    }
  }

  return result
}

/**
 * Convert samples with gaps to uPlot format
 * Handles null values by inserting tiny timestamp offsets
 */
export function samplesToUPlotData<T extends { timestamp: string }>(
  samplesWithGaps: (T | null)[]
): { timestamps: number[]; samples: (T | null)[] } {
  const timestamps: number[] = []
  const samples: (T | null)[] = []

  for (const sample of samplesWithGaps) {
    if (sample) {
      timestamps.push(new Date(sample.timestamp).getTime() / 1000)
      samples.push(sample)
    } else if (timestamps.length > 0) {
      // Insert tiny timestamp gap to maintain alignment
      timestamps.push(timestamps[timestamps.length - 1] + 0.001)
      samples.push(null)
    }
  }

  return { timestamps, samples }
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

  // Calculate gap threshold
  const firstTime = new Date(samples[0].timestamp).getTime()
  const lastTime = new Date(samples[samples.length - 1].timestamp).getTime()
  const totalDuration = lastTime - firstTime
  const expectedSpacing = totalDuration / samples.length
  const GAP_THRESHOLD_MS = Math.max(5000, expectedSpacing * 10)

  // Insert gaps
  const samplesWithGaps = insertGaps(samples, GAP_THRESHOLD_MS)

  // Convert to uPlot format
  const { timestamps, samples: finalSamples } = samplesToUPlotData(samplesWithGaps)

  // Build data arrays based on type
  let data: uPlot.AlignedData
  let series: uPlot.Series[]
  let yAxisLabel: string

  switch (dataType) {
    case 'orientation':
    case 'trueOrientation':
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
    case 'smoothedAccel':
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
    case 'smoothedGyro':
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
      yAxisLabel = 'rad/s'
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
      case 'trueOrientation':
        return {
          'Roll': samples.map(s => s.roll ?? 0),
          'Pitch': samples.map(s => s.pitch ?? 0),
          'Yaw': samples.map(s => s.yaw ?? 0)
        }
      case 'accel':
      case 'smoothedAccel':
        return {
          'X': samples.map(s => s.accel_x),
          'Y': samples.map(s => s.accel_y),
          'Z': samples.map(s => s.accel_z)
        }
      case 'gyro':
      case 'smoothedGyro':
        return {
          'X': samples.map(s => s.gyro_x),
          'Y': samples.map(s => s.gyro_y),
          'Z': samples.map(s => s.gyro_z)
        }
    }
  }

  const values = getValues()
  return Object.entries(values).map(([axis, vals]) => ({
    axis,
    min: Math.min(...vals),
    max: Math.max(...vals),
    mean: vals.reduce((a: number, b: number) => a + b, 0) / vals.length
  }))
}
