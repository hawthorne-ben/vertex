import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

/**
 * Check which local files have already been uploaded
 * Accepts array of filenames, returns sync status for each
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { filenames } = body

    if (!Array.isArray(filenames) || filenames.length === 0) {
      return NextResponse.json(
        { error: 'filenames must be a non-empty array' },
        { status: 400 }
      )
    }

    // Get user ID from auth token
    const authHeader = request.headers.get('authorization')
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const token = authHeader.replace('Bearer ', '')
    const { data: { user }, error: authError } = await supabase.auth.getUser(token)

    if (authError || !user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    // Query recordings table for these filenames
    const { data: recordings, error: queryError } = await supabase
      .from('recordings')
      .select('id, filename, status, uploaded_at')
      .eq('user_id', user.id)
      .in('filename', filenames)

    if (queryError) {
      console.error('Error querying recordings:', queryError)
      return NextResponse.json(
        { error: 'Failed to check sync status' },
        { status: 500 }
      )
    }

    // Build a map of filename -> sync info
    const syncStatus: Record<string, {
      synced: boolean
      recordingId?: string
      status?: string
      uploadedAt?: string
    }> = {}

    // Initialize all filenames as not synced
    filenames.forEach(filename => {
      syncStatus[filename] = { synced: false }
    })

    // Update with actual sync status from database
    recordings?.forEach(recording => {
      syncStatus[recording.filename] = {
        synced: true,
        recordingId: recording.id,
        status: recording.status,
        uploadedAt: recording.uploaded_at
      }
    })

    return NextResponse.json({
      syncStatus
    })

  } catch (error) {
    console.error('Check sync error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
