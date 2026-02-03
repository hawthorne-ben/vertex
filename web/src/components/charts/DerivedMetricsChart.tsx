'use client'

import { useState, useMemo } from 'react'
import { UPlotBase } from './UPlotBase'
import { useDerivedMetric, DerivedMetricType } from './hooks/useDerivedMetric'
import { AlertCircle } from 'lucide-react'
import uPlot from 'uplot'

export interface DerivedMetricsChartProps {
  rideId: string
  fitRecordingId?: string | null
  highlightTime?: number | null
  zoomRange?: { start: string; end: string } | null
  onZoomChange?: (range: { start: string; end: string } | null) => void
  className?: string
}

/**
 * Derived Metrics Chart
 * Handles: Computed analytics like pedaling efficiency
 * Features: Re-computation on zoom, metric-specific visualizations
 */
export function DerivedMetricsChart({
  rideId,
  fitRecordingId,
  highlightTime,
  zoomRange = null,
  onZoomChange,
  className = ''
}: DerivedMetricsChartProps) {
  const [metric, setMetric] = useState<DerivedMetricType>('pedalingEfficiency')

  // Fetch data using hook
  const { samples, loading, error, metadata } = useDerivedMetric({
    rideId,
    metric,
    timeRange: zoomRange,
    fitRecordingId
  })

  // Process data for chart
  const chartData = useMemo((): { data: uPlot.AlignedData; series: uPlot.Series[]; yAxisLabel: string; scales: Record<string, uPlot.Scale> } => {
    if (samples.length === 0) {
      return {
        data: [[0], [null]] as uPlot.AlignedData,
        series: [],
        yAxisLabel: '',
        scales: { x: {}, y: {} }
      }
    }

    // Detect gaps (10+ second gaps should break the line)
    const GAP_THRESHOLD_MS = 10000 // 10 seconds

    const samplesWithGaps: (typeof samples[0] | null)[] = []
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
    const values: (number | null)[] = []

    for (const sample of samplesWithGaps) {
      if (sample) {
        timestamps.push(new Date(sample.timestamp).getTime() / 1000)
        values.push(sample.value)
      } else if (timestamps.length > 0) {
        // Insert a tiny timestamp gap to maintain alignment
        timestamps.push(timestamps[timestamps.length - 1] + 0.001)
        values.push(null)
      }
    }

    const data: uPlot.AlignedData = [timestamps, values] as uPlot.AlignedData
    const series: uPlot.Series[] = [
      {},
      {
        label: metric === 'pedalingEfficiency' ? 'Efficiency %' : 'Value',
        stroke: 'hsl(145, 70%, 50%)', // Green
        width: 2,
        spanGaps: false,
        points: { show: false }
      }
    ]

    const yAxisLabel = metric === 'pedalingEfficiency' ? '%' : ''

    // Build scales
    const scales: Record<string, uPlot.Scale> = {
      x: {},
      y: {
        auto: true,
        range: (u, dataMin, dataMax) => {
          const padding = (dataMax - dataMin) * 0.1
          return [Math.max(0, dataMin - padding), Math.min(100, dataMax + padding)]
        }
      }
    }

    return { data, series, yAxisLabel, scales }
  }, [samples, metric])

  const getTitle = () => {
    switch (metric) {
      case 'pedalingEfficiency': return 'Pedaling Efficiency'
      default: return 'Metric'
    }
  }

  const getDescription = () => {
    switch (metric) {
      case 'pedalingEfficiency':
        return 'Analyzes forward acceleration to detect smooth power delivery vs "mashing". Higher scores indicate more consistent pedaling technique.'
      default:
        return ''
    }
  }

  return (
    <div className={`space-y-4 ${className}`}>
      {/* Metric selector */}
      <div className="flex gap-4 items-center">
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium text-muted-foreground">Metric:</label>
          <select
            value={metric}
            onChange={(e) => setMetric(e.target.value as DerivedMetricType)}
            className="px-3 py-2 pr-8 rounded-md text-sm bg-background border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-primary appearance-none bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2212%22%20height%3D%2212%22%20viewBox%3D%220%200%2012%2012%22%3E%3Cpath%20fill%3D%22%23666%22%20d%3D%22M6%209L1%204h10z%22%2F%3E%3C%2Fsvg%3E')] bg-[length:12px] bg-[position:right_0.5rem_center] bg-no-repeat"
            disabled={loading}
          >
            <option value="pedalingEfficiency">Pedaling Efficiency</option>
            {/* Future metrics will go here */}
          </select>
        </div>

        {loading && <span className="text-xs text-muted-foreground animate-pulse">Calculating...</span>}

        {zoomRange && onZoomChange && (
          <button
            onClick={() => onZoomChange(null)}
            className="ml-auto px-3 py-2 text-sm rounded-md bg-muted text-foreground hover:bg-muted/80 border border-border"
          >
            Reset Zoom
          </button>
        )}
      </div>

      {/* Loading state */}
      {loading && !samples.length && (
        <div className="border border-border rounded-lg p-6 bg-card">
          <div className="h-[400px] bg-muted/50 rounded-lg flex items-center justify-center">
            <div className="text-center">
              <div className="w-12 h-12 border-4 border-muted-foreground/20 border-t-primary rounded-full animate-spin mx-auto mb-3"></div>
              <p className="text-sm text-muted-foreground">Calculating {getTitle().toLowerCase()}...</p>
            </div>
          </div>
        </div>
      )}

      {/* Error state */}
      {error && (
        <div className="border border-border rounded-lg p-6 bg-card">
          <div className="h-[400px] bg-muted/50 rounded-lg flex items-center justify-center">
            <div className="flex flex-col items-center gap-3 text-center max-w-md p-4">
              <AlertCircle className="w-12 h-12 text-destructive" />
              <div>
                <h3 className="text-lg font-semibold mb-2">Analysis Failed</h3>
                <p className="text-sm text-muted-foreground">{error}</p>
                {error.includes('GPS') && (
                  <p className="text-xs text-muted-foreground mt-2">
                    This metric requires GPS data (FIT file) for grade information.
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Chart */}
      {!error && samples.length > 0 && (
        <>
          {/* Summary stats for pedaling efficiency */}
          {metric === 'pedalingEfficiency' && metadata && (
            <div className="grid grid-cols-3 gap-4">
              <div className="text-center p-3 bg-muted rounded-lg">
                <div className="text-2xl font-bold text-primary">
                  {metadata.avgEfficiencyPercent?.toFixed(1)}%
                </div>
                <div className="text-xs text-muted-foreground mt-1">Average Efficiency</div>
              </div>
              <div className="text-center p-3 bg-muted rounded-lg">
                <div className="text-2xl font-bold text-green-500">
                  {metadata.smoothPercent?.toFixed(0)}%
                </div>
                <div className="text-xs text-muted-foreground mt-1">Time Smooth (&gt;70%)</div>
              </div>
              <div className="text-center p-3 bg-muted rounded-lg">
                <div className="text-2xl font-bold text-orange-500">
                  {metadata.roughPercent?.toFixed(0)}%
                </div>
                <div className="text-xs text-muted-foreground mt-1">Time Rough (&lt;50%)</div>
              </div>
            </div>
          )}

          {/* Chart */}
          <div className="border border-border rounded-lg p-6 bg-card relative">
            {/* Loading overlay */}
            {loading && (
              <div className="absolute inset-0 bg-card rounded-lg flex items-center justify-center z-10">
                <div className="text-center">
                  <div className="w-12 h-12 border-4 border-muted-foreground/20 border-t-primary rounded-full animate-spin mx-auto mb-3"></div>
                  <p className="text-sm text-muted-foreground">Calculating {getTitle().toLowerCase()}...</p>
                </div>
              </div>
            )}

            <UPlotBase
              data={chartData.data}
              series={chartData.series}
              scales={chartData.scales}
              title={getTitle()}
              unit={chartData.yAxisLabel}
              highlightTime={highlightTime}
              onZoom={onZoomChange ? (start, end) => onZoomChange({ start, end }) : undefined}
              syncKey="derived-metrics-sync"
            />
          </div>

          {/* Description & Warnings */}
          <div className="text-sm text-muted-foreground space-y-2">
            <p><strong>How it works:</strong> {getDescription()}</p>

            {metadata?.hasGrade === false && (
              <div className="p-3 bg-yellow-500/10 border border-yellow-500/20 rounded-lg">
                <div className="flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 text-yellow-500 mt-0.5" />
                  <div className="text-sm">
                    <p className="font-semibold text-yellow-700 dark:text-yellow-400">Limited Accuracy</p>
                    <p className="text-muted-foreground mt-1">
                      No grade data available. Gravity compensation may be inaccurate on hills.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {metadata?.sampleRate && (
              <p>Sample rate: {metadata.sampleRate.toFixed(1)} Hz | Total samples: {metadata.totalSamples?.toLocaleString()}</p>
            )}

            {zoomRange && <p className="text-primary">Zoomed view - showing recalculated efficiency for selected time range</p>}
          </div>
        </>
      )}
    </div>
  )
}
