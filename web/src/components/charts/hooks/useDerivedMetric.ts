import { useState, useEffect, useRef } from 'react'
import { useAuthFetch } from '@/hooks/useAuthFetch'
import { apiCache } from '@/lib/cache/api-cache'

export type DerivedMetricType = 'pedalingEfficiency' | 'ridingPosition' // | 'corneringScore' | 'jumpHeight' (future)

export interface DerivedMetricSample {
  timestamp: string
  value: number
  [key: string]: any // Allow metric-specific fields
}

export interface UseDerivedMetricOptions {
  rideId: string
  metric: DerivedMetricType
  timeRange?: { start: string; end: string } | null
  fitRecordingId?: string | null
  resolution?: number // Samples per second (e.g. 1 for GPS frequency)
  enabled?: boolean // Whether to fetch data (default: true)
}

export interface UseDerivedMetricResult {
  samples: DerivedMetricSample[]
  loading: boolean
  error: string | null
  metadata: PedalingEfficiencyMetadata | RidingPositionMetadata | null
}

// API Response types
interface PedalingEfficiencyMetadata {
  avgStability: number | null
  avgStabilityPercent: number | null
  stablePercent: number
  unstablePercent: number
  pedalingPercent: number
  avgCadence: number | null
  totalSamples: number
  pedalingSamples: number
  hasGrade: boolean
  sampleRate: number | null
}

interface RidingPositionMetadata {
  standingPercent: number
  seatedPercent: number
  totalSamples: number
  pedalingSamples: number
  avgCadenceStanding: number | null
  avgCadenceSeated: number | null
  sampleRate: number | null
}

interface ApiResponse {
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'not_started'
  samples?: any[]
  metadata?: PedalingEfficiencyMetadata | RidingPositionMetadata
  message?: string
  error?: string
  computedAt?: string
  algorithmVersion?: string
  parameters?: any
}

/**
 * Hook to fetch and manage derived/computed metrics
 * Handles: API calls, re-computation on zoom, metric-specific logic
 */
export function useDerivedMetric({
  rideId,
  metric,
  timeRange,
  fitRecordingId,
  resolution,
  enabled = true
}: UseDerivedMetricOptions): UseDerivedMetricResult {
  const [samples, setSamples] = useState<DerivedMetricSample[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [metadata, setMetadata] = useState<any | null>(null)
  const { authFetch } = useAuthFetch()
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null)

  useEffect(() => {
    // Don't fetch if disabled — but preserve existing data for cache-hit on re-enable
    if (!enabled) {
      setLoading(false)
      return
    }

    // Clear any existing polling from previous effect run
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current)
      pollingIntervalRef.current = null
    }

    const fetchMetric = async () => {
      setLoading(true)
      setError(null)

      try {
        // Build URL based on metric type
        let url: string
        switch (metric) {
          case 'pedalingEfficiency':
            if (!fitRecordingId) {
              throw new Error('Pedaling efficiency requires GPS data from FIT file')
            }

            const effParams = new URLSearchParams()
            // If zoomed, fetch only the selected range (server determines resolution)
            if (timeRange) {
              effParams.set('start', timeRange.start)
              effParams.set('end', timeRange.end)
            }
            // If custom resolution specified (for map at GPS frequency)
            if (resolution !== undefined) {
              effParams.set('resolution', resolution.toString())
            }

            url = `/api/rides/${rideId}/pedaling-efficiency${effParams.toString() ? `?${effParams}` : ''}`
            break

          case 'ridingPosition':
            if (!fitRecordingId) {
              throw new Error('Riding position requires GPS data from FIT file')
            }

            const posParams = new URLSearchParams()
            // If zoomed, fetch only the selected range
            if (timeRange) {
              posParams.set('start', timeRange.start)
              posParams.set('end', timeRange.end)
            }
            // Position data is already at 1 Hz, but support custom resolution
            if (resolution !== undefined) {
              posParams.set('resolution', resolution.toString())
            }

            url = `/api/rides/${rideId}/riding-position${posParams.toString() ? `?${posParams}` : ''}`
            break

          default:
            throw new Error(`Unknown metric: ${metric}`)
        }

        // Use API cache for GET requests
        const result = await apiCache.getOrFetch(url, async () => {
          const response = await authFetch(url)
          const data: ApiResponse = await response.json()

          // Handle new API response format with processing states
          // not_started means the analysis job hasn't been triggered yet (e.g. user just landed on the ride page
          // after upload). Treat it the same as pending/processing — poll until it's ready.
          if (data.status === 'pending' || data.status === 'processing' || data.status === 'not_started') {
            const pollingError = new Error('POLLING_REQUIRED')
            ;(pollingError as any).status = data.status
            throw pollingError
          }

          if (data.status === 'failed') {
            throw new Error(data.error || data.message || 'Analysis failed')
          }

          if (!response.ok) {
            throw new Error(data.error || `Failed to fetch ${metric}`)
          }

          return data
        })

        const metricSamples = result.samples || []
        const metricMetadata = result.metadata || null

        // Transform to common format
        const transformed = metricSamples.map((s: any) => {
          let value: number | null = null

          if (metric === 'pedalingEfficiency') {
            value = s.stabilityPercent ?? (s.stability !== null && s.stability !== undefined ? s.stability * 100 : null)
          } else if (metric === 'ridingPosition') {
            value = s.position === 'standing' ? 1 : s.position === 'seated' ? 0 : null
          }

          return {
            timestamp: s.timestamp,
            value,
            ...s
          }
        })

        setSamples(transformed)
        setMetadata(metricMetadata)
        setLoading(false)

        // Stop polling if we got results
        if (pollingIntervalRef.current) {
          clearInterval(pollingIntervalRef.current)
          pollingIntervalRef.current = null
        }
      } catch (err: any) {
        // Handle polling case
        if (err.message === 'POLLING_REQUIRED') {
          setSamples([])
          setMetadata(null)
          setLoading(true)

          // Start polling every 3 seconds if not already polling
          if (!pollingIntervalRef.current) {
            pollingIntervalRef.current = setInterval(() => {
              fetchMetric()
            }, 3000)
          }
          return
        }

        console.error(`Failed to fetch ${metric}:`, err)
        setError(err.message)

        // Stop polling on error
        if (pollingIntervalRef.current) {
          clearInterval(pollingIntervalRef.current)
          pollingIntervalRef.current = null
        }
        setLoading(false)
      }
    }

    fetchMetric()

    // Cleanup polling on unmount or dependency change
    return () => {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current)
        pollingIntervalRef.current = null
      }
    }
  }, [rideId, metric, timeRange, fitRecordingId, resolution, enabled, authFetch])

  return { samples, loading, error, metadata }
}
