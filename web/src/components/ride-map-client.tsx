'use client'

import { useMemo } from 'react'
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

interface Sample {
  timestamp: string
  latitude?: number | null
  longitude?: number | null
  altitude?: number | null
  speed_ms?: number | null
}

interface EfficiencySample {
  timestamp: string
  value: number
}

interface RideMapClientProps {
  rideId: string
  fitRecordingId: string | null
  highlightTime?: number | null // Unix timestamp in seconds to highlight
  imuTimeRanges?: IMUTimeRange[] // Time ranges where IMU data exists
  samples: Sample[]
  loading: boolean
  error: string | null
  mapMode?: 'vtx' | 'efficiency' // Map overlay mode
  efficiencySamples?: EfficiencySample[] // Pedaling efficiency data for heatmap
}

export function RideMapClient({
  rideId,
  fitRecordingId,
  highlightTime,
  imuTimeRanges = [],
  samples,
  loading,
  error,
  mapMode = 'vtx',
  efficiencySamples = []
}: RideMapClientProps) {

  // Process samples into GPS track format
  const gpsTrack = useMemo(() => {
    return samples
      .filter(s => s.latitude && s.longitude)
      .map(s => ({
        lat: s.latitude!,
        lon: s.longitude!,
        altitude: s.altitude,
        speed: s.speed_ms,
        timestamp: s.timestamp,
        // Pre-calculate converted values for popup efficiency
        speedMph: s.speed_ms ? s.speed_ms * 2.23694 : undefined,
        altitudeFt: s.altitude ? s.altitude * 3.28084 : undefined,
      }))
  }, [samples])

  // Convert highlightTime to GPS track index (using shared sync library)
  const highlightIndex = useMemo(() => {
    if (highlightTime === null || highlightTime === undefined || gpsTrack.length === 0) {
      return null
    }

    const result = findClosestByTime(gpsTrack, highlightTime)
    return result?.index ?? null
  }, [highlightTime, gpsTrack])

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
      imuTimeRanges={mapMode === 'vtx' ? imuTimeRanges : []}
      efficiencySamples={mapMode === 'efficiency' ? efficiencySamples : undefined}
    />
  )
}
