import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { inngest } from '@/inngest/client'
import { generateMergedFilename } from '@/lib/vtx/filename-utils'
import { VTXMerger } from '@vertex-pkg/vtx-parser'

export const dynamic = 'force-dynamic'

/**
 * POST /api/recordings/merge
 *
 * Merge multiple VTX recordings into a single file
 * - Validates compatibility (sample rate, format)
 * - Triggers async Inngest job
 * - Returns job ID for status polling
 *
 * Limit: 2-10 recordings per request
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { recordingIds, newFilename } = body

    // Validate input
    if (!Array.isArray(recordingIds) || recordingIds.length < 2) {
      return NextResponse.json(
        { error: 'At least 2 recordings required for merging' },
        { status: 400 }
      )
    }

    if (recordingIds.length > 10) {
      return NextResponse.json(
        { error: 'Maximum 10 recordings can be merged at once' },
        { status: 400 }
      )
    }

    if (!newFilename || typeof newFilename !== 'string') {
      return NextResponse.json(
        { error: 'newFilename is required' },
        { status: 400 }
      )
    }

    // Sanitize filename and ensure .vtx extension
    const sanitizedFilename = newFilename.trim().replace(/[^a-zA-Z0-9._-]/g, '_')
    const finalFilename = sanitizedFilename.endsWith('.vtx')
      ? sanitizedFilename
      : `${sanitizedFilename}.vtx`

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

    // Fetch recordings to merge (RLS ensures user owns them)
    const { data: recordings, error: fetchError } = await supabase
      .from('recordings')
      .select('id, storage_path, filename, status, file_type, start_time, end_time, device_info')
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

    // Validate all are VTX files
    const nonVtxFiles = recordings.filter(r => r.file_type !== 'vtx')
    if (nonVtxFiles.length > 0) {
      return NextResponse.json(
        { error: 'All recordings must be VTX files' },
        { status: 400 }
      )
    }

    // Validate all are ready
    const notReadyFiles = recordings.filter(r => r.status !== 'ready')
    if (notReadyFiles.length > 0) {
      return NextResponse.json(
        { error: 'All recordings must have status "ready"' },
        { status: 400 }
      )
    }

    // Download files for validation
    const buffers: ArrayBuffer[] = []

    for (const recording of recordings) {
      try {
        const { data, error } = await supabase.storage
          .from('recordings')
          .download(recording.storage_path)

        if (error || !data) {
          return NextResponse.json(
            { error: `Failed to download ${recording.filename} for validation` },
            { status: 500 }
          )
        }

        buffers.push(await data.arrayBuffer())
      } catch (err) {
        console.error('Download error:', err)
        return NextResponse.json(
          { error: `Failed to download ${recording.filename}` },
          { status: 500 }
        )
      }
    }

    // Validate merge compatibility using library method (same as ride merge)
    const validation = VTXMerger.validateMergeCompatibility(buffers)

    if (!validation.compatible) {
      return NextResponse.json(
        {
          error: 'Files are not compatible for merging',
          details: validation.errors
        },
        { status: 400 }
      )
    }

    // Send Inngest event to trigger merge job
    const eventId = await inngest.send({
      name: 'recordings/vtx.merge-requested',
      data: {
        recordingIds,
        newFilename: finalFilename,
        userId: user.id
      }
    })

    return NextResponse.json(
      {
        success: true,
        jobId: eventId.ids[0],
        message: 'Merge job started',
        filename: finalFilename
      },
      { status: 202 } // Accepted
    )

  } catch (error) {
    console.error('Merge request error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
