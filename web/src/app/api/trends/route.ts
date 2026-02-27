import { NextRequest, NextResponse } from 'next/server'
import { withAuth } from '@/lib/api/auth'

export const dynamic = 'force-dynamic'

// Metric allowlist: friendly API names → column names + version columns + thresholds
const METRIC_CONFIG: Record<string, {
  column: string
  versionColumn: string
  unit: string
  stableThreshold: number  // Per-week threshold for stable vs improving/declining
}> = {
  stability: {
    column: 'avg_stability_percent',
    versionColumn: 'efficiency_version',
    unit: '%',
    stableThreshold: 0.5,
  },
  stable: {
    column: 'stable_pedaling_percent',
    versionColumn: 'efficiency_version',
    unit: '%',
    stableThreshold: 1.0,
  },
  unstable: {
    column: 'unstable_pedaling_percent',
    versionColumn: 'efficiency_version',
    unit: '%',
    stableThreshold: 1.0,
  },
  pedaling: {
    column: 'pedaling_percent',
    versionColumn: 'efficiency_version',
    unit: '%',
    stableThreshold: 2.0,
  },
  standing: {
    column: 'standing_percent',
    versionColumn: 'position_version',
    unit: '%',
    stableThreshold: 1.0,
  },
  avg_hr: {
    column: 'avg_heart_rate',
    versionColumn: 'efficiency_version',
    unit: 'bpm',
    stableThreshold: 1.0,
  },
  avg_power: {
    column: 'avg_power_watts',
    versionColumn: 'efficiency_version',
    unit: 'W',
    stableThreshold: 3.0,
  },
  avg_cadence: {
    column: 'avg_cadence',
    versionColumn: 'efficiency_version',
    unit: 'rpm',
    stableThreshold: 1.0,
  },
}

// Valid period values → SQL intervals
const PERIOD_INTERVALS: Record<string, string> = {
  '4w': '4 weeks',
  '8w': '8 weeks',
  '3m': '3 months',
  '6m': '6 months',
  '1y': '1 year',
}

/**
 * Calculate linear regression slope (units per week)
 */
function calculateTrendSlope(points: Array<{ date: string; value: number }>): number {
  if (points.length < 2) return 0

  const firstTime = new Date(points[0].date).getTime()
  const msPerWeek = 7 * 24 * 60 * 60 * 1000

  // x = weeks since first point, y = metric value
  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0
  const n = points.length

  for (const p of points) {
    const x = (new Date(p.date).getTime() - firstTime) / msPerWeek
    const y = p.value
    sumX += x
    sumY += y
    sumXY += x * y
    sumX2 += x * x
  }

  const denominator = n * sumX2 - sumX * sumX
  if (denominator === 0) return 0

  return (n * sumXY - sumX * sumY) / denominator
}

/**
 * GET /api/trends
 *
 * Query parameters:
 *   metric: comma-separated metric names from allowlist (required)
 *   period: lookback period - 4w, 8w, 3m, 6m, 1y, all (default: 8w)
 *   group_by: 'ride' (per-ride points) or 'week' (weekly averages) (default: ride)
 */
