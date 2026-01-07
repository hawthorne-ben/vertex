import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { VTXDecoder } from '@vertex-pkg/vtx-parser'
import { BicycleIMUFilter, type IMUReading } from '@/lib/imu/bicycle-filter'

export const dynamic = 'force-dynamic'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

/**
 * Get smoothed sensor data from a VTX recording
 *
 * Returns accelerometer and gyroscope data after low-pass filtering
 * (same preprocessing used before fusion in bicycle filter)
 *
 * Query parameters:
 * - start: ISO timestamp to filter from (optional)
 * - end: ISO timestamp to filter to (optional)
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

    // Only VTX files are supported
    if (recording.file_type !== 'vtx') {
      return NextResponse.json(
        { error: 'Only VTX recordings are currently supported' },
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

    // Parse VTX file
    const fileBuffer = Buffer.from(await fileData.arrayBuffer())
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

    // Read IMU records within time range
    const imuReadings: IMUReading[] = []
    const recordingStartMs = Number(header.startTimestamp)

    for (let i = 0; i < recordCount; i++) {
      const record = decoder.readRecord(i)

      // Calculate offset from absolute timestamp
      const recordOffset = record.timestamp - recordingStartMs

      // Check if record is within time range
      if (recordOffset < startOffset || recordOffset > endOffset) {
        continue
      }

      imuReadings.push({
        accelX: record.accelX,
        accelY: record.accelY,
        accelZ: record.accelZ,
        gyroX: record.gyroX,
        gyroY: record.gyroY,
        gyroZ: record.gyroZ,
        timestamp: record.timestamp
      })
    }

    // Calculate sample rate from data
    let sampleRate = 50.0 // Default fallback
    if (imuReadings.length > 1) {
      const timeDiffs: number[] = []
      for (let i = 1; i < Math.min(100, imuReadings.length); i++) {
        timeDiffs.push(imuReadings[i].timestamp - imuReadings[i - 1].timestamp)
      }
      const avgDt = timeDiffs.reduce((a, b) => a + b, 0) / timeDiffs.length
      sampleRate = 1000.0 / avgDt
    }

    // Apply bicycle filter with debug enabled to get smoothed data
    const filter = new BicycleIMUFilter({ sampleRate, debug: true })
    const smoothedSamples: any[] = []

    for (const imu of imuReadings) {
      const result = filter.update(imu)

      if (result.debug) {
        smoothedSamples.push({
          timestamp: imu.timestamp,
          accel: {
            x: result.debug.accelFiltered.x,
            y: result.debug.accelFiltered.y,
            z: result.debug.accelFiltered.z
          },
          gyro: {
            x: result.debug.gyroFiltered.x,
            y: result.debug.gyroFiltered.y,
            z: result.debug.gyroFiltered.z
          }
        })
      }
    }

    return NextResponse.json({
      samples: smoothedSamples,
      metadata: {
        total_samples: smoothedSamples.length,
        filter_type: 'low-pass-preprocessing',
        accel_cutoff_hz: 5.0,
        gyro_cutoff_hz: 10.0,
        sample_rate: sampleRate,
        time_range: {
          start: smoothedSamples.length > 0 ? smoothedSamples[0].timestamp : recordingStartMs + startOffset,
          end: smoothedSamples.length > 0 ? smoothedSamples[smoothedSamples.length - 1].timestamp : recordingStartMs + endOffset
        }
      }
    })

  } catch (error) {
    console.error('Smoothed sample fetch error:', error)
    return NextResponse.json(
      {
        error: 'Internal server error',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    )
  }
}
