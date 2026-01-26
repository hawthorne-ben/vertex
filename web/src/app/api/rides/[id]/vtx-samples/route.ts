import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { VTXDecoder } from '@vertex-pkg/vtx-parser'
import { fileCache } from '@/lib/cache/file-cache'
import { downsampleLTTB } from '@/lib/data/downsampling'

export const dynamic = 'force-dynamic'

type RecordingData = {
  id: string
  file_type: string
  storage_path: string
  start_time: string
}

type RideRecordingData = {
  recording_id: string
  recordings: RecordingData | null
}

type RideWithVTXData = {
  id: string
  user_id: string
  merged_vtx_path: string | null
  merged_vtx_file_size_bytes: number | null
  merged_at: string | null
  ride_recordings: RideRecordingData[] | null
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

/**
 * Get VTX samples from merged ride file
 * Falls back to first recording if merged file doesn't exist yet
 *
 * Query parameters:
 * - start: ISO timestamp to filter from (optional)
 * - end: ISO timestamp to filter to (optional)
 * - resolution: Target number of samples (default: 2000, max: 10000)
 * - downsample: Downsampling method - 'lttb' or 'none' (default: 'lttb')
 * - fields: Comma-separated list of fields to include (optional, e.g., 'accel_x,accel_y')
 *   Available fields: accel, gyro, mag, quat, euler, accel_x, accel_y, accel_z, gyro_x, gyro_y, gyro_z
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: rideId } = await params
    const searchParams = request.nextUrl.searchParams

    // Parse query parameters
    const startTime = searchParams.get('start') || undefined
    const endTime = searchParams.get('end') || undefined
    const resolution = Math.min(
      parseInt(searchParams.get('resolution') || '2000'),
      10000
    )
    const downsample = searchParams.get('downsample') || 'lttb'
    const fieldsParam = searchParams.get('fields')
    const requestedFields = fieldsParam ? new Set(fieldsParam.split(',').map(f => f.trim())) : null

    // Helper to check if field should be included
    const includeField = (field: string) => !requestedFields || requestedFields.has(field)

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

    // Get ride with merged VTX path or fallback to recordings
    const { data: ride, error: rideError } = await supabase
      .from('rides')
      .select(`
        id,
        user_id,
        merged_vtx_path,
        merged_vtx_file_size_bytes,
        merged_at,
        ride_recordings (
          recording_id,
          recordings (
            id,
            file_type,
            storage_path,
            start_time
          )
        )
      `)
      .eq('id', rideId)
      .eq('user_id', user.id)
      .single() as { data: RideWithVTXData | null, error: any }

    if (rideError || !ride) {
      return NextResponse.json(
        { error: 'Ride not found' },
        { status: 404 }
      )
    }

    let storagePath: string
    let source: 'merged' | 'individual'

    // Prefer merged file if available
    if (ride.merged_vtx_path) {
      storagePath = ride.merged_vtx_path
      source = 'merged'
    } else {
      // Fallback: use first VTX recording
      const vtxRecording = ride.ride_recordings
        ?.filter((rr) => rr.recordings?.file_type === 'vtx')
        .sort((a, b) =>
          a.recordings!.start_time.localeCompare(b.recordings!.start_time)
        )[0]?.recordings

      if (!vtxRecording) {
        return NextResponse.json(
          { error: 'No VTX data associated with this ride' },
          { status: 404 }
        )
      }

      storagePath = vtxRecording.storage_path
      source = 'individual'
    }

    // Download VTX file from storage (with caching)
    const arrayBuffer = await fileCache.getOrFetch(
      storagePath,
      async () => {
        const { data: fileData, error: downloadError } = await supabase.storage
          .from('recordings')
          .download(storagePath)

        if (downloadError || !fileData) {
          console.error('Error downloading VTX file:', downloadError)
          throw new Error('Failed to download VTX file')
        }

        return await fileData.arrayBuffer()
      }
    )

    // Decode VTX file
    const decoder = new VTXDecoder(arrayBuffer)
    const header = decoder.getHeader()

    // Parse start/end times if provided
    const startOffset = startTime ? new Date(startTime).getTime() : null
    const endOffset = endTime ? new Date(endTime).getTime() : null

    // Collect samples
    const samples = []
    const recordCount = Number(header.recordCount)

    // Optimization: When no time filtering and downsampling requested, use stride to reduce iterations
    // This works because LTTB will handle the proper downsampling, we just need enough samples
    const isFullRange = startOffset === null && endOffset === null
    const willDownsample = downsample === 'lttb' && recordCount > resolution
    const useStride = isFullRange && willDownsample

    // Sample every Nth record when using stride (oversample by 2x for LTTB)
    const stride = useStride ? Math.max(1, Math.floor(recordCount / (resolution * 2))) : 1

    for (let i = 0; i < recordCount; i += stride) {
      const record = decoder.readRecord(i)

      // Filter by time range if specified (only when not using stride optimization)
      if (!useStride) {
        if (startOffset !== null && record.timestamp < startOffset) continue
        if (endOffset !== null && record.timestamp > endOffset) continue
      }

      const sample: any = {
        timestamp: new Date(record.timestamp).toISOString()
      }

      // Add fields based on selection
      if (includeField('accel') || includeField('accel_x') || includeField('accel_y') || includeField('accel_z')) {
        sample.accel = {
          ...(includeField('accel') || includeField('accel_x') ? { x: record.accelX } : {}),
          ...(includeField('accel') || includeField('accel_y') ? { y: record.accelY } : {}),
          ...(includeField('accel') || includeField('accel_z') ? { z: record.accelZ } : {})
        }
      }

      if (includeField('gyro') || includeField('gyro_x') || includeField('gyro_y') || includeField('gyro_z')) {
        sample.gyro = {
          ...(includeField('gyro') || includeField('gyro_x') ? { x: record.gyroX } : {}),
          ...(includeField('gyro') || includeField('gyro_y') ? { y: record.gyroY } : {}),
          ...(includeField('gyro') || includeField('gyro_z') ? { z: record.gyroZ } : {})
        }
      }

      if (includeField('mag') && record.magX !== undefined) {
        sample.mag = {
          x: record.magX,
          y: record.magY,
          z: record.magZ
        }
      }

      if (includeField('quat') && record.quatW !== undefined) {
        sample.quat = {
          w: record.quatW,
          x: record.quatX,
          y: record.quatY,
          z: record.quatZ
        }
      }

      if (includeField('euler') && record.roll !== undefined) {
        sample.euler = {
          roll: record.roll,
          pitch: record.pitch,
          yaw: record.yaw
        }
      }

      samples.push(sample)
    }

    // Downsample if requested and necessary
    let finalSamples = samples
    if (downsample === 'lttb' && samples.length > resolution) {
      // Convert to format expected by downsampling library
      const samplesWithNumericTimestamp = samples.map(s => ({
        timestamp: new Date(s.timestamp).getTime(),
        accel: s.accel,
        gyro: s.gyro,
        mag: s.mag || undefined,
        quat: s.quat || undefined
      }))

      const downsampled = downsampleLTTB(samplesWithNumericTimestamp, resolution)

      // Convert back to ISO timestamp format and preserve euler/quat data
      // Create a map of original samples by timestamp for lookup
      const originalSampleMap = new Map(
        samples.map(s => [new Date(s.timestamp).getTime(), s])
      )

      finalSamples = downsampled.map(s => {
        const original = originalSampleMap.get(s.timestamp)
        return {
          timestamp: new Date(s.timestamp).toISOString(),
          accel: s.accel,
          gyro: s.gyro,
          mag: s.mag || null,
          quat: original?.quat || s.quat || null,
          euler: original?.euler || null
        }
      })
    }

    return NextResponse.json({
      samples: finalSamples,
      metadata: {
        source,
        total_samples: samples.length,
        returned_samples: finalSamples.length,
        sample_rate: header.sampleRate,
        downsampled: finalSamples.length < samples.length,
        time_range: samples.length > 0 ? {
          start: samples[0].timestamp,
          end: samples[samples.length - 1].timestamp
        } : null,
        merged_at: ride.merged_at || null
      }
    })

  } catch (error) {
    console.error('VTX samples error:', error)
    return NextResponse.json(
      {
        error: 'Failed to fetch VTX samples',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    )
  }
}
