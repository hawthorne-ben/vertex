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
  className?: string
}

/**
 * Pure uPlot rendering component
 * Handles: rendering, resize, theme detection, highlight line, zoom
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
  className = ''
}: UPlotBaseProps) {
  const chartRef = useRef<HTMLDivElement>(null)
  const uplotRef = useRef<uPlot | null>(null)
  const highlightTimeRef = useRef<number | null>(highlightTime ?? null)

  // Keep ref in sync with prop
  useEffect(() => {
    highlightTimeRef.current = highlightTime ?? null
  }, [highlightTime])

  // Plugin to draw vertical highlight line at a given timestamp
  const highlightPlugin: uPlot.Plugin = {
    hooks: {
      draw: [
        (u) => {
          const ht = highlightTimeRef.current
          if (ht === null) return

          const ctx = u.ctx
          const plotData = u.data
          if (!plotData || !plotData[0] || plotData[0].length === 0) return

          const timestamps = plotData[0] as number[]

          // Binary search for closest timestamp
          let lo = 0
          let hi = timestamps.length - 1
          while (lo < hi) {
            const mid = (lo + hi) >> 1
            if (timestamps[mid] < ht) lo = mid + 1
            else hi = mid
          }
          // Check if the previous index is closer
          if (lo > 0 && Math.abs(timestamps[lo - 1] - ht) < Math.abs(timestamps[lo] - ht)) {
            lo = lo - 1
          }

          const x = u.valToPos(timestamps[lo], 'x', true)
          const plotTop = u.bbox.top
          const plotBottom = u.bbox.top + u.bbox.height

          ctx.save()
          ctx.strokeStyle = 'rgba(59, 130, 246, 0.6)'
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

  // Zoom plugin
  const zoomPlugin: uPlot.Plugin = {
    hooks: {
      setSelect: [
        (u: uPlot) => {
          const select = u.select
          if (!select || select.left == null || select.width == null) return
          if (select.width === 0) return

          const startVal = u.posToVal(select.left, 'x')
          const endVal = u.posToVal(select.left + select.width, 'x')

          const start = new Date(startVal * 1000).toISOString()
          const end = new Date(endVal * 1000).toISOString()

          u.setSelect({ left: 0, top: 0, width: 0, height: 0 })

          onZoom?.(start, end)
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
        side: 3,
        grid: { show: true, stroke: gridColor },
        stroke: textColor,
        size: 70,
        space: 40,
      }
    ]

    const plugins: uPlot.Plugin[] = [highlightPlugin]
    if (onZoom) {
      plugins.push(zoomPlugin)
    }

    const opts: uPlot.Options = {
      width: chartRef.current.clientWidth,
      height,
      series,
      scales: scales,
      axes: axes || defaultAxes,
      cursor: {
        drag: { x: !!onZoom, y: false },
      },
      plugins,
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
  }, [series, axes, scales, height, onZoom])

  // Effect to update data when it changes (without recreating chart)
  useEffect(() => {
    if (!uplotRef.current || !data || data.length === 0) return

    try {
      uplotRef.current.setData(data)
    } catch (err) {
      // Chart might be recreating
    }
  }, [data])

  // Effect to update scales when they change (e.g. zoom range)
  useEffect(() => {
    if (!uplotRef.current || !scales) return

    try {
      for (const [key, scale] of Object.entries(scales)) {
        if (scale.range && Array.isArray(scale.range)) {
          uplotRef.current.setScale(key, {
            min: scale.range[0] as number,
            max: scale.range[1] as number,
          })
        }
      }
    } catch (err) {
      // Chart might be recreating
    }
  }, [scales])

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

  // Trigger redraw when highlightTime changes (plugin reads from ref)
  useEffect(() => {
    if (uplotRef.current && highlightTime !== null && highlightTime !== undefined) {
      requestAnimationFrame(() => {
        uplotRef.current?.redraw(false, false)
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
