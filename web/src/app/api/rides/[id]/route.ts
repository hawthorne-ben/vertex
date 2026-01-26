import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

type RecordingData = {
  id: string
  storage_path: string
  file_type: string
}

type RideRecordingData = {
  recording_id: string
  recordings: RecordingData | null
}

type RideWithRecordings = {
  id: string
  name: string
  user_id: string
  merged_vtx_path: string | null
  ride_recordings: RideRecordingData[] | null
}

/**
 * DELETE /api/rides/[id]
 * Delete a ride and its associated data
 * - Deletes the ride record (cascades to ride_recordings junction table)
 * - Deletes the FIT recording file and database record (one ride = one FIT file)
 * - Deletes merged VTX file from storage if it exists
 * - Does NOT delete VTX/IMU recordings (can be reused for other rides)
 * Uses RLS policies to ensure users can only delete their own rides
 */
export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const params = await context.params
    const rideId = params.id

    if (!rideId) {
      return NextResponse.json(
        { error: 'Ride ID is required' },
        { status: 400 }
      )
    }

    const supabase = await createClient()

    // Get user session
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    // Get ride with associated recordings
    const { data: ride, error: fetchError } = await supabase
      .from('rides')
      .select(`
        id,
        name,
        user_id,
        merged_vtx_path,
        ride_recordings (
          recording_id,
          recordings (
            id,
            storage_path,
            file_type
          )
        )
      `)
      .eq('id', rideId)
      .single() as { data: RideWithRecordings | null, error: any }

    if (fetchError || !ride) {
      return NextResponse.json(
        { error: 'Ride not found or access denied' },
        { status: 404 }
      )
    }

    // Double-check ownership
    if (ride.user_id !== user.id) {
      return NextResponse.json(
        { error: 'Access denied' },
        { status: 403 }
      )
    }

    // Delete FIT recording (file + database record) - one ride = one FIT file
    const fitRecording = ride.ride_recordings
      ?.find((rr) => rr.recordings?.file_type === 'fit')?.recordings

    if (fitRecording) {
      // Delete FIT file from storage
      if (fitRecording.storage_path) {
        const { error: storageError } = await supabase.storage
          .from('recordings')
          .remove([fitRecording.storage_path])

        if (storageError) {
          console.warn('FIT file deletion failed (non-critical):', storageError)
        }
      }

      // Delete FIT recording from database
      const { error: recError } = await supabase
        .from('recordings')
        .delete()
        .eq('id', fitRecording.id)

      if (recError) {
        console.warn('FIT recording deletion failed:', recError)
      }
    }

    // Delete merged VTX file from storage if it exists
    if (ride.merged_vtx_path) {
      const { error: storageError } = await supabase.storage
        .from('recordings')
        .remove([ride.merged_vtx_path])

      if (storageError) {
        console.warn('Merged VTX deletion failed (non-critical):', storageError)
      }
    }

    // Delete ride record (cascade will handle ride_recordings junction table)
    const { error: deleteError } = await supabase
      .from('rides')
      .delete()
      .eq('id', rideId)

    if (deleteError) {
      console.error('Failed to delete ride:', deleteError)
      return NextResponse.json(
        { error: 'Failed to delete ride' },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      message: `Ride "${ride.name}" deleted successfully`
    })

  } catch (error) {
    console.error('Error deleting ride:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
