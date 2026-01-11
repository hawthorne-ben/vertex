import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/**
 * POST /api/rides/[id]/recordings
 * Associate VTX recordings with a ride
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: rideId } = await params
    const { recordingIds } = await request.json()

    if (!recordingIds || !Array.isArray(recordingIds) || recordingIds.length === 0) {
      return NextResponse.json(
        { error: 'recordingIds array is required' },
        { status: 400 }
      )
    }

    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    // Verify ride exists and belongs to user
    const { data: ride, error: rideError } = await supabase
      .from('rides')
      .select('id, user_id')
      .eq('id', rideId)
      .eq('user_id', user.id)
      .single()

    if (rideError || !ride) {
      return NextResponse.json(
        { error: 'Ride not found' },
        { status: 404 }
      )
    }

    // Verify all recordings exist and belong to user
    const { data: recordings, error: recordingsError } = await supabase
      .from('recordings')
      .select('id, file_type')
      .in('id', recordingIds)
      .eq('user_id', user.id)
      .eq('status', 'ready')

    if (recordingsError || !recordings || recordings.length !== recordingIds.length) {
      return NextResponse.json(
        { error: 'One or more recordings not found or not ready' },
        { status: 404 }
      )
    }

    // Verify all are VTX files
    const nonVtxFiles = recordings.filter(r => r.file_type !== 'vtx')
    if (nonVtxFiles.length > 0) {
      return NextResponse.json(
        { error: 'Only VTX recordings can be associated with rides' },
        { status: 400 }
      )
    }

    // Check for existing associations to avoid duplicates
    const { data: existingAssociations } = await supabase
      .from('ride_recordings')
      .select('recording_id')
      .eq('ride_id', rideId)
      .in('recording_id', recordingIds)

    const existingRecordingIds = new Set(
      existingAssociations?.map(a => a.recording_id) || []
    )

    // Filter out already associated recordings
    const newRecordingIds = recordingIds.filter(id => !existingRecordingIds.has(id))

    if (newRecordingIds.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'All recordings already associated',
        added: 0,
        skipped: recordingIds.length
      })
    }

    // Create new associations
    const associations = newRecordingIds.map(recordingId => ({
      ride_id: rideId,
      recording_id: recordingId
    }))

    const { error: insertError } = await supabase
      .from('ride_recordings')
      .insert(associations)

    if (insertError) {
      console.error('Failed to create associations:', insertError)
      return NextResponse.json(
        { error: 'Failed to create associations', details: insertError.message },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      message: `Successfully associated ${newRecordingIds.length} recording(s)`,
      added: newRecordingIds.length,
      skipped: existingRecordingIds.size
    })

  } catch (error) {
    console.error('Association error:', error)
    return NextResponse.json(
      { error: 'Internal server error', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}

/**
 * DELETE /api/rides/[id]/recordings?recordingId=xxx
 * Remove association between ride and recording
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: rideId } = await params
    const searchParams = request.nextUrl.searchParams
    const recordingId = searchParams.get('recordingId')

    if (!recordingId) {
      return NextResponse.json(
        { error: 'recordingId query parameter is required' },
        { status: 400 }
      )
    }

    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    // Verify ride belongs to user
    const { data: ride, error: rideError } = await supabase
      .from('rides')
      .select('id, user_id')
      .eq('id', rideId)
      .eq('user_id', user.id)
      .single()

    if (rideError || !ride) {
      return NextResponse.json(
        { error: 'Ride not found' },
        { status: 404 }
      )
    }

    // Delete association
    const { error: deleteError } = await supabase
      .from('ride_recordings')
      .delete()
      .eq('ride_id', rideId)
      .eq('recording_id', recordingId)

    if (deleteError) {
      console.error('Failed to delete association:', deleteError)
      return NextResponse.json(
        { error: 'Failed to delete association', details: deleteError.message },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      message: 'Association removed successfully'
    })

  } catch (error) {
    console.error('Delete association error:', error)
    return NextResponse.json(
      { error: 'Internal server error', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