export async function GET(request: NextRequest) {
  try {
    const authResult = await withAuth(request)
    if ('error' in authResult) return authResult.error
    const { user, supabase } = authResult.data

    const searchParams = request.nextUrl.searchParams
    const metricParam = searchParams.get('metric')
    const period = searchParams.get('period') || '8w'
    const groupBy = searchParams.get('group_by') || 'ride'

    // Validate metric param
    if (!metricParam) {
      return NextResponse.json(
        { error: 'Missing required parameter: metric' },
        { status: 400 }
      )
    }

    const metricNames = metricParam.split(',').map(m => m.trim())
    const invalidMetrics = metricNames.filter(m => !METRIC_CONFIG[m])
    if (invalidMetrics.length > 0) {
      return NextResponse.json(
        { error: `Unknown metrics: ${invalidMetrics.join(', ')}. Valid: ${Object.keys(METRIC_CONFIG).join(', ')}` },
        { status: 400 }
      )
    }

    // Validate period
    if (period !== 'all' && !PERIOD_INTERVALS[period]) {
      return NextResponse.json(
        { error: `Invalid period: ${period}. Valid: ${Object.keys(PERIOD_INTERVALS).join(', ')}, all` },
        { status: 400 }
      )
    }

    // Validate group_by
    if (groupBy !== 'ride' && groupBy !== 'week') {
      return NextResponse.json(
        { error: 'Invalid group_by: must be "ride" or "week"' },
        { status: 400 }
      )
    }

    // Build date filter
    const periodInterval = period === 'all' ? null : PERIOD_INTERVALS[period]

    // Query each metric
    const metrics: Record<string, any> = {}
    const algorithmVersions: Record<string, { versions: string[]; mixed: boolean }> = {}
    let totalRideCount = 0

    for (const metricName of metricNames) {
      const config = METRIC_CONFIG[metricName]

      if (groupBy === 'week') {
        // Fetch all points then aggregate by week in JS
        const points = await fetchMetricPoints(supabase, user.id, config, periodInterval)

        if (points.length === 0) {
          metrics[metricName] = { points: [], stats: null }
          continue
        }

        // Group by ISO week
        const weekMap = new Map<string, { values: number[]; count: number }>()
        for (const p of points) {
          const date = new Date(p.date)
          const weekStart = getISOWeekStart(date)
          const weekKey = weekStart.toISOString().slice(0, 10)
          if (!weekMap.has(weekKey)) weekMap.set(weekKey, { values: [], count: 0 })
          const entry = weekMap.get(weekKey)!
          entry.values.push(p.value)
          entry.count++
        }

        const weeklyPoints = Array.from(weekMap.entries())
          .map(([week, data]) => ({
            week,
            value: Math.round((data.values.reduce((a, b) => a + b, 0) / data.values.length) * 10) / 10,
            rideCount: data.count,
          }))
          .sort((a, b) => a.week.localeCompare(b.week))

        const allValues = weeklyPoints.map(p => p.value)
        const trend = calculateTrendSlope(
          weeklyPoints.map(p => ({ date: p.week, value: p.value }))
        )

        metrics[metricName] = {
          points: weeklyPoints,
          stats: {
            current: allValues[allValues.length - 1],
            periodAvg: Math.round((allValues.reduce((a, b) => a + b, 0) / allValues.length) * 10) / 10,
            periodMin: Math.round(Math.min(...allValues) * 10) / 10,
            periodMax: Math.round(Math.max(...allValues) * 10) / 10,
            trend: Math.round(trend * 100) / 100,
            trendDirection: getTrendDirection(trend, config.stableThreshold, metricName),
          },
        }

        // Collect versions from raw points
        const versions = [...new Set(points.map(p => p.version).filter(Boolean))]
        algorithmVersions[metricName] = {
          versions,
          mixed: versions.length > 1,
        }

        totalRideCount = Math.max(totalRideCount, points.length)
      } else {
        // Per-ride query
        const points = await fetchMetricPoints(supabase, user.id, config, periodInterval)

        if (points.length === 0) {
          metrics[metricName] = { points: [], stats: null }
          continue
        }

        const values = points.map(p => p.value)
        const trend = calculateTrendSlope(points)

        metrics[metricName] = {
          points: points.map(p => ({
            date: p.date,
            value: Math.round(p.value * 10) / 10,
            rideId: p.rideId,
            rideName: p.rideName,
          })),
          stats: {
            current: Math.round(values[values.length - 1] * 10) / 10,
            periodAvg: Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10,
            periodMin: Math.round(Math.min(...values) * 10) / 10,
            periodMax: Math.round(Math.max(...values) * 10) / 10,
            trend: Math.round(trend * 100) / 100,
            trendDirection: getTrendDirection(trend, config.stableThreshold, metricName),
          },
        }

        // Collect versions
        const versions = [...new Set(points.map(p => p.version).filter(Boolean))]
        algorithmVersions[metricName] = {
          versions,
          mixed: versions.length > 1,
        }

        totalRideCount = Math.max(totalRideCount, points.length)
      }
    }

    // Calculate period bounds
    const now = new Date()
    let periodStart: string
    if (period === 'all') {
      // Find earliest point across all metrics
      let earliest = now.toISOString()
      for (const m of Object.values(metrics)) {
        const pts = m.points || []
        if (pts.length > 0) {
          const first = pts[0].date || pts[0].week
          if (first < earliest) earliest = first
        }
      }
      periodStart = earliest
    } else {
      const interval = PERIOD_INTERVALS[period]
      const match = interval.match(/(\d+)\s+(\w+)/)
      if (match) {
        const [, num, unit] = match
        const start = new Date(now)
        if (unit === 'weeks') start.setDate(start.getDate() - parseInt(num) * 7)
        else if (unit === 'months') start.setMonth(start.getMonth() - parseInt(num))
        else if (unit === 'year') start.setFullYear(start.getFullYear() - parseInt(num))
        periodStart = start.toISOString().slice(0, 10)
      } else {
        periodStart = now.toISOString().slice(0, 10)
      }
    }

    return NextResponse.json({
      metrics,
      period: {
        start: periodStart,
        end: now.toISOString().slice(0, 10),
      },
      rideCount: totalRideCount,
      algorithmVersions,
    })
  } catch (error: any) {
    console.error('Error fetching trends:', error)
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    )
  }
}

