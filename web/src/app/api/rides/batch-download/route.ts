import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import archiver from 'archiver'
import { Readable } from 'stream'

export const dynamic = 'force-dynamic'
export const maxDuration = 300 // 5 minutes for large downloads

/**
 * POST /api/rides/batch-download
 *
 * Download FIT files for multiple rides as a ZIP
 * Limit: 20 rides per request
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { rideIds } = body

    // Validate input
    if (!Array.isArray(rideIds) || rideIds.length === 0) {
      return NextResponse.json(
        { error: 'rideIds must be a non-empty array' },
        { status: 400 }
      )
    }

    if (rideIds.length > 20) {
      return NextResponse.json(
        { error: 'Maximum 20 rides can be downloaded at once' },
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

    // Fetch rides with FIT recordings (RLS ensures user owns them)
    const { data: rides, error: fetchError } = await supabase
      .from('rides')
      .select(`
        id,
        name,
        ride_recordings (
          recordings (
            file_type,
            storage_path,
            filename
          )
        )
      `)
      .in('id', rideIds)

    if (fetchError) {
      console.error('Failed to fetch rides:', fetchError)
      return NextResponse.json(
        { error: 'Failed to fetch rides' },
        { status: 500 }
      )
    }

    if (!rides || rides.length === 0) {
      return NextResponse.json(
        { error: 'No rides found or access denied' },
        { status: 404 }
      )
    }

    // Extract FIT files
    const fitFiles = rides
      .map((ride: any) => {
        const fitRecording = ride.ride_recordings?.find(
          (rr: any) => rr.recordings?.file_type === 'fit'
        )?.recordings

        return fitRecording ? {
          storage_path: fitRecording.storage_path,
          filename: fitRecording.filename || `${ride.name}.fit`
        } : null
      })
      .filter((f): f is { storage_path: string; filename: string } => f !== null)

    if (fitFiles.length === 0) {
      return NextResponse.json(
        { error: 'No FIT files found for selected rides' },
        { status: 404 }
      )
    }

    // Create ZIP archive
    const archive = archiver('zip', {
      zlib: { level: 6 }
    })

    // Handle archiver errors
    archive.on('error', (err) => {
      console.error('Archive error:', err)
      throw err
    })

    // Download files and add to archive
    for (const file of fitFiles) {
      try {
        const { data, error } = await supabase.storage
          .from('recordings')
          .download(file.storage_path)

        if (error || !data) {
          console.warn(`Failed to download ${file.filename}:`, error)
          continue
        }

        const buffer = Buffer.from(await data.arrayBuffer())
        archive.append(buffer, { name: file.filename })

      } catch (err) {
        console.warn(`Error processing ${file.filename}:`, err)
        continue
      }
    }

    // Finalize archive
    archive.finalize()

    // Generate filename with timestamp
    const timestamp = new Date().toISOString().split('T')[0]
    const filename = `rides-${timestamp}.zip`

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
