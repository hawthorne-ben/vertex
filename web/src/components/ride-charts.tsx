'use client'

import { useEffect, useRef, useState } from 'react'
import uPlot from 'uplot'
import 'uplot/dist/uPlot.min.css'

interface RideChartsProps {
  samples: Array<{
    timestamp: string
    power_watts?: number | null
    heart_rate?: number | null
    cadence?: number | null
    speed_ms?: number | null
  }>
  onHover?: (index: number | null) => void
  syncKey?: string
  className?: string
}

export function RideCharts({
  samples,
  onHover,
  syncKey = 'ride-charts',
  className = ''
}: RideChartsProps) {
  const chartRef = useRef<HTMLDivElement>(null)
  const plotRef = useRef<uPlot | null>(null)

  useEffect(() => {
    if (!chartRef.current || samples.length === 0) return

    // Prepare data arrays
    const timestamps = samples.map(s => new Date(s.timestamp).getTime() / 1000)
    const power = samples.map(s => s.power_watts ?? null)
    const heartRate = samples.map(s => s.heart_rate ?? null)
    const cadence = samples.map(s => s.cadence ?? null)
    const speedMph = samples.map(s => s.speed_ms ? s.speed_ms * 2.23694 : null) // m/s to mph

    const hasPower = power.some(v => v !== null)
    const hasHR = heartRate.some(v => v !== null)
    const hasCadence = cadence.some(v => v !== null)
    const hasSpeed = speedMph.some(v => v !== null)

    // Build data array and series
    const data: uPlot.AlignedData = [timestamps]
    const series: uPlot.Series[] = [
      { label: 'Time' } // X-axis
    ]

    // Add available series
    if (hasPower) {
      data.push(power as any)
      series.push({
        label: 'Power',
        stroke: '#ef4444', // red
        width: 2,
        scale: 'watts',
        value: (u, v) => v == null ? '-' : `${v.toFixed(0)}W`
      })
    }

    if (hasHR) {
      data.push(heartRate as any)
      series.push({
        label: 'Heart Rate',
        stroke: '#ec4899', // pink
        width: 2,
        scale: 'bpm',
        value: (u, v) => v == null ? '-' : `${v.toFixed(0)} bpm`
      })
    }

    if (hasCadence) {
      data.push(cadence as any)
      series.push({
        label: 'Cadence',
        stroke: '#3b82f6', // blue
        width: 2,
        scale: 'rpm',
        value: (u, v) => v == null ? '-' : `${v.toFixed(0)} rpm`
      })
    }

    if (hasSpeed) {
      data.push(speedMph as any)
      series.push({
        label: 'Speed',
        stroke: '#10b981', // green
        width: 2,
        scale: 'speed',
        value: (u, v) => v == null ? '-' : `${v.toFixed(1)} mph`
      })
    }

    // Check theme for colors
    const isDark = document.documentElement.classList.contains('dark')
    const gridColor = isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'
    const textColor = isDark ? '#e5e7eb' : '#1f2937'

    // Configure axes
    const axes: uPlot.Axis[] = [
      {
        // X-axis (time)
        space: 80,
        grid: { show: true, stroke: gridColor },
        values: (u, vals) => vals.map(v => {
          const date = new Date(v * 1000)
          const hours = date.getHours()
          const minutes = date.getMinutes().toString().padStart(2, '0')
          const seconds = date.getSeconds().toString().padStart(2, '0')
          return `${hours}:${minutes}:${seconds}`
        })
      }
    ]

    // Left Y-axis (Power, HR) - scale 'watts'
    if (hasPower || hasHR) {
      const maxVal = Math.max(
        hasPower ? Math.max(...power.filter((v): v is number => v !== null)) : 0,
        hasHR ? Math.max(...heartRate.filter((v): v is number => v !== null)) : 0
      )
      axes.push({
        scale: 'watts',
        side: 3, // left
        grid: { show: true, stroke: gridColor },
        label: hasPower ? 'Power (W) / HR (bpm)' : 'HR (bpm)',
        labelSize: 60,
        size: 60,
        values: (u, vals) => vals.map(v => v?.toFixed(0) || ''),
        space: 40,
      })
    }

    // Right Y-axis (Cadence, Speed) - scale 'rpm'
    if (hasCadence || hasSpeed) {
      axes.push({
        scale: 'rpm',
        side: 1, // right
        grid: { show: false },
        label: hasCadence && hasSpeed ? 'Cadence (rpm) / Speed (mph)' : hasCadence ? 'Cadence (rpm)' : 'Speed (mph)',
        labelSize: 60,
        size: 60,
        values: (u, vals) => vals.map(v => v?.toFixed(0) || ''),
        space: 40,
      })
    }

    // Create scales
    const scales: Record<string, uPlot.Scale> = {
      x: {},
      watts: {
        auto: true,
        range: (u, dataMin, dataMax) => {
          // Add 10% padding
          const padding = (dataMax - dataMin) * 0.1
          return [Math.max(0, dataMin - padding), dataMax + padding]
        }
      },
      rpm: {
        auto: true,
        range: (u, dataMin, dataMax) => {
          const padding = (dataMax - dataMin) * 0.1
          return [Math.max(0, dataMin - padding), dataMax + padding]
        }
      },
      bpm: { from: 'watts' },
      speed: { from: 'rpm' }
    }

    const opts: uPlot.Options = {
      width: chartRef.current.clientWidth,
      height: 400,
      series,
      scales,
      axes,
      cursor: {
        sync: {
          key: syncKey,
        },
        drag: {
          x: true, // Enable zoom by dragging
          y: false,
        },
      },
      hooks: {
        setCursor: [
          (u) => {
            const idx = u.cursor.idx
            if (onHover) {
              onHover(idx !== undefined && idx !== null ? idx : null)
            }
          }
        ]
      },
      plugins: [
        {
          hooks: {
            // Double-click to reset zoom
            init: (u) => {
              const over = u.over
              over.addEventListener('dblclick', () => {
                u.setScale('x', { min: timestamps[0], max: timestamps[timestamps.length - 1] })
              })
            }
          }
        }
      ]
    }

    // Create plot
    const plot = new uPlot(opts, data, chartRef.current)
    plotRef.current = plot

    // Handle resize
    const handleResize = () => {
      if (chartRef.current && plotRef.current) {
        plotRef.current.setSize({
          width: chartRef.current.clientWidth,
          height: 400
        })
      }
    }
    window.addEventListener('resize', handleResize)

    return () => {
      window.removeEventListener('resize', handleResize)
      plot.destroy()
    }
  }, [samples, onHover, syncKey])

  if (samples.length === 0) {
    return (
      <div className={`bg-muted rounded-lg flex items-center justify-center ${className}`} style={{ height: 400 }}>
        <p className="text-muted-foreground">No data available</p>
      </div>
    )
  }

  return (
    <div className={className}>
      <div ref={chartRef} className="w-full" />
    </div>
  )
}
