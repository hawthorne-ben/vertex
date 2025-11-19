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
 * Upload VTX or FIT recording file
 * Accepts chunked uploads (fileId provided) or direct uploads
 *
 * For chunked uploads:
 * - Client first uploads chunks via /api/upload/chunk-url
 * - Client then calls this endpoint with fileId to complete upload
 *
 * For direct uploads:
 * - Client uploads file directly to storage first
 * - Client then calls this endpoint with storage path
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { fileId, fileName, fileSize, totalChunks, mimeType, storagePath } = body

    // Validate required fields
    if (!fileName || !fileSize) {
      return NextResponse.json(
        { error: 'Missing required fields: fileName, fileSize' },
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

    // Get user ID from Supabase session
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

    // Determine storage path based on upload type
    let finalStoragePath: string

    if (fileId && totalChunks) {
      // Chunked upload - verify chunks exist
      const { data: chunkFiles, error: listError } = await supabase.storage
        .from('uploads')
        .list(`chunks/${fileId}`)

      if (listError) {
        console.error('Error listing chunks:', listError)
        return NextResponse.json(
          { error: 'Failed to verify chunks' },
          { status: 500 }
        )
      }

      const existingChunks = chunkFiles?.map(f => f.name) || []
      const expectedChunks = Array.from({ length: totalChunks }, (_, i) =>
        `${fileId}_chunk_${i.toString().padStart(3, '0')}`
      )

      const missingChunks = expectedChunks.filter(chunk => !existingChunks.includes(chunk))

      if (missingChunks.length > 0) {
        return NextResponse.json(
          { error: `Missing chunks: ${missingChunks.join(', ')}` },
          { status: 400 }
        )
      }

      finalStoragePath = `chunks/${fileId}`
    } else if (storagePath) {
      // Direct upload - path already provided
      finalStoragePath = storagePath
    } else {
      return NextResponse.json(
        { error: 'Must provide either fileId+totalChunks or storagePath' },
        { status: 400 }
      )
    }

    // Download and parse file to extract metadata
    let metadata: any
    let dataRanges: number[][]
    let gapInfo: any

    if (fileType === 'vtx') {
      // Parse VTX file header and detect gaps
      const fileBuffer = await downloadFile(finalStoragePath, fileId, totalChunks)

      // Parse VTX file - convert Buffer to ArrayBuffer
      const arrayBuffer = fileBuffer.buffer.slice(
        fileBuffer.byteOffset,
        fileBuffer.byteOffset + fileBuffer.byteLength
      ) as ArrayBuffer

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

    // Move file to final location in recordings bucket
    const recordingId = crypto.randomUUID()
    let finalPath = `${userId}/${recordingId}.${fileType}`


    if (fileId && totalChunks) {
      // For chunked uploads, download all chunks and reassemble
      const fileBuffer = await downloadFile(finalStoragePath, fileId, totalChunks)

      // Upload to final location
      const { error: uploadError } = await supabase.storage
        .from('recordings')
        .upload(finalPath, fileBuffer, {
          contentType: fileType === 'vtx' ? 'application/octet-stream' : 'application/vnd.ant.fit',
          upsert: false
        })

      if (uploadError) {
        console.error('Error moving file to recordings bucket:', uploadError)
        return NextResponse.json(
          { error: 'Failed to move file to recordings bucket' },
          { status: 500 }
        )
      }

      // Clean up chunks
      await cleanupChunks(fileId, totalChunks)
    } else {
      // For direct uploads, need to move/rename file to use unique recordingId
      if (finalStoragePath.startsWith(userId)) {
        // File is already in recordings bucket with user_id prefix
        // Move it to use unique recordingId to avoid duplicates
        const { error: moveError } = await supabase.storage
          .from('recordings')
          .move(finalStoragePath, finalPath)

        if (moveError) {
          console.error('Error renaming file in recordings bucket:', moveError)
          return NextResponse.json(
            { error: 'Failed to rename file to unique path' },
            { status: 500 }
          )
        }
      } else {
        // File is in uploads bucket, move it to recordings
        const { error: moveError } = await supabase.storage
          .from('uploads')
          .move(finalStoragePath, `recordings/${finalPath}`)

        if (moveError) {
          console.error('Error moving file:', moveError)
          return NextResponse.json(
            { error: 'Failed to move file to recordings bucket' },
            { status: 500 }
          )
        }
      }
    }

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
      if (existingRecording.storage_path) {
        await supabase.storage
          .from('recordings')
          .remove([existingRecording.storage_path])
      }

      // Update existing record
      const { data: updated, error: updateError } = await supabase
        .from('recordings')
        .update({
          storage_path: finalPath,
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
        await supabase.storage.from('recordings').remove([finalPath])
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
          storage_path: finalPath,
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
        await supabase.storage.from('recordings').remove([finalPath])
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

        // Update status to indicate manual processing needed
        await supabase
          .from('recordings')
          .update({
            status: 'uploaded',
            error_message: 'Inngest not available - manual processing required'
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

/**
 * Download file from storage (handles both chunked and direct uploads)
 */
async function downloadFile(
  storagePath: string,
  fileId?: string,
  totalChunks?: number
): Promise<Buffer> {
  if (fileId && totalChunks) {
    // Download and combine chunks
    const chunks: Buffer[] = []

    for (let i = 0; i < totalChunks; i++) {
      const chunkPath = `chunks/${fileId}/${fileId}_chunk_${i.toString().padStart(3, '0')}`

      const { data: chunkData, error: chunkError } = await supabase.storage
        .from('uploads')
        .download(chunkPath)

      if (chunkError || !chunkData) {
        throw new Error(`Failed to download chunk ${i}: ${chunkError?.message}`)
      }

      const chunkBuffer = Buffer.from(await chunkData.arrayBuffer())
      chunks.push(chunkBuffer)
    }

    return Buffer.concat(chunks)
  } else {
    // Download single file from recordings bucket
    const { data: fileData, error: downloadError} = await supabase.storage
      .from('recordings')
      .download(storagePath)

    if (downloadError || !fileData) {
      console.error('Download error details:', {
        error: downloadError,
        errorString: JSON.stringify(downloadError),
        path: storagePath,
        hasData: !!fileData
      })
      throw new Error(`Failed to download file from recordings/${storagePath}: ${downloadError?.message || JSON.stringify(downloadError)}`)
    }

    return Buffer.from(await fileData.arrayBuffer())
  }
}

/**
 * Clean up chunk files after successful upload
 */
async function cleanupChunks(fileId: string, totalChunks: number): Promise<void> {
  const chunkPaths = Array.from({ length: totalChunks }, (_, i) =>
    `chunks/${fileId}/${fileId}_chunk_${i.toString().padStart(3, '0')}`
  )

  const { error } = await supabase.storage
    .from('uploads')
    .remove(chunkPaths)

  if (error) {
    console.warn(`⚠️ Failed to cleanup chunks for ${fileId}:`, error)
    // Don't throw - cleanup is best effort
  } else {
    console.log(`✅ Cleaned up ${totalChunks} chunks for ${fileId}`)
  }
}
