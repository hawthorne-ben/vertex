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
  highlightTime?: number | null // Unix timestamp in seconds to highlight
}

type DataType = 'orientation' | 'trueOrientation' | 'accel' | 'gyro' | 'smoothedAccel' | 'smoothedGyro'

export function IMUUPlotCharts({ fileId, initialSamples, originalCount, highlightTime }: IMUUPlotChartsProps) {
  const [samples, setSamples] = useState<IMUSample[]>(initialSamples)
  const [filteredSamples, setFilteredSamples] = useState<IMUSample[] | null>(null)
  const [smoothedSamples, setSmoothedSamples] = useState<IMUSample[] | null>(null)
  const [filteredLoading, setFilteredLoading] = useState(false)
  const [smoothedLoading, setSmoothedLoading] = useState(false)

  // Check if orientation data exists
  const hasOrientationData = samples.some(s => s.roll !== null && s.pitch !== null && s.yaw !== null)

  const [dataType, setDataType] = useState<DataType>(hasOrientationData ? 'orientation' : 'accel')
  const [loading, setLoading] = useState(false)
  const [zoomRange, setZoomRange] = useState<{ start: string; end: string } | null>(null)
  
  const chartRef = useRef<HTMLDivElement>(null)
  const uplotRef = useRef<uPlot | null>(null)
  const prevDataTypeRef = useRef<DataType>(dataType)
  const prevDataTypeForChartRef = useRef<DataType>(dataType)
  const highlightTimeRef = useRef<number | null>(highlightTime || null)

  // Keep ref in sync with prop
  useEffect(() => {
    highlightTimeRef.current = highlightTime || null
  }, [highlightTime])


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
        })

        // Use appropriate endpoint based on current data type
        let endpoint: string
        if (dataType === 'trueOrientation') {
          endpoint = `/api/recordings/${fileId}/samples/filtered?${params}`
        } else if (dataType === 'smoothedAccel' || dataType === 'smoothedGyro') {
          endpoint = `/api/recordings/${fileId}/samples/smoothed?${params}`
        } else {
          endpoint = `/api/recordings/${fileId}/samples?${params}&resolution=high`
        }

        const response = await fetch(endpoint, {
          headers: {
            'Authorization': `Bearer ${session.access_token}`
          }
        })
        const responseData = await response.json()

        if (responseData.samples && responseData.samples.length > 0) {
          if (dataType === 'trueOrientation') {
            // Transform filtered samples
            const transformedSamples: IMUSample[] = responseData.samples.map((s: any) => ({
              timestamp: new Date(s.timestamp).toISOString(),
              accel_x: 0,
              accel_y: 0,
              accel_z: 0,
              gyro_x: 0,
              gyro_y: 0,
              gyro_z: 0,
              roll: s.roll,
              pitch: s.pitch,
              yaw: s.yaw
            }))
            setFilteredSamples(transformedSamples)
          } else if (dataType === 'smoothedAccel' || dataType === 'smoothedGyro') {
            // Transform smoothed samples
            const transformedSamples: IMUSample[] = responseData.samples.map((s: any) => ({
              timestamp: new Date(s.timestamp).toISOString(),
              accel_x: s.accel.x,
              accel_y: s.accel.y,
              accel_z: s.accel.z,
              gyro_x: s.gyro.x,
              gyro_y: s.gyro.y,
              gyro_z: s.gyro.z,
              roll: null,
              pitch: null,
              yaw: null
            }))
            setSmoothedSamples(transformedSamples)
          } else {
            // Transform regular samples
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
              roll: s.euler?.roll ?? null,
              pitch: s.euler?.pitch ?? null,
              yaw: s.euler?.yaw ?? null
            }))
            setSamples(transformedSamples)
          }
        }
      } catch (error) {
        console.error('Failed to fetch detail data:', error)
      } finally {
        setLoading(false)
      }
    }

    fetchDetailData()
  }, [zoomRange, fileId, dataType])

  // Fetch filtered orientation data when switching to trueOrientation (initial load only)
  useEffect(() => {
    if (dataType !== 'trueOrientation') return
    if (filteredSamples !== null) return // Already loaded
    if (zoomRange !== null) return // Zoom handler will fetch zoomed filtered data

    const fetchFilteredData = async () => {
      setFilteredLoading(true)
      try {
        const supabase = createClient()
        const { data: { session } } = await supabase.auth.getSession()

        if (!session) {
          console.error('No session found for filtered orientation fetch')
          return
        }

        const response = await fetch(`/api/recordings/${fileId}/samples/filtered`, {
          headers: {
            'Authorization': `Bearer ${session.access_token}`
          }
        })
        const responseData = await response.json()

        if (responseData.samples && responseData.samples.length > 0) {
          // Transform filtered samples to match IMUSample format
          const transformedSamples: IMUSample[] = responseData.samples.map((s: any) => ({
            timestamp: new Date(s.timestamp).toISOString(),
            // Keep original accel/gyro data from main samples
            accel_x: 0,
            accel_y: 0,
            accel_z: 0,
            gyro_x: 0,
            gyro_y: 0,
            gyro_z: 0,
            // Filtered orientation
            roll: s.roll,
            pitch: s.pitch,
            yaw: s.yaw
          }))
          setFilteredSamples(transformedSamples)
        }
      } catch (error) {
        console.error('Failed to fetch filtered orientation:', error)
      } finally {
        setFilteredLoading(false)
      }
    }

    fetchFilteredData()
  }, [dataType, fileId, filteredSamples, zoomRange])

  // Fetch smoothed sensor data when switching to smoothed tabs (initial load only)
  useEffect(() => {
    if (dataType !== 'smoothedAccel' && dataType !== 'smoothedGyro') return
    if (smoothedSamples !== null) return // Already loaded
    if (zoomRange !== null) return // Zoom handler will fetch zoomed data

    const fetchSmoothedData = async () => {
      setSmoothedLoading(true)
      try {
        const supabase = createClient()
        const { data: { session } } = await supabase.auth.getSession()

        if (!session) {
          console.error('No session found for smoothed data fetch')
          return
        }

        const response = await fetch(`/api/recordings/${fileId}/samples/smoothed`, {
          headers: {
            'Authorization': `Bearer ${session.access_token}`
          }
        })
        const responseData = await response.json()

        if (responseData.samples && responseData.samples.length > 0) {
          // Transform smoothed samples to match IMUSample format
          const transformedSamples: IMUSample[] = responseData.samples.map((s: any) => ({
            timestamp: new Date(s.timestamp).toISOString(),
            accel_x: s.accel.x,
            accel_y: s.accel.y,
            accel_z: s.accel.z,
            gyro_x: s.gyro.x,
            gyro_y: s.gyro.y,
            gyro_z: s.gyro.z,
            roll: null,
            pitch: null,
            yaw: null
          }))
          setSmoothedSamples(transformedSamples)
        }
      } catch (error) {
        console.error('Failed to fetch smoothed data:', error)
      } finally {
        setSmoothedLoading(false)
      }
    }

    fetchSmoothedData()
  }, [dataType, fileId, smoothedSamples, zoomRange])

  // Track dataType changes but KEEP zoom persistent across tabs!
  useEffect(() => {
    if (prevDataTypeRef.current !== dataType) {
      prevDataTypeRef.current = dataType

      // Only reset to initial samples if NOT zoomed
      if (!zoomRange) {
        setSamples(initialSamples)
      }
      // If zoomed, keep current samples (or refetch will happen via zoomRange dependency)
    }
  }, [dataType, initialSamples, zoomRange])

  // Create/update chart when samples or dataType change
  useEffect(() => {
    if (!chartRef.current) return

    // Determine which data source we need for the current chart type
    const getActiveDataSource = () => {
      if (dataType === 'trueOrientation') {
        return filteredSamples
      }
      if (dataType === 'smoothedAccel' || dataType === 'smoothedGyro') {
        return smoothedSamples
      }
      return samples
    }

    const activeData = getActiveDataSource()

    // Wait for data to be available
    if (!activeData || activeData.length === 0) {
      return // Don't render yet, data is still loading
    }

    // Detect gaps in timestamps and insert null markers
    // Only mark gaps that are significantly larger than expected sample spacing
    // For downsampled data, we need a much larger threshold to avoid false positives
    // Calculate expected sample spacing based on data span
    const firstTime = new Date(activeData[0].timestamp).getTime()
    const lastTime = new Date(activeData[activeData.length - 1].timestamp).getTime()
    const totalDuration = lastTime - firstTime
    const expectedSampleSpacing = totalDuration / activeData.length
    // Use 10x the expected spacing as threshold - only mark real gaps
    const GAP_THRESHOLD_MS = Math.max(5000, expectedSampleSpacing * 10)

    const samplesWithGaps: (IMUSample | null)[] = []

    for (let i = 0; i < activeData.length; i++) {
      samplesWithGaps.push(activeData[i])

      if (i < activeData.length - 1) {
        const currentTime = new Date(activeData[i].timestamp).getTime()
        const nextTime = new Date(activeData[i + 1].timestamp).getTime()
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
      case 'trueOrientation':
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
      case 'smoothedAccel':
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
      case 'smoothedGyro':
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


    // Get computed colors for theme support
    const foregroundColor = getComputedStyle(chartRef.current).getPropertyValue('--foreground').trim()
    const borderColor = getComputedStyle(chartRef.current).getPropertyValue('--border').trim()

    // Plugin to draw vertical highlight line
    const highlightPlugin: uPlot.Plugin = {
      hooks: {
        draw: [
          (u) => {
            const ht = highlightTimeRef.current
            if (ht === null || ht === undefined) return

            const ctx = u.ctx
            const data = u.data
            if (!data || !data[0] || data[0].length === 0) return

            const timestamps = data[0] as number[]

            // Find closest timestamp
            let closestIdx = 0
            let minDiff = Math.abs(timestamps[0] - ht)
            for (let i = 1; i < timestamps.length; i++) {
              const diff = Math.abs(timestamps[i] - ht)
              if (diff < minDiff) {
                minDiff = diff
                closestIdx = i
              } else {
                break
              }
            }

            // Get pixel position
            const x = Math.round(u.valToPos(timestamps[closestIdx], 'x', true))

            // Draw vertical line
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
      height: 400,
      plugins: [highlightPlugin],
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

              // Convert Unix seconds to ISO string
              const startTime = new Date(startTimeUnix * 1000).toISOString()
              const endTime = new Date(endTimeUnix * 1000).toISOString()

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
  }, [samples, dataType, zoomRange, filteredSamples, smoothedSamples])
  
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

  // Trigger redraw when highlightTime changes (only when actually set, not on mount with null)
  useEffect(() => {
    if (uplotRef.current && highlightTime !== null && highlightTime !== undefined) {
      // Use RAF to batch redraws across multiple charts
      requestAnimationFrame(() => {
        if (uplotRef.current) {
          const currentData = uplotRef.current.data
          uplotRef.current.setData(currentData)
        }
      })
    }
  }, [highlightTime])

  // Calculate stats
  const calculateStats = () => {
    let values: { [key: string]: number[] } = {}

    // Use filtered samples for trueOrientation
    const activeSamples = dataType === 'trueOrientation' && filteredSamples !== null
      ? filteredSamples
      : samples

    switch (dataType) {
      case 'orientation':
      case 'trueOrientation':
        values = {
          'Roll': activeSamples.map(s => s.roll ?? 0),
          'Pitch': activeSamples.map(s => s.pitch ?? 0),
          'Yaw': activeSamples.map(s => s.yaw ?? 0)
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
      case 'trueOrientation': return '°'
      case 'accel': return 'm/s²'
      case 'smoothedAccel': return 'm/s²'
      case 'gyro': return 'deg/s'
      case 'smoothedGyro': return 'rad/s'
      // Magnetometer removed
    }
  }

  const getTitle = () => {
    switch (dataType) {
      case 'orientation': return 'Orientation (BNO055)'
      case 'trueOrientation': return 'True* Orientation (Bicycle Filter)'
      case 'accel': return 'Accelerometer'
      case 'smoothedAccel': return 'Smoothed Accelerometer (0.1Hz EMA)'
      case 'gyro': return 'Gyroscope'
      case 'smoothedGyro': return 'Smoothed Gyroscope (2Hz EMA)'
      // Magnetometer removed
    }
  }

  return (
    <div className="space-y-6">
      {/* Selector */}
      <div className="flex gap-2 items-center">
        {hasOrientationData && (
          <>
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
            <button
              onClick={() => setDataType('trueOrientation')}
              className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                dataType === 'trueOrientation'
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground hover:bg-muted/80'
              }`}
              disabled={filteredLoading}
            >
              True* Orientation
              {filteredLoading && <span className="ml-1 text-xs">...</span>}
            </button>
          </>
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
        <button
          onClick={() => setDataType('smoothedAccel')}
          className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
            dataType === 'smoothedAccel'
              ? 'bg-primary text-primary-foreground'
              : 'bg-muted text-muted-foreground hover:bg-muted/80'
          }`}
          disabled={smoothedLoading}
        >
          Smoothed Accel
          {smoothedLoading && <span className="ml-1 text-xs">...</span>}
        </button>
        <button
          onClick={() => setDataType('smoothedGyro')}
          className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
            dataType === 'smoothedGyro'
              ? 'bg-primary text-primary-foreground'
              : 'bg-muted text-muted-foreground hover:bg-muted/80'
          }`}
          disabled={smoothedLoading}
        >
          Smoothed Gyro
          {smoothedLoading && <span className="ml-1 text-xs">...</span>}
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
              // Also reset filtered and smoothed samples so they refetch full dataset
              setFilteredSamples(null)
              setSmoothedSamples(null)
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
        {stats.map(({ axis, min, max, mean }) => {
          // Determine color based on data type and axis
          let color = 'hsl(0, 70%, 50%)' // Default red
          if (dataType === 'orientation' || dataType === 'trueOrientation') {
            // Match orientation chart colors
            if (axis === 'Roll') color = 'hsl(220, 70%, 50%)' // Blue
            else if (axis === 'Pitch') color = 'hsl(145, 60%, 45%)' // Green
            else if (axis === 'Yaw') color = 'hsl(10, 70%, 50%)' // Red
          } else {
            // Match accel/gyro chart colors
            if (axis === 'X') color = 'hsl(10, 49.20%, 52.90%)'
            else if (axis === 'Y') color = 'hsl(145, 49.60%, 54.10%)'
            else if (axis === 'Z') color = 'hsl(205, 59.70%, 70.80%)'
          }

          return (
            <div key={axis} className="p-4 bg-muted rounded-lg border border-border">
              <div className="flex items-center gap-2 mb-2">
                <div
                  className="w-3 h-3 rounded-full"
                  style={{ backgroundColor: color }}
                />
                <span className="font-medium text-foreground">
                  {(dataType === 'orientation' || dataType === 'trueOrientation') ? axis : `${axis}-axis`}
                </span>
              </div>
              <div className="space-y-1 text-xs text-muted-foreground font-mono">
                <div>Min: {min.toFixed(3)} {getUnit()}</div>
                <div>Max: {max.toFixed(3)} {getUnit()}</div>
                <div>Mean: {mean.toFixed(3)} {getUnit()}</div>
              </div>
            </div>
          )
        })}
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

