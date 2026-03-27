'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import uPlot from 'uplot'
import 'uplot/dist/uPlot.min.css'
import '@/css/uplot-custom.css'

export interface ChartStat {
  label: string
  color: string
  avg: number | null
  max: number | null
  unit?: string
  avgPrefix?: string // defaults to "Avg", set to "" to show just the value
}

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
  stats?: ChartStat[]
}

/**
 * Pure uPlot rendering component
 * Handles: rendering, resize, theme detection, highlight line, zoom, tooltip
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
  className = '',
  stats
}: UPlotBaseProps) {
  const chartRef = useRef<HTMLDivElement>(null)
  const uplotRef = useRef<uPlot | null>(null)
  const highlightTimeRef = useRef<number | null>(highlightTime ?? null)
  const tooltipRef = useRef<HTMLDivElement>(null)
  const [tooltipData, setTooltipData] = useState<{
    left: number
    top: number
    time: string
    values: Array<{ label: string; color: string; value: string }>
  } | null>(null)
  const [hiddenSeries, setHiddenSeries] = useState<Set<number>>(new Set())

  // Keep ref in sync with prop
  useEffect(() => {
    highlightTimeRef.current = highlightTime ?? null
  }, [highlightTime])

  // Reset hidden series when series config changes (labels identify the series)
  const seriesKey = series.map(s => typeof s.label === 'string' ? s.label : '').join(',')
  useEffect(() => {
    setHiddenSeries(new Set())
    // Re-show all series in the uPlot instance
    if (uplotRef.current) {
      for (let i = 1; i < uplotRef.current.series.length; i++) {
        uplotRef.current.setSeries(i, { show: true })
      }
    }
  }, [seriesKey])

  // Toggle series visibility
  const toggleSeries = useCallback((seriesIndex: number) => {
    setHiddenSeries(prev => {
      const next = new Set(prev)
      if (next.has(seriesIndex)) {
        next.delete(seriesIndex)
      } else {
        next.add(seriesIndex)
      }
      // Update uPlot series visibility
      if (uplotRef.current) {
        const show = !next.has(seriesIndex)
        uplotRef.current.setSeries(seriesIndex, { show })
      }
      return next
    })
  }, [])

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

  // Tooltip plugin - tracks cursor and shows hovered values
  const seriesRef = useRef(series)
  seriesRef.current = series
  const dataRef = useRef(data)
  dataRef.current = data

  const handleCursorMove = useCallback((u: uPlot) => {
    const idx = u.cursor.idx
    if (idx == null || idx < 0) {
      setTooltipData(null)
      return
    }

    const currentData = dataRef.current
    const currentSeries = seriesRef.current
    if (!currentData || !currentData[0] || idx >= currentData[0].length) {
      setTooltipData(null)
      return
    }

    const timestamp = currentData[0][idx]
    if (timestamp == null) {
      setTooltipData(null)
      return
    }

    const date = new Date(timestamp * 1000)
    const time = `${date.getHours()}:${date.getMinutes().toString().padStart(2, '0')}:${date.getSeconds().toString().padStart(2, '0')}`

    const values: Array<{ label: string; color: string; value: string }> = []
    for (let i = 1; i < currentSeries.length; i++) {
      const s = currentSeries[i]
      const v = currentData[i]?.[idx]
      if (v == null) continue

      const label = typeof s.label === 'string' ? s.label : `Series ${i}`
      const color = typeof s.stroke === 'string' ? s.stroke : '#888'
      let formatted: string
      if (s.value && typeof s.value === 'function') {
        formatted = s.value(u, v, i, idx) as string
      } else {
        formatted = typeof v === 'number' ? v.toFixed(2) : String(v)
      }
      values.push({ label, color, value: formatted })
    }

    if (values.length === 0) {
      setTooltipData(null)
      return
    }

    // Position tooltip near cursor
    const left = u.valToPos(timestamp, 'x', true) / devicePixelRatio
    const top = u.cursor.top ?? 0

    setTooltipData({ left, top, time, values })
  }, [])

  const tooltipPlugin: uPlot.Plugin = {
    hooks: {
      setCursor: [handleCursorMove]
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
        size: 40,
        values: (u, vals) => vals.map(v => {
          const date = new Date(v * 1000)
          return `${date.getHours()}:${date.getMinutes().toString().padStart(2, '0')}:${date.getSeconds().toString().padStart(2, '0')}`
        })
      },
      {
        side: 3,
        grid: { show: true, stroke: gridColor },
        stroke: textColor,
        size: 45,
        space: 40,
      }
    ]

    const plugins: uPlot.Plugin[] = [highlightPlugin, tooltipPlugin]
    if (onZoom) {
      plugins.push(zoomPlugin)
    }

    // Always use the themed x-axis (first entry in defaultAxes).
    // Custom axes provide only y-axes; we prepend the themed x-axis.
    const resolvedAxes = axes
      ? [defaultAxes[0], ...axes]
      : defaultAxes

    const opts: uPlot.Options = {
      width: chartRef.current.clientWidth,
      height,
      series,
      scales: scales,
      axes: resolvedAxes,
      legend: { show: false },
      cursor: {
        drag: { x: !!onZoom, y: false },
      },
      plugins,
    }

    // Create new chart
    uplotRef.current = new uPlot(opts, data, chartRef.current)

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

  // Clear tooltip when cursor leaves chart area
  useEffect(() => {
    const el = chartRef.current
    if (!el) return
    const handleLeave = () => setTooltipData(null)
    el.addEventListener('mouseleave', handleLeave)
    return () => el.removeEventListener('mouseleave', handleLeave)
  }, [])

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
      <div ref={chartRef} className="w-full relative">
        {/* Cursor tooltip */}
        {tooltipData && (
          <div
            ref={tooltipRef}
            className="uplot-tooltip glass-overlay border border-border rounded-lg pointer-events-none"
            style={{
              position: 'absolute',
              left: Math.min(tooltipData.left + 12, (chartRef.current?.clientWidth ?? 300) - 180),
              top: Math.max(0, tooltipData.top - 10),
              zIndex: 50,
            }}
          >
            <div className="text-xs text-muted-foreground mb-1">{tooltipData.time}</div>
            {tooltipData.values.map((v, i) => (
              <div key={i} className="flex items-center gap-1.5 text-xs">
                <span
                  className="inline-block w-2 h-2 rounded-sm flex-shrink-0"
                  style={{ backgroundColor: v.color }}
                />
                <span className="text-foreground">{v.label}:</span>
                <span className="text-muted-foreground font-mono">{v.value}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Static stats bar — click to toggle series visibility */}
      {stats && stats.length > 0 && (
        <div className="flex flex-wrap justify-around gap-y-1 mt-2 text-sm text-muted-foreground">
          {stats.map((s, i) => {
            const seriesIdx = i + 1 // series[0] is time axis
            const isHidden = hiddenSeries.has(seriesIdx)
            return (
              <button
                key={i}
                type="button"
                onClick={() => stats.length > 1 && toggleSeries(seriesIdx)}
                className={`flex items-center gap-1.5 transition-opacity ${
                  stats.length > 1 ? 'cursor-pointer hover:opacity-80' : ''
                } ${isHidden ? 'opacity-40' : ''}`}
              >
                <span
                  className="inline-block w-2 h-2 rounded-sm flex-shrink-0"
                  style={{ backgroundColor: s.color }}
                />
                {/* Only show label when there are multiple series to distinguish */}
                {stats.length > 1 && <span className="text-foreground font-medium">{s.label}:</span>}
                {s.avg != null && <span>{(s.avgPrefix ?? 'Avg') + ((s.avgPrefix ?? 'Avg') ? ' ' : '')}{s.avg.toFixed(1)}{s.unit ? ` ${s.unit}` : ''}</span>}
                {s.avg != null && s.max != null && <span>/</span>}
                {s.max != null && <span>Max {s.max.toFixed(1)}{s.unit ? ` ${s.unit}` : ''}</span>}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
