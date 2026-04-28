import { NextRequest, NextResponse } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { calculatePedalingEfficiency } from '@/lib/analysis/ride-imu-analysis'

export const dynamic = 'force-dynamic'

/**
 * Debug endpoint for pedaling efficiency analysis
 *
 * Designed for analyzing small time windows (10-30 seconds) with detailed diagnostics
 *
 * Query parameters:
 * - start: Start timestamp (REQUIRED)
 * - end: End timestamp (REQUIRED)
 * - window_size: Smoothness window in seconds (default: 3)
 * - hpf_cutoff: High-pass filter cutoff Hz (default: 0.5)
 *
 * Returns detailed diagnostics including:
 * - Full sample data with all intermediate values
 * - Signal statistics
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: rideId } = await params
    const searchParams = request.nextUrl.searchParams

    // Parse query parameters
    const startTime = searchParams.get('start')
    const endTime = searchParams.get('end')
    const windowSize = parseInt(searchParams.get('window_size') || '3')
    const hpfCutoff = parseFloat(searchParams.get('hpf_cutoff') || '0.5')

    if (!startTime || !endTime) {
      return NextResponse.json(
        { error: 'start and end timestamps are required for debug endpoint' },
        { status: 400 }
      )
    }

    // Validate time window size (max 60 seconds for debug)
    const start = new Date(startTime)
    const end = new Date(endTime)
    const durationSeconds = (end.getTime() - start.getTime()) / 1000

    if (durationSeconds > 60) {
      return NextResponse.json(
        { error: 'Debug endpoint limited to 60 second windows. Use main endpoint for longer ranges.' },
        { status: 400 }
      )
    }

    if (durationSeconds <= 0) {
      return NextResponse.json(
        { error: 'End time must be after start time' },
        { status: 400 }
      )
    }

    // Authenticate user
    const authResult = await withAuth(request)
    if ('error' in authResult) return authResult.error

    const { user, supabase } = authResult.data

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

    // Fetch FIT samples (include cadence)
    const fitSamplesUrl = new URL(`${request.url.split('/pedaling-efficiency')[0]}/samples`, request.url)
    fitSamplesUrl.searchParams.set('start', startTime)
    fitSamplesUrl.searchParams.set('end', endTime)
    fitSamplesUrl.searchParams.set('fields', 'grade,altitude,distance,cadence,speed,power')

    const fitResponse = await fetch(fitSamplesUrl, {
      headers: { 'Authorization': request.headers.get('authorization')! }
    })

    if (!fitResponse.ok) {
      throw new Error('Failed to fetch FIT samples')
    }

    const { samples: fitSamples } = await fitResponse.json()

    // Fetch VTX samples
    const vtxSamplesUrl = new URL(`${request.url.split('/pedaling-efficiency')[0]}/vtx-samples`, request.url)
    vtxSamplesUrl.searchParams.set('start', startTime)
    vtxSamplesUrl.searchParams.set('end', endTime)
    vtxSamplesUrl.searchParams.set('fields', 'accel,gyro')
    vtxSamplesUrl.searchParams.set('downsample', 'none')

    const vtxResponse = await fetch(vtxSamplesUrl, {
      headers: { 'Authorization': request.headers.get('authorization')! }
    })

    if (!vtxResponse.ok) {
      throw new Error('Failed to fetch VTX samples')
    }

    const { samples: vtxSamples } = await vtxResponse.json()

    if (vtxSamples.length === 0) {
      return NextResponse.json(
        { error: 'No VTX samples found in time range' },
        { status: 404 }
      )
    }

    // Transform VTX samples (include all gyro axes for position + braking detection)
    const allVtxSamples = vtxSamples.map((s: any) => ({
      timestamp: s.timestamp,
      accel_x: s.accel?.x ?? 0,
      accel_y: s.accel?.y ?? 0,
      accel_z: s.accel?.z ?? 0,
      gyro_x: s.gyro?.x ?? undefined,
      gyro_y: s.gyro?.y ?? undefined,
      gyro_z: s.gyro?.z ?? undefined,
    }))

    // Parse optional tuning parameters from query string
    const getFloat = (key: string) => {
      const v = searchParams.get(key)
      return v ? parseFloat(v) : undefined
    }

    // Run analysis with debug enabled
    const result = calculatePedalingEfficiency({
      vtxSamples: allVtxSamples,
      fitSamples: fitSamples.map((s: any) => ({
        timestamp: s.timestamp,
        grade: s.grade,
        altitude: s.altitude,
        distance: s.distance ?? null,
        cadence: s.cadence ?? null,
        speed: s.speed ?? null,
        power: s.power ?? null,
      })),
      options: {
        windowSize,
        hpfCutoff,
        includeDebug: true,
        // Position detection
        positionWindowSeconds: getFloat('position_window_seconds'),
        yAxisThreshold: getFloat('y_axis_threshold'),
        rollBpfLow: getFloat('roll_bpf_low'),
        rollBpfHigh: getFloat('roll_bpf_high'),
        rollRmsThreshold: getFloat('roll_rms_threshold'),
        yawBpfLow: getFloat('yaw_bpf_low'),
        yawBpfHigh: getFloat('yaw_bpf_high'),
        yawRmsThreshold: getFloat('yaw_rms_threshold'),
        gyroWeight: getFloat('gyro_weight'),
        accelWeight: getFloat('accel_weight'),
        positionRollWeight: getFloat('position_roll_weight'),
        positionYawWeight: getFloat('position_yaw_weight'),
        // Stability
        stabilityBpfLow: getFloat('stability_bpf_low'),
        stabilityBpfHigh: getFloat('stability_bpf_high'),
        stabilityRollWeight: getFloat('stability_roll_weight'),
        stabilityYawWeight: getFloat('stability_yaw_weight'),
        stabilitySurgeWeight: getFloat('stability_surge_weight'),
        maxStabilityRms: getFloat('max_stability_rms'),
        // Braking
        brakingLpfHz: getFloat('braking_lpf_hz'),
        brakingHpfHz: getFloat('braking_hpf_hz'),
        brakingThresholdMs2: getFloat('braking_threshold_ms2'),
        brakingMaxMs2: getFloat('braking_max_ms2'),
        // Roughness
        roughnessBaseCeiling: getFloat('roughness_base_ceiling'),
        roughnessReferenceSpeedMs: getFloat('roughness_reference_speed_ms'),
        roughnessSpeedExponent: getFloat('roughness_speed_exponent'),
      }
    })

    // Return ALL samples for debug (not just summary)
    return NextResponse.json({
      timeRange: {
        start: startTime,
        end: endTime,
        durationSeconds
      },
      parameters: {
        windowSize,
        hpfCutoff,
        sampleCount: result.efficiency.samples.length,
        sampleRate: result.efficiency.metadata.sampleRate
      },
      samples: result.efficiency.samples,
      metadata: result.efficiency.metadata,
      position: {
        samples: result.position.samples,
        rawSamples: result.position.rawSamples,
        metadata: result.position.metadata
      },
      braking: {
        samples: result.braking.samples,
        metadata: result.braking.metadata
      },
      roughness: {
        metadata: result.roughness.metadata
      },
      rawInputs: {
        vtxSampleCount: allVtxSamples.length,
        fitSampleCount: fitSamples.length,
        firstVtxSample: allVtxSamples[0],
        lastVtxSample: allVtxSamples[allVtxSamples.length - 1]
      }
    })

  } catch (error: any) {
    console.error('Error in debug pedaling efficiency:', error)
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    )
  }
}
