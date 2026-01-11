'use client'

import { useEffect, useState, useRef } from 'react'
import { MapContainer, TileLayer, Polyline, Marker, Popup, useMap } from 'react-leaflet'
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

interface GPSPoint {
  lat: number
  lon: number
  timestamp?: string
  speed?: number | null
  altitude?: number | null
}

interface RideMapProps {
  gpsTrack: GPSPoint[]
  hoverIndex?: number | null
  onPointClick?: (index: number) => void
  colorBy?: 'speed' | 'elevation' | 'none'
  className?: string
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

export function RideMap({
  gpsTrack,
  hoverIndex = null,
  onPointClick,
  colorBy = 'speed',
  className = ''
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

  // Convert to Leaflet format
  const positions: [number, number][] = gpsTrack.map(p => [p.lat, p.lon])

  // Calculate center
  const centerLat = gpsTrack.reduce((sum, p) => sum + p.lat, 0) / gpsTrack.length
  const centerLon = gpsTrack.reduce((sum, p) => sum + p.lon, 0) / gpsTrack.length

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

  // Theme-aware route color
  const routeColor = isDark ? '#ffffff' : '#000000'

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

        {/* Route polyline - theme-aware minimal */}
        <Polyline
          positions={positions}
          pathOptions={{
            color: routeColor,
            weight: 2,
            opacity: 0.7,
          }}
          eventHandlers={{
            click: (e) => {
              // Future: find closest point and trigger chart sync
            }
          }}
        />

        {/* Hover marker */}
        {hoverPosition && (
          <Marker position={hoverPosition} icon={hoverIcon}>
            <Popup>
              {gpsTrack[hoverIndex!].speed && (
                <div>Speed: {(gpsTrack[hoverIndex!].speed! * 2.23694).toFixed(1)} mph</div>
              )}
              {gpsTrack[hoverIndex!].altitude && (
                <div>Elevation: {(gpsTrack[hoverIndex!].altitude! * 3.28084).toFixed(0)} ft</div>
              )}
            </Popup>
          </Marker>
        )}

        {/* Start marker - green home icon */}
        <Marker position={positions[0]} icon={startIcon}>
          <Popup>Start</Popup>
        </Marker>

        {/* End marker - red home icon */}
        <Marker position={positions[positions.length - 1]} icon={endIcon}>
          <Popup>Finish</Popup>
        </Marker>
      </MapContainer>
    </div>
  )
}
