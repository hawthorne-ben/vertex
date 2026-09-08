import { ROUTE_PATH_VIEWBOX } from '@/lib/utils/route-path'

interface RouteThumbnailProps {
  /**
   * Prerendered path from rides.route_path — a normalized SVG path in a
   * 0..1000 viewBox. Null/undefined means the ride has no drawable GPS track
   * (or predates the backfill), and the component renders nothing.
   */
  routePath?: string | null
  color?: string
  width?: number
  height?: number
  className?: string
}

/**
 * Route-shape thumbnail.
 *
 * Pure presentation: it takes the path straight off the ride row and draws it.
 * There is deliberately no fetch here — this component used to pull the ride's
 * GPS through /api/rides/[id]/samples, which downloads and parses the entire
 * FIT file server-side on every call. On an unpaginated rides list that was one
 * full FIT parse per card. The shape is now computed once at parse time
 * (migration 011, buildRoutePath) and stored on the row, so a thumbnail costs
 * nothing beyond data the list already has.
 *
 * The stored path is normalized into a square viewBox with aspect ratio already
 * applied, so rendering at any size is just a viewBox mapping.
 */
export function RouteThumbnail({
  routePath,
  color = 'hsl(var(--primary))',
  width = 120,
  height = 72,
  className = '',
}: RouteThumbnailProps) {
  if (!routePath) return null

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${ROUTE_PATH_VIEWBOX} ${ROUTE_PATH_VIEWBOX}`}
      // The path is normalized into a square; letterbox it into the requested
      // box rather than stretching the route out of shape.
      preserveAspectRatio="xMidYMid meet"
      className={className}
      aria-hidden="true"
    >
      <path
        d={routePath}
        fill="none"
        stroke={color}
        strokeWidth={2}
        vectorEffect="non-scaling-stroke"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  )
}
