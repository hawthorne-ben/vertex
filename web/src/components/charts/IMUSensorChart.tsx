'use client'

import { useState, useMemo, useEffect } from 'react'
import { UPlotBase } from './UPlotBase'
import { useIMUData, IMUDataType, IMUSample } from './hooks/useIMUData'
import uPlot from 'uplot'

export interface VTXRecording {
  id: string
  start_time: string
  end_time: string
}

export interface IMUSensorChartProps {
  rideId?: string  // Preferred: fetch from ride-level merged VTX endpoint
  recordings: VTXRecording[]  // Legacy: for backward compatibility
  highlightTime?: number | null
  zoomRange?: { start: string; end: string } | null
  onZoomChange?: (range: { start: string; end: string } | null) => void
  className?: string
  initialSamples?: IMUSample[]  // Optional: server-fetched samples (recording detail page)
  originalCount?: number  // Optional: total sample count when initialSamples provided
}

/**
 * IMU Sensor Data Chart
 * Handles: Raw accelerometer, gyroscope, and orientation data
 * Features: Multi-axis display, gap detection, zoom for more detail
 */
export function IMUSensorChart({
  rideId,
  recordings,
  highlightTime,
  zoomRange = null,
  onZoomChange,
  className = '',
  initialSamples,
  originalCount: propOriginalCount
}: IMUSensorChartProps) {
  const [dataType, setDataType] = useState<IMUDataType>('orientation')

  // Fetch data using hook
  // Skip fetching if initialSamples are provided (recording detail page)
  // initialSamples contain ALL sensor data (accel, gyro, orientation), so we can use them for all data types
  const shouldSkip = !!initialSamples

  const { samples: fetchedSamples, loading: fetchedLoading, error: fetchedError, originalCount: fetchedOriginalCount } = useIMUData({
    rideId,
    recordings,
    dataType,
    timeRange: zoomRange,
    skip: shouldSkip
  })

  // Use initialSamples if provided (they contain all data types)
  const samples = initialSamples || fetchedSamples
  const loading = initialSamples ? false : fetchedLoading
  const error = initialSamples ? null : fetchedError
  const originalCount = initialSamples ? (propOriginalCount ?? 0) : fetchedOriginalCount

  // Process data for chart (gap detection, format conversion)
  const chartData = useMemo((): { data: uPlot.AlignedData; series: uPlot.Series[]; yAxisLabel: string; scales: Record<string, uPlot.Scale> } => {
    if (!samples || samples.length === 0) {
      // Return minimal valid data structure that won't be rendered
      return {
        data: [[], []] as uPlot.AlignedData,
        series: [{}],
        yAxisLabel: '',
        scales: { x: {}, y: {} }
      }
    }

    // Detect gaps
    const firstTime = new Date(samples[0].timestamp).getTime()
    const lastTime = new Date(samples[samples.length - 1].timestamp).getTime()
    const totalDuration = lastTime - firstTime
    const expectedSpacing = totalDuration / samples.length
    const GAP_THRESHOLD_MS = Math.max(5000, expectedSpacing * 10)

    const samplesWithGaps: (IMUSample | null)[] = []
    for (let i = 0; i < samples.length; i++) {
      samplesWithGaps.push(samples[i])
      if (i < samples.length - 1) {
        const gap = new Date(samples[i + 1].timestamp).getTime() - new Date(samples[i].timestamp).getTime()
        if (gap > GAP_THRESHOLD_MS) {
          samplesWithGaps.push(null)
        }
      }
    }

    // Convert to uPlot format
    const timestamps: number[] = []
    const finalSamples: (IMUSample | null)[] = []

    for (const sample of samplesWithGaps) {
      if (sample) {
        timestamps.push(new Date(sample.timestamp).getTime() / 1000)
        finalSamples.push(sample)
      } else if (timestamps.length > 0) {
        timestamps.push(timestamps[timestamps.length - 1] + 0.001)
        finalSamples.push(null)
      }
    }

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

    // Build scales for proper axis configuration
    const scales: Record<string, uPlot.Scale> = {
      x: {},
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
  }, [samples, dataType])

  // Calculate stats
  const stats = useMemo(() => {
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
  }, [samples, dataType])

  const getTitle = () => {
    switch (dataType) {
      case 'orientation': return 'Orientation (BNO055)'
      case 'trueOrientation': return 'True* Orientation (Bicycle Filter)'
      case 'accel': return 'Accelerometer'
      case 'smoothedAccel': return 'Smoothed Accelerometer (0.1Hz EMA)'
      case 'gyro': return 'Gyroscope'
      case 'smoothedGyro': return 'Smoothed Gyroscope (2Hz EMA)'
    }
  }

  const hasOrientationData = samples.some(s => s.roll !== null && s.pitch !== null)

  // Auto-switch to accel if orientation data is not available
  useEffect(() => {
    if (!loading && samples.length > 0 && !hasOrientationData && (dataType === 'orientation' || dataType === 'trueOrientation')) {
      setDataType('accel')
    }
  }, [loading, samples.length, hasOrientationData, dataType])

  return (
    <div className={`space-y-4 ${className}`}>
      {/* Data source selector */}
      <div className="flex gap-4 items-center">
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium text-muted-foreground">Data Source:</label>
          <select
            value={dataType}
            onChange={(e) => setDataType(e.target.value as IMUDataType)}
            className="px-3 py-2 pr-8 rounded-md text-sm bg-background border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-primary appearance-none bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2212%22%20height%3D%2212%22%20viewBox%3D%220%200%2012%2012%22%3E%3Cpath%20fill%3D%22%23666%22%20d%3D%22M6%209L1%204h10z%22%2F%3E%3C%2Fsvg%3E')] bg-[length:12px] bg-[position:right_0.5rem_center] bg-no-repeat"
            disabled={loading}
          >
            {hasOrientationData && (
              <>
                <option value="orientation">Orientation (BNO055)</option>
                <option value="trueOrientation">True* Orientation (Bicycle Filter)</option>
              </>
            )}
            <option value="accel">Accelerometer</option>
            <option value="gyro">Gyroscope</option>
            <option value="smoothedAccel">Smoothed Accelerometer (0.1Hz)</option>
            <option value="smoothedGyro">Smoothed Gyroscope (2Hz)</option>
          </select>
        </div>

        {loading && <span className="text-xs text-muted-foreground animate-pulse">Loading...</span>}

        {zoomRange && onZoomChange && (
          <button
            onClick={() => onZoomChange(null)}
            className="ml-auto px-3 py-2 text-sm rounded-md bg-muted text-foreground hover:bg-muted/80 border border-border"
          >
            Reset Zoom
          </button>
        )}
      </div>

      {/* Chart */}
      <div className="border border-border rounded-lg p-6 bg-card relative min-h-[400px]">
        {/* Loading state */}
        {loading && (
          <div className="absolute inset-0 bg-card rounded-lg flex items-center justify-center z-10">
            <div className="text-center">
              <div className="w-12 h-12 border-4 border-muted-foreground/20 border-t-primary rounded-full animate-spin mx-auto mb-3"></div>
              <p className="text-sm text-muted-foreground">Loading {getTitle().toLowerCase()}...</p>
            </div>
          </div>
        )}

        {/* Error state */}
        {!loading && error && (
          <div className="h-[400px] bg-muted/50 rounded-lg flex items-center justify-center">
            <p className="text-destructive">{error}</p>
          </div>
        )}

        {/* No data state */}
        {!loading && !error && samples.length === 0 && (
          <div className="h-[400px] bg-muted/50 rounded-lg flex items-center justify-center">
            <p className="text-muted-foreground">No data available for selected range</p>
          </div>
        )}

        {/* Chart - render when we have data */}
        {!error && samples.length > 0 && (
          <UPlotBase
            data={chartData.data}
            series={chartData.series}
            scales={chartData.scales}
            title={getTitle()}
            unit={chartData.yAxisLabel}
            highlightTime={highlightTime}
            onZoom={onZoomChange ? (start, end) => onZoomChange({ start, end }) : undefined}
            zoomRange={zoomRange}
            syncKey="imu-sensor-sync"
          />
        )}
      </div>

      {/* Stats */}
      {stats.length > 0 && (
        <div className="text-sm text-muted-foreground">
          <div className="grid grid-cols-3 gap-4">
            {stats.map(stat => (
              <div key={stat.axis}>
                <strong>{stat.axis}-axis</strong>
                <div>Min: {stat.min.toFixed(3)} {chartData.yAxisLabel}</div>
                <div>Max: {stat.max.toFixed(3)} {chartData.yAxisLabel}</div>
                <div>Mean: {stat.mean.toFixed(3)} {chartData.yAxisLabel}</div>
              </div>
            ))}
          </div>
          <div className="mt-2">
            Displaying {samples.length.toLocaleString()} of {originalCount.toLocaleString()} samples
            {zoomRange && ' (zoomed)'}
          </div>
        </div>
      )}
    </div>
  )
}
