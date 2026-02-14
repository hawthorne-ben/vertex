'use client'

import { useMemo } from 'react'
import dynamic from 'next/dynamic'
import uPlot from 'uplot'

const UPlotBase = dynamic(
  () => import('./charts/UPlotBase').then(mod => ({ default: mod.UPlotBase })),
  { ssr: false, loading: () => <div className="h-[200px] bg-muted rounded-lg animate-pulse" /> }
)

interface SingleMetricChartProps {
  samples: Array<{
    timestamp: string
    value: number | null
  }>
  label: string
  unit: string
  color: string
  highlightTime?: number | null
  className?: string
}

export function SingleMetricChart({
  samples,
  label,
  unit,
  color,
  highlightTime,
  className = ''
}: SingleMetricChartProps) {
  const chartConfig = useMemo(() => {
    if (samples.length === 0 || !samples.some(s => s.value !== null)) return null

    const timestamps = samples.map(s => new Date(s.timestamp).getTime() / 1000)
    const rawValues = samples.map(s => s.value)

    // Apply 3-sample rolling average for smoothing
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
        label,
        stroke: color,
        width: 2,
        scale: 'y',
        spanGaps: false,
        points: { show: true, size: 3, fill: color },
        value: (u, v) => v == null ? '-' : `${v.toFixed(label === 'Speed' ? 1 : 0)}${unit}`
      }
    ]

    const isDark = document.documentElement.classList.contains('dark')
    const gridColor = isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'
    const textColor = isDark ? '#e5e7eb' : '#374151'

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
        scale: 'y',
        side: 3,
        grid: { show: true, stroke: gridColor },
        stroke: textColor,
        ticks: { show: true, stroke: gridColor },
        label: `${label} (${unit})`,
        labelSize: 20,
        labelGap: 4,
        size: 50,
        values: (u, vals) => vals.map(v => v?.toFixed(0) || ''),
        space: 25,
      }
    ]

    const scales: Record<string, uPlot.Scale> = {
      x: {},
      y: {
        auto: true,
        range: (u, dataMin, dataMax) => {
          const padding = (dataMax - dataMin) * 0.1
          return [Math.max(0, dataMin - padding), dataMax + padding]
        }
      }
    }

    return { data, series, axes, scales }
  }, [samples, label, unit, color])

  if (!chartConfig) {
    return (
      <div className={`bg-muted rounded-lg flex items-center justify-center ${className}`} style={{ height: 200 }}>
        <p className="text-sm text-muted-foreground">No {label.toLowerCase()} data</p>
      </div>
    )
  }

  return (
    <UPlotBase
      data={chartConfig.data}
      series={chartConfig.series}
      axes={chartConfig.axes}
      scales={chartConfig.scales}
      height={200}
      highlightTime={highlightTime}
      className={className}
    />
  )
}