/**
 * Fetch per-ride metric points from ride_summaries
 */
async function fetchMetricPoints(
  supabase: any,
  userId: string,
  config: typeof METRIC_CONFIG[string],
  periodInterval: string | null,
): Promise<Array<{ date: string; value: number; rideId: string; rideName: string; version: string }>> {
  // Build query — select specific columns
  // We need: ride_started_at, metric column, version column, ride_id
  // Plus join to rides for name
  let query = supabase
    .from('ride_summaries')
    .select(`
      ride_started_at,
      ${config.column},
      ${config.versionColumn},
      ride_id,
      rides!ride_summaries_ride_id_fkey(name)
    `)
    .eq('user_id', userId)
    .not(config.column, 'is', null)
    .order('ride_started_at', { ascending: true })

  // Apply date filter
  if (periodInterval) {
    const now = new Date()
    const match = periodInterval.match(/(\d+)\s+(\w+)/)
    if (match) {
      const [, num, unit] = match
      const start = new Date(now)
      if (unit === 'weeks') start.setDate(start.getDate() - parseInt(num) * 7)
      else if (unit === 'months') start.setMonth(start.getMonth() - parseInt(num))
      else if (unit === 'year') start.setFullYear(start.getFullYear() - parseInt(num))
      query = query.gte('ride_started_at', start.toISOString())
    }
  }

  const { data, error } = await query

  if (error) {
    console.error(`Failed to fetch metric ${config.column}:`, error.message)
    return []
  }

  return (data || []).map((row: any) => ({
    date: row.ride_started_at,
    value: row[config.column],
    rideId: row.ride_id,
    rideName: row.rides?.name || 'Untitled Ride',
    version: row[config.versionColumn] || '',
  }))
}

/**
 * Get ISO week start (Monday) for a date
 */
function getISOWeekStart(date: Date): Date {
  const d = new Date(date)
  const day = d.getDay()
  const diff = d.getDate() - day + (day === 0 ? -6 : 1) // Monday
  d.setDate(diff)
  d.setHours(0, 0, 0, 0)
  return d
}

/**
 * Determine trend direction based on slope and metric-specific threshold
 * For "rough" metric, lower is better (invert direction)
 */
function getTrendDirection(
  slope: number,
  threshold: number,
  metricName: string,
): 'improving' | 'declining' | 'stable' {
  const absSlope = Math.abs(slope)
  if (absSlope <= threshold) return 'stable'

  // For "rough" percent, a negative trend (decreasing roughness) is improving
  const invertedMetrics = ['rough']
  const isInverted = invertedMetrics.includes(metricName)

  if (slope > 0) return isInverted ? 'declining' : 'improving'
  return isInverted ? 'improving' : 'declining'
}
