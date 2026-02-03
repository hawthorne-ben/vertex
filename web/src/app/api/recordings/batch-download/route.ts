import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import archiver from 'archiver'
import { Readable } from 'stream'

export const dynamic = 'force-dynamic'
export const maxDuration = 300 // 5 minutes for large downloads

/**
 * POST /api/recordings/batch-download
 *
 * Download multiple recordings as a ZIP file
 * Limit: 20 recordings per request
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

    if (recordingIds.length > 20) {
      return NextResponse.json(
        { error: 'Maximum 20 recordings can be downloaded at once' },
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

    // Fetch recordings to download (RLS ensures user owns them)
    const { data: recordings, error: fetchError } = await supabase
      .from('recordings')
      .select('id, storage_path, filename, status')
      .in('id', recordingIds)
      .eq('status', 'ready')

    if (fetchError) {
      console.error('Failed to fetch recordings:', fetchError)
      return NextResponse.json(
        { error: 'Failed to fetch recordings' },
        { status: 500 }
      )
    }

    if (!recordings || recordings.length === 0) {
      return NextResponse.json(
        { error: 'No ready recordings found or access denied' },
        { status: 404 }
      )
    }

    // Create ZIP archive
    const archive = archiver('zip', {
      zlib: { level: 6 } // Compression level (0-9)
    })

    // Handle archiver errors
    archive.on('error', (err) => {
      console.error('Archive error:', err)
      throw err
    })

    // Download files and add to archive
    for (const recording of recordings) {
      try {
        const { data, error } = await supabase.storage
          .from('recordings')
          .download(recording.storage_path)

        if (error || !data) {
          console.warn(`Failed to download ${recording.filename}:`, error)
          continue // Skip failed downloads
        }

        // Add file to archive
        const buffer = Buffer.from(await data.arrayBuffer())
        archive.append(buffer, { name: recording.filename })

      } catch (err) {
        console.warn(`Error processing ${recording.filename}:`, err)
        continue
      }
    }

    // Finalize archive
    archive.finalize()

    // Generate filename with timestamp
    const timestamp = new Date().toISOString().split('T')[0]
    const filename = `recordings-${timestamp}.zip`

    // Convert archive stream to web stream
    const nodeStream = Readable.toWeb(archive as any)

    // Return streaming response
    return new NextResponse(nodeStream as ReadableStream, {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-cache'
      }
    })

  } catch (error) {
    console.error('Batch download error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
