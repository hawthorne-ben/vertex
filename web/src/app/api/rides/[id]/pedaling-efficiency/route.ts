import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { calculatePedalingEfficiency } from '@/lib/analysis/pedaling-efficiency'

export const dynamic = 'force-dynamic'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

/**
 * Get pedaling efficiency analysis for a ride
 *
 * Requires:
 * - Ride with FIT file (for GPS grade data)
 * - Ride with VTX recording (for IMU accel_x data)
 *
 * Query parameters:
 * - window_size: Smoothness calculation window in seconds (default: 3)
 * - lpf_cutoff: Low-pass filter cutoff Hz (default: 8)
 *
 * Returns:
 * - samples: Time series of efficiency scores
 * - metadata: Summary statistics
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: rideId } = await params
    const searchParams = request.nextUrl.searchParams

    // Parse query parameters
    const windowSize = parseInt(searchParams.get('window_size') || '3')
    const lpfCutoff = parseInt(searchParams.get('lpf_cutoff') || '8')
    const startTime = searchParams.get('start') || undefined
    const endTime = searchParams.get('end') || undefined

    // Get user from auth header
    const authHeader = request.headers.get('authorization')
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json(
        { error: 'Unauthorized - No auth token' },
        { status: 401 }
      )
    }

    const token = authHeader.replace('Bearer ', '')
    const { data: { user }, error: authError } = await supabase.auth.getUser(token)

    if (authError || !user) {
      return NextResponse.json(
        { error: 'Unauthorized - Invalid token' },
        { status: 401 }
      )
    }

    // Get ride with FIT and VTX recordings
    const { data: ride, error: rideError } = await supabase
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
            status,
            start_time,
            end_time
          )
        )
      `)
      .eq('id', rideId)
      .eq('user_id', user.id)
      .single()

    if (rideError || !ride) {
      return NextResponse.json(
        { error: 'Ride not found' },
        { status: 404 }
      )
    }

    // Find FIT and VTX recordings
    const fitRecording = ride.ride_recordings?.find(
      (rr: any) => rr.recordings?.file_type === 'fit'
    )?.recordings

    const vtxRecordings = ride.ride_recordings
      ?.filter((rr: any) => rr.recordings?.file_type === 'vtx' && rr.recordings?.status === 'ready')
      .map((rr: any) => ({
        id: rr.recordings.id,
        storage_path: rr.recordings.storage_path
      })) || []

    if (!fitRecording) {
      return NextResponse.json(
        { error: 'No FIT file associated with this ride' },
        { status: 404 }
      )
    }

    if (vtxRecordings.length === 0) {
      return NextResponse.json(
        { error: 'No VTX recordings associated with this ride' },
        { status: 404 }
      )
    }

    // Fetch FIT samples using internal API endpoint (reuses caching and parsing logic)
    const fitSamplesUrl = new URL(`${request.url.split('/pedaling-efficiency')[0]}/samples`, request.url)
    if (startTime) fitSamplesUrl.searchParams.set('start', startTime)
    if (endTime) fitSamplesUrl.searchParams.set('end', endTime)
    fitSamplesUrl.searchParams.set('fields', 'grade,altitude')  // Only need grade and altitude

    const fitResponse = await fetch(fitSamplesUrl, {
      headers: { 'Authorization': `Bearer ${token}` }
    })

    if (!fitResponse.ok) {
      throw new Error('Failed to fetch FIT samples')
    }

    const { samples: fitSamples } = await fitResponse.json()

    // Fetch VTX samples using internal API endpoint (reuses caching, parsing, and merging logic)
    const vtxSamplesUrl = new URL(`${request.url.split('/pedaling-efficiency')[0]}/vtx-samples`, request.url)
    if (startTime) vtxSamplesUrl.searchParams.set('start', startTime)
    if (endTime) vtxSamplesUrl.searchParams.set('end', endTime)
    vtxSamplesUrl.searchParams.set('fields', 'accel')  // Fetch all 3 axes for magnitude calculation
    // Note: Must fetch full resolution - pedaling efficiency depends on sub-second acceleration spikes
    // Downsampling would destroy the high-frequency signal we're analyzing
    vtxSamplesUrl.searchParams.set('downsample', 'none')

    const vtxResponse = await fetch(vtxSamplesUrl, {
      headers: { 'Authorization': `Bearer ${token}` }
    })

    if (!vtxResponse.ok) {
      throw new Error('Failed to fetch VTX samples')
    }

    const { samples: vtxSamples } = await vtxResponse.json()

    if (vtxSamples.length === 0) {
      return NextResponse.json(
        { error: 'No VTX samples found' },
        { status: 404 }
      )
    }

    // Transform VTX samples to expected format (with all 3 axes)
    const allVtxSamples = vtxSamples.map((s: any) => ({
      timestamp: s.timestamp,
      accel_x: s.accel?.x ?? 0,
      accel_y: s.accel?.y ?? 0,
      accel_z: s.accel?.z ?? 0
    }))

    // Run pedaling efficiency analysis
    const result = calculatePedalingEfficiency({
      vtxSamples: allVtxSamples,
      fitSamples: fitSamples.map((s: any) => ({
        timestamp: s.timestamp,
        grade: s.grade,
        altitude: s.altitude
      })),
      options: {
        windowSize,
        lpfCutoff
      }
    })

    return NextResponse.json({
      samples: result.samples,
      metadata: result.metadata
    })

  } catch (error: any) {
    console.error('Error calculating pedaling efficiency:', error)
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    )
  }
}
