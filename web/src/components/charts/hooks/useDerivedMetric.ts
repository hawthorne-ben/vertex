import { useState, useEffect, useRef } from 'react'
import { useAuthFetch } from '@/hooks/useAuthFetch'
import { apiCache } from '@/lib/cache/api-cache'

export type DerivedMetricType = 'pedalingEfficiency' | 'ridingPosition' | 'surfaceRoughness' | 'braking'

// Map client-facing metric type to the analysis_type stored in ride_analysis
// (and returned by /api/rides/[id]/analysis-status).
const METRIC_TO_ANALYSIS_TYPE: Record<DerivedMetricType, string> = {
  pedalingEfficiency: 'pedaling_efficiency',
  ridingPosition: 'riding_position',
  surfaceRoughness: 'surface_roughness',
  braking: 'braking',
}

// Exponential backoff schedule (ms) for polling status while a job is processing.
// First poll fires fast (results often appear within seconds), then backs off so a
// forgotten tab doesn't hammer Supabase. The last value is the steady-state cadence.
const POLL_BACKOFF_MS = [3000, 5000, 8000, 12000, 15000]

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
  polling: boolean  // True only when waiting for inngest job (not normal fetches)
  error: string | null
  metadata: PedalingEfficiencyMetadata | RidingPositionMetadata | SurfaceRoughnessMetadata | BrakingMetadata | null
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

interface SurfaceRoughnessMetadata {
  avgRoughness: number
  maxRoughness: number
  smoothSurfacePercent: number
  roughSurfacePercent: number
  totalSamples: number
  sampleRate: number | null
}

interface BrakingMetadata {
  totalBrakingEvents: number
  totalBrakingSeconds: number
  avgBrakingIntensity: number
  maxBrakingIntensity: number
  maxBrakingDecelerationMs2: number
  brakingPercent: number
  totalSamples: number
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
  const [polling, setPolling] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [metadata, setMetadata] = useState<any | null>(null)
  const { authFetch } = useAuthFetch()
  const pollTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const cancelledRef = useRef(false)

