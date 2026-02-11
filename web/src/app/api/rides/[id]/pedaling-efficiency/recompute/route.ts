import { NextRequest, NextResponse } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { calculatePedalingEfficiency } from '@/lib/analysis/pedaling-efficiency'
import { ALGORITHM_VERSION } from '@/lib/analysis/pedaling-efficiency-constants'
import { VTXDecoder } from '@vertex-pkg/vtx-parser'
import FitParser from 'fit-file-parser'

export const dynamic = 'force-dynamic'
export const maxDuration = 60 // Allow up to 60 seconds for large rides

/**
 * DEV ONLY: Recompute pedaling efficiency with custom parameters
 *
 * This endpoint allows developers to experiment with algorithm tuning
 * by recomputing efficiency with custom parameters.
 *
 * POST /api/rides/[id]/pedaling-efficiency/recompute
 *
 * Body:
 * {
 *   parameters: {
 *     hpfCutoff?: number
 *     windowSize?: number
 *     fftWindowSize?: number
 *     confidenceThreshold?: number
 *     minCadence?: number
 *     maxCadence?: number
 *     useMagnitude?: boolean
 *   },
 *   saveToDatabase?: boolean  // If true, overwrites existing analysis
 * }
 *
 * Response:
 * {
 *   success: true,
 *   message: string,
 *   metadata: PedalingEfficiencyMetadata,
 *   sampleCount: number,
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
      })
    }

    console.log(`[DEV] Parsed VTX: ${vtxSamples.length} samples`)

    // Calculate efficiency with custom parameters
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
    console.log(`[DEV] Result: ${result.samples.length} samples, ${result.metadata.pedalingSamples} pedaling`)
    console.log(`[DEV] Avg efficiency: ${result.metadata.avgEfficiencyPercent?.toFixed(1)}%`)

    // Save to database if requested
    if (saveToDatabase) {
      const { error: upsertError } = await supabase
        .from('ride_analysis')
        .upsert(
          {
            ride_id: rideId,
            analysis_type: 'pedaling_efficiency',
            status: 'completed',
            algorithm_version: ALGORITHM_VERSION,
            parameters,
            samples: result.samples,
            metadata: result.metadata,
            started_at: new Date().toISOString(),
            completed_at: new Date().toISOString(),
          },
          {
            onConflict: 'ride_id,analysis_type',
          }
        )

      if (upsertError) {
        throw new Error(`Failed to save analysis: ${upsertError.message}`)
      }

      console.log(`[DEV] Saved analysis to database`)
    }

    return NextResponse.json({
      success: true,
      message: saveToDatabase
        ? 'Analysis recomputed and saved to database'
        : 'Analysis recomputed (not saved)',
      metadata: result.metadata,
      sampleCount: result.samples.length,
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
