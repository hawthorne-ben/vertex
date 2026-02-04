'use client'

import { useEffect, useRef } from 'react'
import uPlot from 'uplot'
import 'uplot/dist/uPlot.min.css'
import '@/css/uplot-custom.css'

export interface UPlotBaseProps {
  data: uPlot.AlignedData
  series: uPlot.Series[]
  axes?: uPlot.Axis[]
  scales?: Record<string, uPlot.Scale>
  title?: string
  unit?: string
  height?: number
  highlightTime?: number | null // Unix timestamp in seconds
  onZoom?: (start: string, end: string) => void
  syncKey?: string
  className?: string
}

/**
 * Pure uPlot rendering component
 * Handles: rendering, resize, cursor sync, theme detection, highlight line
 * Does NOT handle: data fetching, processing, or business logic
 */
export function UPlotBase({
  data,
  series,
  axes,
  scales,
  title,
  unit,
  height = 400,
  highlightTime,
  onZoom,
  syncKey = 'chart-sync',
  className = ''
}: UPlotBaseProps) {
  const chartRef = useRef<HTMLDivElement>(null)
  const uplotRef = useRef<uPlot | null>(null)
  const highlightTimeRef = useRef<number | null>(highlightTime || null)

  // Keep ref in sync with prop
  useEffect(() => {
    highlightTimeRef.current = highlightTime || null
  }, [highlightTime])

  // Plugin to draw vertical highlight line
  const highlightPlugin: uPlot.Plugin = {
    hooks: {
      draw: [
        (u) => {
          const ht = highlightTimeRef.current
          if (ht === null || ht === undefined) return

          const ctx = u.ctx
          const plotData = u.data
          if (!plotData || !plotData[0] || plotData[0].length === 0) return

          const timestamps = plotData[0] as number[]

          // Find closest timestamp
          let closestIdx = 0
          let minDiff = Math.abs(timestamps[0] - ht)
          for (let i = 1; i < timestamps.length; i++) {
            const diff = Math.abs(timestamps[i] - ht)
            if (diff < minDiff) {
              minDiff = diff
              closestIdx = i
            }
          }

          // Get pixel position
          const x = u.valToPos(timestamps[closestIdx], 'x', true)
          const plotTop = u.bbox.top
          const plotBottom = u.bbox.top + u.bbox.height

          // Draw vertical line
          ctx.save()
          ctx.strokeStyle = 'rgba(59, 130, 246, 0.6)' // Blue
          ctx.lineWidth = 2
          ctx.setLineDash([5, 5])
          ctx.beginPath()
          ctx.moveTo(x, plotTop)
          ctx.lineTo(x, plotBottom)
          ctx.stroke()
          ctx.restore()
        }
      ]
    }
  }

  // Effect to handle chart creation/recreation when series/config changes
  useEffect(() => {
    if (!chartRef.current) return
    if (!data || data.length === 0 || !data[0] || data[0].length === 0) return

    // Check if series configuration changed
    let seriesChanged = !uplotRef.current

    if (uplotRef.current) {
      try {
        const currentSeries = uplotRef.current.series
        seriesChanged = currentSeries.length !== series.length ||
          currentSeries.some((s, i) => s.label !== series[i]?.label)
      } catch (err) {
        seriesChanged = true
      }
    }

    // Only recreate if series actually changed
    if (!seriesChanged) return

    // Destroy old chart if exists
    if (uplotRef.current) {
      try {
        uplotRef.current.destroy()
      } catch (err) {
        // Already destroyed
      }
      uplotRef.current = null
    }

    // Get theme-aware colors
    const isDark = document.documentElement.classList.contains('dark')
    const gridColor = isDark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)'
    const textColor = isDark ? '#e5e7eb' : '#1f2937'

    // Build default axes if not provided
    const defaultAxes: uPlot.Axis[] = [
      {
        // X-axis (time)
        space: 80,
        grid: { show: true, stroke: gridColor },
        stroke: textColor,
        size: 60,
        values: (u, vals) => vals.map(v => {
          const date = new Date(v * 1000)
          return `${date.getHours()}:${date.getMinutes().toString().padStart(2, '0')}:${date.getSeconds().toString().padStart(2, '0')}`
        })
      },
      {
        // Y-axis
        side: 3, // left
        grid: { show: true, stroke: gridColor },
        stroke: textColor,
        size: 70,
        space: 40,
      }
    ]

    const opts: uPlot.Options = {
      width: chartRef.current.clientWidth,
      height,
      series,
      scales: scales,
      axes: axes || defaultAxes,
      cursor: {
        sync: { key: syncKey },
        drag: { x: true, y: false },
      },
      plugins: [
        // Highlight plugin - only include if highlightTime prop is provided
        ...(highlightTime !== null && highlightTime !== undefined ? [highlightPlugin] : []),
        // Zoom plugin - only include if onZoom callback is provided
        ...(onZoom ? [{
          hooks: {
            setSelect: [
              (u: uPlot) => {
                // setSelect is called when user completes a drag selection
                const select = u.select
                if (!select || select.left == null || select.width == null) return

                // Ignore if selection is being cleared (width is 0)
                if (select.width === 0) return

                // Convert pixel coordinates to data values
                const left = select.left
                const width = select.width
                const startVal = u.posToVal(left, 'x')
                const endVal = u.posToVal(left + width, 'x')

                const start = new Date(startVal * 1000).toISOString()
                const end = new Date(endVal * 1000).toISOString()

                // Clear selection (this will trigger setSelect again but width will be 0)
                u.setSelect({ left: 0, top: 0, width: 0, height: 0 })

                // Trigger zoom callback
                onZoom(start, end)
              }
            ]
          }
        }] : [])
      ]
    }

    // Create new chart
    uplotRef.current = new uPlot(opts, data, chartRef.current)

    // Style legend markers
    setTimeout(() => {
      const legendMarkers = chartRef.current?.querySelectorAll('.u-legend .u-marker')
      if (legendMarkers) {
        legendMarkers.forEach((marker, idx) => {
          if (idx < series.length && series[idx].stroke) {
            const color = series[idx].stroke
            ;(marker as HTMLElement).style.backgroundColor = typeof color === 'string' ? color : ''
          }
        })
      }
    }, 0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [series, axes, scales, height, syncKey, onZoom])

  // Effect to update data when it changes (without recreating chart)
  useEffect(() => {
    if (!uplotRef.current || !data || data.length === 0) return

    try {
      uplotRef.current.setData(data)
    } catch (err) {
      // Chart might be recreating
    }
  }, [data])

  // Effect to handle resize
  useEffect(() => {
    if (!chartRef.current) return

    const resizeObserver = new ResizeObserver(() => {
      if (uplotRef.current && chartRef.current) {
        try {
          uplotRef.current.setSize({
            width: chartRef.current.clientWidth,
            height
          })
        } catch (err) {
          // Chart might be destroyed, ignore
        }
      }
    })

    resizeObserver.observe(chartRef.current)

    return () => {
      resizeObserver.disconnect()
    }
  }, [height])

  // Cleanup on unmount only
  useEffect(() => {
    return () => {
      if (uplotRef.current) {
        try {
          uplotRef.current.destroy()
        } catch (err) {
          // Already destroyed, ignore
        }
        uplotRef.current = null
      }
    }
  }, [])

  // Trigger redraw when highlightTime changes
  useEffect(() => {
    if (uplotRef.current && highlightTime !== null && highlightTime !== undefined) {
      requestAnimationFrame(() => {
        if (uplotRef.current) {
          const currentData = uplotRef.current.data
          uplotRef.current.setData(currentData)
        }
      })
    }
  }, [highlightTime])

  if (!data || data.length === 0 || !data[0] || data[0].length === 0) {
    return (
      <div className={`h-[${height}px] bg-muted rounded-lg flex items-center justify-center ${className}`}>
        <p className="text-muted-foreground">No data available</p>
      </div>
    )
  }

  return (
    <div className={className}>
      {title && (
        <h3 className="text-lg font-medium mb-2">
          {title} {unit && <span className="text-sm text-muted-foreground">({unit})</span>}
        </h3>
      )}
      <div ref={chartRef} className="w-full" />
    </div>
  )
}
