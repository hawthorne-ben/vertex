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
 * Process uploaded VTX or FIT recording file
 *
 * Expects file to already be uploaded to storage via TUS.
 * This endpoint validates the file, parses metadata, and creates DB record.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { fileName, fileSize, storagePath } = body

    // Validate required fields
    if (!fileName || !fileSize || !storagePath) {
      return NextResponse.json(
        { error: 'Missing required fields: fileName, fileSize, storagePath' },
        { status: 400 }
      )
    }

    // Validate file type - only VTX and FIT
    const lowercaseFileName = fileName.toLowerCase()
    if (!lowercaseFileName.endsWith('.vtx') && !lowercaseFileName.endsWith('.fit')) {
      return NextResponse.json(
        { error: 'Invalid file type. Only .vtx and .fit files are supported.' },
        { status: 400 }
      )
    }

    const fileType = lowercaseFileName.endsWith('.vtx') ? 'vtx' : 'fit'

    // Authenticate user
    const authHeader = request.headers.get('authorization')
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json(
        { error: 'Unauthorized - No auth token' },
        { status: 401 }
      )
    }

    const token = authHeader.replace('Bearer ', '')
    const { data: { user }, error: authError } = await supabase.auth.getUser(token)

    if (authError || !user) {
      console.error('Auth error:', authError)
      return NextResponse.json(
        { error: 'Unauthorized - Invalid token' },
        { status: 401 }
      )
    }

    const userId = user.id

    // Verify file exists in storage
    const { data: fileData, error: downloadError } = await supabase.storage
      .from('recordings')
      .download(storagePath)

    if (downloadError || !fileData) {
      console.error('File not found in storage:', downloadError)
      return NextResponse.json(
        { error: 'File not found in storage. Upload may have failed.' },
        { status: 404 }
      )
    }

    // Parse file metadata
    let metadata: any
    let dataRanges: number[][]
    let gapInfo: any

    if (fileType === 'vtx') {
      // Parse VTX file header and detect gaps
      const arrayBuffer = await fileData.arrayBuffer()
      const decoder = new VTXDecoder(arrayBuffer)

      // Extract metadata from header
      metadata = extractVTXMetadata(decoder)

      // Detect data gaps
      const gapDetectionResult = detectDataRanges(decoder)
      dataRanges = rangesToPgArray(gapDetectionResult.ranges)
      gapInfo = gapDetectionResult.gapInfo

    } else {
      // FIT file - we'll parse it later via Inngest
      // For now, just create a basic record
      metadata = {
        startTime: new Date(),
        endTime: new Date(),
        durationMs: 0,
        sampleRate: null,
        sampleCount: null,
        recordFormat: null,
        deviceInfo: null,
        sessionMetadata: null,
      }
      dataRanges = []
      gapInfo = null
    }

    // Generate unique recording ID
    const recordingId = crypto.randomUUID()

    // Check if a recording with this filename already exists for this user
    const { data: existingRecording } = await supabase
      .from('recordings')
      .select('id, storage_path')
      .eq('user_id', userId)
      .eq('filename', fileName)
      .single()

    let recordingRecord: any

    if (existingRecording) {
      console.log(`📝 Overwriting existing recording: ${fileName}`)

      // Delete old file from storage
      if (existingRecording.storage_path && existingRecording.storage_path !== storagePath) {
        await supabase.storage
          .from('recordings')
          .remove([existingRecording.storage_path])
      }

      // Update existing record
      const { data: updated, error: updateError } = await supabase
        .from('recordings')
        .update({
          storage_path: storagePath,
          file_size_bytes: fileSize,
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
          status: fileType === 'vtx' ? 'ready' : 'uploaded',
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
      // Create new recording record
      const { data: inserted, error: insertError } = await supabase
        .from('recordings')
        .insert({
          id: recordingId,
          user_id: userId,
          filename: fileName,
          file_type: fileType,
          storage_path: storagePath,
          file_size_bytes: fileSize,
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
          status: fileType === 'vtx' ? 'ready' : 'uploaded',
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

    // For FIT files, trigger parsing via Inngest
    if (fileType === 'fit') {
      try {
        const { inngest } = await import('@/inngest/client')
        await inngest.send({
          name: 'fit/parse',
          data: {
            fileId: recordingRecord.id,
            userId
          }
        })
      } catch (inngestError) {
        console.warn(`⚠️ Failed to trigger Inngest FIT parsing:`, inngestError)

        // Mark as failed so the frontend polling picks it up immediately
        await supabase
          .from('recordings')
          .update({
            status: 'failed',
            error_message: 'Failed to start file processing. Please try uploading again.'
          })
          .eq('id', recordingRecord.id)
      }
    }

    return NextResponse.json({
      success: true,
      recordingId: recordingRecord.id,
      fileType,
      status: recordingRecord.status,
      sampleCount: metadata.sampleCount,
      gapInfo,
      message: fileType === 'vtx'
        ? 'VTX file uploaded and ready'
        : 'FIT file uploaded, parsing started'
    })

  } catch (error) {
    console.error('Recording upload error:', error)
    return NextResponse.json(
      { error: 'Internal server error', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}

