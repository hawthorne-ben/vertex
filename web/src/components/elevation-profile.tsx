'use client'

import { useMemo } from 'react'
import dynamic from 'next/dynamic'
import uPlot from 'uplot'
import type { ChartStat } from './charts/UPlotBase'

const UPlotBase = dynamic(
  () => import('./charts/UPlotBase').then(mod => ({ default: mod.UPlotBase })),
  { ssr: false, loading: () => <div className="h-[250px] bg-muted rounded-lg animate-pulse" /> }
)

interface ElevationProfileProps {
  samples: Array<{
    timestamp: string
    altitude?: number | null
  }>
  highlightTime?: number | null // Unix timestamp in seconds
  zoomRange?: { start: string; end: string } | null
  onZoom?: (start: string, end: string) => void
  className?: string
}

export function ElevationProfile({
  samples,
  highlightTime,
  zoomRange,
  onZoom,
  className = ''
}: ElevationProfileProps) {
  const chartConfig = useMemo(() => {
    if (samples.length === 0 || !samples.some(s => s.altitude !== null && s.altitude !== undefined)) return null

    // Filter to zoom range to avoid passing huge out-of-range arrays to uPlot
    const filtered = zoomRange
      ? samples.filter(s => {
          const t = new Date(s.timestamp).getTime()
          return t >= new Date(zoomRange.start).getTime() && t <= new Date(zoomRange.end).getTime()
        })
      : samples

    if (filtered.length === 0 || !filtered.some(s => s.altitude !== null && s.altitude !== undefined)) return null

    const timestamps = filtered.map(s => new Date(s.timestamp).getTime() / 1000)
    const altitudeFeet = filtered.map(s => s.altitude ? s.altitude * 3.28084 : null) // meters to feet

    const isDark = document.documentElement.classList.contains('dark')
    const gridColor = isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'
    const textColor = isDark ? '#e5e7eb' : '#374151'
    const fillColor = isDark ? 'rgba(59, 130, 246, 0.3)' : 'rgba(59, 130, 246, 0.2)'

    const data: uPlot.AlignedData = [timestamps, altitudeFeet as any]

    const series: uPlot.Series[] = [
      { label: 'Time' },
      {
        label: 'Elevation',
        stroke: '#3b82f6',
        fill: fillColor,
        width: 2,
        scale: 'elevation',
        value: (u, v) => v == null ? '-' : `${v.toFixed(0)} ft`,
        paths: (u, seriesIdx, idx0, idx1) => {
          const stroke = new Path2D()
          const fill = new Path2D()

          const firstX = u.valToPos(u.data[0][idx0], 'x', true)
          const firstY = u.valToPos(u.data[seriesIdx][idx0] || 0, 'elevation', true)
          const zeroY = u.valToPos(0, 'elevation', true)

          stroke.moveTo(firstX, firstY)
          fill.moveTo(firstX, zeroY)
          fill.lineTo(firstX, firstY)

          for (let i = idx0 + 1; i <= idx1; i++) {
            const x = u.valToPos(u.data[0][i], 'x', true)
            const y = u.valToPos(u.data[seriesIdx][i] || 0, 'elevation', true)
            stroke.lineTo(x, y)
            fill.lineTo(x, y)
          }

          const lastX = u.valToPos(u.data[0][idx1], 'x', true)
          fill.lineTo(lastX, zeroY)
          fill.closePath()

          return { stroke, fill }
        }
      }
    ]

    const scales: Record<string, uPlot.Scale> = {
      x: {
        ...(zoomRange ? {
          range: [
            new Date(zoomRange.start).getTime() / 1000,
            new Date(zoomRange.end).getTime() / 1000
          ]
        } : {})
      },
      elevation: {
        auto: true,
        range: (u, dataMin, dataMax) => {
          if (!isFinite(dataMin) || !isFinite(dataMax)) return [0, 100]
          const padding = (dataMax - dataMin) * 0.1
          return [dataMin - padding, dataMax + padding]
        }
      }
    }

    const axes: uPlot.Axis[] = [
      {
        space: 50,
        grid: { show: true, stroke: gridColor },
        stroke: textColor,
        ticks: { show: true, stroke: gridColor },
        values: (u, vals) => vals.map(v => {
          const date = new Date(v * 1000)
          return `${date.getHours()}:${date.getMinutes().toString().padStart(2, '0')}:${date.getSeconds().toString().padStart(2, '0')}`
        })
      },
      {
        scale: 'elevation',
        side: 3,
        grid: { show: true, stroke: gridColor },
        stroke: textColor,
        ticks: { show: true, stroke: gridColor },
        label: 'Elevation (ft)',
        labelSize: 20,
        labelGap: 4,
        size: 50,
        values: (u, vals) => vals.map(v => v?.toFixed(0) || ''),
        space: 25,
      }
    ]

    // Compute stats
    const validAltitudes = altitudeFeet.filter((v): v is number => v !== null)
    let elevMax = -Infinity
    let elevSum = 0
    for (let i = 0; i < validAltitudes.length; i++) {
      const v = validAltitudes[i]
      if (v > elevMax) elevMax = v
      elevSum += v
    }
    const stats: ChartStat[] = validAltitudes.length > 0 ? [{
      label: 'Elevation',
      color: '#3b82f6',
      avg: elevSum / validAltitudes.length,
      max: elevMax,
      unit: 'ft',
    }] : []

    return { data, series, scales, axes, stats }
  }, [samples, zoomRange])

  if (!chartConfig) {
    return (
      <div className={`bg-muted rounded-lg flex items-center justify-center ${className}`} style={{ height: 250 }}>
        <p className="text-muted-foreground">No elevation data available</p>
      </div>
    )
  }

  return (
    <UPlotBase
      data={chartConfig.data}
      series={chartConfig.series}
      scales={chartConfig.scales}
      axes={chartConfig.axes}
      height={250}
      highlightTime={highlightTime}
      onZoom={onZoom}
      stats={chartConfig.stats}
      className={className}
    />
  )
}
