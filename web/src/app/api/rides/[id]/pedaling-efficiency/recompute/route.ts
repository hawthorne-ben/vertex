import { NextRequest, NextResponse } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { calculatePedalingEfficiency } from '@/lib/analysis/pedaling-efficiency'
import { ALGORITHM_VERSION } from '@/lib/analysis/pedaling-efficiency-constants'
import { VTXDecoder } from '@vertex-pkg/vtx-parser'
import FitParser from 'fit-file-parser'

export const dynamic = 'force-dynamic'
export const maxDuration = 60 // Allow up to 60 seconds for large rides

/**
 * DEV ONLY: Recompute pedaling efficiency and riding position with custom parameters
 *
 * This endpoint allows developers to experiment with algorithm tuning
 * by recomputing both metrics with custom parameters.
 *
 * POST /api/rides/[id]/pedaling-efficiency/recompute
 *
 * Body:
 * {
 *   parameters: {
 *     hpfCutoff?: number       // HPF cutoff Hz (default: 0.5)
 *     windowSize?: number      // Efficiency window seconds (default: 3)
 *     yAxisThreshold?: number  // Standing detection threshold (default: 2.2)
 *   },
 *   saveToDatabase?: boolean  // If true, overwrites existing analyses
 * }
 *
 * Response:
 * {
 *   success: true,
 *   message: string,
 *   efficiency: {
 *     metadata: PedalingEfficiencyMetadata,
 *     sampleCount: number
 *   },
 *   position: {
 *     metadata: RidingPositionMetadata,
 *     sampleCount: number
 *   },
 *   parameters: object
 * }
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // DEV ONLY: Check if we're in development mode
    const isDev = process.env.NODE_ENV === 'development'
    if (!isDev) {
      return NextResponse.json(
        { error: 'This endpoint is only available in development mode' },
        { status: 403 }
      )
    }

    const { id: rideId } = await params
    const body = await request.json()
    const { parameters = {}, saveToDatabase = false } = body

    // Authenticate user
    const authResult = await withAuth(request)
    if ('error' in authResult) return authResult.error

    const { user, supabase } = authResult.data

    // Verify ride ownership
    const { data: ride, error: rideError } = await supabase
      .from('rides')
      .select('id, user_id, name')
      .eq('id', rideId)
      .eq('user_id', user.id)
      .single()

    if (rideError || !ride) {
      return NextResponse.json({ error: 'Ride not found' }, { status: 404 })
    }

    console.log(`[DEV] Recomputing efficiency for ride: ${ride.name} (${rideId})`)
    console.log(`[DEV] Custom parameters:`, parameters)
    console.log(`[DEV] Save to database: ${saveToDatabase}`)

    // Fetch ride recordings
    const { data: recordings, error: recordingsError } = await supabase
      .from('ride_recordings')
      .select(`
        recording:recordings (
          id,
          file_type,
          storage_path,
          filename
        )
      `)
      .eq('ride_id', rideId)

    if (recordingsError) {
      throw new Error(`Failed to fetch recordings: ${recordingsError.message}`)
    }

    if (!recordings || recordings.length === 0) {
      return NextResponse.json(
        { error: 'No recordings associated with this ride' },
        { status: 400 }
      )
    }

    // Find FIT and VTX files (prefer merged, fallback to single VTX)
    const fitRecording = recordings.find((r: any) => r.recording?.file_type === 'fit') as any
    const vtxRecording = recordings.find((r: any) =>
      r.recording?.file_type === 'vtx_merged' || r.recording?.file_type === 'vtx'
    ) as any

    if (!fitRecording?.recording) {
      return NextResponse.json(
        { error: 'No FIT file found for this ride' },
        { status: 400 }
      )
    }

    if (!vtxRecording?.recording) {
      return NextResponse.json(
        { error: 'No VTX file found for this ride. Please associate a VTX recording first.' },
        { status: 400 }
      )
    }

    console.log(`[DEV] Found FIT: ${fitRecording.recording.filename}`)
    console.log(`[DEV] Found VTX: ${vtxRecording.recording.filename}`)

    // Download and parse FIT file
    const { data: fitBlob, error: fitDownloadError } = await supabase.storage
      .from('recordings')
      .download(fitRecording.recording.storage_path)

    if (fitDownloadError || !fitBlob) {
      throw new Error(`Failed to download FIT file: ${fitDownloadError?.message}`)
    }

    const fitBuffer = Buffer.from(await fitBlob.arrayBuffer())
    const fitParser = new FitParser({ force: true, mode: 'list' })

    const fitSamples = await new Promise<any[]>((resolve, reject) => {
      fitParser.parse(fitBuffer, (error: any, data: any) => {
        if (error) return reject(error)

        const records = data.records || []
        const samples = records.map((record: any) => ({
          timestamp: record.timestamp,
          grade: record.grade ?? null,
          altitude: record.altitude ?? null,
          cadence: record.cadence ?? null,
        }))

        resolve(samples)
      })
    })

    console.log(`[DEV] Parsed FIT: ${fitSamples.length} samples`)

    // Download and parse merged VTX file
    const { data: vtxBlob, error: vtxDownloadError } = await supabase.storage
      .from('recordings')
      .download(vtxRecording.recording.storage_path)

    if (vtxDownloadError || !vtxBlob) {
      throw new Error(`Failed to download VTX file: ${vtxDownloadError?.message}`)
    }

    const vtxArrayBuffer = await vtxBlob.arrayBuffer()
    const decoder = new VTXDecoder(vtxArrayBuffer)
    const header = decoder.getHeader()
    const recordCount = Number(header.recordCount)

    const vtxSamples = []
    for (let i = 0; i < recordCount; i++) {
      const record = decoder.readRecord(i)
      vtxSamples.push({
        timestamp: new Date(record.timestamp).toISOString(),
        accel_x: record.accelX,
        accel_y: record.accelY,
        accel_z: record.accelZ,
        gyro_x: record.gyroX,
      })
    }

    console.log(`[DEV] Parsed VTX: ${vtxSamples.length} samples`)

    // Calculate both efficiency and position with custom parameters
    const startTime = Date.now()
    const result = calculatePedalingEfficiency({
      vtxSamples,
      fitSamples,
      options: {
        ...parameters,
        includeDebug: true, // Always include debug in dev mode
      },
    })
    const computeTime = Date.now() - startTime

    console.log(`[DEV] Computation took ${computeTime}ms`)
    console.log(`[DEV] Efficiency: ${result.efficiency.samples.length} samples, ${result.efficiency.metadata.pedalingSamples} pedaling`)
    console.log(`[DEV] Avg efficiency: ${result.efficiency.metadata.avgEfficiencyPercent?.toFixed(1)}%`)
    console.log(`[DEV] Position: ${result.position.samples.length} samples`)
    console.log(`[DEV] Standing: ${result.position.metadata.standingPercent?.toFixed(1)}%, Seated: ${result.position.metadata.seatedPercent?.toFixed(1)}%`)

    // Save to database if requested
    if (saveToDatabase) {
      const now = new Date().toISOString()

      // Save efficiency analysis
      const { error: efficiencyError } = await supabase
        .from('ride_analysis')
        .upsert(
          {
            ride_id: rideId,
            analysis_type: 'pedaling_efficiency',
            status: 'completed',
            algorithm_version: ALGORITHM_VERSION,
            parameters,
            samples: result.efficiency.samples,
            metadata: result.efficiency.metadata,
            started_at: now,
            completed_at: now,
          },
          {
            onConflict: 'ride_id,analysis_type',
          }
        )

      if (efficiencyError) {
        throw new Error(`Failed to save efficiency analysis: ${efficiencyError.message}`)
      }

      // Save position analysis
      const { error: positionError } = await supabase
        .from('ride_analysis')
        .upsert(
          {
            ride_id: rideId,
            analysis_type: 'riding_position',
            status: 'completed',
            algorithm_version: ALGORITHM_VERSION,
            parameters,
            samples: result.position.samples,
            metadata: result.position.metadata,
            started_at: now,
            completed_at: now,
          },
          {
            onConflict: 'ride_id,analysis_type',
          }
        )

      if (positionError) {
        throw new Error(`Failed to save position analysis: ${positionError.message}`)
      }

      console.log(`[DEV] Saved both analyses to database`)
    }

    return NextResponse.json({
      success: true,
      message: saveToDatabase
        ? 'Both analyses recomputed and saved to database'
        : 'Both analyses recomputed (not saved)',
      efficiency: {
        metadata: result.efficiency.metadata,
        sampleCount: result.efficiency.samples.length,
      },
      position: {
        metadata: result.position.metadata,
        sampleCount: result.position.samples.length,
      },
      parameters: {
        ...parameters,
        algorithmVersion: ALGORITHM_VERSION,
      },
      computeTime,
    })
  } catch (error: any) {
    console.error('[DEV] Recompute error:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to recompute efficiency' },
      { status: 500 }
    )
  }
}
