'use client'

import { useEffect, useState, useRef, useMemo, memo } from 'react'
import { MapContainer, TileLayer, Polyline, Marker, Popup, useMap, useMapEvents, ZoomControl } from 'react-leaflet'
import L from 'leaflet'
import { Home } from 'lucide-react'
import { renderToStaticMarkup } from 'react-dom/server'
import 'leaflet/dist/leaflet.css'

// Create custom home icon for start/end markers
const createHomeIcon = (color: string) => {
  const iconHtml = renderToStaticMarkup(
    <div style={{
      backgroundColor: color,
      borderRadius: '50%',
      width: '32px',
      height: '32px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      border: '2px solid white',
      boxShadow: '0 2px 4px rgba(0,0,0,0.3)'
    }}>
      <Home size={18} color="white" />
    </div>
  )

  return L.divIcon({
    html: iconHtml,
    className: '',
    iconSize: [32, 32],
    iconAnchor: [16, 32],
  })
}

// Create custom hover marker (pulsing circle)
const createHoverIcon = () => {
  const iconHtml = renderToStaticMarkup(
    <div style={{
      position: 'relative',
      width: '24px',
      height: '24px'
    }}>
      <div style={{
        position: 'absolute',
        width: '24px',
        height: '24px',
        backgroundColor: '#3b82f6',
        borderRadius: '50%',
        border: '3px solid white',
        boxShadow: '0 0 0 4px rgba(59, 130, 246, 0.3), 0 2px 8px rgba(0,0,0,0.4)',
        animation: 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite'
      }} />
    </div>
  )

  return L.divIcon({
    html: iconHtml,
    className: 'hover-marker',
    iconSize: [24, 24],
    iconAnchor: [12, 12],
  })
}

const startIcon = createHomeIcon('#22c55e') // Green for start
const endIcon = createHomeIcon('#ef4444')   // Red for end
const hoverIcon = createHoverIcon()         // Blue pulsing marker

// Helper: Check if there's a significant GPS gap (tunnel/dropout)
// Use time-based detection since distance varies with speed
const hasGpsGap = (point1: GPSPoint, point2: GPSPoint): boolean => {
  if (!point1.timestamp || !point2.timestamp) return false

  const timeDiff = Math.abs(
    new Date(point2.timestamp).getTime() - new Date(point1.timestamp).getTime()
  )

  // Gap > 10 seconds indicates tunnel or GPS dropout
  // (Garmin records at 1 Hz, so 10s = significant gap)
  return timeDiff > 10000
}


// Helper: Build stability lookup map (O(1) lookups instead of O(n) linear search)
const buildStabilityMap = (samples: Array<{ timestamp: string; value: number | null }>): Map<number, number> => {
  const map = new Map<number, number>()

  for (const sample of samples) {
    const timestamp = new Date(sample.timestamp).getTime()
    if (sample.value !== null && sample.value !== undefined) {
      // Round to nearest second for bucketing
      const bucket = Math.round(timestamp / 1000) * 1000
      map.set(bucket, sample.value)
    }
  }

  return map
}

// Helper: Find stability value using pre-built map
const getStabilityFromMap = (
  targetTime: number,
  stabilityMap: Map<number, number>,
  maxWindowMs: number = 1000
): number | null => {
  // Try exact second match first
  const targetBucket = Math.round(targetTime / 1000) * 1000
  if (stabilityMap.has(targetBucket)) {
    return stabilityMap.get(targetBucket)!
  }

  // Try adjacent seconds
  for (let offset = 1000; offset <= maxWindowMs; offset += 1000) {
    if (stabilityMap.has(targetBucket + offset)) {
      return stabilityMap.get(targetBucket + offset)!
    }
    if (stabilityMap.has(targetBucket - offset)) {
      return stabilityMap.get(targetBucket - offset)!
    }
  }

  return null
}


