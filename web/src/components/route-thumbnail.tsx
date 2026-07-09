'use client'

import { useEffect, useState } from 'react'
import { useAuthFetch } from '@/hooks/useAuthFetch'

interface RouteThumbnailProps {
  rideId: string
  color?: string
  width?: number
  height?: number
  className?: string
}

/**
 * Lightweight route-shape thumbnail for the dashboard hero. Fetches only the
 * ride's GPS lat/lon (via the samples endpoint's `fields` filter), downsamples,
 * and renders an inline SVG polyline — no Leaflet, no tiles. Renders nothing if
 * the ride has no GPS track.
 */
export function RouteThumbnail({
  rideId,
  color = 'hsl(var(--primary))',
  width = 120,
  height = 72,
  className = '',
}: RouteThumbnailProps) {
  const { authFetch } = useAuthFetch()
  const [path, setPath] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const res = await authFetch(`/api/rides/${rideId}/samples?fields=latitude,longitude`)
        if (!res.ok || cancelled) return
        const json = await res.json()
        const raw: Array<{ latitude?: number | null; longitude?: number | null }> = json.samples ?? []
        const coords = raw
          .filter(s => s.latitude != null && s.longitude != null)
          .map(s => [s.longitude as number, s.latitude as number] as [number, number])
        if (coords.length < 2) return

        // Downsample to at most ~150 points for a clean, cheap path.
        const stride = Math.max(1, Math.floor(coords.length / 150))
        const sampled = coords.filter((_, i) => i % stride === 0)

        // Project to the SVG box, preserving aspect ratio, with padding.
        const lons = sampled.map(c => c[0])
        const lats = sampled.map(c => c[1])
        const minLon = Math.min(...lons), maxLon = Math.max(...lons)
        const minLat = Math.min(...lats), maxLat = Math.max(...lats)
        const pad = 6
        const w = width - pad * 2
        const h = height - pad * 2
        const spanLon = maxLon - minLon || 1e-6
        const spanLat = maxLat - minLat || 1e-6
        // Correct longitude for latitude compression so shapes aren't stretched.
        const latRad = ((minLat + maxLat) / 2) * (Math.PI / 180)
        const geoW = spanLon * Math.cos(latRad)
        const geoH = spanLat
        const scale = Math.min(w / geoW, h / geoH)
        const drawW = geoW * scale
        const drawH = geoH * scale
        const offX = pad + (w - drawW) / 2
        const offY = pad + (h - drawH) / 2

        const d = sampled
          .map((c, i) => {
            const x = offX + (c[0] - minLon) * Math.cos(latRad) * scale
            // SVG y grows downward; invert latitude.
            const y = offY + (maxLat - c[1]) * scale
            return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`
          })
          .join(' ')

        if (!cancelled) setPath(d)
      } catch {
        // non-critical — hero renders fine without the thumbnail
      }
    }
    load()
    return () => { cancelled = true }
  }, [authFetch, rideId, width, height])

  if (!path) return null

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={className}
      aria-hidden="true"
    >
      <path
        d={path}
        fill="none"
        stroke={color}
        strokeWidth={2}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  )
}
