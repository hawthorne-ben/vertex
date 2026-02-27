import { NextRequest, NextResponse } from 'next/server'
import { withAuth } from '@/lib/api/auth'

export const dynamic = 'force-dynamic'

/**
 * GET /api/rides/[id]/comparisons
 * Returns this ride's key metrics compared against the user's 8-week rolling average.
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const authResult = await withAuth(request)
  if ('error' in authResult) return authResult.error
  const { user, supabase } = authResult.data

  const { id: rideId } = await context.params

  // Fetch this ride's summary
  const { data: summary, error: summaryError } = await supabase
    .from('ride_summaries')
    .select('avg_stability_percent, standing_percent, avg_heart_rate, avg_power_watts, ride_started_at')
    .eq('ride_id', rideId)
    .eq('user_id', user.id)
    .maybeSingle()

  if (summaryError) {
    return NextResponse.json({ error: 'Failed to fetch ride summary' }, { status: 500 })
  }

  if (!summary) {
    return NextResponse.json({ comparisons: null })
  }

  // Fetch 8-week rolling averages from all rides
  const eightWeeksAgo = new Date(Date.now() - 8 * 7 * 24 * 60 * 60 * 1000).toISOString()

  const { data: others } = await supabase
    .from('ride_summaries')
    .select('avg_stability_percent, standing_percent, avg_heart_rate, avg_power_watts')
    .eq('user_id', user.id)
    .gte('ride_started_at', eightWeeksAgo)

  if (!others || others.length === 0) {
    return NextResponse.json({ comparisons: null })
  }

  const avg = (arr: (number | null)[]) => {
    const valid = arr.filter((v): v is number => v !== null)
    return valid.length > 0 ? valid.reduce((a, b) => a + b, 0) / valid.length : null
  }

  const avgStability = avg(others.map(r => r.avg_stability_percent))
  const avgStanding = avg(others.map(r => r.standing_percent))
  const avgHr = avg(others.map(r => r.avg_heart_rate))
  const avgPower = avg(others.map(r => r.avg_power_watts))

  const comparisons: Record<string, { value: number; average: number } | null> = {
    stability: summary.avg_stability_percent != null && avgStability != null
      ? { value: summary.avg_stability_percent, average: avgStability } : null,
    standing: summary.standing_percent != null && avgStanding != null
      ? { value: summary.standing_percent, average: avgStanding } : null,
    avgHr: summary.avg_heart_rate != null && avgHr != null
      ? { value: summary.avg_heart_rate, average: avgHr } : null,
    avgPower: summary.avg_power_watts != null && avgPower != null
      ? { value: summary.avg_power_watts, average: avgPower } : null,
  }

  return NextResponse.json({ comparisons })
}
