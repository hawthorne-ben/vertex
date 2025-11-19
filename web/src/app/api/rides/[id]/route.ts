import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

/**
 * DELETE /api/rides/[id]
 * Delete a ride and its associated FIT recording
 * Cascades to ride_recordings junction table
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
        ride_recordings (
          recording_id,
          recordings (
            id,
            storage_path,
            filename
          )
        )
      `)
      .eq('id', rideId)
      .single()

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

    // Delete associated FIT files from storage
    const fitRecordings = ride.ride_recordings
      ?.filter((rr: any) => rr.recordings?.file_type === 'fit' || rr.recordings?.storage_path)
      .map((rr: any) => rr.recordings) || []

    for (const recording of fitRecordings) {
      if (recording?.storage_path) {
        const { error: storageError } = await supabase.storage
          .from('recordings')
          .remove([recording.storage_path])

        if (storageError) {
          console.warn('Storage deletion failed (non-critical):', storageError)
        }
      }

      // Delete recording from database (this will cascade to ride_recordings via FK)
      if (recording?.id) {
        const { error: recError } = await supabase
          .from('recordings')
          .delete()
          .eq('id', recording.id)

        if (recError) {
          console.warn('Recording deletion failed:', recError)
        }
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
