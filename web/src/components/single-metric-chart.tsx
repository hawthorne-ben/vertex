'use client'

import { useEffect, useRef } from 'react'
import uPlot from 'uplot'
import 'uplot/dist/uPlot.min.css'

interface SingleMetricChartProps {
  samples: Array<{
    timestamp: string
    value: number | null
  }>
  label: string
  unit: string
  color: string
  onHover?: (index: number | null) => void
  highlightIndex?: number | null // Externally controlled highlight
  syncKey?: string
  resetTrigger?: number // Increment to trigger reset
  className?: string
}

export function SingleMetricChart({
  samples,
  label,
  unit,
  color,
  onHover,
  highlightIndex,
  syncKey = 'ride-charts',
  resetTrigger = 0,
  className = ''
}: SingleMetricChartProps) {
  const chartRef = useRef<HTMLDivElement>(null)
  const plotRef = useRef<uPlot | null>(null)
  const highlightIndexRef = useRef<number | null>(highlightIndex || null)

  // Keep ref in sync
  useEffect(() => {
    highlightIndexRef.current = highlightIndex || null
  }, [highlightIndex])

  useEffect(() => {
    if (!chartRef.current || samples.length === 0) return

    // Prepare data
    const timestamps = samples.map(s => new Date(s.timestamp).getTime() / 1000)
    const rawValues = samples.map(s => s.value)

    // Apply 3-sample rolling average for smoothing
    const values = rawValues.map((val, idx) => {
      if (val === null) return null

      // Get surrounding samples (current, prev, next)
      const sampleWindow: number[] = []
      if (idx > 0 && rawValues[idx - 1] !== null) sampleWindow.push(rawValues[idx - 1]!)
      sampleWindow.push(val)
      if (idx < rawValues.length - 1 && rawValues[idx + 1] !== null) sampleWindow.push(rawValues[idx + 1]!)

      return sampleWindow.reduce((a, b) => a + b, 0) / sampleWindow.length
    })

    const hasData = values.some(v => v !== null)
    if (!hasData) return

    // Check theme
    const isDark = document.documentElement.classList.contains('dark')
    const gridColor = isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'
    const textColor = isDark ? '#e5e7eb' : '#374151'

    const data: uPlot.AlignedData = [timestamps, values as any]

    const series: uPlot.Series[] = [
      { label: 'Time' },
      {
        label,
        stroke: color,
        width: 2,
        scale: 'y',
        value: (u, v) => v == null ? '-' : `${v.toFixed(label === 'Speed' ? 1 : 0)}${unit}`
      }
    ]

    // Plugin to draw vertical highlight line
    const highlightPlugin: uPlot.Plugin = {
      hooks: {
        draw: [
          (u) => {
            const idx = highlightIndexRef.current
            if (idx === null || idx === undefined) return

            const data = u.data
            if (!data || !data[0] || data[0].length === 0) return
            if (idx < 0 || idx >= data[0].length) return

            const timestamps = data[0] as number[]
            const x = Math.round(u.valToPos(timestamps[idx], 'x', true))

            // Draw vertical line
            const ctx = u.ctx
            ctx.save()
            ctx.strokeStyle = '#3b82f6'
            ctx.lineWidth = 2
            ctx.setLineDash([5, 5])
            ctx.beginPath()
            ctx.moveTo(x, u.bbox.top)
            ctx.lineTo(x, u.bbox.top + u.bbox.height)
            ctx.stroke()
            ctx.restore()
          }
        ]
      }
    }

    const opts: uPlot.Options = {
      width: chartRef.current.clientWidth,
      height: 200,
      padding: [8, 8, 0, 0],
      plugins: [highlightPlugin],
      series,
      cursor: {
        drag: {
          x: false,
          y: false
        },
        points: {
          size: 12,
          width: 2
        }
      },
      scales: {
        x: {},
        y: {
          auto: true,
          range: (u, dataMin, dataMax) => {
            const padding = (dataMax - dataMin) * 0.1
            return [Math.max(0, dataMin - padding), dataMax + padding]
          }
        }
      },
      axes: [
        {
          space: 50,
          grid: { show: true, stroke: gridColor },
          stroke: textColor,
          ticks: { show: true, stroke: gridColor },
          values: (u, vals) => vals.map(v => {
            const date = new Date(v * 1000)
            const hours = date.getHours()
            const minutes = date.getMinutes().toString().padStart(2, '0')
            const seconds = date.getSeconds().toString().padStart(2, '0')
            return `${hours}:${minutes}:${seconds}`
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
      ],
      hooks: {
        setCursor: [
          (u) => {
            const idx = u.cursor.idx
            if (onHover) {
              onHover(idx !== undefined && idx !== null ? idx : null)
            }
          }
        ]
      }
    }

    const plot = new uPlot(opts, data, chartRef.current)
    plotRef.current = plot

    const handleResize = () => {
      if (chartRef.current && plotRef.current) {
        plotRef.current.setSize({
          width: chartRef.current.clientWidth,
          height: 200
        })
      }
    }
    window.addEventListener('resize', handleResize)

    return () => {
      window.removeEventListener('resize', handleResize)
      plot.destroy()
    }
  }, [samples, label, unit, color, onHover, syncKey])

  // Trigger redraw only when highlightIndex is actually set (not null/undefined)
  useEffect(() => {
    if (highlightIndex !== null && highlightIndex !== undefined && plotRef.current) {
      // Use RAF to batch redraws across multiple charts
      requestAnimationFrame(() => {
        if (plotRef.current) {
          const currentData = plotRef.current.data
          plotRef.current.setData(currentData)
        }
      })
    }
  }, [highlightIndex])

  if (samples.length === 0 || !samples.some(s => s.value !== null)) {
    return (
      <div className={`bg-muted rounded-lg flex items-center justify-center ${className}`} style={{ height: 200 }}>
        <p className="text-sm text-muted-foreground">No {label.toLowerCase()} data</p>
      </div>
    )
  }

  return (
    <div className={className}>
      <div ref={chartRef} className="w-full" />
    </div>
  )
}
