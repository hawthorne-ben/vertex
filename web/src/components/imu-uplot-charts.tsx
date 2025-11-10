'use client'

import { useState, useEffect, useRef } from 'react'
import uPlot from 'uplot'
import 'uplot/dist/uPlot.min.css'
import '@/css/uplot-custom.css'
import { createClient } from '@/lib/supabase/client'

interface IMUSample {
  timestamp: string
  accel_x: number
  accel_y: number
  accel_z: number
  gyro_x: number
  gyro_y: number
  gyro_z: number
  roll?: number | null
  pitch?: number | null
  yaw?: number | null
  mag_x?: number | null
  mag_y?: number | null
  mag_z?: number | null
}

interface IMUUPlotChartsProps {
  fileId: string
  initialSamples: IMUSample[]
  originalCount: number
}

type DataType = 'orientation' | 'accel' | 'gyro'  // Added orientation (roll/pitch/yaw)

export function IMUUPlotCharts({ fileId, initialSamples, originalCount }: IMUUPlotChartsProps) {
  const [samples, setSamples] = useState<IMUSample[]>(initialSamples)

  // Check if orientation data exists
  const hasOrientationData = samples.some(s => s.roll !== null && s.pitch !== null && s.yaw !== null)

  const [dataType, setDataType] = useState<DataType>(hasOrientationData ? 'orientation' : 'accel')
  const [loading, setLoading] = useState(false)
  const [zoomRange, setZoomRange] = useState<{ start: string; end: string } | null>(null)
  
  const chartRef = useRef<HTMLDivElement>(null)
  const uplotRef = useRef<uPlot | null>(null)
  const prevDataTypeRef = useRef<DataType>(dataType)
  const prevDataTypeForChartRef = useRef<DataType>(dataType)


  // Magnetometer removed - using 6DoF mode
  const hasMagData = false

  // Fetch high-resolution data when zoomed
  useEffect(() => {
    if (!zoomRange) return

    const fetchDetailData = async () => {
      setLoading(true)
      try {
        const supabase = createClient()
        const { data: { session } } = await supabase.auth.getSession()

        if (!session) {
          console.error('No session found for zoom fetch')
          return
        }

        const params = new URLSearchParams({
          start: zoomRange.start,
          end: zoomRange.end,
          resolution: 'high'
        })

        const response = await fetch(`/api/recordings/${fileId}/samples?${params}`, {
          headers: {
            'Authorization': `Bearer ${session.access_token}`
          }
        })
        const responseData = await response.json()

        if (responseData.samples && responseData.samples.length > 0) {
          // Transform API response format to component format
          const transformedSamples: IMUSample[] = responseData.samples.map((s: any) => ({
            timestamp: new Date(s.timestamp).toISOString(),
            accel_x: s.accel.x,
            accel_y: s.accel.y,
            accel_z: s.accel.z,
            gyro_x: s.gyro.x,
            gyro_y: s.gyro.y,
            gyro_z: s.gyro.z,
            mag_x: s.mag?.x ?? null,
            mag_y: s.mag?.y ?? null,
            mag_z: s.mag?.z ?? null,
          }))
          setSamples(transformedSamples)
        }
      } catch (error) {
        console.error('Failed to fetch detail data:', error)
      } finally {
        setLoading(false)
      }
    }

    fetchDetailData()
  }, [zoomRange, fileId])

  // Reset zoom and samples when dataType actually changes (user clicks button)
  useEffect(() => {
    if (prevDataTypeRef.current !== dataType) {
      // User changed the data type - reset zoom and samples
      setZoomRange(null)
      setSamples(initialSamples)
      prevDataTypeRef.current = dataType
    }
  }, [dataType, initialSamples])

  // Create/update chart when samples or dataType change
  useEffect(() => {
    if (!chartRef.current || samples.length === 0) return

    // Detect gaps in timestamps and insert null markers
    // Only mark gaps that are significantly larger than expected sample spacing
    // For downsampled data, we need a much larger threshold to avoid false positives
    // Calculate expected sample spacing based on data span
    const firstTime = new Date(samples[0].timestamp).getTime()
    const lastTime = new Date(samples[samples.length - 1].timestamp).getTime()
    const totalDuration = lastTime - firstTime
    const expectedSampleSpacing = totalDuration / samples.length
    // Use 10x the expected spacing as threshold - only mark real gaps
    const GAP_THRESHOLD_MS = Math.max(5000, expectedSampleSpacing * 10)
    
    const samplesWithGaps: (IMUSample | null)[] = []

    for (let i = 0; i < samples.length; i++) {
      samplesWithGaps.push(samples[i])

      if (i < samples.length - 1) {
        const currentTime = new Date(samples[i].timestamp).getTime()
        const nextTime = new Date(samples[i + 1].timestamp).getTime()
        const gap = nextTime - currentTime

        if (gap > GAP_THRESHOLD_MS) {
          // Insert null marker to break the line only for real gaps
          samplesWithGaps.push(null)
        }
      }
    }

    // Convert samples to uPlot format
    // uPlot requires timestamps to be numbers (Unix seconds)
    // For gaps, we create aligned arrays where null samples get a timestamp
    // slightly after the previous one to maintain visual continuity
    const finalSamplesWithGaps: (IMUSample | null)[] = []
    const finalTimestamps: number[] = []
    
    for (let i = 0; i < samplesWithGaps.length; i++) {
      if (samplesWithGaps[i]) {
        const ts = new Date(samplesWithGaps[i]!.timestamp).getTime() / 1000
        finalTimestamps.push(ts)
        finalSamplesWithGaps.push(samplesWithGaps[i])
      } else {
        // For gap markers, add a timestamp just after the last one
        // This ensures arrays stay aligned and creates a visual break in the line
        if (finalTimestamps.length > 0) {
          finalTimestamps.push(finalTimestamps[finalTimestamps.length - 1] + 0.001)
          finalSamplesWithGaps.push(null)
        }
        // Skip gap markers at the start (shouldn't happen in practice)
      }
    }

    let series: uPlot.Series[]
    let data: uPlot.AlignedData
    let yAxisLabel: string

    switch (dataType) {
      case 'orientation':
        data = [
          finalTimestamps,
          finalSamplesWithGaps.map(s => s ? (s.roll ?? null) : null) as (number | null)[],
          finalSamplesWithGaps.map(s => s ? (s.pitch ?? null) : null) as (number | null)[],
          finalSamplesWithGaps.map(s => s ? (s.yaw ?? null) : null) as (number | null)[]
        ]
        series = [
          {}, // Timestamp series
          { label: 'Roll', stroke: 'hsl(220, 70%, 50%)', width: 2, spanGaps: false, points: { show: false, size: 0 } },
          { label: 'Pitch', stroke: 'hsl(145, 60%, 45%)', width: 2, spanGaps: false, points: { show: false, size: 0 } },
          { label: 'Yaw', stroke: 'hsl(10, 70%, 50%)', width: 2, spanGaps: false, points: { show: false, size: 0 } }
        ]
        yAxisLabel = 'Angle (degrees)'
        break
      case 'accel':
        data = [
          finalTimestamps,
          finalSamplesWithGaps.map(s => s ? s.accel_x : null) as (number | null)[],
          finalSamplesWithGaps.map(s => s ? s.accel_y : null) as (number | null)[],
          finalSamplesWithGaps.map(s => s ? s.accel_z : null) as (number | null)[]
        ]
        series = [
          {}, // Timestamp series (no label, no stroke - won't show in legend)
          { label: 'X', stroke: 'hsl(10, 49.20%, 52.90%)', width: 2, spanGaps: false, points: { show: false, size: 0 } },
          { label: 'Y', stroke: 'hsl(145, 49.60%, 54.10%)', width: 2, spanGaps: false, points: { show: false, size: 0 } },
          { label: 'Z', stroke: 'hsl(205, 59.70%, 70.80%)', width: 2, spanGaps: false, points: { show: false, size: 0 } }
        ]
        yAxisLabel = 'Acceleration (m/s²)'
        break
      case 'gyro':
        data = [
          finalTimestamps,
          finalSamplesWithGaps.map(s => s ? s.gyro_x : null) as (number | null)[],
          finalSamplesWithGaps.map(s => s ? s.gyro_y : null) as (number | null)[],
          finalSamplesWithGaps.map(s => s ? s.gyro_z : null) as (number | null)[]
        ]
        series = [
          {}, // Timestamp series (no label, no stroke - won't show in legend)
          { label: 'X', stroke: 'hsl(10, 49.20%, 52.90%)', width: 2, spanGaps: false, points: { show: false, size: 0 } },
          { label: 'Y', stroke: 'hsl(145, 49.60%, 54.10%)', width: 2, spanGaps: false, points: { show: false, size: 0 } },
          { label: 'Z', stroke: 'hsl(205, 59.70%, 70.80%)', width: 2, spanGaps: false, points: { show: false, size: 0 } }
        ]
        yAxisLabel = 'Angular Velocity (rad/s)'
        break
      // Magnetometer case removed - using 6DoF mode
    }

    // Debug: log data structure
    console.log('Chart data:', {
      timestampCount: finalTimestamps.length,
      dataLengths: data.map(d => d.length),
      firstTimestamp: finalTimestamps[0],
      lastTimestamp: finalTimestamps[finalTimestamps.length - 1],
      sampleCount: finalSamplesWithGaps.length
    })

    // Get computed colors for theme support
    const foregroundColor = getComputedStyle(chartRef.current).getPropertyValue('--foreground').trim()
    const borderColor = getComputedStyle(chartRef.current).getPropertyValue('--border').trim()
    
    const opts: uPlot.Options = {
      width: chartRef.current.clientWidth,
      height: 400,
      series,
      axes: [
        {
          label: 'Time',
          space: 80,
          stroke: `hsl(${foregroundColor})`,
          labelGap: 8,
          labelSize: 14,
          labelFont: '500 14px system-ui',
          grid: {
            show: false  // Remove grid for minimal look
          },
          ticks: {
            stroke: `hsl(${borderColor})`,
            width: 1
          },
          // Reduce tick density for cleaner X-axis
          incrs: [
            // seconds
            1, 2, 5, 10, 15, 30,
            // minutes
            60, 120, 300, 600, 900, 1800,
            // hours  
            3600, 7200, 14400, 21600, 43200, 86400
          ],
          values: (self, ticks) => {
            // Format timestamps as absolute time (12-hour format) in local timezone
            return ticks.map(t => {
              const date = new Date(t * 1000)
              const hours = date.getHours()
              const minutes = date.getMinutes().toString().padStart(2, '0')
              const seconds = date.getSeconds().toString().padStart(2, '0')
              
              // Convert to 12-hour format
              const hour12 = hours % 12 || 12
              const ampm = hours < 12 ? 'AM' : 'PM'
              
              return `${hour12}:${minutes}:${seconds} ${ampm}`
            })
          }
        },
        {
          label: yAxisLabel,
          space: 70,
          stroke: `hsl(${foregroundColor})`,
          labelGap: 8,
          labelSize: 14,
          labelFont: '500 14px system-ui',
          grid: {
            show: false  // Remove grid for minimal look
          },
          ticks: {
            stroke: `hsl(${borderColor})`,
            width: 1
          }
        }
      ],
      scales: {
        x: {
          time: true, // Use absolute time
          // Explicitly set range if we have data
          ...(finalTimestamps.length > 0 && {
            min: Math.min(...finalTimestamps),
            max: Math.max(...finalTimestamps)
          })
        }
      },
      cursor: {
        drag: {
          x: true,
          y: false
        },
        sync: {
          key: 'imu-sync' // Sync cursor across multiple charts if we add more
        }
      },
      hooks: {
        setSelect: [
          (self) => {
            // Drag-to-zoom callback
            const select = self.select
            if (select && select.width > 0) {
              // Use uPlot's scale conversion to get the actual timestamp values at the pixel positions
              // This correctly handles downsampled/irregular data
              const startTimeUnix = self.posToVal(select.left, 'x')
              const endTimeUnix = self.posToVal(select.left + select.width, 'x')
              
              // Log the current X-axis scale bounds for debugging
              const xScale = self.scales.x
              console.log('🔍 Zoom selection:', {
                pixelLeft: select.left,
                pixelRight: select.left + select.width,
                pixelWidth: select.width,
                currentXScaleMin: xScale?.min,
                currentXScaleMax: xScale?.max,
                currentXScaleMinLocal: xScale?.min ? new Date(xScale.min * 1000).toLocaleTimeString() : 'N/A',
                currentXScaleMaxLocal: xScale?.max ? new Date(xScale.max * 1000).toLocaleTimeString() : 'N/A',
                startTimeUnix,
                endTimeUnix,
                startTimeLocal: new Date(startTimeUnix * 1000).toLocaleTimeString(),
                endTimeLocal: new Date(endTimeUnix * 1000).toLocaleTimeString()
              })
              
              // Convert Unix seconds to ISO string
              const startTime = new Date(startTimeUnix * 1000).toISOString()
              const endTime = new Date(endTimeUnix * 1000).toISOString()
              
              console.log('🔍 Setting zoom range:', { startTime, endTime })
              setZoomRange({ start: startTime, end: endTime })
            }
          }
        ]
      },
      legend: {
        show: true,
        live: true
      },
      padding: [16, 16, 16, 16]
    }

    // Check if dataType changed (need to recreate chart with new series config)
    const dataTypeChanged = prevDataTypeForChartRef.current !== dataType
    
    if (dataTypeChanged) {
      // Data type changed - destroy and recreate chart
      if (uplotRef.current) {
        uplotRef.current.destroy()
        uplotRef.current = null
      }
      prevDataTypeForChartRef.current = dataType
    }
    
    // Update existing chart or create new one
    if (uplotRef.current) {
      // Chart exists - just update the data (zoom fetch completed)
      uplotRef.current.setData(data)
      
      // After setData, scale to show all the new data
      if (zoomRange) {
        uplotRef.current.setScale('x', { min: data[0][0], max: data[0][data[0].length - 1] })
      } else {
        // For default view, ensure scales are set correctly
        if (finalTimestamps.length > 0) {
          uplotRef.current.setScale('x', { 
            min: Math.min(...finalTimestamps), 
            max: Math.max(...finalTimestamps) 
          })
        }
      }
    } else {
      // First time or after dataType change - create the chart
      uplotRef.current = new uPlot(opts, data, chartRef.current)
      
      // Ensure scales are set after creation
      if (finalTimestamps.length > 0 && !zoomRange) {
        uplotRef.current.setScale('x', { 
          min: Math.min(...finalTimestamps), 
          max: Math.max(...finalTimestamps) 
        })
      }
    }

    // Manually set legend marker background colors (uPlot doesn't use fill for legend markers)
    setTimeout(() => {
      const legendMarkers = chartRef.current?.querySelectorAll('.u-legend .u-marker')
      if (legendMarkers) {
        legendMarkers.forEach((marker, idx) => {
          // idx corresponds to series index (0 = timestamp, 1 = X, 2 = Y, 3 = Z)
          // But we need to map to the actual series array
          const seriesIndex = idx
          if (seriesIndex < series.length && series[seriesIndex].stroke) {
            const seriesColor = series[seriesIndex].stroke
            ;(marker as HTMLElement).style.backgroundColor = typeof seriesColor === 'string' ? seriesColor : ''
          }
        })
      }
    }, 0)

    // Handle resize
    const resizeObserver = new ResizeObserver(() => {
      if (uplotRef.current && chartRef.current) {
        uplotRef.current.setSize({
          width: chartRef.current.clientWidth,
          height: 400
        })
      }
    })

    resizeObserver.observe(chartRef.current)

    // Cleanup
    return () => {
      resizeObserver.disconnect()
      // Don't destroy chart here - we manage it manually based on dataType changes
    }
  }, [samples, dataType, zoomRange])
  
  // Separate cleanup on unmount
  useEffect(() => {
    return () => {
      if (uplotRef.current) {
        uplotRef.current.destroy()
        uplotRef.current = null
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Calculate stats
  const calculateStats = () => {
    let values: { [key: string]: number[] } = {}
    
    switch (dataType) {
      case 'orientation':
        values = {
          'Roll': samples.map(s => s.roll ?? 0),
          'Pitch': samples.map(s => s.pitch ?? 0),
          'Yaw': samples.map(s => s.yaw ?? 0)
        }
        break
      case 'accel':
        values = {
          'X': samples.map(s => s.accel_x),
          'Y': samples.map(s => s.accel_y),
          'Z': samples.map(s => s.accel_z)
        }
        break
      case 'gyro':
        values = {
          'X': samples.map(s => s.gyro_x),
          'Y': samples.map(s => s.gyro_y),
          'Z': samples.map(s => s.gyro_z)
        }
        break
      // Magnetometer case removed - using 6DoF mode
    }

    return Object.entries(values).map(([axis, vals]) => {
      const min = Math.min(...vals)
      const max = Math.max(...vals)
      const mean = vals.reduce((a, b) => a + b, 0) / vals.length
      return { axis, min, max, mean }
    })
  }

  const stats = calculateStats()
  const firstTimestamp = samples.length > 0 ? new Date(samples[0].timestamp).getTime() : 0
  const lastTimestamp = samples.length > 0 ? new Date(samples[samples.length - 1].timestamp).getTime() : 0
  const duration = (lastTimestamp - firstTimestamp) / 1000

  const getUnit = () => {
    switch (dataType) {
      case 'orientation': return '°'
      case 'accel': return 'm/s²'
      case 'gyro': return 'rad/s'
      // Magnetometer removed
    }
  }

  const getTitle = () => {
    switch (dataType) {
      case 'orientation': return 'Orientation'
      case 'accel': return 'Accelerometer'
      case 'gyro': return 'Gyroscope'
      // Magnetometer removed
    }
  }

  return (
    <div className="space-y-6">
      {/* Selector */}
      <div className="flex gap-2 items-center">
        {hasOrientationData && (
          <button
            onClick={() => setDataType('orientation')}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              dataType === 'orientation'
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground hover:bg-muted/80'
            }`}
          >
            Orientation
          </button>
        )}
        <button
          onClick={() => setDataType('accel')}
          className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
            dataType === 'accel'
              ? 'bg-primary text-primary-foreground'
              : 'bg-muted text-muted-foreground hover:bg-muted/80'
          }`}
        >
          Accelerometer
        </button>
        <button
          onClick={() => setDataType('gyro')}
          className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
            dataType === 'gyro'
              ? 'bg-primary text-primary-foreground'
              : 'bg-muted text-muted-foreground hover:bg-muted/80'
          }`}
        >
          Gyroscope
        </button>
        {/* Magnetometer button removed - using 6DoF mode */}
        
        {loading && (
          <span className="text-xs text-secondary ml-2">Loading detail...</span>
        )}

        {zoomRange && (
          <button
            onClick={() => {
              setZoomRange(null)
              setSamples(initialSamples)
            }}
            className="ml-auto px-3 py-1 text-xs rounded-md bg-muted text-muted-foreground hover:bg-muted/80"
          >
            Reset Zoom
          </button>
        )}
      </div>

      {/* Chart */}
      <div className="border border-border rounded-lg p-6 bg-card">
        <h3 className="text-lg font-medium text-card-foreground mb-4">
          {getTitle()} <span className="text-sm text-muted-foreground">({getUnit()})</span>
        </h3>
        
        <div ref={chartRef} className="w-full" />
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        {stats.map(({ axis, min, max, mean }) => (
          <div key={axis} className="p-4 bg-muted rounded-lg border border-border">
            <div className="flex items-center gap-2 mb-2">
              <div 
                className="w-3 h-3 rounded-full" 
                style={{ 
                  backgroundColor: axis === 'X' ? 'hsl(0, 70%, 50%)' : 
                                   axis === 'Y' ? 'hsl(120, 70%, 40%)' : 
                                   'hsl(210, 70%, 50%)' 
                }}
              />
              <span className="font-medium text-foreground">{axis}-axis</span>
            </div>
            <div className="space-y-1 text-xs text-muted-foreground font-mono">
              <div>Min: {min.toFixed(3)} {getUnit()}</div>
              <div>Max: {max.toFixed(3)} {getUnit()}</div>
              <div>Mean: {mean.toFixed(3)} {getUnit()}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Info */}
      <div className="text-sm text-muted-foreground bg-muted border border-border rounded-lg p-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <strong>Displaying:</strong> {samples.length.toLocaleString()} samples
            {samples.length < initialSamples.length && ' (zoomed)'}
          </div>
          <div>
            <strong>Time span:</strong> {duration.toFixed(2)}s
          </div>
          <div>
            <strong>Original dataset:</strong> {originalCount.toLocaleString()} samples
          </div>
          <div>
            <strong>Downsampled:</strong> {initialSamples.length < originalCount ? 'Yes (LTTB)' : 'No'}
          </div>
        </div>
      </div>
    </div>
  )
}

