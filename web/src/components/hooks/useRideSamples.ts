import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'

export interface RideSample {
  timestamp: string
  latitude?: number | null
  longitude?: number | null
  altitude?: number | null
  speed_ms?: number | null
  power_watts?: number | null
  heart_rate?: number | null
  cadence?: number | null
  temperature?: number | null
  grade?: number | null
}

export interface UseRideSamplesResult {
  samples: RideSample[]
  loading: boolean
  error: string | null
}

/**
 * Shared hook to fetch ride samples from FIT data
 * Prevents duplicate API calls when multiple components need the same data
 */
export function useRideSamples(rideId: string, fitRecordingId: string | null): UseRideSamplesResult {
  const [samples, setSamples] = useState<RideSample[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function loadSamples() {
      if (!fitRecordingId) {
        setError('No FIT file associated with this ride')
        setLoading(false)
        return
      }

      try {
        const supabase = createClient()
        const { data: { session } } = await supabase.auth.getSession()

        if (!session) {
          setError('Not authenticated')
          setLoading(false)
          return
        }

        const response = await fetch(
          `/api/rides/${rideId}/samples`,
          {
            headers: {
              'Authorization': `Bearer ${session.access_token}`
            }
          }
        )

        if (!response.ok) {
          const errorData = await response.json()
          throw new Error(errorData.error || 'Failed to fetch ride data')
        }

        const { samples: sampleData } = await response.json()
        setSamples(sampleData)
      } catch (err: any) {
        console.error('Failed to load ride data:', err)
        setError(err.message)
      } finally {
        setLoading(false)
      }
    }

    loadSamples()
  }, [rideId, fitRecordingId])

  return { samples, loading, error }
}
