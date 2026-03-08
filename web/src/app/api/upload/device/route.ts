import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { VTXDecoder } from '@vertex-pkg/vtx-parser'
import { detectDataRanges, extractVTXMetadata, rangesToPgArray } from '@/lib/vtx/gap-detection'

export const dynamic = 'force-dynamic'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

/**
 * Check which files already exist for a user.
 * Firmware calls this before uploading to skip already-synced files.
 *
 * Query: ?filenames=file1.vtx,file2.vtx
 * Returns: { "existing": ["file1.vtx"] }
 */
export async function GET(request: NextRequest) {
  try {
    const deviceKey = request.headers.get('x-device-key')
    if (!deviceKey || deviceKey !== process.env.DEVICE_API_KEY) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userId = request.headers.get('x-user-id')
    if (!userId) {
      return NextResponse.json({ error: 'Missing X-User-Id' }, { status: 400 })
    }

    const filenames = request.nextUrl.searchParams.get('filenames')
    if (!filenames) {
      return NextResponse.json({ error: 'Missing filenames param' }, { status: 400 })
    }

    const filenameList = filenames.split(',').map(f => f.trim()).filter(Boolean)

    const { data: existing } = await supabase
      .from('recordings')
      .select('filename')
      .eq('user_id', userId)
      .in('filename', filenameList)

    return NextResponse.json({
      existing: (existing || []).map(r => r.filename),
    })
  } catch (error) {
    console.error('Device check error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

/**
 * Device upload relay endpoint
 *
 * ESP32 uploads .vtx files directly via WiFi.
 * Auth via X-Device-Key header (shared secret), X-User-Id identifies the owner.
 * Uploads to Supabase Storage, parses VTX metadata, creates DB record.
 */
export async function POST(request: NextRequest) {
  try {
    // Validate device API key
    const deviceKey = request.headers.get('x-device-key')
    if (!deviceKey || deviceKey !== process.env.DEVICE_API_KEY) {
      return NextResponse.json(
        { error: 'Unauthorized - Invalid device key' },
        { status: 401 }
      )
    }

    // Get user ID from header
    const userId = request.headers.get('x-user-id')
    if (!userId) {
      return NextResponse.json(
        { error: 'Missing X-User-Id header' },
        { status: 400 }
      )
    }

    // Parse multipart form data
    const formData = await request.formData()
    const file = formData.get('file') as File | null

    if (!file) {
      return NextResponse.json(
        { error: 'Missing file in form data' },
        { status: 400 }
      )
    }

    const fileName = file.name
    if (!fileName.toLowerCase().endsWith('.vtx')) {
      return NextResponse.json(
        { error: 'Only .vtx files are supported' },
        { status: 400 }
      )
    }

    // Upload to Supabase Storage
    const timestamp = Date.now()
    const storagePath = `${userId}/${timestamp}_${fileName}`
    const fileBuffer = Buffer.from(await file.arrayBuffer())

    const { error: uploadError } = await supabase.storage
      .from('recordings')
      .upload(storagePath, fileBuffer, {
        contentType: 'application/octet-stream',
        upsert: false,
      })

    if (uploadError) {
      console.error('Storage upload error:', uploadError)
      return NextResponse.json(
        { error: 'Failed to upload file to storage' },
        { status: 500 }
      )
    }

    // Parse VTX metadata
    const arrayBuffer = fileBuffer.buffer.slice(
      fileBuffer.byteOffset,
      fileBuffer.byteOffset + fileBuffer.byteLength
    )
    const decoder = new VTXDecoder(arrayBuffer)
    const metadata = extractVTXMetadata(decoder)
    const gapDetectionResult = detectDataRanges(decoder)
    const dataRanges = rangesToPgArray(gapDetectionResult.ranges)
    const gapInfo = gapDetectionResult.gapInfo

    // Check for existing recording with same filename for this user
    const { data: existingRecording } = await supabase
      .from('recordings')
      .select('id, storage_path')
      .eq('user_id', userId)
      .eq('filename', fileName)
      .single()

    let recordingRecord: any

    if (existingRecording) {
      // Delete old file from storage
      if (existingRecording.storage_path && existingRecording.storage_path !== storagePath) {
        await supabase.storage
          .from('recordings')
          .remove([existingRecording.storage_path])
      }

      const { data: updated, error: updateError } = await supabase
        .from('recordings')
        .update({
          storage_path: storagePath,
          file_size_bytes: file.size,
          start_time: metadata.startTime,
          end_time: metadata.endTime,
          duration_ms: metadata.durationMs,
          data_ranges: dataRanges,
          gap_info: gapInfo,
          sample_rate: metadata.sampleRate,
          sample_count: metadata.sampleCount,
          record_format: metadata.recordFormat,
          device_info: metadata.deviceInfo,
          session_metadata: metadata.sessionMetadata,
          status: 'ready',
          error_message: null,
          uploaded_at: new Date().toISOString(),
        })
        .eq('id', existingRecording.id)
        .select()
        .single()

      if (updateError) {
        console.error('Error updating recording record:', updateError)
        return NextResponse.json(
          { error: 'Failed to update recording record' },
          { status: 500 }
        )
      }

      recordingRecord = updated
    } else {
      const recordingId = crypto.randomUUID()

      const { data: inserted, error: insertError } = await supabase
        .from('recordings')
        .insert({
          id: recordingId,
          user_id: userId,
          filename: fileName,
          file_type: 'vtx',
          storage_path: storagePath,
          file_size_bytes: file.size,
          start_time: metadata.startTime,
          end_time: metadata.endTime,
          duration_ms: metadata.durationMs,
          data_ranges: dataRanges,
          gap_info: gapInfo,
          sample_rate: metadata.sampleRate,
          sample_count: metadata.sampleCount,
          record_format: metadata.recordFormat,
          device_info: metadata.deviceInfo,
          session_metadata: metadata.sessionMetadata,
          status: 'ready',
        })
        .select()
        .single()

      if (insertError) {
        console.error('Error creating recording record:', insertError)
        return NextResponse.json(
          { error: 'Failed to create recording record' },
          { status: 500 }
        )
      }

      recordingRecord = inserted
    }

    return NextResponse.json({
      success: true,
      recordingId: recordingRecord.id,
    })

  } catch (error) {
    console.error('Device upload error:', error)
    return NextResponse.json(
      { error: 'Internal server error', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
