/**
 * Prerendered route-shape paths.
 *
 * A ride's thumbnail used to be drawn by fetching the ride's GPS through
 * /api/rides/[id]/samples, which downloads the whole FIT file from storage and
 * parses it server-side — the `fields` filter trims the response, not the work.
 * That is far too much to pay per card on a list page, so the shape is computed
 * once at parse time and stored on the ride row.
 *
 * The stored path is normalized into a fixed VIEWBOX square with aspect ratio
 * preserved, so a consumer renders it at any size by setting the SVG viewBox
 * and never has to know the original coordinates.
 */

/** Coordinate space of the stored path. Consumers render with this viewBox. */
export const ROUTE_PATH_VIEWBOX = 1000

/** Target point count after downsampling. Enough for a recognizable shape. */
const TARGET_POINTS = 150

export interface RouteBounds {
  minLat: number
  maxLat: number
  minLon: number
  maxLon: number
}

export interface RoutePathResult {
  path: string
  bounds: RouteBounds
}

/**
 * Build a normalized SVG path from a GPS track.
 *
 * Returns null when there is nothing meaningful to draw (fewer than two fixed
 * points), which the caller stores as NULL rather than an empty path — the
 * thumbnail then renders nothing, same as a ride with no GPS.
 */
export function buildRoutePath(
  points: Array<{ latitude?: number | null; longitude?: number | null }>,
): RoutePathResult | null {
  const coords: Array<[number, number]> = []
  for (const p of points) {
    const { latitude: lat, longitude: lon } = p
    // Reject non-finite values and the 0,0 null-island fix that some head units
    // emit before the GPS locks; a single one of those would blow the bounds out
    // to span half the planet and flatten the real route to a dot.
    if (lat == null || lon == null) continue
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue
    if (lat === 0 && lon === 0) continue
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) continue
    coords.push([lon, lat])
  }

  if (coords.length < 2) return null

  const stride = Math.max(1, Math.floor(coords.length / TARGET_POINTS))
  // Always keep the final point so the drawn route ends where the ride did,
  // rather than wherever the stride happened to land.
  const sampled = coords.filter((_, i) => i % stride === 0)
  const last = coords[coords.length - 1]
  if (sampled[sampled.length - 1] !== last) sampled.push(last)

  const lons = sampled.map(c => c[0])
  const lats = sampled.map(c => c[1])
  const minLon = Math.min(...lons)
  const maxLon = Math.max(...lons)
  const minLat = Math.min(...lats)
  const maxLat = Math.max(...lats)

  const spanLon = maxLon - minLon || 1e-6
  const spanLat = maxLat - minLat || 1e-6

  // Correct longitude for latitude compression so shapes are not stretched
  // east-west. Same projection the old client-side thumbnail used.
  const latRad = ((minLat + maxLat) / 2) * (Math.PI / 180)
  const geoW = spanLon * Math.cos(latRad)
  const geoH = spanLat

  // Fit into the viewBox preserving aspect ratio, centered. A degenerate span
  // (an out-and-back that is effectively a straight line) still scales, because
  // the 1e-6 floor keeps the divisor non-zero.
  const scale = Math.min(ROUTE_PATH_VIEWBOX / geoW, ROUTE_PATH_VIEWBOX / geoH)
  const drawW = geoW * scale
  const drawH = geoH * scale
  const offX = (ROUTE_PATH_VIEWBOX - drawW) / 2
  const offY = (ROUTE_PATH_VIEWBOX - drawH) / 2

  const path = sampled
    .map((c, i) => {
      const x = offX + (c[0] - minLon) * Math.cos(latRad) * scale
      // SVG y grows downward; invert latitude so north is up.
      const y = offY + (maxLat - c[1]) * scale
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`
    })
    .join(' ')

  return { path, bounds: { minLat, maxLat, minLon, maxLon } }
}
