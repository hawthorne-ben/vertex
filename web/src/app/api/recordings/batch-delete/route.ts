import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

/**
 * POST /api/recordings/batch-delete
 *
 * Delete multiple recordings at once
 * Limit: 100 recordings per request
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { recordingIds } = body

    // Validate input
    if (!Array.isArray(recordingIds) || recordingIds.length === 0) {
      return NextResponse.json(
        { error: 'recordingIds must be a non-empty array' },
        { status: 400 }
      )
    }

    if (recordingIds.length > 100) {
      return NextResponse.json(
        { error: 'Maximum 100 recordings can be deleted at once' },
        { status: 400 }
      )
    }

    // Create Supabase client (respects RLS)
    const supabase = await createClient()

    // Get user session
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    // Fetch recordings to delete (RLS ensures user owns them)
    const { data: recordings, error: fetchError } = await supabase
      .from('recordings')
      .select('id, storage_path, filename')
      .in('id', recordingIds)

    if (fetchError) {
      console.error('Failed to fetch recordings:', fetchError)
      return NextResponse.json(
        { error: 'Failed to fetch recordings' },
        { status: 500 }
      )
    }

    if (!recordings || recordings.length === 0) {
      return NextResponse.json(
        { error: 'No recordings found or access denied' },
        { status: 404 }
      )
    }

    // Delete from storage (parallel, best-effort)
    const storagePaths = recordings.map(r => r.storage_path).filter(Boolean)

    if (storagePaths.length > 0) {
      const { error: storageError } = await supabase.storage
        .from('recordings')
        .remove(storagePaths)

      if (storageError) {
        console.warn('Storage deletion failed (non-critical):', storageError)
        // Continue with database deletion
      }
    }

    // Delete from database
    const { error: deleteError } = await supabase
      .from('recordings')
      .delete()
      .in('id', recordings.map(r => r.id))

    if (deleteError) {
      console.error('Failed to delete recordings:', deleteError)
      return NextResponse.json(
        { error: 'Failed to delete recordings from database' },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      deleted: recordings.length,
      message: `Successfully deleted ${recordings.length} recording${recordings.length > 1 ? 's' : ''}`
    })

  } catch (error) {
    console.error('Batch delete error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