  useEffect(() => {
    // Don't fetch if disabled — preserve existing data for cache-hit on re-enable
    if (!enabled) {
      setLoading(false)
      return
    }

    cancelledRef.current = false

    const clearPollTimer = () => {
      if (pollTimeoutRef.current) {
        clearTimeout(pollTimeoutRef.current)
        pollTimeoutRef.current = null
      }
    }

    clearPollTimer()

    // Build the heavy metric URL once (depends on rideId/metric/timeRange/resolution)
    const buildMetricUrl = (): string => {
      const params = new URLSearchParams()
      if (timeRange) {
        params.set('start', timeRange.start)
        params.set('end', timeRange.end)
      }
      if (resolution !== undefined) {
        params.set('resolution', resolution.toString())
      }
      const qs = params.toString() ? `?${params}` : ''

      switch (metric) {
        case 'pedalingEfficiency':
          if (!fitRecordingId) throw new Error('Pedaling efficiency requires GPS data from FIT file')
          return `/api/rides/${rideId}/pedaling-efficiency${qs}`
        case 'ridingPosition':
          if (!fitRecordingId) throw new Error('Riding position requires GPS data from FIT file')
          return `/api/rides/${rideId}/riding-position${qs}`
        case 'surfaceRoughness':
          if (!fitRecordingId) throw new Error('Surface roughness requires GPS data from FIT file')
          return `/api/rides/${rideId}/surface-roughness${qs}`
        case 'braking':
          if (!fitRecordingId) throw new Error('Braking analysis requires GPS data from FIT file')
          return `/api/rides/${rideId}/braking${qs}`
        default:
          throw new Error(`Unknown metric: ${metric}`)
      }
    }

    const transformResult = (result: ApiResponse) => {
      const metricSamples = result.samples || []
      const metricMetadata = result.metadata || null

      const transformed = metricSamples.map((s: any) => {
        let value: number | null = null

        if (metric === 'pedalingEfficiency') {
          value = s.stabilityPercent ?? (s.stability !== null && s.stability !== undefined ? s.stability * 100 : null)
        } else if (metric === 'ridingPosition') {
          value = s.position === 'standing' ? 1 : s.position === 'seated' ? 0 : null
        } else if (metric === 'surfaceRoughness') {
          value = s.roughness !== null && s.roughness !== undefined ? s.roughness * 100 : null
        } else if (metric === 'braking') {
          value = s.brakingIntensity ?? null
        }

        return {
          timestamp: s.timestamp,
          value,
          ...s,
        }
      })

      if (cancelledRef.current) return
      setSamples(transformed)
      setMetadata(metricMetadata)
      setLoading(false)
      setPolling(false)
    }

    // Hit the heavy per-metric endpoint. Returns the parsed body, or throws
    // POLLING_REQUIRED when the analysis isn't completed yet.
    const fetchHeavy = async (url: string): Promise<ApiResponse> => {
      return apiCache.getOrFetch(url, async () => {
        const response = await authFetch(url)
        const data: ApiResponse = await response.json()

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
    }

    // Poll the cheap cross-metric status endpoint until *this* metric reports
    // completed (or failed). Uses exponential backoff so a forgotten tab
    // doesn't hammer Supabase indefinitely.
    const pollStatus = (attempt: number, url: string) => {
      if (cancelledRef.current) return

      const delay = POLL_BACKOFF_MS[Math.min(attempt, POLL_BACKOFF_MS.length - 1)]

      pollTimeoutRef.current = setTimeout(async () => {
        if (cancelledRef.current) return

        try {
          const statusUrl = `/api/rides/${rideId}/analysis-status`
          const response = await authFetch(statusUrl)
          if (!response.ok) {
            // Transient — keep polling.
            pollStatus(attempt + 1, url)
            return
          }

          const body = await response.json() as {
            statuses: Record<string, { status: string; errorMessage: string | null }>
          }

          const analysisType = METRIC_TO_ANALYSIS_TYPE[metric]
          const entry = body.statuses?.[analysisType]
          const s = entry?.status

          if (s === 'completed') {
            // Status flipped — invalidate any 202 we may have cached for the
            // heavy URL and fetch the real samples once.
            apiCache.invalidate(url)
            try {
              const result = await fetchHeavy(url)
              transformResult(result)
            } catch (err: any) {
              if (err.message === 'POLLING_REQUIRED') {
                // Race: status said completed but the route disagreed.
                // Resume polling.
                pollStatus(attempt + 1, url)
                return
              }
              if (cancelledRef.current) return
              setError(err.message)
              setLoading(false)
              setPolling(false)
            }
            return
          }

          if (s === 'failed') {
            if (cancelledRef.current) return
            setError(entry?.errorMessage || 'Analysis failed')
            setLoading(false)
            setPolling(false)
            return
          }

          // Still pending/processing/not_started — keep polling with backoff.
          pollStatus(attempt + 1, url)
        } catch {
          // Network blip — keep polling.
          pollStatus(attempt + 1, url)
        }
      }, delay)
    }

    const start = async () => {
      setLoading(true)
      setError(null)

      let url: string
      try {
        url = buildMetricUrl()
      } catch (err: any) {
        if (cancelledRef.current) return
        setError(err.message)
        setLoading(false)
        return
      }

      try {
        const result = await fetchHeavy(url)
        transformResult(result)
      } catch (err: any) {
        if (err.message === 'POLLING_REQUIRED') {
          if (cancelledRef.current) return
          setSamples([])
          setMetadata(null)
          setLoading(true)
          setPolling(true)
          // Begin polling the cheap status endpoint with exponential backoff.
          pollStatus(0, url)
          return
        }

        if (cancelledRef.current) return
        console.error(`Failed to fetch ${metric}:`, err)
        setError(err.message)
        setLoading(false)
        setPolling(false)
      }
    }

    start()

    return () => {
      cancelledRef.current = true
      clearPollTimer()
    }
  }, [rideId, metric, timeRange, fitRecordingId, resolution, enabled, authFetch])

  return { samples, loading, polling, error, metadata }
}
