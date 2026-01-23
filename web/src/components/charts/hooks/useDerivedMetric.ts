import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'

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
}

export interface UseDerivedMetricResult {
  samples: DerivedMetricSample[]
  loading: boolean
  error: string | null
  metadata: any | null
}

/**
 * Hook to fetch and manage derived/computed metrics
 * Handles: API calls, re-computation on zoom, metric-specific logic
 */
export function useDerivedMetric({
  rideId,
  metric,
  timeRange,
  fitRecordingId
}: UseDerivedMetricOptions): UseDerivedMetricResult {
  const [samples, setSamples] = useState<DerivedMetricSample[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [metadata, setMetadata] = useState<any | null>(null)

  useEffect(() => {
    const fetchMetric = async () => {
      setLoading(true)
      setError(null)

      try {
        const supabase = createClient()
        const { data: { session } } = await supabase.auth.getSession()

        if (!session) {
          throw new Error('Not authenticated')
        }

        // Build URL based on metric type
        let url: string
        switch (metric) {
          case 'pedalingEfficiency':
            if (!fitRecordingId) {
              throw new Error('Pedaling efficiency requires GPS data from FIT file')
            }
            url = `/api/rides/${rideId}/pedaling-efficiency`
            if (timeRange) {
              const params = new URLSearchParams({
                start: timeRange.start,
                end: timeRange.end
              })
              url += `?${params}`
            }
            break
          default:
            throw new Error(`Unknown metric: ${metric}`)
        }

        const response = await fetch(url, {
          headers: { 'Authorization': `Bearer ${session.access_token}` }
        })

        if (!response.ok) {
          const errorData = await response.json()
          throw new Error(errorData.error || `Failed to fetch ${metric}`)
        }

        const { samples: metricSamples, metadata: metricMetadata } = await response.json()

        // Transform to common format
        const transformed = metricSamples.map((s: any) => ({
          timestamp: s.timestamp,
          value: s.efficiencyPercent ?? s.value, // Normalize to 'value' field
          ...s // Keep all original fields
        }))

        setSamples(transformed)
        setMetadata(metricMetadata)
      } catch (err: any) {
        console.error(`Failed to fetch ${metric}:`, err)
        setError(err.message)
      } finally {
        setLoading(false)
      }
    }

    fetchMetric()
  }, [rideId, metric, timeRange, fitRecordingId])

  return { samples, loading, error, metadata }
}
