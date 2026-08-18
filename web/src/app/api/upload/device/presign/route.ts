import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// Matches the `recordings` bucket file_size_limit AND the project-wide global
// upload limit (both 500MB). Guarding here lets an oversized upload fail fast
// with a clear message instead of a raw storage 413 after the full PUT.
// See memory: supabase-global-upload-limit.
const MAX_UPLOAD_BYTES = 500 * 1024 * 1024

/**
 * Generate a presigned upload URL for direct-to-Supabase upload from ESP32.
 *
 * POST body (JSON): { filename: string, fileSize: number }
 * Headers: X-Device-Key, X-User-Id
 * Returns: { url: string, token: string, storagePath: string }
 *
 * The firmware PUTs the file directly to the signed URL,
 * then calls /api/upload/device/complete to create the DB record.
 */
export async function POST(request: NextRequest) {
  try {
    const deviceKey = request.headers.get('x-device-key')
    if (!deviceKey || deviceKey !== process.env.DEVICE_API_KEY) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userId = request.headers.get('x-user-id')
    if (!userId) {
      return NextResponse.json({ error: 'Missing X-User-Id' }, { status: 400 })
    }

    const body = await request.json()
    const { filename, fileSize } = body

    if (!filename || !filename.endsWith('.vtx')) {
      return NextResponse.json({ error: 'Invalid filename' }, { status: 400 })
    }

    if (typeof fileSize === 'number' && fileSize > MAX_UPLOAD_BYTES) {
      const mb = (bytes: number) => Math.round(bytes / (1024 * 1024))
      return NextResponse.json(
        {
          error: 'File too large',
          message: `File is ${mb(fileSize)}MB, exceeding the ${mb(MAX_UPLOAD_BYTES)}MB upload limit.`,
          maxBytes: MAX_UPLOAD_BYTES,
        },
        { status: 413 }
      )
    }

    const timestamp = Date.now()
    const storagePath = `${userId}/${timestamp}_${filename}`

    // Supabase signed upload URLs expire after 2 hours (server default, not configurable via JS SDK)
    const { data, error } = await supabase.storage
      .from('recordings')
      .createSignedUploadUrl(storagePath, { upsert: true })

    if (error || !data) {
      console.error('Presign error:', error)
      return NextResponse.json({ error: 'Failed to create upload URL' }, { status: 500 })
    }

    return NextResponse.json({
      url: data.signedUrl,
      token: data.token,
      storagePath,
    })
  } catch (error) {
    console.error('Presign error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
