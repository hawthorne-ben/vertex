import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

/**
 * DELETE /api/recordings/[id]
 * Delete a recording and its associated storage file
 * Uses RLS policies to ensure users can only delete their own recordings
 */
export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const params = await context.params
    const recordingId = params.id

    if (!recordingId) {
      return NextResponse.json(
        { error: 'Recording ID is required' },
        { status: 400 }
      )
    }

    // Create Supabase client with user's session (respects RLS)
    const supabase = await createClient()

    // Get user session
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    // Get recording info before deletion (RLS ensures user owns this)
    const { data: recording, error: fetchError } = await supabase
      .from('recordings')
      .select('id, filename, storage_path, user_id')
      .eq('id', recordingId)
      .single()

    if (fetchError || !recording) {
      return NextResponse.json(
        { error: 'Recording not found or access denied' },
        { status: 404 }
      )
    }

    // Double-check ownership (RLS should handle this, but belt and suspenders)
    if (recording.user_id !== user.id) {
      return NextResponse.json(
        { error: 'Access denied' },
        { status: 403 }
      )
    }

    // Delete from storage first
    if (recording.storage_path) {
      const { error: storageError } = await supabase.storage
        .from('recordings')
        .remove([recording.storage_path])

      if (storageError) {
        console.warn('Storage deletion failed (non-critical):', storageError)
        // Continue with database deletion even if storage fails
      }
    }

    // Delete database record (RLS ensures user owns this)
    const { error: deleteError } = await supabase
      .from('recordings')
      .delete()
      .eq('id', recordingId)

    if (deleteError) {
      console.error('Failed to delete recording:', deleteError)
      return NextResponse.json(
        { error: 'Failed to delete recording' },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      message: `Recording ${recording.filename} deleted successfully`
    })

  } catch (error) {
    console.error('Error deleting recording:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
