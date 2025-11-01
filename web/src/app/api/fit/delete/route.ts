import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

/**
 * Delete recording (VTX or FIT) and all associated data
 * Requires authentication and ownership verification
 *
 * NOTE: This endpoint is deprecated. Use DELETE /api/recordings/[id] instead.
 * This file is kept for backward compatibility but will be removed in future.
 */
export async function DELETE(request: NextRequest) {
  try {
    // Authenticate user
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json(
        { error: 'Unauthorized - Authentication required' },
        { status: 401 }
      )
    }

    const body = await request.json()
    const { fileId } = body

    if (!fileId) {
      return NextResponse.json(
        { error: 'Missing fileId' },
        { status: 400 }
      )
    }

    console.log(`🗑️ [DEPRECATED] Deleting recording ${fileId} via old endpoint`)

    // Get recording to verify ownership (RLS policies apply)
    const { data: recording, error: fetchError } = await supabase
      .from('recordings')
      .select('id, filename, storage_path, user_id')
      .eq('id', fileId)
      .single()

    if (fetchError || !recording) {
      console.error('Recording not found:', fetchError)
      return NextResponse.json(
        { error: 'Recording not found or access denied' },
        { status: 404 }
      )
    }

    // Verify ownership
    if (recording.user_id !== user.id) {
      return NextResponse.json(
        { error: 'Access denied - you do not own this recording' },
        { status: 403 }
      )
    }

    console.log(`📁 Found recording: ${recording.filename}`)

    // Delete storage file
    if (recording.storage_path) {
      try {
        const { error: storageError } = await supabase.storage
          .from('recordings')
          .remove([recording.storage_path])

        if (storageError) {
          console.warn('Warning: Failed to delete storage file:', storageError)
          // Don't fail the operation if storage cleanup fails
        } else {
          console.log(`✅ Deleted storage file for ${recording.filename}`)
        }
      } catch (storageErr) {
        console.warn('Warning: Storage cleanup failed:', storageErr)
        // Continue with database cleanup
      }
    }

    // Delete recording record (RLS policies apply)
    const { error: deleteError } = await supabase
      .from('recordings')
      .delete()
      .eq('id', fileId)

    if (deleteError) {
      console.error('Error deleting recording:', deleteError)
      return NextResponse.json(
        { error: 'Failed to delete recording' },
        { status: 500 }
      )
    }

    console.log(`✅ Successfully deleted recording ${fileId}`)

    return NextResponse.json({
      success: true,
      message: `Recording ${recording.filename} deleted successfully`,
      note: 'This endpoint is deprecated. Please use DELETE /api/recordings/[id] instead.'
    })

  } catch (error) {
    console.error('Recording deletion error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
