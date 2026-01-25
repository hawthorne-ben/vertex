import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { calculatePedalingEfficiency } from '@/lib/analysis/pedaling-efficiency'
import { fileCache } from '@/lib/cache/file-cache'

export const dynamic = 'force-dynamic'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

/**
 * Get pedaling efficiency analysis for a ride
 *
 * Requires:
 * - Ride with FIT file (for GPS grade data)
 * - Ride with VTX recording (for IMU accel_x data)
 *
 * Query parameters:
 * - window_size: Smoothness calculation window in seconds (default: 3)
 * - lpf_cutoff: Low-pass filter cutoff Hz (default: 8)
 *
 * Returns:
 * - samples: Time series of efficiency scores
 * - metadata: Summary statistics
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: rideId } = await params
    const searchParams = request.nextUrl.searchParams

    // Parse query parameters
    const windowSize = parseInt(searchParams.get('window_size') || '3')
    const lpfCutoff = parseInt(searchParams.get('lpf_cutoff') || '8')
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

    // Get ride with FIT and VTX recordings
    const { data: ride, error: rideError } = await supabase
      .from('rides')
      .select(`
        *,
        ride_recordings (
          recording_id,
          recordings (
            id,
            filename,
            file_type,
            storage_path,
            status,
            start_time,
            end_time
          )
        )
      `)
      .eq('id', rideId)
      .eq('user_id', user.id)
      .single()

    if (rideError || !ride) {
      return NextResponse.json(
        { error: 'Ride not found' },
        { status: 404 }
      )
    }

    // Find FIT and VTX recordings
    const fitRecording = ride.ride_recordings?.find(
      (rr: any) => rr.recordings?.file_type === 'fit'
    )?.recordings

    const vtxRecordings = ride.ride_recordings
      ?.filter((rr: any) => rr.recordings?.file_type === 'vtx' && rr.recordings?.status === 'ready')
      .map((rr: any) => ({
        id: rr.recordings.id,
        storage_path: rr.recordings.storage_path
      })) || []

    if (!fitRecording) {
      return NextResponse.json(
        { error: 'No FIT file associated with this ride' },
        { status: 404 }
      )
    }

    if (vtxRecordings.length === 0) {
      return NextResponse.json(
        { error: 'No VTX recordings associated with this ride' },
        { status: 404 }
      )
    }

    // Fetch FIT samples directly from storage (avoid internal API call)
    // Download and parse FIT file (with caching)
    const fitArrayBuffer = await fileCache.getOrFetch(
      fitRecording.storage_path,
      async () => {
        const { data: fitFileData, error: fitDownloadError } = await supabase.storage
          .from('recordings')
          .download(fitRecording.storage_path)

        if (fitDownloadError || !fitFileData) {
          console.error('Error downloading FIT file:', fitDownloadError)
          throw new Error('Failed to download FIT file')
        }

        return await fitFileData.arrayBuffer()
      }
    )

    // Parse FIT file
    const FitParser = (await import('fit-file-parser')).default
    const buffer = new Uint8Array(fitArrayBuffer)

    const fitData = await new Promise<any>((resolve, reject) => {
      const parser = new FitParser({ force: true, speedUnit: 'm/s', lengthUnit: 'm' })
      parser.parse(buffer, (error: any, data: any) => {
        if (error) reject(error)
        else resolve(data)
      })
    })

    // Extract records (same logic as rides/[id]/samples route)
    let records = fitData.records || []
    const session = fitData.sessions?.[0] || fitData.activity?.sessions?.[0]
    if (session?.laps) {
      const lapRecords: any[] = []
      session.laps.forEach((lap: any) => {
        if (lap.records?.length > 0) lapRecords.push(...lap.records)
      })
      if (lapRecords.length > 0) records = lapRecords
    }

    let fitSamples = records.map((record: any) => ({
      timestamp: record.timestamp ? new Date(record.timestamp).toISOString() : null,
      grade: record.grade || null,
      altitude: record.enhanced_altitude ?? record.altitude ?? null
    })).filter((s: any) => s.timestamp !== null)

    // Apply time filters if provided (for zoom)
    if (startTime) {
      const startDate = new Date(startTime)
      fitSamples = fitSamples.filter((s: any) => new Date(s.timestamp) >= startDate)
    }
    if (endTime) {
      const endDate = new Date(endTime)
      fitSamples = fitSamples.filter((s: any) => new Date(s.timestamp) <= endDate)
    }

    // Fetch VTX samples directly from storage (parse binary files)
    const VTXDecoder = (await import('@vertex-pkg/vtx-parser')).VTXDecoder
    const allVtxSamples: Array<{ timestamp: string; accel_x: number }> = []

    for (const vtx of vtxRecordings) {
      // Download VTX file (with caching)
      let vtxArrayBuffer: ArrayBuffer
      try {
        vtxArrayBuffer = await fileCache.getOrFetch(
          vtx.storage_path,
          async () => {
            const { data: vtxFileData, error: vtxDownloadError } = await supabase.storage
              .from('recordings')
              .download(vtx.storage_path)

            if (vtxDownloadError || !vtxFileData) {
              console.error(`Failed to download VTX file ${vtx.id}:`, vtxDownloadError)
              throw new Error('Failed to download VTX file')
            }

            // Parse VTX file
            const fileBuffer = Buffer.from(await vtxFileData.arrayBuffer())
            return fileBuffer.buffer.slice(
              fileBuffer.byteOffset,
              fileBuffer.byteOffset + fileBuffer.byteLength
            ) as ArrayBuffer
          }
        )
      } catch (error) {
        console.error(`Failed to fetch VTX file ${vtx.id}:`, error)
        continue
      }

      const decoder = new VTXDecoder(vtxArrayBuffer)
      const header = decoder.getHeader()
      const recordCount = Number(header.recordCount)

      // Read all records and extract accel_x
      const recordingStartMs = Number(header.startTimestamp)
      const startOffset = startTime ? new Date(startTime).getTime() - recordingStartMs : 0
      const endOffset = endTime
        ? new Date(endTime).getTime() - recordingStartMs
        : Number(header.endTimestamp - header.startTimestamp)

      for (let i = 0; i < recordCount; i++) {
        const record = decoder.readRecord(i)
        const recordOffset = record.timestamp - recordingStartMs

        // Skip records outside time range (for zoom)
        if (recordOffset < startOffset || recordOffset > endOffset) {
          continue
        }

        allVtxSamples.push({
          timestamp: new Date(record.timestamp).toISOString(),
          accel_x: record.accelX
        })
      }
    }

    // Sort VTX samples by timestamp
    allVtxSamples.sort((a, b) => {
      return new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    })

    if (allVtxSamples.length === 0) {
      return NextResponse.json(
        { error: 'No VTX samples found' },
        { status: 404 }
      )
    }

    // Run pedaling efficiency analysis
    const result = calculatePedalingEfficiency({
      vtxSamples: allVtxSamples,
      fitSamples: fitSamples.map((s: any) => ({
        timestamp: s.timestamp,
        grade: s.grade,
        altitude: s.altitude
      })),
      options: {
        windowSize,
        lpfCutoff
      }
    })

    return NextResponse.json({
      samples: result.samples,
      metadata: result.metadata
    })

  } catch (error: any) {
    console.error('Error calculating pedaling efficiency:', error)
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    )
  }
}
