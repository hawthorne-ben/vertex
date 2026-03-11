import { useState, useEffect, useMemo } from 'react'
import { useAuthFetch } from '@/hooks/useAuthFetch'
import { apiCache } from '@/lib/cache/api-cache'

export type IMUDataType = 'orientation' | 'accel' | 'gyro'

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
  rideId?: string  // Ride ID for fetching merged VTX data
  recordings: VTXRecording[]  // Legacy: for backward compatibility
  dataType: IMUDataType
  timeRange?: { start: string; end: string } | null
  skip?: boolean  // Skip fetching (when data provided externally)
}

export interface UseIMUDataResult {
  samples: IMUSample[]
  loading: boolean
  error: string | null
  originalCount: number
  coverageRanges: Array<{ start: number; end: number }>
}

/**
 * Hook to fetch and manage IMU sensor data
 * Handles: VTX file parsing, filtering, smoothing, zoom/time range
 *
 * If rideId is provided, fetches from ride-level merged VTX endpoint
 * Otherwise falls back to individual recording endpoints (legacy)
 */
export function useIMUData({
  rideId,
  recordings,
  dataType,
  timeRange,
  skip = false
}: UseIMUDataOptions): UseIMUDataResult {
  const [samples, setSamples] = useState<IMUSample[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [originalCount, setOriginalCount] = useState(0)
  const [coverageRanges, setCoverageRanges] = useState<Array<{ start: number; end: number }>>([])
  const { authFetch } = useAuthFetch()

  // Stable recording IDs to prevent unnecessary refetches
  const recordingIds = useMemo(() =>
    recordings.map(r => r.id).sort().join(','),
    [recordings]
  )

  useEffect(() => {
    // Skip fetch if skip flag is set
    if (skip) {
      setLoading(false)
      return
    }

    // Fetch data on mount and when dependencies change
    const fetchData = async () => {
      setLoading(true)
      setError(null)

      try {
        // Use ride-level endpoint if rideId provided (preferred)
        if (rideId) {
          const params = new URLSearchParams()
          params.set('downsample', 'lttb')

          // If zoomed, fetch only the selected range (server determines resolution)
          if (timeRange) {
            params.set('start', timeRange.start)
            params.set('end', timeRange.end)
          }
          // Otherwise fetch full ride (server auto-downsamples to ~1000 points)

          const url = params.toString()
            ? `/api/rides/${rideId}/vtx-samples?${params}`
            : `/api/rides/${rideId}/vtx-samples`

          const { samples: fetchedSamples, metadata, coverage } = await apiCache.getOrFetch(url, async () => {
            const response = await authFetch(url)

            if (!response.ok) {
              throw new Error(`Failed to fetch data: ${response.statusText}`)
            }

            return response.json()
          })

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

          setSamples(transformed)
          setOriginalCount(metadata?.total_samples || transformed.length)
          setCoverageRanges(coverage || [])
        } else {
          // Legacy: Fetch from individual recording endpoints
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
            params.set('downsample', 'lttb')
            params.set('resolution', '2000')
            if (timeRange) {
              params.set('start', timeRange.start)
              params.set('end', timeRange.end)
            }

            const endpoint = `/api/recordings/${recording.id}/samples`

            const url = `${endpoint}?${params}`

            const response = await authFetch(url)

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
            for (const sample of result.samples) {
              allSamples.push(sample)
            }
            totalOriginalCount += result.totalSamples
          }

          // Sort by timestamp for merged results
          allSamples.sort((a, b) => {
            return new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
          })

          setSamples(allSamples)
          setOriginalCount(totalOriginalCount)
        }
      } catch (err: any) {
        console.error('Failed to fetch IMU data:', err)
        setError(err.message)
      } finally {
        setLoading(false)
      }
    }

    fetchData()
    // dataType intentionally excluded — the API returns all sensor types in one response;
    // dataType only affects client-side processing in processIMUChartData.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rideId, recordingIds, timeRange, skip, authFetch])

  return { samples, loading, error, originalCount, coverageRanges }
}
