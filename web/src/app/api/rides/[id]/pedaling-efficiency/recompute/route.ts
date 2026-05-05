import { NextRequest, NextResponse } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { calculatePedalingEfficiency } from '@/lib/analysis/ride-imu-analysis'
import { ALGORITHM_VERSION, OUTPUT_SAMPLE_RATE_HZ } from '@/lib/analysis/imu-constants'
import { buildSamplesPath, uploadSamples } from '@/lib/analysis/samples-storage'
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
 *   saveToDatabase?: boolean  // If true, overwrites existing analyses + ride summary
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
      .select('id, user_id, name, start_time, duration_seconds, distance_meters, elevation_gain_meters')
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
      throw new Error(`Failed to download FIT file: ${JSON.stringify(fitDownloadError)}`)
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
          altitude: record.enhanced_altitude ?? record.altitude ?? null,
          distance: record.distance ?? null,
          cadence: record.cadence ?? null,
          power: record.power ?? null,
          speed: record.speed ? record.speed / 3.6 : null,  // km/h → m/s
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
      throw new Error(`Failed to download VTX file: ${JSON.stringify(vtxDownloadError)}`)
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
        gyro_y: record.gyroY,
        gyro_z: record.gyroZ,
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
    console.log(`[DEV] Avg stability: ${result.efficiency.metadata.avgStabilityPercent?.toFixed(1)}%`)
    console.log(`[DEV] Position: ${result.position.samples.length} samples`)
    console.log(`[DEV] Standing: ${result.position.metadata.standingPercent?.toFixed(1)}%, Seated: ${result.position.metadata.seatedPercent?.toFixed(1)}%`)
    console.log(`[DEV] Roughness: ${result.roughness.samples.length} samples, avg ${result.roughness.metadata.avgRoughness?.toFixed(1)}%, smooth ${result.roughness.metadata.smoothSurfacePercent?.toFixed(1)}%, rough ${result.roughness.metadata.roughSurfacePercent?.toFixed(1)}%`)
    console.log(`[DEV] Braking: ${result.braking.samples.length} samples, ${result.braking.metadata.totalBrakingEvents} events, ${result.braking.metadata.brakingPercent?.toFixed(1)}% time, max intensity ${result.braking.metadata.maxBrakingIntensity?.toFixed(0)}`)

    // Save to database if requested
    if (saveToDatabase) {
      const now = new Date().toISOString()

      // Upload samples to Storage and upsert the row with path + counts.
      const persistAnalysis = async (
        analysisType: string,
        samples: any[],
        metadata: any
      ) => {
        const path = buildSamplesPath(ride.user_id, rideId, analysisType, ALGORITHM_VERSION)
        const upload = await uploadSamples(supabase, path, samples)

        return supabase
          .from('ride_analysis')
          .upsert(
            {
              ride_id: rideId,
              user_id: ride.user_id,
              analysis_type: analysisType,
              status: 'completed',
              algorithm_version: ALGORITHM_VERSION,
              parameters,
              metadata,
              samples_path: upload.path,
              samples_size_bytes: upload.sizeBytes,
              sample_count: upload.sampleCount,
              sample_rate_hz: OUTPUT_SAMPLE_RATE_HZ,
              started_at: now,
              completed_at: now,
            },
            { onConflict: 'ride_id,analysis_type' }
          )
      }

      const { error: efficiencyError } = await persistAnalysis(
        'pedaling_efficiency',
        result.efficiency.samples,
        result.efficiency.metadata
      )
      if (efficiencyError) {
        throw new Error(`Failed to save efficiency analysis: ${efficiencyError.message}`)
      }

      const { error: positionError } = await persistAnalysis(
        'riding_position',
        result.position.samples,
        result.position.metadata
      )
      if (positionError) {
        throw new Error(`Failed to save position analysis: ${positionError.message}`)
      }

      const { error: roughnessError } = await persistAnalysis(
        'surface_roughness',
        result.roughness.samples,
        result.roughness.metadata
      )
      if (roughnessError) {
        throw new Error(`Failed to save roughness analysis: ${roughnessError.message}`)
      }

      const { error: brakingError } = await persistAnalysis(
        'braking',
        result.braking.samples,
        result.braking.metadata
      )

      if (brakingError) {
        throw new Error(`Failed to save braking analysis: ${brakingError.message}`)
      }

      console.log(`[DEV] Saved all four analyses to database`)

      // Upsert ride_summaries (same as inngest job)
      const { data: fitRec } = await supabase
        .from('recordings')
        .select('analysis_results')
        .eq('id', fitRecording.recording.id)
        .maybeSingle()

      const fitStats = fitRec?.analysis_results as any

      const summaryRow = {
        ride_id: rideId,
        user_id: user.id,
        ride_started_at: ride.start_time,
        duration_seconds: ride.duration_seconds,
        distance_meters: ride.distance_meters,
        elevation_gain_meters: ride.elevation_gain_meters,

        // FIT-derived
        avg_speed_ms: fitStats?.avg_speed_ms ?? null,
        avg_heart_rate: fitStats?.avg_heart_rate ?? null,
        avg_power_watts: fitStats?.avg_power_watts ?? null,
        avg_cadence: fitStats?.avg_cadence ?? null,
        max_heart_rate: fitStats?.max_heart_rate ?? null,
        max_power_watts: fitStats?.max_power_watts ?? null,
        max_cadence: fitStats?.max_cadence ?? null,

        // IMU-derived: Stability
        avg_stability_percent: result.efficiency.metadata.avgStabilityPercent ?? null,
        stable_pedaling_percent: result.efficiency.metadata.stablePercent ?? null,
        unstable_pedaling_percent: result.efficiency.metadata.unstablePercent ?? null,
        pedaling_percent: result.efficiency.metadata.pedalingPercent ?? null,

        // IMU-derived: Position
        standing_percent: result.position.metadata.standingPercent ?? null,
        seated_percent: result.position.metadata.seatedPercent ?? null,
        avg_cadence_standing: result.position.metadata.avgCadenceStanding ?? null,
        avg_cadence_seated: result.position.metadata.avgCadenceSeated ?? null,

        // IMU-derived: Roughness
        avg_roughness: result.roughness.metadata.avgRoughness ?? null,
        max_roughness: result.roughness.metadata.maxRoughness ?? null,
        smooth_surface_percent: result.roughness.metadata.smoothSurfacePercent ?? null,
        rough_surface_percent: result.roughness.metadata.roughSurfacePercent ?? null,

        // IMU-derived: Braking
        total_braking_events: result.braking.metadata.totalBrakingEvents ?? null,
        braking_percent: result.braking.metadata.brakingPercent ?? null,
        avg_braking_intensity: result.braking.metadata.avgBrakingIntensity ?? null,
        max_braking_intensity: result.braking.metadata.maxBrakingIntensity ?? null,

        // Algorithm versions
        efficiency_version: ALGORITHM_VERSION,
        position_version: ALGORITHM_VERSION,
        roughness_version: ALGORITHM_VERSION,
        braking_version: ALGORITHM_VERSION,
        computed_at: now,
      }

      const { error: summaryError } = await supabase
        .from('ride_summaries')
        .upsert(summaryRow, { onConflict: 'ride_id' })

      if (summaryError) {
        console.error(`[DEV] Failed to upsert ride summary:`, summaryError.message)
      } else {
        console.log(`[DEV] Upserted ride summary`)
      }
    }

    return NextResponse.json({
      success: true,
      message: saveToDatabase
        ? 'All analyses recomputed and saved to database'
        : 'All analyses recomputed (not saved)',
      efficiency: {
        metadata: result.efficiency.metadata,
        sampleCount: result.efficiency.samples.length,
      },
      position: {
        metadata: result.position.metadata,
        sampleCount: result.position.samples.length,
      },
      roughness: {
        metadata: result.roughness.metadata,
        sampleCount: result.roughness.samples.length,
      },
      braking: {
        metadata: result.braking.metadata,
        sampleCount: result.braking.samples.length,
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