// Helper: Build overlay segments from GPS track and color lookup function
// This unified function handles both efficiency and position overlays
const buildOverlaySegments = (
  gpsTrack: GPSPoint[],
  getColorForPoint: (point: GPSPoint) => string | null,
  overlayName: string
): { segments: { positions: [number, number][]; color: string }[]; matchedCount: number; totalCount: number } => {
  const segments: { positions: [number, number][]; color: string }[] = []
  let currentSegment: [number, number][] = []
  let currentColor: string | null = null
  let matchedCount = 0
  let totalCount = 0

  for (let idx = 0; idx < gpsTrack.length; idx++) {
    const point = gpsTrack[idx]
    if (!point.timestamp) continue

    totalCount++
    const pointColor = getColorForPoint(point)

    if (pointColor !== null) {
      matchedCount++

      // Same color as current segment - add to it
      if (pointColor === currentColor) {
        currentSegment.push([point.lat, point.lon])
      } else {
        // Color changed - save current segment and start new one
        if (currentSegment.length > 1) {
          segments.push({
            positions: [...currentSegment],
            color: currentColor!
          })
        }
        // Start new segment (with previous point for continuity if available)
        currentSegment = currentSegment.length > 0
          ? [currentSegment[currentSegment.length - 1], [point.lat, point.lon]]
          : [[point.lat, point.lon]]
        currentColor = pointColor
      }
    } else {
      // No data - end current segment
      if (currentSegment.length > 1) {
        segments.push({
          positions: [...currentSegment],
          color: currentColor!
        })
      }
      currentSegment = []
      currentColor = null
    }
  }

  // Save final segment
  if (currentSegment.length > 1 && currentColor) {
    segments.push({
      positions: currentSegment,
      color: currentColor
    })
  }

  return { segments, matchedCount, totalCount }
}

interface GPSPoint {
  lat: number
  lon: number
  timestamp?: string
  speed?: number | null
  altitude?: number | null
  speedMph?: number // Pre-calculated
  altitudeFt?: number // Pre-calculated
}

interface IMUTimeRange {
  start: number // Unix timestamp in ms
  end: number // Unix timestamp in ms
}

/** Generic analytics overlay: samples with a numeric value + a color function */
export interface AnalyticsOverlay {
  samples: Array<{ timestamp: string; value: number | null }>
  getColor: (value: number) => string | null
}

export interface FitStatsSample {
  timestamp: string
  power_watts?: number | null
  heart_rate?: number | null
  cadence?: number | null
  speed_ms?: number | null
}

export type FitStatsMetric = 'power' | 'cadence' | 'hr' | 'speed'

// Same 9-stop gradient as efficiency overlay: green (low/cruising) → red (high/intense)
const FIT_STATS_COLORS = [
  '#22c55e', // Green — ≤p50
  '#4ade80',
  '#84cc16',
  '#eab308',
  '#f59e0b',
  '#f97316',
  '#fb923c',
  '#ef4444',
  '#dc2626', // Dark red — ≥p90
]

// Compute percentile thresholds from non-zero values.
// Returns 9 boundaries (p50, p55, p60, p65, p70, p75, p80, p85, p90).
// Values ≤p50 = full green, ≥p90 = full red.
const computePercentileThresholds = (values: number[]): number[] => {
  const sorted = [...values].sort((a, b) => a - b)
  const n = sorted.length
  if (n === 0) return []
  const percentiles = [0.50, 0.55, 0.60, 0.65, 0.70, 0.75, 0.80, 0.85, 0.90]
  return percentiles.map(p => {
    const idx = Math.min(Math.floor(p * n), n - 1)
    return sorted[idx]
  })
}

// Map value → color using precomputed thresholds. High = red, low = green.
const getColorFromThresholds = (value: number, thresholds: number[]): string => {
  if (thresholds.length === 0) return FIT_STATS_COLORS[0]
  for (let i = thresholds.length - 1; i >= 0; i--) {
    if (value >= thresholds[i]) return FIT_STATS_COLORS[i]
  }
  return FIT_STATS_COLORS[0] // Below p50 = green
}

const FIT_STATS_FIELD_KEY: Record<FitStatsMetric, keyof FitStatsSample> = {
  power: 'power_watts',
  cadence: 'cadence',
  hr: 'heart_rate',
  speed: 'speed_ms',
}

// Build timestamp→value lookup map for a FIT stats metric (excludes zeros)
const buildFitStatsMap = (samples: FitStatsSample[], metric: FitStatsMetric): Map<number, number> => {
  const map = new Map<number, number>()
  const key = FIT_STATS_FIELD_KEY[metric]

  for (const sample of samples) {
    const val = sample[key] as number | null | undefined
    if (val != null && val > 0) {
      const bucket = Math.round(new Date(sample.timestamp).getTime() / 1000) * 1000
      map.set(bucket, val)
    }
  }

  return map
}

