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
    let pollingInterval: NodeJS.Timeout | null = null

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

        const data = await response.json()

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
        let transformed = metricSamples.map((s: any) => ({
          timestamp: s.timestamp,
          value: s.efficiencyPercent ?? s.value, // Normalize to 'value' field
          ...s // Keep all original fields
        }))

        // Client-side time range filtering (API returns full cached dataset)
        if (timeRange) {
          const startTime = new Date(timeRange.start).getTime()
          const endTime = new Date(timeRange.end).getTime()
          transformed = transformed.filter((s: any) => {
            const sampleTime = new Date(s.timestamp).getTime()
            return sampleTime >= startTime && sampleTime <= endTime
          })
        }

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
  }, [rideId, metric, timeRange, fitRecordingId])

  return { samples, loading, error, metadata }
}
