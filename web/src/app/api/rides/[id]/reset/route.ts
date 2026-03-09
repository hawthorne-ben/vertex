import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { createClient } from '@supabase/supabase-js'
import { inngest } from '@/inngest/client'

export const dynamic = 'force-dynamic'

// Service-role client for storage operations
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

/**
 * POST /api/rides/[id]/reset
 *
 * Hard reset a ride's IMU data and analysis results.
 * Removes all VTX associations, merged VTX file, analysis records,
 * and ride summary. Does NOT delete the ride or its FIT recording.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: rideId } = await params

    const supabase = await createServerClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Verify ride ownership and get merged VTX path
    const { data: ride, error: rideError } = await supabase
      .from('rides')
      .select('id, user_id, merged_vtx_path')
      .eq('id', rideId)
      .eq('user_id', user.id)
      .single()

    if (rideError || !ride) {
      return NextResponse.json({ error: 'Ride not found' }, { status: 404 })
    }

    // 1. Delete all analysis records
    await supabaseAdmin
      .from('ride_analysis')
      .delete()
      .eq('ride_id', rideId)

    // 2. Delete ride summary
    await supabaseAdmin
      .from('ride_summaries')
      .delete()
      .eq('ride_id', rideId)

    // 3. Remove VTX recording associations (keep FIT)
    // First get VTX recording IDs to only delete those
    const { data: vtxAssociations } = await supabase
      .from('ride_recordings')
      .select('recording_id, recordings!inner(file_type)')
      .eq('ride_id', rideId)
      .neq('recordings.file_type', 'fit')

    if (vtxAssociations && vtxAssociations.length > 0) {
      const vtxRecordingIds = vtxAssociations.map(a => a.recording_id)
      await supabaseAdmin
        .from('ride_recordings')
        .delete()
        .eq('ride_id', rideId)
        .in('recording_id', vtxRecordingIds)
    }

    // 4. Delete merged VTX file from storage
    if (ride.merged_vtx_path) {
      await supabaseAdmin.storage
        .from('recordings')
        .remove([ride.merged_vtx_path])
    }

    // 5. Clear merged VTX fields on ride
    await supabaseAdmin
      .from('rides')
      .update({
        merged_vtx_path: null,
        merged_vtx_file_size_bytes: null,
        merged_at: null,
      })
      .eq('id', rideId)

    return NextResponse.json({
      success: true,
      message: 'Ride IMU data and analysis reset successfully',
    })
  } catch (error) {
    console.error('Reset error:', error)
    return NextResponse.json(
      { error: 'Internal server error', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