interface RideMapProps {
  gpsTrack: GPSPoint[]
  hoverIndex?: number | null
  onPointClick?: (index: number) => void
  colorBy?: 'speed' | 'elevation' | 'none'
  className?: string
  imuTimeRanges?: IMUTimeRange[] // Time ranges where IMU data exists
  imuColor?: string // Color for IMU coverage overlay (default: green)
  analyticsOverlay?: AnalyticsOverlay // Generic analytics overlay (stability, roughness, braking, position, etc.)
  fitStatsSamples?: FitStatsSample[] // FIT stats samples for metric overlay
  fitStatsMetric?: FitStatsMetric // Which FIT metric to overlay
  onZoomChange?: (zoom: number) => void
}

// Track map zoom level changes and report to parent
function ZoomTracker({ onZoomChange }: { onZoomChange: (zoom: number) => void }) {
  useMapEvents({
    zoomend: (e) => {
      onZoomChange(e.target.getZoom())
    }
  })
  return null
}

// Component to fit bounds only on initial mount
function FitBounds({ positions }: { positions: [number, number][] }) {
  const map = useMap()
  const hasInitialized = useRef(false)

  useEffect(() => {
    // Only fit bounds once on mount, preserve user zoom/pan after that
    if (!hasInitialized.current && positions.length > 0) {
      const bounds = L.latLngBounds(positions)
      map.fitBounds(bounds, { padding: [20, 20], maxZoom: 16 })
      hasInitialized.current = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // Empty deps - only run once

  return null
}

// Component to render polylines with gap detection
// Memoized to prevent re-rendering when only hoverIndex changes
const RoutePolylines = memo(function RoutePolylines({
  fullTrack,
  imuTimeRanges,
  defaultColor,
  imuColor,
  analyticsOverlay,
  fitStatsSamples,
  fitStatsMetric
}: {
  fullTrack: GPSPoint[]
  imuTimeRanges: IMUTimeRange[]
  defaultColor: string
  imuColor: string
  analyticsOverlay?: AnalyticsOverlay
  fitStatsSamples?: FitStatsSample[]
  fitStatsMetric?: FitStatsMetric
}) {
  // Use full GPS track (1 Hz, ~6000 points for 2-hour ride)
  const gpsTrack = fullTrack

  // Build segments based on overlay mode
  const { baseSegments, overlaySegments } = useMemo(() => {
    // Build base segments with gap detection (breaks line at tunnels)
    const baseSegs: { positions: [number, number][]; color: string }[] = []
    let currentBase: [number, number][] = []

    for (let i = 0; i < gpsTrack.length; i++) {
      const point = gpsTrack[i]
      const hasGap = i > 0 && hasGpsGap(gpsTrack[i - 1], point)

      if (hasGap && currentBase.length > 1) {
        // Save segment before gap
        baseSegs.push({ positions: currentBase, color: defaultColor })
        currentBase = []
      }

      currentBase.push([point.lat, point.lon])
    }

    // Save final base segment
    if (currentBase.length > 1) {
      baseSegs.push({ positions: currentBase, color: defaultColor })
    }

    // Analytics overlay — generic for any metric (stability, roughness, braking, position, etc.)
    if (analyticsOverlay && analyticsOverlay.samples.length > 0) {
      const valueMap = buildStabilityMap(analyticsOverlay.samples as Array<{ timestamp: string; value: number }>)
      const colorFn = analyticsOverlay.getColor

      const { segments: overlays } = buildOverlaySegments(
        gpsTrack,
        (point) => {
          const pointTime = new Date(point.timestamp!).getTime()
          const value = getStabilityFromMap(pointTime, valueMap, 1000)
          return value !== null ? colorFn(value) : null
        },
        'AnalyticsOverlay'
      )

      return {
        baseSegments: baseSegs,
        overlaySegments: overlays
      }
    }

    // FIT stats overlay - percentile-based green→red gradient
    if (fitStatsSamples && fitStatsSamples.length > 0 && fitStatsMetric) {
      const statsMap = buildFitStatsMap(fitStatsSamples, fitStatsMetric)
      const allValues = Array.from(statsMap.values())
      const thresholds = computePercentileThresholds(allValues)

      const { segments: overlays } = buildOverlaySegments(
        gpsTrack,
        (point) => {
          const pointTime = new Date(point.timestamp!).getTime()
          const val = getStabilityFromMap(pointTime, statsMap, 1000)
          return val !== null ? getColorFromThresholds(val, thresholds) : null
        },
        'FitStatsOverlay'
      )

      return {
        baseSegments: baseSegs,
        overlaySegments: overlays
      }
    }

    // Mode 4: VTX overlay - show full route + green IMU segments
    if (imuTimeRanges.length > 0) {
      const overlays: { positions: [number, number][]; color: string }[] = []
      let currentSegment: GPSPoint[] = []
      let inIMURange = false

      gpsTrack.forEach((point) => {
        if (!point.timestamp) return

        const pointTime = new Date(point.timestamp).getTime()
        const hasIMU = imuTimeRanges.some(range => pointTime >= range.start && pointTime <= range.end)

        if (hasIMU) {
          currentSegment.push(point)
          inIMURange = true
        } else {
          if (inIMURange && currentSegment.length > 0) {
            overlays.push({
              positions: currentSegment.map(p => [p.lat, p.lon]),
              color: imuColor
            })
            currentSegment = []
          }
          inIMURange = false
        }
      })

      // Save final segment
      if (currentSegment.length > 0) {
        overlays.push({
          positions: currentSegment.map(p => [p.lat, p.lon]),
          color: imuColor
        })
      }

      return {
        baseSegments: baseSegs,
        overlaySegments: overlays
      }
    }

    // No overlay - just show default route with gaps
    return {
      baseSegments: baseSegs,
      overlaySegments: []
    }
  }, [gpsTrack, imuTimeRanges, analyticsOverlay, fitStatsSamples, fitStatsMetric, defaultColor, imuColor])

  return (
    <>
      {/* Base layer - shows route with gaps at tunnels */}
      {baseSegments.map((segment, idx) => (
        <Polyline
          key={`base-${idx}`}
          positions={segment.positions}
          pathOptions={{
            color: segment.color,
            weight: 3,
            opacity: 0.8,
          }}
        />
      ))}

      {/* Overlay layer - shows colored segments on top */}
      {overlaySegments.map((segment, idx) => (
        <Polyline
          key={`overlay-${idx}`}
          positions={segment.positions}
          pathOptions={{
            color: segment.color,
            weight: 4, // Slightly thicker to show on top
            opacity: 0.9,
          }}
        />
      ))}
    </>
  )
})

// Hover marker is split out + memoized so a scrub tick (which only changes
// hoverIndex) doesn't cascade through the whole RideMap tree, re-rendering
// the MapContainer / TileLayer / Polylines / start-end markers each time.
const HoverMarker = memo(function HoverMarker({
  gpsTrack,
  hoverIndex,
}: {
  gpsTrack: GPSPoint[]
  hoverIndex: number | null
}) {
  if (hoverIndex === null || hoverIndex < 0 || hoverIndex >= gpsTrack.length) return null
  const point = gpsTrack[hoverIndex]
  const position: [number, number] = [point.lat, point.lon]
  return (
    <Marker position={position} icon={hoverIcon} zIndexOffset={1000}>
      <Popup>
        {point.speedMph !== undefined && <div>Speed: {point.speedMph.toFixed(1)} mph</div>}
        {point.altitudeFt !== undefined && <div>Elevation: {point.altitudeFt.toFixed(0)} ft</div>}
      </Popup>
    </Marker>
  )
})

export function RideMap({
  gpsTrack,
  hoverIndex = null,
  onPointClick,
  colorBy = 'speed',
  className = '',
  imuTimeRanges = [],
  imuColor: imuColorProp,
  analyticsOverlay,
  fitStatsSamples,
  fitStatsMetric,
  onZoomChange
}: RideMapProps) {
  const [mounted, setMounted] = useState(false)
  const [isDark, setIsDark] = useState(false)

  // Use stable initial center to prevent map reset on re-renders
  // Must be before conditional returns to follow Rules of Hooks
  const { initialCenter, initialZoom } = useMemo(() => ({
    initialCenter: [gpsTrack[0]?.lat || 0, gpsTrack[0]?.lon || 0] as [number, number],
    initialZoom: 13
  }), [gpsTrack])

  // Detect theme from HTML class
  useEffect(() => {
    setMounted(true)

    // Check for dark mode
    const checkTheme = () => {
      setIsDark(document.documentElement.classList.contains('dark'))
    }

    checkTheme()

    // Watch for theme changes
    const observer = new MutationObserver(checkTheme)
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class']
    })

    return () => observer.disconnect()
  }, [])

  // Calculate bounds from original track (memoized to avoid recreating on scrub)
  // Must be before conditional returns to follow Rules of Hooks
  const positions = useMemo<[number, number][]>(
    () => gpsTrack.map(p => [p.lat, p.lon]),
    [gpsTrack]
  )

  if (!mounted) {
    return (
      <div className={`bg-muted rounded-lg flex items-center justify-center ${className}`} style={{ height: 400 }}>
        <p className="text-muted-foreground">Loading map...</p>
      </div>
    )
  }

  if (gpsTrack.length === 0) {
    return (
      <div className={`bg-muted rounded-lg flex items-center justify-center ${className}`} style={{ height: 400 }}>
        <p className="text-muted-foreground">No GPS data available</p>
      </div>
    )
  }

  // Theme-aware tile layer
  const tileUrl = isDark
    ? 'https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png'  // Minimal dark
    : 'https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png'  // Minimal light

  const tileAttribution = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'

  // Color-code polyline by speed or elevation
  const getColor = (index: number): string => {
    if (colorBy === 'none') return '#3b82f6' // Blue

    const point = gpsTrack[index]

    if (colorBy === 'speed' && point.speed !== null && point.speed !== undefined) {
      // Speed gradient: 0-30 mph
      const speedMph = point.speed * 2.23694 // m/s to mph
      const ratio = Math.min(speedMph / 30, 1)
      // Green (slow) to Red (fast)
      const hue = (1 - ratio) * 120 // 120 = green, 0 = red
      return `hsl(${hue}, 70%, 50%)`
    }

    if (colorBy === 'elevation' && point.altitude !== null && point.altitude !== undefined) {
      // Elevation gradient relative to track
      const altitudes = gpsTrack.map(p => p.altitude).filter(a => a !== null) as number[]
      let minAlt = Infinity
      let maxAlt = -Infinity
      for (let i = 0; i < altitudes.length; i++) {
        if (altitudes[i] < minAlt) minAlt = altitudes[i]
        if (altitudes[i] > maxAlt) maxAlt = altitudes[i]
      }
      const range = maxAlt - minAlt
      if (range > 0) {
        const ratio = (point.altitude - minAlt) / range
        const hue = ratio * 240 // 0 = red (low), 240 = blue (high)
        return `hsl(${hue}, 70%, 50%)`
      }
    }

    return '#3b82f6' // Default blue
  }

  // Theme-aware colors
  const defaultRouteColor = isDark ? '#ffffff' : '#000000'
  const imuRouteColor = imuColorProp ?? '#22c55e' // Default green for IMU coverage

  return (
    <div className={`${className} relative rounded-lg`} style={{ zIndex: 1 }}>
      <MapContainer
        key="ride-map" // Stable key to prevent remounting when overlay props change
        center={initialCenter}
        zoom={initialZoom}
        style={{ height: 400, width: '100%', borderRadius: '0.5rem', position: 'relative', zIndex: 1 }}
        scrollWheelZoom={false}
        zoomControl={false}
      >
        {/* Minimal theme-aware tiles (no labels, just roads and topo) */}
        <TileLayer
          attribution={tileAttribution}
          url={tileUrl}
        />

        {/* Custom styled zoom control in top-right */}
        <ZoomControl position="topright" />

        <FitBounds positions={positions} />
        {onZoomChange && <ZoomTracker onZoomChange={onZoomChange} />}

        {/* Route polylines - full resolution */}
        <RoutePolylines
          fullTrack={gpsTrack}
          imuTimeRanges={imuTimeRanges}
          defaultColor={defaultRouteColor}
          imuColor={imuRouteColor}
          analyticsOverlay={analyticsOverlay}
          fitStatsSamples={fitStatsSamples}
          fitStatsMetric={fitStatsMetric}
        />

        {/* Hover marker - zIndex 1000. Memoized so scrub ticks don't reconcile
            the rest of the map tree. */}
        <HoverMarker gpsTrack={gpsTrack} hoverIndex={hoverIndex} />

        {/* Start marker - green home icon - zIndex 500 */}
        <Marker position={positions[0]} icon={startIcon} zIndexOffset={500}>
          <Popup>Start</Popup>
        </Marker>

        {/* End marker - red home icon - zIndex 500 */}
        <Marker position={positions[positions.length - 1]} icon={endIcon} zIndexOffset={500}>
          <Popup>Finish</Popup>
        </Marker>
      </MapContainer>
    </div>
  )
}
