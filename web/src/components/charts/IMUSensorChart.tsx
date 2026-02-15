'use client'

import { useState, useMemo, useEffect } from 'react'
import { UPlotBase } from './UPlotBase'
import { useIMUData, IMUDataType, IMUSample } from './hooks/useIMUData'
import { processIMUChartData, calculateIMUStats } from '@/lib/charts/processing'

export interface VTXRecording {
  id: string
  start_time: string
  end_time: string
}

export interface IMUSensorChartProps {
  rideId?: string  // Preferred: fetch from ride-level merged VTX endpoint
  recordings: VTXRecording[]  // Legacy: for backward compatibility
  dataType?: IMUDataType  // Controlled data type from parent (overrides internal state)
  highlightTime?: number | null
  zoomRange?: { start: string; end: string } | null
  onZoomChange?: (range: { start: string; end: string } | null) => void
  onCoverageUpdate?: (coverage: Array<{ start: number; end: number }>) => void  // Callback when coverage data is loaded
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
  dataType: controlledDataType,
  highlightTime,
  zoomRange = null,
  onZoomChange,
  onCoverageUpdate,
  className = '',
  initialSamples,
  originalCount: propOriginalCount
}: IMUSensorChartProps) {
  const [internalDataType, setInternalDataType] = useState<IMUDataType>('accel')
  const dataType = controlledDataType ?? internalDataType
  const isControlled = controlledDataType !== undefined

  // Fetch data using hook
  // Skip fetching if initialSamples are provided (recording detail page)
  // initialSamples contain ALL sensor data (accel, gyro, orientation), so we can use them for all data types
  const shouldSkip = !!initialSamples

  const { samples: fetchedSamples, loading: fetchedLoading, error: fetchedError, originalCount: fetchedOriginalCount, coverageRanges } = useIMUData({
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

  // Notify parent when coverage data is available
  useEffect(() => {
    if (onCoverageUpdate && coverageRanges.length > 0) {
      onCoverageUpdate(coverageRanges)
    }
  }, [coverageRanges, onCoverageUpdate])

  // Process data for chart using pure function
  const chartData = useMemo(() => {
    return processIMUChartData(samples, dataType, zoomRange)
  }, [samples, dataType, zoomRange])

  // Calculate stats using pure function
  const stats = useMemo(() => {
    return calculateIMUStats(samples, dataType)
  }, [samples, dataType])

  const getTitle = () => {
    switch (dataType) {
      case 'orientation': return 'Orientation (BNO055)'
      case 'accel': return 'Accelerometer'
      case 'gyro': return 'Gyroscope'
      default: return 'Accelerometer'
    }
  }

  const hasOrientationData = samples.some(s => s.roll !== null && s.pitch !== null)

  // Auto-switch to accel if orientation data is not available (only in uncontrolled mode)
  useEffect(() => {
    if (!isControlled && !loading && samples.length > 0 && !hasOrientationData && dataType === 'orientation') {
      setInternalDataType('accel')
    }
  }, [isControlled, loading, samples.length, hasOrientationData, dataType])

  return (
    <div className={`space-y-4 ${className}`}>
      {/* Data source selector (only shown in uncontrolled mode) */}
      {!isControlled ? (
        <div className="flex gap-4 items-center">
          <div className="flex items-center gap-2">
            <label className="text-sm font-medium text-muted-foreground">Data Source:</label>
            <select
              value={dataType}
              onChange={(e) => setInternalDataType(e.target.value as IMUDataType)}
              className="px-3 py-2 pr-8 rounded-md text-sm bg-background border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-primary appearance-none bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2212%22%20height%3D%2212%22%20viewBox%3D%220%200%2012%2012%22%3E%3Cpath%20fill%3D%22%23666%22%20d%3D%22M6%209L1%204h10z%22%2F%3E%3C%2Fsvg%3E')] bg-[length:12px] bg-[position:right_0.5rem_center] bg-no-repeat"
              disabled={loading}
            >
              {hasOrientationData && (
                <option value="orientation">Orientation (BNO055)</option>
              )}
              <option value="accel">Accelerometer</option>
              <option value="gyro">Gyroscope</option>
            </select>
          </div>

          {loading && <span className="text-xs text-muted-foreground animate-pulse">Loading...</span>}
        </div>
      ) : (
        loading && <div className="flex gap-4 items-center"><span className="text-xs text-muted-foreground animate-pulse">Loading...</span></div>
      )}

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
