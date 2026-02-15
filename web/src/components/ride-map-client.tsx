'use client'

import { useMemo, useState, useEffect, useRef } from 'react'
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

interface PositionSample {
  timestamp: string
  position: 'standing' | 'seated' | null
  rockingMagnitude: number
  cadence: number | null
}

interface RideMapClientProps {
  rideId: string
  fitRecordingId: string | null
  highlightTime?: number | null // Unix timestamp in seconds to highlight
  imuTimeRanges?: IMUTimeRange[] // Time ranges where IMU data exists
  imuColor?: string // Color for IMU coverage overlay
  samples: Sample[]
  loading: boolean
  error: string | null
  mapMode?: 'vtx' | 'efficiency' | 'pedalingEfficiency' | 'ridingPosition' // Map overlay mode
  efficiencySamples?: EfficiencySample[] // Pedaling efficiency data for heatmap
  efficiencyLoading?: boolean // Loading state for efficiency data
  positionSamples?: PositionSample[] // Riding position data for heatmap
  positionLoading?: boolean // Loading state for position data
  onZoomChange?: (zoom: number) => void
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
  efficiencySamples = [],
  efficiencyLoading = false,
  positionSamples = [],
  positionLoading = false,
  imuColor,
  onZoomChange
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

  // Overlay data is still loading (GPS track already available)
  const isOverlayLoading = !loading && gpsTrack.length > 0 && (
    ((mapMode === 'efficiency' || mapMode === 'pedalingEfficiency') && efficiencyLoading) ||
    (mapMode === 'ridingPosition' && positionLoading)
  )

  // Tab-switch blur transition — snap on instantly, fade out over 200ms
  // Defer data swap until overlay is opaque so the map doesn't flash new data first
  const [showTransition, setShowTransition] = useState(false)
  const prevOverlayKey = useRef(`${mapMode}:${imuColor}`)
  const [deferredMode, setDeferredMode] = useState(mapMode)
  const [deferredImuColor, setDeferredImuColor] = useState(imuColor)

  useEffect(() => {
    const key = `${mapMode}:${imuColor}`
    if (prevOverlayKey.current !== key) {
      prevOverlayKey.current = key
      setShowTransition(true)
      // Swap underlying data after one frame (overlay is already opaque)
      requestAnimationFrame(() => {
        setDeferredMode(mapMode)
        setDeferredImuColor(imuColor)
      })
      const timer = setTimeout(() => setShowTransition(false), 200)
      return () => clearTimeout(timer)
    }
  }, [mapMode, imuColor])

  const showOverlay = isOverlayLoading || showTransition

  // Initial GPS data still loading — nothing to show yet
  if (loading) {
    return (
      <div className="h-[400px] bg-muted rounded-lg map-shadow flex items-center justify-center">
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
      <div className="h-[400px] bg-muted rounded-lg map-shadow flex items-center justify-center">
        <p className="text-muted-foreground">{error || 'No GPS data available'}</p>
      </div>
    )
  }

  return (
    <div className="relative rounded-lg map-shadow">
      <RideMap
        gpsTrack={gpsTrack}
        hoverIndex={highlightIndex !== null && highlightIndex !== -1 ? highlightIndex : null}
        className="w-full"
        imuTimeRanges={deferredMode === 'vtx' ? imuTimeRanges : []}
        imuColor={deferredImuColor}
        efficiencySamples={isOverlayLoading ? undefined : ((deferredMode === 'efficiency' || deferredMode === 'pedalingEfficiency') ? efficiencySamples : undefined)}
        positionSamples={isOverlayLoading ? undefined : (deferredMode === 'ridingPosition' ? positionSamples : undefined)}
        onZoomChange={onZoomChange}
      />

      {/* Glass overlay — blur transition on tab switch, persistent during data loading */}
      <div
        className={`absolute inset-0 z-10 rounded-lg glass-overlay flex items-center justify-center ${
          showOverlay ? 'opacity-100' : 'opacity-0 pointer-events-none transition-opacity duration-200'
        }`}
      >
        {isOverlayLoading && (
          <div className="flex flex-col items-center gap-3">
            <div className="relative">
              <div className="w-10 h-10 border-4 border-muted-foreground/20 rounded-full"></div>
              <div className="w-10 h-10 border-4 border-primary border-t-transparent rounded-full animate-spin absolute top-0"></div>
            </div>
            <p className="text-sm text-muted-foreground">Loading overlay data...</p>
          </div>
        )}
      </div>
    </div>
  )
}
