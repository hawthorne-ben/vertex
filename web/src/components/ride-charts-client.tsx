'use client'

import { useMemo } from 'react'
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

interface RideChartsClientProps {
  rideId: string
  fitRecordingId: string | null
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
}

export function RideChartsClient({
  rideId,
  fitRecordingId,
  highlightTime,
  samples: propSamples,
  loading: propLoading,
  error: propError,
  zoomRange,
  onZoomChange
}: RideChartsClientProps) {
  const samples = propSamples ?? []
  const loading = propLoading ?? false
  const error = propError ?? null

  // Filter samples by zoom range if provided
  const filteredSamples = useMemo(() => {
    if (!zoomRange) return samples

    const startMs = new Date(zoomRange.start).getTime()
    const endMs = new Date(zoomRange.end).getTime()

    return samples.filter(s => {
      const sampleMs = new Date(s.timestamp).getTime()
      return sampleMs >= startMs && sampleMs <= endMs
    })
  }, [samples, zoomRange])

  // Check what data we have based on filtered samples
  const dataAvailability = useMemo(() => ({
    hasPower: filteredSamples.some(s => s.power_watts !== null && s.power_watts !== undefined),
    hasHR: filteredSamples.some(s => s.heart_rate !== null && s.heart_rate !== undefined),
    hasCadence: filteredSamples.some(s => s.cadence !== null && s.cadence !== undefined),
    hasSpeed: filteredSamples.some(s => s.speed_ms !== null && s.speed_ms !== undefined),
    hasElevation: filteredSamples.some(s => s.altitude !== null && s.altitude !== undefined),
  }), [filteredSamples])

  const { hasPower, hasHR, hasCadence, hasSpeed, hasElevation } = dataAvailability

  // Prepare data for individual charts (memoized)
  const powerData = useMemo(() =>
    filteredSamples.map(s => ({ timestamp: s.timestamp, value: s.power_watts ?? null })),
    [filteredSamples]
  )
  const hrData = useMemo(() =>
    filteredSamples.map(s => ({ timestamp: s.timestamp, value: s.heart_rate ?? null })),
    [filteredSamples]
  )
  const cadenceData = useMemo(() =>
    filteredSamples.map(s => ({ timestamp: s.timestamp, value: s.cadence ?? null })),
    [filteredSamples]
  )
  const speedData = useMemo(() =>
    filteredSamples.map(s => ({ timestamp: s.timestamp, value: s.speed_ms ? s.speed_ms * 2.23694 : null })),
    [filteredSamples]
  )

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

      {/* Performance Charts Grid - 2 per row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {hasPower && (
          <Card>
            <CardContent className="pt-6">
              <SingleMetricChart
                samples={powerData}
                label="Power"
                unit="W"
                highlightTime={highlightTime}
                color="#ef4444"
                className="w-full"
              />
            </CardContent>
          </Card>
        )}

        {hasHR && (
          <Card>
            <CardContent className="pt-6">
              <SingleMetricChart
                samples={hrData}
                label="Heart Rate"
                unit="bpm"
                highlightTime={highlightTime}
                color="#ec4899"
                className="w-full"
              />
            </CardContent>
          </Card>
        )}

        {hasCadence && (
          <Card>
            <CardContent className="pt-6">
              <SingleMetricChart
                samples={cadenceData}
                label="Cadence"
                unit="rpm"
                highlightTime={highlightTime}
                color="#3b82f6"
                className="w-full"
              />
            </CardContent>
          </Card>
        )}

        {hasSpeed && (
          <Card>
            <CardContent className="pt-6">
              <SingleMetricChart
                samples={speedData}
                label="Speed"
                unit="mph"
                highlightTime={highlightTime}
                color="#10b981"
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
              highlightTime={highlightTime}
              zoomRange={zoomRange}
              onZoom={onZoomChange ? (start, end) => onZoomChange({ start, end }) : undefined}
              className="w-full"
            />
          </CardContent>
        </Card>
      )}
    </div>
  )
}
