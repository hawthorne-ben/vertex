'use client'

import { useEffect, useState, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import dynamic from 'next/dynamic'
import { findClosestByTime } from '@/lib/sync/fit-vtx-sync'

// Dynamically import map to avoid SSR issues with Leaflet
const RideMap = dynamic(
  () => import('./ride-map').then(mod => ({ default: mod.RideMap })),
  { ssr: false, loading: () => <div className="h-[400px] bg-muted rounded-lg animate-pulse" /> }
)

interface IMUTimeRange {
  start: number // Unix timestamp in ms
  end: number // Unix timestamp in ms
}

interface RideMapClientProps {
  rideId: string
  fitRecordingId: string | null
  highlightTime?: number | null // Unix timestamp in seconds to highlight
  imuTimeRanges?: IMUTimeRange[] // Time ranges where IMU data exists
}

export function RideMapClient({ rideId, fitRecordingId, highlightTime, imuTimeRanges = [] }: RideMapClientProps) {
  const [gpsTrack, setGpsTrack] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Convert highlightTime to GPS track index (using shared sync library)
  const highlightIndex = useMemo(() => {
    if (highlightTime === null || highlightTime === undefined || gpsTrack.length === 0) {
      return null
    }

    const result = findClosestByTime(gpsTrack, highlightTime)
    return result?.index ?? null
  }, [highlightTime, gpsTrack])

  useEffect(() => {
    async function loadGPS() {
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
          `/api/rides/${rideId}/samples?fields=latitude,longitude,altitude,speed_ms,timestamp`,
          {
            headers: {
              'Authorization': `Bearer ${session.access_token}`
            }
          }
        )

        if (!response.ok) {
          const errorData = await response.json()
          throw new Error(errorData.error || 'Failed to fetch GPS data')
        }

        const { samples } = await response.json()

        const track = samples
          .filter((s: any) => s.latitude && s.longitude)
          .map((s: any) => ({
            lat: s.latitude,
            lon: s.longitude,
            altitude: s.altitude,
            speed: s.speed_ms,
            timestamp: s.timestamp,
            // Pre-calculate converted values for popup efficiency
            speedMph: s.speed_ms ? s.speed_ms * 2.23694 : undefined,
            altitudeFt: s.altitude ? s.altitude * 3.28084 : undefined,
          }))

        setGpsTrack(track)
      } catch (err: any) {
        console.error('Failed to load GPS data:', err)
        setError(err.message)
      } finally {
        setLoading(false)
      }
    }

    loadGPS()
  }, [rideId, fitRecordingId])

  if (loading) {
    return (
      <div className="h-[400px] bg-muted rounded-lg flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="relative">
            <div className="w-12 h-12 border-4 border-muted-foreground/20 rounded-full"></div>
            <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin absolute top-0"></div>
          </div>
          <p className="text-sm text-muted-foreground">Loading route...</p>
        </div>
      </div>
    )
  }

  if (error || gpsTrack.length === 0) {
    return (
      <div className="h-[400px] bg-muted rounded-lg flex items-center justify-center">
        <p className="text-muted-foreground">{error || 'No GPS data available'}</p>
      </div>
    )
  }

  return (
    <RideMap
      gpsTrack={gpsTrack}
      hoverIndex={highlightIndex !== null && highlightIndex !== -1 ? highlightIndex : null}
      className="w-full"
      imuTimeRanges={imuTimeRanges}
    />
  )
}
