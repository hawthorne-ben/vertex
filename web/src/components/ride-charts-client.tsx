'use client'

import { useEffect, useState, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import dynamic from 'next/dynamic'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { findClosestByTime } from '@/lib/sync/fit-vtx-sync'

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
  highlightTime?: number | null // Unix timestamp in seconds to highlight
  samples?: Sample[]
  loading?: boolean
  error?: string | null
  zoomRange?: { start: string; end: string } | null
  onZoomChange?: (range: { start: string; end: string } | null) => void
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

export function RideChartsClient({
  rideId,
  fitRecordingId,
  showMap = false,
  onElevationUpdate,
  highlightTime,
  samples: propSamples,
  loading: propLoading,
  error: propError,
  zoomRange,
  onZoomChange
}: RideChartsClientProps) {
  const [fetchedSamples, setFetchedSamples] = useState<Sample[]>([])
  const [fetchedLoading, setFetchedLoading] = useState(true)
  const [fetchedError, setFetchedError] = useState<string | null>(null)
  const [hoverIndex, setHoverIndex] = useState<number | null>(null)

  // Use props if provided, otherwise use fetched state
  const samples = propSamples ?? fetchedSamples
  const loading = propLoading ?? fetchedLoading
  const error = propError ?? fetchedError

  // Filter samples by zoom range if provided (MUST be before highlightIndex calculation)
  const filteredSamples = useMemo(() => {
    if (!zoomRange) return samples

    const startMs = new Date(zoomRange.start).getTime()
    const endMs = new Date(zoomRange.end).getTime()

    return samples.filter(s => {
      const sampleMs = new Date(s.timestamp).getTime()
      return sampleMs >= startMs && sampleMs <= endMs
    })
  }, [samples, zoomRange])

  // Convert highlightTime to sample index in FILTERED samples (using shared sync library)
  const highlightIndex = useMemo(() => {
    if (highlightTime === null || highlightTime === undefined || filteredSamples.length === 0) {
      return null
    }

    const result = findClosestByTime(filteredSamples, highlightTime)
    return result?.index ?? null
  }, [highlightTime, filteredSamples])

  // Use highlightIndex if set, otherwise use hoverIndex
  const activeIndex = highlightIndex !== null && highlightIndex !== -1 ? highlightIndex : hoverIndex

  // Only fetch if samples not provided as prop
  useEffect(() => {
    async function loadSamples() {
      if (propSamples !== undefined) {
        // Samples provided as prop, skip fetch
        return
      }

      if (!fitRecordingId) {
        setFetchedError('No FIT file associated with this ride')
        setFetchedLoading(false)
        return
      }

      try {
        const supabase = createClient()
        const { data: { session } } = await supabase.auth.getSession()

        if (!session) {
          setFetchedError('Not authenticated')
          setFetchedLoading(false)
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
        setFetchedSamples(sampleData)
      } catch (err: any) {
        console.error('Failed to load ride data:', err)
        setFetchedError(err.message)
      } finally {
        setFetchedLoading(false)
      }
    }

    loadSamples()
  }, [rideId, fitRecordingId, propSamples])

  // Check what data we have (must be before any returns for hooks rules)
  const hasPower = samples.some(s => s.power_watts !== null && s.power_watts !== undefined)
  const hasHR = samples.some(s => s.heart_rate !== null && s.heart_rate !== undefined)
  const hasCadence = samples.some(s => s.cadence !== null && s.cadence !== undefined)
  const hasSpeed = samples.some(s => s.speed_ms !== null && s.speed_ms !== undefined)
  const hasElevation = samples.some(s => s.altitude !== null && s.altitude !== undefined)
  const hasGpsData = samples.some(s => s.latitude !== null && s.longitude !== null)

  // Debug: log what data is available
  useEffect(() => {
    if (samples.length > 0) {
      console.log('[RideChartsClient] Data availability:', {
        hasPower,
        hasHR,
        hasCadence,
        hasSpeed,
        hasElevation,
        hasGpsData,
        sampleCount: samples.length,
        firstSample: samples[0]
      })
    }
  }, [samples, hasPower, hasHR, hasCadence, hasSpeed, hasElevation, hasGpsData])

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

  // Prepare data for individual charts
  const powerData = filteredSamples.map(s => ({ timestamp: s.timestamp, value: s.power_watts ?? null }))
  const hrData = filteredSamples.map(s => ({ timestamp: s.timestamp, value: s.heart_rate ?? null }))
  const cadenceData = filteredSamples.map(s => ({ timestamp: s.timestamp, value: s.cadence ?? null }))
  const speedData = filteredSamples.map(s => ({ timestamp: s.timestamp, value: s.speed_ms ? s.speed_ms * 2.23694 : null })) // m/s to mph

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
              hoverIndex={activeIndex}
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
                highlightIndex={activeIndex}
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
                highlightIndex={activeIndex}
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
                highlightIndex={activeIndex}
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
                highlightIndex={activeIndex}
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
              highlightTime={highlightTime}
              zoomRange={zoomRange}
              onZoom={onZoomChange ? (start, end) => onZoomChange({ start, end }) : undefined}
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
