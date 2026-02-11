'use client'

import { useEffect, useState, useRef, useMemo } from 'react'
import { MapContainer, TileLayer, Polyline, Marker, Popup, useMap, ZoomControl } from 'react-leaflet'
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

// Helper: Map efficiency value (0-100%) to gradient matching the chart
// Green (70%+) → Yellow/Orange (40-69%) → Red (0-39%)
const getEfficiencyColor = (efficiency: number): string => {
  if (efficiency >= 70) {
    return '#22c55e' // Green - hsl(145, 70%, 50%)
  } else if (efficiency >= 65) {
    return '#4ade80' // Light green
  } else if (efficiency >= 60) {
    return '#84cc16' // Lime
  } else if (efficiency >= 55) {
    return '#eab308' // Yellow
  } else if (efficiency >= 50) {
    return '#f59e0b' // Amber
  } else if (efficiency >= 45) {
    return '#f97316' // Orange
  } else if (efficiency >= 40) {
    return '#fb923c' // Light orange
  } else if (efficiency >= 35) {
    return '#ef4444' // Red
  } else {
    return '#dc2626' // Dark red
  }
}

// Helper: Build efficiency lookup map (O(1) lookups instead of O(n) linear search)
const buildEfficiencyMap = (samples: EfficiencySample[]): Map<number, number> => {
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

// Helper: Find efficiency value using pre-built map
const getEfficiencyFromMap = (
  targetTime: number,
  efficiencyMap: Map<number, number>,
  maxWindowMs: number = 1000
): number | null => {
  // Try exact second match first
  const targetBucket = Math.round(targetTime / 1000) * 1000
  if (efficiencyMap.has(targetBucket)) {
    return efficiencyMap.get(targetBucket)!
  }

  // Try adjacent seconds
  for (let offset = 1000; offset <= maxWindowMs; offset += 1000) {
    if (efficiencyMap.has(targetBucket + offset)) {
      return efficiencyMap.get(targetBucket + offset)!
    }
    if (efficiencyMap.has(targetBucket - offset)) {
      return efficiencyMap.get(targetBucket - offset)!
    }
  }

  return null
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

interface RideMapProps {
  gpsTrack: GPSPoint[]
  hoverIndex?: number | null
  onPointClick?: (index: number) => void
  colorBy?: 'speed' | 'elevation' | 'none'
  className?: string
  imuTimeRanges?: IMUTimeRange[] // Time ranges where IMU data exists
  efficiencySamples?: EfficiencySample[] // Pedaling efficiency samples for heatmap overlay
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
function RoutePolylines({
  fullTrack,
  imuTimeRanges,
  defaultColor,
  imuColor,
  efficiencySamples
}: {
  fullTrack: GPSPoint[]
  imuTimeRanges: IMUTimeRange[]
  defaultColor: string
  imuColor: string
  efficiencySamples?: EfficiencySample[]
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
      const overlays: { positions: [number, number][]; color: string }[] = []

      // Build efficiency lookup map once (O(n) instead of O(n²))
      const efficiencyMap = buildEfficiencyMap(efficiencySamples)

      let currentSegment: [number, number][] = []
      let currentColor: string | null = null
      let matchedCount = 0
      let totalCount = 0

      for (let idx = 0; idx < gpsTrack.length; idx++) {
        const point = gpsTrack[idx]
        if (!point.timestamp) continue

        totalCount++
        const pointTime = new Date(point.timestamp).getTime()

        // Lookup efficiency from pre-built map (O(1))
        const efficiency = getEfficiencyFromMap(pointTime, efficiencyMap, 1000)

        if (efficiency !== null) {
          matchedCount++
          const pointColor = getEfficiencyColor(efficiency)

          // Same color as current segment - add to it
          if (pointColor === currentColor) {
            currentSegment.push([point.lat, point.lon])
          } else {
            // Color changed - save current segment and start new one
            if (currentSegment.length > 1) {
              overlays.push({
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
          // No efficiency data - end current segment
          if (currentSegment.length > 1) {
            overlays.push({
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
        overlays.push({
          positions: currentSegment,
          color: currentColor
        })
      }

      console.log('[EfficiencyOverlay] GPS points:', totalCount, 'Matched:', matchedCount, `(${((matchedCount/totalCount)*100).toFixed(1)}%)`)
      console.log('[EfficiencyOverlay] Efficiency samples:', efficiencySamples.length)
      console.log('[EfficiencyOverlay] Base segments (with gaps):', baseSegs.length)

      return {
        baseSegments: baseSegs,
        overlaySegments: overlays
      }
    }

    // Mode 2: VTX overlay - show full route + green IMU segments
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
  }, [gpsTrack, imuTimeRanges, efficiencySamples, defaultColor, imuColor])

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
}

export function RideMap({
  gpsTrack,
  hoverIndex = null,
  onPointClick,
  colorBy = 'speed',
  className = '',
  imuTimeRanges = [],
  efficiencySamples
}: RideMapProps) {
  const [mounted, setMounted] = useState(false)
  const [isDark, setIsDark] = useState(false)

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

  // No need for static simplification - DynamicPolylines will handle it based on zoom

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

  // Calculate center and bounds from original track
  const centerLat = gpsTrack.reduce((sum, p) => sum + p.lat, 0) / gpsTrack.length
  const centerLon = gpsTrack.reduce((sum, p) => sum + p.lon, 0) / gpsTrack.length
  const positions: [number, number][] = gpsTrack.map(p => [p.lat, p.lon])

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
  const imuRouteColor = '#22c55e' // Green for IMU coverage

  return (
    <div className={`${className} relative`} style={{ zIndex: 1 }}>
      <MapContainer
        center={[centerLat, centerLon]}
        zoom={15}
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

        {/* Route polylines - full resolution */}
        <RoutePolylines
          fullTrack={gpsTrack}
          imuTimeRanges={imuTimeRanges}
          defaultColor={defaultRouteColor}
          imuColor={imuRouteColor}
          efficiencySamples={efficiencySamples}
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
