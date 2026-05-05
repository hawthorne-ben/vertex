'use client'

import { useMemo, useState, useEffect, useRef } from 'react'
import dynamic from 'next/dynamic'
import type { FitStatsSample, FitStatsMetric, AnalyticsOverlay } from './ride-map'

// Stable empty array — passing `[]` inline as a prop each render would
// invalidate RoutePolylines' memo and force a full-track segment rebuild
// every scrub tick on tabs that don't show IMU coverage.
const EMPTY_IMU_RANGES: never[] = []

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

interface RideMapClientProps {
  rideId: string
  fitRecordingId: string | null
  highlightTime?: number | null
  imuTimeRanges?: IMUTimeRange[]
  imuColor?: string
  samples: Sample[]
  loading: boolean
  error: string | null
  mapMode?: string
  analyticsOverlay?: AnalyticsOverlay
  analyticsLoading?: boolean
  fitStatsSamples?: FitStatsSample[]
  fitStatsMetric?: FitStatsMetric
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
  analyticsOverlay,
  analyticsLoading = false,
  fitStatsSamples,
  fitStatsMetric,
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
        speedMph: s.speed_ms ? s.speed_ms * 2.23694 : undefined,
        altitudeFt: s.altitude ? s.altitude * 3.28084 : undefined,
      }))
  }, [samples])

  // Parallel array of timestamps as Unix ms, sorted ascending. Built once per
  // gpsTrack so highlight lookups during scrub do a pure-numeric binary search
  // instead of allocating a Date object per probe.
  const trackTimestampsMs = useMemo(() => {
    const out = new Float64Array(gpsTrack.length)
    for (let i = 0; i < gpsTrack.length; i++) {
      out[i] = new Date(gpsTrack[i].timestamp).getTime()
    }
    return out
  }, [gpsTrack])

  // Convert highlightTime to GPS track index. Inline binary search on the
  // precomputed ms array — runs every scrub tick, so allocating zero objects
  // matters.
  const highlightIndex = useMemo(() => {
    if (highlightTime === null || highlightTime === undefined || trackTimestampsMs.length === 0) {
      return null
    }
    const targetMs = highlightTime * 1000
    let lo = 0
    let hi = trackTimestampsMs.length - 1
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (trackTimestampsMs[mid] < targetMs) lo = mid + 1
      else hi = mid
    }
    if (lo > 0 && Math.abs(trackTimestampsMs[lo - 1] - targetMs) < Math.abs(trackTimestampsMs[lo] - targetMs)) {
      lo = lo - 1
    }
    return lo
  }, [highlightTime, trackTimestampsMs])

  // Overlay data is still loading
  const isOverlayLoading = !loading && gpsTrack.length > 0 && mapMode !== 'route' && analyticsLoading

  // Tab-switch blur transition — snap on instantly, fade out over 200ms
  const [showTransition, setShowTransition] = useState(false)
  const prevOverlayKey = useRef(`${mapMode}:${imuColor}`)
  const [deferredMode, setDeferredMode] = useState(mapMode)
  const [deferredImuColor, setDeferredImuColor] = useState(imuColor)

  useEffect(() => {
    const key = `${mapMode}:${imuColor}`
    if (prevOverlayKey.current !== key) {
      prevOverlayKey.current = key
      setShowTransition(true)
      requestAnimationFrame(() => {
        setDeferredMode(mapMode)
        setDeferredImuColor(imuColor)
      })
      const timer = setTimeout(() => setShowTransition(false), 200)
      return () => clearTimeout(timer)
    }
  }, [mapMode, imuColor])

  const showOverlay = isOverlayLoading || showTransition

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
        hoverIndex={highlightIndex}
        className="w-full"
        imuTimeRanges={deferredMode === 'vtx' ? imuTimeRanges : EMPTY_IMU_RANGES}
        imuColor={deferredMode === 'route' ? undefined : deferredImuColor}
        analyticsOverlay={!isOverlayLoading && analyticsOverlay && analyticsOverlay.samples.length > 0 ? analyticsOverlay : undefined}
        fitStatsSamples={deferredMode === 'fitStats' ? fitStatsSamples : undefined}
        fitStatsMetric={deferredMode === 'fitStats' ? fitStatsMetric : undefined}
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
