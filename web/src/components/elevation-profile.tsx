'use client'

import { useEffect, useRef } from 'react'
import uPlot from 'uplot'
import 'uplot/dist/uPlot.min.css'

interface ElevationProfileProps {
  samples: Array<{
    timestamp: string
    altitude?: number | null
  }>
  onHover?: (index: number | null) => void
  highlightIndex?: number | null // Externally controlled highlight
  syncKey?: string
  resetTrigger?: number
  className?: string
}

export function ElevationProfile({
  samples,
  onHover,
  highlightIndex,
  syncKey = 'ride-charts',
  resetTrigger = 0,
  className = ''
}: ElevationProfileProps) {
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
    const altitudeFeet = samples.map(s => s.altitude ? s.altitude * 3.28084 : null) // meters to feet

    const hasAltitude = altitudeFeet.some(v => v !== null)

    if (!hasAltitude) return

    // Calculate grade (percent slope) between points
    const grades: (number | null)[] = [null] // First point has no grade
    for (let i = 1; i < samples.length; i++) {
      const prev = samples[i - 1]
      const curr = samples[i]

      if (prev.altitude !== null && curr.altitude !== null && prev.altitude !== undefined && curr.altitude !== undefined) {
        const prevTime = new Date(prev.timestamp).getTime() / 1000
        const currTime = new Date(curr.timestamp).getTime() / 1000
        const timeDiff = currTime - prevTime

        // Approximate distance (assuming constant speed)
        // For more accuracy, would need GPS distance between points
        // Simple approximation: use time and average cycling speed
        const estimatedSpeed = 5 // m/s (~11 mph average)
        const distance = estimatedSpeed * timeDiff

        if (distance > 0) {
          const elevChange = curr.altitude - prev.altitude
          const grade = (elevChange / distance) * 100
          grades.push(Math.max(-25, Math.min(25, grade))) // Clamp to reasonable range
        } else {
          grades.push(null)
        }
      } else {
        grades.push(null)
      }
    }

    // Check theme
    const isDark = document.documentElement.classList.contains('dark')
    const gridColor = isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'
    const textColor = isDark ? '#e5e7eb' : '#374151'
    const fillColor = isDark ? 'rgba(59, 130, 246, 0.3)' : 'rgba(59, 130, 246, 0.2)' // blue with transparency

    const data: uPlot.AlignedData = [timestamps, altitudeFeet as any]

    const series: uPlot.Series[] = [
      { label: 'Time' },
      {
        label: 'Elevation',
        stroke: '#3b82f6', // blue
        fill: fillColor,
        width: 2,
        scale: 'elevation',
        value: (u, v) => v == null ? '-' : `${v.toFixed(0)} ft`,
        paths: (u, seriesIdx, idx0, idx1) => {
          // Custom path builder for filled area chart
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
      height: 250,
      padding: [8, 8, 0, 0],
      plugins: [highlightPlugin],
      series,
      scales: {
        x: {},
        elevation: {
          auto: true,
          range: (u, dataMin, dataMax) => {
            // Add padding and ensure we start from a reasonable floor
            const padding = (dataMax - dataMin) * 0.1
            const floor = Math.max(0, dataMin - padding)
            return [floor, dataMax + padding]
          }
        }
      },
      axes: [
        {
          // X-axis
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
          // Y-axis (elevation)
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
      ],
      hooks: {
        setCursor: [
          (u) => {
            const idx = u.cursor.idx
            if (onHover) {
              onHover(idx !== undefined && idx !== null ? idx : null)
            }
          }
        ],
        draw: [
          (u) => {
            // Draw grade labels on steep sections
            const ctx = u.ctx
            const idx = u.cursor.idx

            if (idx !== undefined && idx !== null && grades[idx] !== null) {
              const grade = grades[idx]!
              const x = u.valToPos(u.data[0][idx], 'x', true)
              const y = u.valToPos(u.data[1][idx] || 0, 'elevation', true)

              // Show grade label
              ctx.save()
              ctx.fillStyle = isDark ? '#e5e7eb' : '#1f2937'
              ctx.font = '12px sans-serif'
              const gradeText = `${grade >= 0 ? '+' : ''}${grade.toFixed(1)}%`
              ctx.fillText(gradeText, x + 10, y - 10)
              ctx.restore()
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
          height: 250
        })
      }
    }
    window.addEventListener('resize', handleResize)

    return () => {
      window.removeEventListener('resize', handleResize)
      plot.destroy()
    }
  }, [samples, onHover, syncKey])

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

  if (samples.length === 0 || !samples.some(s => s.altitude !== null)) {
    return (
      <div className={`bg-muted rounded-lg flex items-center justify-center ${className}`} style={{ height: 250 }}>
        <p className="text-muted-foreground">No elevation data available</p>
      </div>
    )
  }

  return (
    <div className={className}>
      <div ref={chartRef} className="w-full" />
    </div>
  )
}
