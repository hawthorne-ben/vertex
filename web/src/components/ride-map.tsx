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

// Helper: Map stability value (0-100%) to gradient matching the chart
// Green (70%+) → Yellow/Orange (40-69%) → Red (0-39%)
const getStabilityColor = (stability: number): string => {
  if (stability >= 70) {
    return '#22c55e' // Green - hsl(145, 70%, 50%)
  } else if (stability >= 65) {
    return '#4ade80' // Light green
  } else if (stability >= 60) {
    return '#84cc16' // Lime
  } else if (stability >= 55) {
    return '#eab308' // Yellow
  } else if (stability >= 50) {
    return '#f59e0b' // Amber
  } else if (stability >= 45) {
    return '#f97316' // Orange
  } else if (stability >= 40) {
    return '#fb923c' // Light orange
  } else if (stability >= 35) {
    return '#ef4444' // Red
  } else {
    return '#dc2626' // Dark red
  }
}

// Helper: Map roughness value (0-100%) to gradient
// Inverted from stability: low roughness (smooth) = green, high roughness (rough) = red
const getRoughnessColor = (roughness: number): string => {
  if (roughness <= 10) {
    return '#22c55e' // Green - very smooth
  } else if (roughness <= 20) {
    return '#4ade80' // Light green
  } else if (roughness <= 30) {
    return '#84cc16' // Lime
  } else if (roughness <= 40) {
    return '#eab308' // Yellow
  } else if (roughness <= 50) {
    return '#f59e0b' // Amber
  } else if (roughness <= 60) {
    return '#f97316' // Orange
  } else if (roughness <= 70) {
    return '#fb923c' // Light orange
  } else if (roughness <= 85) {
    return '#ef4444' // Red
  } else {
    return '#dc2626' // Dark red - very rough
  }
}

// Helper: Map riding position to color
// Green = Seated, Red = Standing
const getPositionColor = (position: 'standing' | 'seated' | null): string | null => {
  if (position === 'seated') {
    return '#22c55e' // Green - hsl(145, 70%, 50%)
  } else if (position === 'standing') {
    return '#ef4444' // Red - Tailwind red-500
  }
  return null // No pedaling
}

