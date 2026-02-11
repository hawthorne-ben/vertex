import { useState, useEffect } from 'react'
import { useAuthFetch } from '@/hooks/useAuthFetch'

export type DerivedMetricType = 'pedalingEfficiency' // | 'corneringScore' | 'jumpHeight' (future)

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
}

export interface UseDerivedMetricResult {
  samples: DerivedMetricSample[]
  loading: boolean
  error: string | null
  metadata: PedalingEfficiencyMetadata | null
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

interface ApiResponse {
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'not_started'
  samples?: any[]
  metadata?: PedalingEfficiencyMetadata
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
  resolution
}: UseDerivedMetricOptions): UseDerivedMetricResult {
  const [samples, setSamples] = useState<DerivedMetricSample[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [metadata, setMetadata] = useState<any | null>(null)
  const { authFetch } = useAuthFetch()

  useEffect(() => {
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

            const params = new URLSearchParams()
            // If zoomed, fetch only the selected range (server determines resolution)
            if (timeRange) {
              params.set('start', timeRange.start)
              params.set('end', timeRange.end)
            }
            // If custom resolution specified (for map at GPS frequency)
            if (resolution !== undefined) {
              params.set('resolution', resolution.toString())
            }
            // Otherwise fetch full ride (server auto-downsamples to ~1000 points)

            url = `/api/rides/${rideId}/pedaling-efficiency${params.toString() ? `?${params}` : ''}`
            break
          default:
            throw new Error(`Unknown metric: ${metric}`)
        }

        const response = await authFetch(url)

        const data: ApiResponse = await response.json()

        // Handle new API response format with processing states
        if (data.status === 'pending' || data.status === 'processing') {
          // Analysis is still being computed - start polling
          // Don't set error, just leave loading state
          setSamples([])
          setMetadata(null)
          setLoading(true) // Keep loading indicator showing

          // Start polling every 3 seconds if not already polling
          if (!pollingInterval) {
            pollingInterval = setInterval(() => {
              fetchMetric()
            }, 3000)
          }
          return
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

        const metricSamples = data.samples || []
        const metricMetadata = data.metadata || null

        // Transform to common format
        // Server handles time range filtering and downsampling
        const transformed = metricSamples.map((s: any) => ({
          timestamp: s.timestamp,
          value: s.efficiencyPercent ?? (s.efficiency !== null && s.efficiency !== undefined ? s.efficiency * 100 : null), // Normalize to 'value' field as percentage
          ...s // Keep all original fields
        }))

        setSamples(transformed)
        setMetadata(metricMetadata)

        // Stop polling if we got results
        if (pollingInterval) {
          clearInterval(pollingInterval)
          pollingInterval = null
        }
      } catch (err: any) {
        console.error(`Failed to fetch ${metric}:`, err)
        setError(err.message)

        // Stop polling on error
        if (pollingInterval) {
          clearInterval(pollingInterval)
          pollingInterval = null
        }
      } finally {
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
  }, [rideId, metric, timeRange, fitRecordingId, resolution, authFetch])

  return { samples, loading, error, metadata }
}
