import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { VTXDecoder } from '@vertex-pkg/vtx-parser'
import { detectDataRanges, extractVTXMetadata, rangesToPgArray } from '@/lib/vtx/gap-detection'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

/**
 * Complete a device upload after the firmware has PUT the file to Supabase Storage.
 * Downloads the file from storage, parses VTX metadata, creates/updates DB record.
 *
 * POST body (JSON): { filename: string, storagePath: string, fileSize: number }
 * Headers: X-Device-Key, X-User-Id
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
    const { filename, storagePath, fileSize } = body

    if (!filename || !storagePath) {
      return NextResponse.json({ error: 'Missing filename or storagePath' }, { status: 400 })
    }

    // Download file from storage for VTX parsing
    const { data: fileData, error: downloadError } = await supabase.storage
      .from('recordings')
      .download(storagePath)

    if (downloadError || !fileData) {
      console.error('Download error:', downloadError)
      return NextResponse.json({ error: 'File not found in storage' }, { status: 404 })
    }

    // Parse VTX metadata
    const arrayBuffer = await fileData.arrayBuffer()
    const decoder = new VTXDecoder(arrayBuffer)
    const metadata = extractVTXMetadata(decoder)
    const gapDetectionResult = detectDataRanges(decoder)
    const dataRanges = rangesToPgArray(gapDetectionResult.ranges)
    const gapInfo = gapDetectionResult.gapInfo

    // Check for existing recording with same filename
    const { data: existingRecording } = await supabase
      .from('recordings')
      .select('id, storage_path')
      .eq('user_id', userId)
      .eq('filename', filename)
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
          file_size_bytes: fileSize || arrayBuffer.byteLength,
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
        console.error('Update error:', updateError)
        return NextResponse.json({ error: 'Failed to update recording' }, { status: 500 })
      }
      recordingRecord = updated
    } else {
      const recordingId = crypto.randomUUID()

      const { data: inserted, error: insertError } = await supabase
        .from('recordings')
        .insert({
          id: recordingId,
          user_id: userId,
          filename,
          file_type: 'vtx',
          storage_path: storagePath,
          file_size_bytes: fileSize || arrayBuffer.byteLength,
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
        console.error('Insert error:', insertError)
        return NextResponse.json({ error: 'Failed to create recording' }, { status: 500 })
      }
      recordingRecord = inserted
    }

    return NextResponse.json({
      success: true,
      recordingId: recordingRecord.id,
    })
  } catch (error) {
    console.error('Complete error:', error)
    return NextResponse.json(
      { error: 'Internal server error', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
