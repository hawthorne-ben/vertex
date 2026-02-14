import { useState, useEffect } from 'react'
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
  avgEfficiency: number | null
  avgEfficiencyPercent: number | null
  smoothPercent: number
  roughPercent: number
  pedalingPercent: number
  avgConfidence: number
  avgDetectedCadence: number | null
  totalSamples: number
  pedalingSamples: number
  hasCadence: boolean
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
  avgConfidence: number
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

  useEffect(() => {
    // Don't fetch if disabled
    if (!enabled) {
      setSamples([])
      setMetadata(null)
      setError(null)
      setLoading(false)
      return
    }

    let pollingInterval: NodeJS.Timeout | null = null

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
            // Otherwise fetch full ride (server auto-downsamples to ~1000 points)

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
          if (data.status === 'pending' || data.status === 'processing') {
            // Analysis is still being computed - don't cache, start polling
            // Throw special error to trigger polling
            const pollingError = new Error('POLLING_REQUIRED')
            ;(pollingError as any).status = data.status
            throw pollingError
          }

          if (data.status === 'failed') {
            throw new Error(data.error || data.message || 'Analysis failed')
          }

          if (data.status === 'not_started') {
            throw new Error(data.message || 'Analysis not yet started')
          }

          if (!response.ok) {
            throw new Error(data.error || `Failed to fetch ${metric}`)
          }

          return data
        })

        const metricSamples = result.samples || []
        const metricMetadata = result.metadata || null

        // Transform to common format
        // Server handles time range filtering and downsampling
        const transformed = metricSamples.map((s: any) => {
          let value: number | null = null

          // Extract numeric value based on metric type
          if (metric === 'pedalingEfficiency') {
            value = s.efficiencyPercent ?? (s.efficiency !== null && s.efficiency !== undefined ? s.efficiency * 100 : null)
          } else if (metric === 'ridingPosition') {
            // For position, value is categorical (standing=1, seated=0, null=null)
            // This allows for basic charting, but position should primarily use bar chart
            value = s.position === 'standing' ? 1 : s.position === 'seated' ? 0 : null
          }

          return {
            timestamp: s.timestamp,
            value,
            ...s // Keep all original fields
          }
        })

        setSamples(transformed)
        setMetadata(metricMetadata)
        setLoading(false)

        // Stop polling if we got results
        if (pollingInterval) {
          clearInterval(pollingInterval)
          pollingInterval = null
        }
      } catch (err: any) {
        // Handle polling case
        if (err.message === 'POLLING_REQUIRED') {
          setSamples([])
          setMetadata(null)
          setLoading(true) // Keep loading indicator showing

          // Start polling every 3 seconds if not already polling
          if (!pollingInterval) {
            pollingInterval = setInterval(() => {
              fetchMetric()
            }, 3000)
          }
          return // Don't set error state
        }

        console.error(`Failed to fetch ${metric}:`, err)
        setError(err.message)

        // Stop polling on error
        if (pollingInterval) {
          clearInterval(pollingInterval)
          pollingInterval = null
        }
        setLoading(false)
      }
    }

    fetchMetric()

    // Cleanup polling on unmount or dependency change
    return () => {
      if (pollingInterval) {
        clearInterval(pollingInterval)
      }
    }
  }, [rideId, metric, timeRange, fitRecordingId, resolution, enabled, authFetch])

  return { samples, loading, error, metadata }
}
