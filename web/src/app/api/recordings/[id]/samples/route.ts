import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { VTXDecoder } from '@vertex-pkg/vtx-parser'
import { downsampleLTTB } from '@/lib/data/downsampling'

export const dynamic = 'force-dynamic'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

interface QueryParams {
  start?: string // ISO timestamp
  end?: string // ISO timestamp
  resolution?: string // Target number of samples (default 2000)
  downsample?: 'lttb' | 'none' // Downsampling algorithm
}

/**
 * Get samples from a VTX or FIT recording
 *
 * Query parameters:
 * - start: ISO timestamp to filter from (optional)
 * - end: ISO timestamp to filter to (optional)
 * - resolution: Target number of samples after downsampling (default 2000)
 * - downsample: 'lttb' or 'none' (default 'lttb')
 *
 * Response includes:
 * - samples: Array of IMU samples
 * - metadata: Information about sampling and downsampling
 * - gaps: Array of gap details for visualization
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: recordingId } = await params
    const searchParams = request.nextUrl.searchParams

    // Parse query parameters
    const startTime = searchParams.get('start') || undefined
    const endTime = searchParams.get('end') || undefined
    const resolution = parseInt(searchParams.get('resolution') || '2000')
    const downsample = (searchParams.get('downsample') || 'lttb') as 'lttb' | 'none'

    // Get user from auth header
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
      return NextResponse.json(
        { error: 'Unauthorized - Invalid token' },
        { status: 401 }
      )
    }

    // Get recording metadata
    const { data: recording, error: recordingError } = await supabase
      .from('recordings')
      .select('*')
      .eq('id', recordingId)
      .eq('user_id', user.id)
      .single()

    if (recordingError || !recording) {
      return NextResponse.json(
        { error: 'Recording not found' },
        { status: 404 }
      )
    }

    // Check recording status
    if (recording.status !== 'ready') {
      return NextResponse.json(
        {
          error: 'Recording not ready',
          status: recording.status,
          message: recording.error_message
        },
        { status: 400 }
      )
    }

    // Only VTX files are supported for now (FIT files need separate handling)
    if (recording.file_type !== 'vtx') {
      return NextResponse.json(
        { error: 'Only VTX recordings are currently supported for sample access' },
        { status: 400 }
      )
    }

    // Download VTX file from storage
    const { data: fileData, error: downloadError } = await supabase.storage
      .from('recordings')
      .download(recording.storage_path)

    if (downloadError || !fileData) {
      console.error('Error downloading recording:', downloadError)
      return NextResponse.json(
        { error: 'Failed to download recording file' },
        { status: 500 }
      )
    }

    // Parse VTX file - convert to ArrayBuffer for VTXDecoder
    const fileBuffer = Buffer.from(await fileData.arrayBuffer())

    // Convert Buffer to ArrayBuffer
    const arrayBuffer = fileBuffer.buffer.slice(
      fileBuffer.byteOffset,
      fileBuffer.byteOffset + fileBuffer.byteLength
    ) as ArrayBuffer

    const decoder = new VTXDecoder(arrayBuffer)
    const header = decoder.getHeader()
    const recordCount = Number(header.recordCount)

    // Convert time filter to timestamp offsets if provided
    let startOffset = 0
    let endOffset = Number(header.endTimestamp - header.startTimestamp)

    if (startTime) {
      const startMs = new Date(startTime).getTime()
      const recordingStartMs = Number(header.startTimestamp)
      startOffset = Math.max(0, startMs - recordingStartMs)
    }

    if (endTime) {
      const endMs = new Date(endTime).getTime()
      const recordingStartMs = Number(header.startTimestamp)
      endOffset = Math.min(endOffset, endMs - recordingStartMs)
    }

    // Read records within time range
    const samples: any[] = []
    const recordingStartMs = Number(header.startTimestamp)

    for (let i = 0; i < recordCount; i++) {
      const record = decoder.readRecord(i)

      // Calculate offset from absolute timestamp
      const recordOffset = record.timestamp - recordingStartMs

      // Check if record is within time range
      if (recordOffset < startOffset || recordOffset > endOffset) {
        continue
      }

      samples.push({
        timestamp: record.timestamp,
        accel: {
          x: record.accelX,
          y: record.accelY,
          z: record.accelZ
        },
        gyro: {
          x: record.gyroX,
          y: record.gyroY,
          z: record.gyroZ
        },
        mag: record.magX !== undefined ? {
          x: record.magX,
          y: record.magY,
          z: record.magZ
        } : undefined,
        quat: record.quatW !== undefined ? {
          w: record.quatW,
          x: record.quatX,
          y: record.quatY,
          z: record.quatZ
        } : undefined,
        euler: record.roll !== undefined ? {
          roll: record.roll,
          pitch: record.pitch,
          yaw: record.yaw
        } : undefined
      })
    }

    // Apply downsampling if requested and needed
    let downsampledSamples = samples
    let downsampled = false
    let downsamplingRatio = 1

    if (downsample === 'lttb' && samples.length > resolution) {
      // Apply LTTB downsampling to each sensor axis
      downsampledSamples = downsampleLTTB(samples, resolution)
      downsampled = true
      downsamplingRatio = samples.length / downsampledSamples.length
    }

    // Extract gap information for the requested time range
    const gaps = (recording.gap_info?.gap_details || [])
      .filter((gap: any) => {
        return gap.start_offset_ms >= startOffset && gap.end_offset_ms <= endOffset
      })
      .map((gap: any) => ({
        start: recordingStartMs + gap.start_offset_ms,
        end: recordingStartMs + gap.end_offset_ms,
        duration_ms: gap.duration_ms
      }))

    return NextResponse.json({
      samples: downsampledSamples,
      metadata: {
        total_samples: samples.length,
        downsampled,
        downsampling_ratio: downsamplingRatio,
        time_range: {
          start: samples.length > 0 ? samples[0].timestamp : recordingStartMs + startOffset,
          end: samples.length > 0 ? samples[samples.length - 1].timestamp : recordingStartMs + endOffset
        },
        sample_rate: recording.sample_rate,
        recording_duration_ms: recording.duration_ms
      },
      gaps
    })

  } catch (error) {
    console.error('Sample fetch error:', error)
    return NextResponse.json(
      {
        error: 'Internal server error',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    )
  }
}
