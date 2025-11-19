'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import dynamic from 'next/dynamic'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'

// Dynamically import charts to avoid SSR issues
const SingleMetricChart = dynamic(
  () => import('./single-metric-chart').then(mod => ({ default: mod.SingleMetricChart })),
  { ssr: false, loading: () => <div className="h-[200px] bg-muted rounded-lg animate-pulse" /> }
)

const ElevationProfile = dynamic(
  () => import('./elevation-profile').then(mod => ({ default: mod.ElevationProfile })),
  { ssr: false, loading: () => <div className="h-[250px] bg-muted rounded-lg animate-pulse" /> }
)

const RideMap = dynamic(
  () => import('./ride-map').then(mod => ({ default: mod.RideMap })),
  { ssr: false, loading: () => <div className="h-[400px] bg-muted rounded-lg animate-pulse" /> }
)

interface RideChartsClientProps {
  rideId: string
  fitRecordingId: string | null
  showMap?: boolean
  onElevationUpdate?: (elevationMeters: number) => void
}

interface Sample {
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

export function RideChartsClient({ rideId, fitRecordingId, showMap = false, onElevationUpdate }: RideChartsClientProps) {
  const [samples, setSamples] = useState<Sample[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [hoverIndex, setHoverIndex] = useState<number | null>(null)

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

  if (loading) {
    return (
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Performance Data</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[400px] bg-muted rounded-lg animate-pulse flex items-center justify-center">
              <div className="flex flex-col items-center gap-3">
                <div className="relative">
                  <div className="w-12 h-12 border-4 border-muted-foreground/20 rounded-full"></div>
                  <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin absolute top-0"></div>
                </div>
                <p className="text-sm text-muted-foreground">Loading performance data...</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (error || samples.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Performance Data</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-[400px] bg-muted rounded-lg flex items-center justify-center">
            <p className="text-muted-foreground">{error || 'No performance data available'}</p>
          </div>
        </CardContent>
      </Card>
    )
  }

  // Check what data we have
  const hasPower = samples.some(s => s.power_watts !== null)
  const hasHR = samples.some(s => s.heart_rate !== null)
  const hasCadence = samples.some(s => s.cadence !== null)
  const hasSpeed = samples.some(s => s.speed_ms !== null)
  const hasElevation = samples.some(s => s.altitude !== null)
  const hasGpsData = samples.some(s => s.latitude !== null && s.longitude !== null)

  // Prepare data for individual charts
  const powerData = samples.map(s => ({ timestamp: s.timestamp, value: s.power_watts ?? null }))
  const hrData = samples.map(s => ({ timestamp: s.timestamp, value: s.heart_rate ?? null }))
  const cadenceData = samples.map(s => ({ timestamp: s.timestamp, value: s.cadence ?? null }))
  const speedData = samples.map(s => ({ timestamp: s.timestamp, value: s.speed_ms ? s.speed_ms * 2.23694 : null })) // m/s to mph

  // Prepare GPS track for map
  const gpsTrack = samples
    .filter(s => s.latitude !== null && s.longitude !== null)
    .map(s => ({
      lat: s.latitude!,
      lon: s.longitude!,
      altitude: s.altitude,
      speed: s.speed_ms,
      timestamp: s.timestamp,
    }))

  const hasAnyData = hasPower || hasHR || hasCadence || hasSpeed || hasElevation

  if (!hasAnyData) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Performance Data</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-[400px] bg-muted rounded-lg flex items-center justify-center">
            <p className="text-muted-foreground">No performance data available</p>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-6">

      {/* GPS Map (if enabled and data available) */}
      {showMap && hasGpsData && (
        <Card>
          <CardHeader>
            <CardTitle>Route Map</CardTitle>
          </CardHeader>
          <CardContent>
            <RideMap
              gpsTrack={gpsTrack}
              hoverIndex={hoverIndex}
              onPointClick={(index) => {
                // Future: sync to charts
              }}
              colorBy="speed"
              className="w-full"
            />
          </CardContent>
        </Card>
      )}

      {/* Performance Charts Grid - 2 per row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Power Chart */}
        {hasPower && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Power</CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <SingleMetricChart
                samples={powerData}
                label="Power"
                unit="W"
                color="#ef4444"
                onHover={setHoverIndex}
                syncKey="ride-sync"
                className="w-full"
              />
            </CardContent>
          </Card>
        )}

        {/* Heart Rate Chart */}
        {hasHR && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Heart Rate</CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <SingleMetricChart
                samples={hrData}
                label="Heart Rate"
                unit="bpm"
                color="#ec4899"
                onHover={setHoverIndex}
                syncKey="ride-sync"
                className="w-full"
              />
            </CardContent>
          </Card>
        )}

        {/* Cadence Chart */}
        {hasCadence && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Cadence</CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <SingleMetricChart
                samples={cadenceData}
                label="Cadence"
                unit="rpm"
                color="#3b82f6"
                onHover={setHoverIndex}
                syncKey="ride-sync"
                className="w-full"
              />
            </CardContent>
          </Card>
        )}

        {/* Speed Chart */}
        {hasSpeed && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Speed</CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <SingleMetricChart
                samples={speedData}
                label="Speed"
                unit="mph"
                color="#10b981"
                onHover={setHoverIndex}
                syncKey="ride-sync"
                className="w-full"
              />
            </CardContent>
          </Card>
        )}
      </div>

      {/* Elevation Profile - Full Width */}
      {hasElevation && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Elevation Profile</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <ElevationProfile
              samples={samples}
              onHover={setHoverIndex}
              syncKey="ride-sync"
              className="w-full"
            />
            <div className="mt-3 text-xs text-muted-foreground">
              <p>Hover over steep sections to see grade percentage.</p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
