import { NextRequest, NextResponse } from 'next/server'
import { withAuth } from '@/lib/api/auth'

export const dynamic = 'force-dynamic'

/**
 * GET /api/rides - List all rides for authenticated user
 * Includes FIT recording info and ride summary metrics
 */
export async function GET(request: NextRequest) {
  const authResult = await withAuth(request)
  if ('error' in authResult) return authResult.error
  const { user, supabase } = authResult.data

  try {
    // Fetch rides with associated recordings (same query as web rides page)
    const { data: rides, error: ridesError } = await supabase
      .from('rides')
      .select(`
        *,
        ride_recordings (
          recording_id,
          recordings (
            id,
            filename,
            file_type,
            storage_path,
            analysis_results
          )
        )
      `)
      .eq('user_id', user.id)
      .order('start_time', { ascending: false })

    if (ridesError) {
      console.error('Failed to fetch rides:', ridesError)
      return NextResponse.json({ error: 'Failed to fetch rides' }, { status: 500 })
    }

    // Fetch ride summaries for mini-metrics
    const rideIds = (rides || []).map(r => r.id)
    let summariesMap: Record<string, any> = {}

    if (rideIds.length > 0) {
      const { data: summaries } = await supabase
        .from('ride_summaries')
        .select('ride_id, avg_efficiency_percent, smooth_percent, rough_percent, standing_percent, seated_percent, avg_heart_rate, avg_power_watts, avg_cadence, max_heart_rate, max_power_watts, max_cadence, avg_cadence_standing, avg_cadence_seated')
        .in('ride_id', rideIds)

      if (summaries) {
        for (const s of summaries) {
          summariesMap[s.ride_id] = s
        }
      }
    }

    // Transform to include FIT recording info and summary
    const ridesWithRecordings = (rides || []).map(ride => {
      const fitRecording = ride.ride_recordings?.find(
        (rr: any) => rr.recordings?.file_type === 'fit'
      )?.recordings

      const summary = summariesMap[ride.id] || null

      // Strip ride_recordings from response (already extracted what we need)
      const { ride_recordings, ...rideFields } = ride

      return {
        ...rideFields,
        fit_recording_id: fitRecording?.id || null,
        fit_filename: fitRecording?.filename || null,
        fit_storage_path: fitRecording?.storage_path || null,
        analysis_results: fitRecording?.analysis_results || {},
        summary: summary ? {
          avg_efficiency_percent: summary.avg_efficiency_percent,
          smooth_percent: summary.smooth_percent,
          rough_percent: summary.rough_percent,
          standing_percent: summary.standing_percent,
          seated_percent: summary.seated_percent,
          avg_heart_rate: summary.avg_heart_rate,
          avg_power_watts: summary.avg_power_watts,
          avg_cadence: summary.avg_cadence,
          max_heart_rate: summary.max_heart_rate,
          max_power_watts: summary.max_power_watts,
          max_cadence: summary.max_cadence,
          avg_cadence_standing: summary.avg_cadence_standing,
          avg_cadence_seated: summary.avg_cadence_seated,
        } : null,
      }
    })

    return NextResponse.json({ rides: ridesWithRecordings })
  } catch (error) {
    console.error('Error in GET /api/rides:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
