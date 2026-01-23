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
  const isUserZoomRef = useRef(false)
  const lastZoomRef = useRef<{ start: string; end: string } | null>(null)

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

  // Create/update chart
  useEffect(() => {
    if (!chartRef.current) return
    if (!data || data.length === 0 || !data[0] || data[0].length === 0) return

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
      scales: scales || { x: {}, y: {} },
      axes: axes || defaultAxes,
      cursor: {
        sync: { key: syncKey },
        drag: { x: true, y: false },
      },
      plugins: [
        highlightPlugin,
        {
          hooks: {
            // Init: setup event listeners
            init: [
              (u) => {
                const over = u.over
                // Double-click to reset zoom
                over.addEventListener('dblclick', () => {
                  const timestamps = data[0] as number[]
                  u.setScale('x', { min: timestamps[0], max: timestamps[timestamps.length - 1] })
                })
                // Track mousedown for user-initiated zoom detection
                if (onZoom) {
                  over.addEventListener('mousedown', () => {
                    isUserZoomRef.current = true
                  })
                }
              }
            ],
            // Capture zoom for callback (only on user drag, not programmatic)
            setScale: onZoom ? [
              (u) => {
                // Only trigger callback if this was a user-initiated zoom
                if (!isUserZoomRef.current) {
                  return
                }

                const xScale = u.scales.x
                if (xScale.min !== undefined && xScale.max !== undefined) {
                  const start = new Date(xScale.min * 1000).toISOString()
                  const end = new Date(xScale.max * 1000).toISOString()

                  // Debounce - only fire if zoom range actually changed (with tolerance)
                  if (lastZoomRef.current) {
                    const prevStart = new Date(lastZoomRef.current.start).getTime()
                    const prevEnd = new Date(lastZoomRef.current.end).getTime()
                    const newStart = new Date(start).getTime()
                    const newEnd = new Date(end).getTime()

                    // If zoom range is within 100ms of previous, skip
                    if (Math.abs(prevStart - newStart) < 100 && Math.abs(prevEnd - newEnd) < 100) {
                      isUserZoomRef.current = false
                      return
                    }
                  }

                  lastZoomRef.current = { start, end }

                  // Use setTimeout to debounce rapid zoom changes
                  setTimeout(() => {
                    onZoom(start, end)
                  }, 300)
                }

                isUserZoomRef.current = false // Reset flag
              }
            ] : undefined
          }
        }
      ]
    }

    // Create or update chart
    if (uplotRef.current) {
      // Prevent zoom callback from firing during programmatic data updates
      isUserZoomRef.current = false

      // Preserve current zoom state before updating data
      const currentXScale = uplotRef.current.scales.x
      const wasZoomed = currentXScale.min !== undefined && currentXScale.max !== undefined

      uplotRef.current.setData(data)

      // Restore zoom after data update (if was zoomed)
      if (wasZoomed && currentXScale.min !== undefined && currentXScale.max !== undefined) {
        // Use requestAnimationFrame to apply zoom after data is rendered
        requestAnimationFrame(() => {
          if (uplotRef.current) {
            uplotRef.current.setScale('x', {
              min: currentXScale.min,
              max: currentXScale.max
            })
          }
        })
      }
    } else {
      uplotRef.current = new uPlot(opts, data, chartRef.current)
    }

    // Manually style legend markers
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

    // Handle resize
    const resizeObserver = new ResizeObserver(() => {
      if (uplotRef.current && chartRef.current) {
        uplotRef.current.setSize({
          width: chartRef.current.clientWidth,
          height
        })
      }
    })

    resizeObserver.observe(chartRef.current)

    return () => {
      resizeObserver.disconnect()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, series, axes, scales, height, syncKey, onZoom]) // highlightPlugin is stable, ignore warning

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (uplotRef.current) {
        uplotRef.current.destroy()
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
