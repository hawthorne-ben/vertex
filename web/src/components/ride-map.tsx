'use client'

import { useEffect, useState, useRef, useMemo } from 'react'
import { MapContainer, TileLayer, Polyline, Marker, Popup, useMap } from 'react-leaflet'
import L from 'leaflet'
import { Home } from 'lucide-react'
import { renderToStaticMarkup } from 'react-dom/server'
import { simplifyGPSTrack } from '@/lib/geo/douglas-peucker'
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

interface RideMapProps {
  gpsTrack: GPSPoint[]
  hoverIndex?: number | null
  onPointClick?: (index: number) => void
  colorBy?: 'speed' | 'elevation' | 'none'
  className?: string
  imuTimeRanges?: IMUTimeRange[] // Time ranges where IMU data exists
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

// Component to dynamically adjust polyline detail based on zoom level
function DynamicPolylines({
  fullTrack,
  imuTimeRanges,
  defaultColor,
  imuColor
}: {
  fullTrack: GPSPoint[]
  imuTimeRanges: IMUTimeRange[]
  defaultColor: string
  imuColor: string
}) {
  const map = useMap()
  const [zoom, setZoom] = useState(map.getZoom())

  useEffect(() => {
    const handleZoom = () => {
      setZoom(map.getZoom())
    }

    map.on('zoomend', handleZoom)
    return () => {
      map.off('zoomend', handleZoom)
    }
  }, [map])

  // Adjust simplification based on zoom level
  const simplifiedTrack = useMemo(() => {
    // More detail at higher zoom levels
    // Zoom 10 (city level): 0.0005 (~55m)
    // Zoom 13 (neighborhood): 0.0002 (~22m)
    // Zoom 15+ (street level): 0.00005 (~5m)
    let epsilon: number
    if (zoom >= 15) {
      epsilon = 0.00005 // High detail
    } else if (zoom >= 13) {
      epsilon = 0.0001 // Medium detail
    } else if (zoom >= 11) {
      epsilon = 0.0002 // Low detail
    } else {
      epsilon = 0.0005 // Very low detail
    }

    return simplifyGPSTrack(fullTrack, epsilon).simplified
  }, [fullTrack, zoom])

  // Split into IMU segments
  const segments = useMemo(() => {
    const hasIMUData = (timestamp: string): boolean => {
      if (imuTimeRanges.length === 0) return false
      const pointTime = new Date(timestamp).getTime()
      return imuTimeRanges.some(range => pointTime >= range.start && pointTime <= range.end)
    }

    const segs: { positions: [number, number][]; hasIMU: boolean }[] = []
    let currentSegment: [number, number][] = []
    let currentHasIMU = false

    simplifiedTrack.forEach((point, idx) => {
      const pointHasIMU = point.timestamp ? hasIMUData(point.timestamp) : false

      if (idx === 0) {
        currentHasIMU = pointHasIMU
        currentSegment.push([point.lat, point.lon])
      } else if (pointHasIMU === currentHasIMU) {
        currentSegment.push([point.lat, point.lon])
      } else {
        if (currentSegment.length > 0) {
          segs.push({ positions: [...currentSegment], hasIMU: currentHasIMU })
        }
        currentSegment = [[simplifiedTrack[idx - 1].lat, simplifiedTrack[idx - 1].lon], [point.lat, point.lon]]
        currentHasIMU = pointHasIMU
      }
    })

    if (currentSegment.length > 0) {
      segs.push({ positions: currentSegment, hasIMU: currentHasIMU })
    }

    return segs
  }, [simplifiedTrack, imuTimeRanges])

  return (
    <>
      {segments.map((segment, idx) => (
        <Polyline
          key={`segment-${idx}-zoom-${zoom}`}
          positions={segment.positions}
          pathOptions={{
            color: segment.hasIMU ? imuColor : defaultColor,
            weight: 3,
            opacity: 0.8,
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
  imuTimeRanges = []
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
        scrollWheelZoom={true}
        zoomControl={false} // Remove default zoom control
      >
        {/* Minimal theme-aware tiles (no labels, just roads and topo) */}
        <TileLayer
          attribution={tileAttribution}
          url={tileUrl}
        />

        <FitBounds positions={positions} />

        {/* Route polylines - dynamically simplified based on zoom */}
        <DynamicPolylines
          fullTrack={gpsTrack}
          imuTimeRanges={imuTimeRanges}
          defaultColor={defaultRouteColor}
          imuColor={imuRouteColor}
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
