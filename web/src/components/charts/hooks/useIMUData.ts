import { useState, useEffect, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'

export type IMUDataType = 'orientation' | 'accel' | 'gyro' | 'smoothedAccel' | 'smoothedGyro' | 'trueOrientation'

export interface IMUSample {
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
}

export interface VTXRecording {
  id: string
  start_time: string
  end_time: string
}

export interface UseIMUDataOptions {
  recordings: VTXRecording[]  // Changed from recordingIds to include time ranges
  dataType: IMUDataType
  timeRange?: { start: string; end: string } | null
  initialSamples?: IMUSample[]
}

export interface UseIMUDataResult {
  samples: IMUSample[]
  loading: boolean
  error: string | null
  originalCount: number
}

/**
 * Hook to fetch and manage IMU sensor data
 * Handles: VTX file parsing, filtering, smoothing, zoom/time range
 */
export function useIMUData({
  recordings,
  dataType,
  timeRange,
  initialSamples
}: UseIMUDataOptions): UseIMUDataResult {
  const [samples, setSamples] = useState<IMUSample[]>(initialSamples || [])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [originalCount, setOriginalCount] = useState(initialSamples?.length || 0)
  const hasFetchedRef = useRef(false)

  useEffect(() => {
    // If we have initial samples and no time range (not zoomed), use them
    // This optimization only applies on FIRST LOAD (before any fetch)
    // After that, we always fetch to ensure we have the right resolution
    if (initialSamples && !timeRange && !hasFetchedRef.current) {
      setSamples(initialSamples)
      setOriginalCount(initialSamples.length)
      return
    }

    // Otherwise fetch data (for zoom, data type changes, or zoom reset)
    const fetchData = async () => {
      hasFetchedRef.current = true // Mark that we've fetched
      setLoading(true)
      setError(null)

      try {
        const supabase = createClient()
        const { data: { session } } = await supabase.auth.getSession()

        if (!session) {
          throw new Error('No session found')
        }

        const allSamples: IMUSample[] = []

        // Filter recordings to only those that overlap with the time range
        let recordingsToFetch = recordings
        if (timeRange) {
          const rangeStartMs = new Date(timeRange.start).getTime()
          const rangeEndMs = new Date(timeRange.end).getTime()

          recordingsToFetch = recordings.filter(rec => {
            const recStartMs = new Date(rec.start_time).getTime()
            const recEndMs = new Date(rec.end_time).getTime()
            // Check if ranges overlap
            return recStartMs < rangeEndMs && recEndMs > rangeStartMs
          })

          console.log(`Zoom: ${recordings.length} total recordings, ${recordingsToFetch.length} overlap with zoom range`)
        }

        // Fetch all recordings in parallel
        const fetchPromises = recordingsToFetch.map(async (recording) => {
          const params = new URLSearchParams()
          if (timeRange) {
            params.set('start', timeRange.start)
            params.set('end', timeRange.end)
            params.set('resolution', 'high')
          }

          // Choose endpoint based on data type
          let endpoint: string
          if (dataType === 'trueOrientation') {
            endpoint = `/api/recordings/${recording.id}/samples/filtered`
          } else if (dataType === 'smoothedAccel' || dataType === 'smoothedGyro') {
            endpoint = `/api/recordings/${recording.id}/samples/smoothed`
          } else {
            endpoint = `/api/recordings/${recording.id}/samples`
          }

          const url = params.toString() ? `${endpoint}?${params}` : endpoint

          const response = await fetch(url, {
            headers: { 'Authorization': `Bearer ${session.access_token}` }
          })

          if (!response.ok) {
            throw new Error(`Failed to fetch data: ${response.statusText}`)
          }

          const { samples: fetchedSamples, metadata } = await response.json()

          // Transform samples to consistent format
          const transformed = fetchedSamples.map((s: any) => ({
            timestamp: s.timestamp,
            accel_x: s.accel?.x ?? s.accel_x ?? 0,
            accel_y: s.accel?.y ?? s.accel_y ?? 0,
            accel_z: s.accel?.z ?? s.accel_z ?? 0,
            gyro_x: s.gyro?.x ?? s.gyro_x ?? 0,
            gyro_y: s.gyro?.y ?? s.gyro_y ?? 0,
            gyro_z: s.gyro?.z ?? s.gyro_z ?? 0,
            roll: s.euler?.roll ?? s.roll ?? null,
            pitch: s.euler?.pitch ?? s.pitch ?? null,
            yaw: s.euler?.yaw ?? s.yaw ?? null,
          }))

          return {
            samples: transformed,
            totalSamples: metadata?.total_samples || 0
          }
        })

        // Wait for all fetches to complete in parallel
        const results = await Promise.all(fetchPromises)

        // Merge results
        let totalOriginalCount = 0
        for (const result of results) {
          allSamples.push(...result.samples)
          totalOriginalCount += result.totalSamples
        }

        setOriginalCount(totalOriginalCount)

        // Sort by timestamp
        allSamples.sort((a, b) => {
          return new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
        })

        setSamples(allSamples)
      } catch (err: any) {
        console.error('Failed to fetch IMU data:', err)
        setError(err.message)
      } finally {
        setLoading(false)
      }
    }

    fetchData()
  }, [recordings, dataType, timeRange, initialSamples])

  return { samples, loading, error, originalCount }
}
