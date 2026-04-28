'use client'

import { useState, useMemo, useEffect } from 'react'
import { UPlotBase } from './UPlotBase'
import { useIMUData, IMUDataType, IMUSample } from './hooks/useIMUData'
import { processIMUChartData, calculateIMUStats, mergeFilteredStreams } from '@/lib/charts/processing'
import type { ChartStat } from './UPlotBase'
import type { FilteredStream } from './hooks/useFilteredStreams'

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
  parentLoading?: boolean  // Optional: parent is still fetching initialSamples
  filteredStreams?: FilteredStream[]  // Optional: pre-computed filtered series to overlay
  onDataTypeChange?: (dt: IMUDataType) => void  // Optional: notify parent of data type changes
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
  originalCount: propOriginalCount,
  parentLoading = false,
  filteredStreams,
  onDataTypeChange,
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
  const loading = initialSamples ? parentLoading : fetchedLoading
  const error = initialSamples ? null : fetchedError
  const originalCount = initialSamples ? (propOriginalCount ?? 0) : fetchedOriginalCount

  // Notify parent when coverage data is available
  useEffect(() => {
    if (onCoverageUpdate && coverageRanges.length > 0) {
      onCoverageUpdate(coverageRanges)
    }
  }, [coverageRanges, onCoverageUpdate])

  // Process data for chart using pure function
  const baseChartData = useMemo(() => {
    return processIMUChartData(samples, dataType, zoomRange)
  }, [samples, dataType, zoomRange])

  // Merge filtered streams (if any) into the chart data
  const chartData = useMemo(() => {
    if (!filteredStreams || filteredStreams.length === 0) return baseChartData
    // Filter to only streams whose axis matches the current data type
    const prefix = dataType === 'gyro' ? 'gyro_' : 'accel_'
    const relevant = filteredStreams.filter(s => s.axis.startsWith(prefix))
    if (relevant.length === 0) return baseChartData
    return mergeFilteredStreams(baseChartData, relevant)
  }, [baseChartData, filteredStreams, dataType])

  // Calculate stats using pure function (raw data only, not filtered)
  const stats = useMemo(() => {
    return calculateIMUStats(samples, dataType)
  }, [samples, dataType])

  // Convert stats to ChartStat format for UPlotBase.
  // Includes both raw axis stats and filtered stream entries so the legend
  // shows toggle buttons for every series in the chart.
  const chartStats = useMemo((): ChartStat[] => {
    if (stats.length === 0 || !baseChartData.series.length) return []

    // Raw axis stats
    const rawStats: ChartStat[] = stats.map((s, i) => {
      const seriesEntry = baseChartData.series[i + 1]
      const color = typeof seriesEntry?.stroke === 'string' ? seriesEntry.stroke : '#888'
      return {
        label: s.axis,
        color,
        avg: s.mean,
        max: s.max,
        unit: baseChartData.yAxisLabel,
      }
    })

    // Filtered stream entries — label-only (no avg/max stats, just toggle)
    if (filteredStreams && filteredStreams.length > 0) {
      const prefix = dataType === 'gyro' ? 'gyro_' : 'accel_'
      const relevant = filteredStreams.filter(s => s.axis.startsWith(prefix))
      for (const stream of relevant) {
        // Find the matching series in chartData to get the color
        const seriesEntry = chartData.series.find(s => s.label === stream.label)
        const color = typeof seriesEntry?.stroke === 'string' ? seriesEntry.stroke : '#888'
        rawStats.push({
          label: stream.label,
          color,
          avg: null,
          max: null,
        })
      }
    }

    return rawStats
  }, [stats, baseChartData.series, baseChartData.yAxisLabel, filteredStreams, dataType, chartData.series])

  const getTitle = () => {
    switch (dataType) {
      case 'orientation': return 'Orientation (BNO055)'
      case 'accel': return 'Accelerometer'
      case 'gyro': return 'Gyroscope'
      default: return 'Accelerometer'
    }
  }

  const hasOrientationData = samples.some(s => s.roll != null && s.pitch != null)
  const hasAccelData = samples.some(s => s.accel_x != null)
  const hasGyroData = samples.some(s => s.gyro_x != null)

  // Auto-switch if current data type is not available (only in uncontrolled mode)
  useEffect(() => {
    if (!isControlled && !loading && samples.length > 0) {
      if (dataType === 'orientation' && !hasOrientationData) {
        setInternalDataType(hasAccelData ? 'accel' : 'gyro')
      } else if (dataType === 'accel' && !hasAccelData) {
        setInternalDataType(hasGyroData ? 'gyro' : 'orientation')
      } else if (dataType === 'gyro' && !hasGyroData) {
        setInternalDataType(hasAccelData ? 'accel' : 'orientation')
      }
    }
  }, [isControlled, loading, samples.length, hasOrientationData, hasAccelData, hasGyroData, dataType])

  return (
    <div className={`space-y-4 ${className}`}>
      {/* Data source selector */}
      {(!isControlled || onDataTypeChange) ? (
        <div className="flex gap-4 items-center">
          <div className="flex items-center gap-2">
            <label className="text-sm font-medium text-muted-foreground">Data Source:</label>
            <select
              value={dataType}
              onChange={(e) => {
                const dt = e.target.value as IMUDataType
                if (isControlled) {
                  onDataTypeChange?.(dt)
                } else {
                  setInternalDataType(dt)
                }
              }}
              className="px-3 py-2 pr-8 rounded-md text-sm bg-background border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-primary appearance-none bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2212%22%20height%3D%2212%22%20viewBox%3D%220%200%2012%2012%22%3E%3Cpath%20fill%3D%22%23666%22%20d%3D%22M6%209L1%204h10z%22%2F%3E%3C%2Fsvg%3E')] bg-[length:12px] bg-[position:right_0.5rem_center] bg-no-repeat"
              disabled={loading}
            >
              {hasOrientationData && (
                <option value="orientation">Orientation (BNO055)</option>
              )}
              {hasAccelData && (
                <option value="accel">Accelerometer</option>
              )}
              {hasGyroData && (
                <option value="gyro">Gyroscope</option>
              )}
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

        {/* Always render UPlotBase when there's no error, even if samples are
            transiently empty during zoom/scrub. UPlotBase handles empty-data
            state internally as an overlay so legend visibility survives data
            transitions. */}
        {!error && (
          <UPlotBase
            data={chartData.data}
            series={chartData.series}
            scales={chartData.scales}
            highlightTime={highlightTime}
            onZoom={onZoomChange ? (start, end) => onZoomChange({ start, end }) : undefined}
            stats={chartStats}
          />
        )}
      </div>

      {/* Sample count info */}
      {samples.length > 0 && (
        <div className="text-xs text-muted-foreground">
          Displaying {samples.length.toLocaleString()} of {originalCount.toLocaleString()} samples
          {zoomRange && ' (zoomed)'}
        </div>
      )}
    </div>
  )
}