// Helper: Build stability lookup map (O(1) lookups instead of O(n) linear search)
const buildStabilityMap = (samples: EfficiencySample[]): Map<number, number> => {
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

// Helper: Build position lookup map (O(1) lookups)
const buildPositionMap = (samples: PositionSample[]): Map<number, 'standing' | 'seated' | null> => {
  const map = new Map<number, 'standing' | 'seated' | null>()

  for (const sample of samples) {
    const timestamp = new Date(sample.timestamp).getTime()
    // Only store non-null positions (filter out "not pedaling" samples)
    if (sample.position !== null) {
      const bucket = Math.round(timestamp / 1000) * 1000
      map.set(bucket, sample.position)
    }
  }

  return map
}

// Helper: Find position using pre-built map
const getPositionFromMap = (
  targetTime: number,
  positionMap: Map<number, 'standing' | 'seated' | null>,
  maxWindowMs: number = 1000
): 'standing' | 'seated' | null => {
  // Try exact second match first
  const targetBucket = Math.round(targetTime / 1000) * 1000
  if (positionMap.has(targetBucket)) {
    return positionMap.get(targetBucket)!
  }

  // Try adjacent seconds
  for (let offset = 1000; offset <= maxWindowMs; offset += 1000) {
    if (positionMap.has(targetBucket + offset)) {
      return positionMap.get(targetBucket + offset)!
    }
    if (positionMap.has(targetBucket - offset)) {
      return positionMap.get(targetBucket - offset)!
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

interface RoughnessSample {
  timestamp: string
  value: number
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
  efficiencySamples?: EfficiencySample[] // Pedaling efficiency samples for heatmap overlay
  positionSamples?: PositionSample[] // Riding position samples for heatmap overlay
  roughnessSamples?: RoughnessSample[] // Surface roughness samples for heatmap overlay
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
  efficiencySamples,
  positionSamples,
  roughnessSamples,
  fitStatsSamples,
  fitStatsMetric
}: {
  fullTrack: GPSPoint[]
  imuTimeRanges: IMUTimeRange[]
  defaultColor: string
  imuColor: string
  efficiencySamples?: EfficiencySample[]
  positionSamples?: PositionSample[]
  roughnessSamples?: RoughnessSample[]
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

    // Mode 1: Efficiency overlay - show full route + colored efficiency segments
    if (efficiencySamples && efficiencySamples.length > 0) {
      // Build stability lookup map once (O(n) instead of O(n²))
      const stabilityMap = buildStabilityMap(efficiencySamples)

      // Use shared overlay builder
      const { segments: overlays, matchedCount, totalCount } = buildOverlaySegments(
        gpsTrack,
        (point) => {
          const pointTime = new Date(point.timestamp!).getTime()
          const stability = getStabilityFromMap(pointTime, stabilityMap, 1000)
          return stability !== null ? getStabilityColor(stability) : null
        },
        'StabilityOverlay'
      )

      return {
        baseSegments: baseSegs,
        overlaySegments: overlays
      }
    }

    // Mode 2: Position overlay - show full route + colored position segments (green=seated, orange=standing)
    if (positionSamples && positionSamples.length > 0) {
      // Build position lookup map once (O(n) instead of O(n²))
      const positionMap = buildPositionMap(positionSamples)

      // Use shared overlay builder
      const { segments: overlays, matchedCount, totalCount } = buildOverlaySegments(
        gpsTrack,
        (point) => {
          const pointTime = new Date(point.timestamp!).getTime()
          const position = getPositionFromMap(pointTime, positionMap, 1000)
          return position ? getPositionColor(position) : null
        },
        'PositionOverlay'
      )

      return {
        baseSegments: baseSegs,
        overlaySegments: overlays
      }
    }

    // Mode 3: Roughness overlay - green (smooth) → red (rough)
    if (roughnessSamples && roughnessSamples.length > 0) {
      // Reuse same { timestamp, value } map structure
      const roughnessMap = buildStabilityMap(roughnessSamples)

      const { segments: overlays } = buildOverlaySegments(
        gpsTrack,
        (point) => {
          const pointTime = new Date(point.timestamp!).getTime()
          const roughness = getStabilityFromMap(pointTime, roughnessMap, 1000)
          return roughness !== null ? getRoughnessColor(roughness) : null
        },
        'RoughnessOverlay'
      )

      return {
        baseSegments: baseSegs,
        overlaySegments: overlays
      }
    }

    // Mode 4: FIT stats overlay - percentile-based green→red gradient
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
  }, [gpsTrack, imuTimeRanges, efficiencySamples, positionSamples, roughnessSamples, fitStatsSamples, fitStatsMetric, defaultColor, imuColor])

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

export function RideMap({
  gpsTrack,
  hoverIndex = null,
  onPointClick,
  colorBy = 'speed',
  className = '',
  imuTimeRanges = [],
  imuColor: imuColorProp,
  efficiencySamples,
  positionSamples,
  roughnessSamples,
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
      const minAlt = Math.min(...altitudes)
      const maxAlt = Math.max(...altitudes)
      const range = maxAlt - minAlt
      if (range > 0) {
        const ratio = (point.altitude - minAlt) / range
        const hue = ratio * 240 // 0 = red (low), 240 = blue (high)
        return `hsl(${hue}, 70%, 50%)`
      }
    }

    return '#3b82f6' // Default blue
  }

  // Create hover marker position
  const hoverPosition = hoverIndex !== null && hoverIndex >= 0 && hoverIndex < gpsTrack.length
    ? [gpsTrack[hoverIndex].lat, gpsTrack[hoverIndex].lon] as [number, number]
    : null

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
          efficiencySamples={efficiencySamples}
          positionSamples={positionSamples}
          roughnessSamples={roughnessSamples}
          fitStatsSamples={fitStatsSamples}
          fitStatsMetric={fitStatsMetric}
        />

        {/* Hover marker - zIndex 1000 */}
        {hoverPosition && (
          <Marker position={hoverPosition} icon={hoverIcon} zIndexOffset={1000}>
            <Popup>
              {gpsTrack[hoverIndex!].speedMph !== undefined && (
                <div>Speed: {gpsTrack[hoverIndex!].speedMph!.toFixed(1)} mph</div>
              )}
              {gpsTrack[hoverIndex!].altitudeFt !== undefined && (
                <div>Elevation: {gpsTrack[hoverIndex!].altitudeFt!.toFixed(0)} ft</div>
              )}
            </Popup>
          </Marker>
        )}

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
