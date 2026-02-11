import { NextRequest, NextResponse } from 'next/server'
import { withAuth } from '@/lib/api/auth'

export const dynamic = 'force-dynamic'

/**
 * Helper: Average multiple efficiency samples into one
 */
function averageSamples(samples: any[]): any {
  if (samples.length === 0) return null
  if (samples.length === 1) return samples[0]

  let sumEfficiency = 0
  let sumConfidence = 0
  let sumCadence = 0
  let countEfficiency = 0
  let countConfidence = 0
  let countCadence = 0

  for (const s of samples) {
    if (s.efficiency !== null && s.efficiency !== undefined) {
      sumEfficiency += s.efficiency
      countEfficiency++
    }
    if (s.confidence !== null && s.confidence !== undefined) {
      sumConfidence += s.confidence
      countConfidence++
    }
    if (s.detectedCadence !== null && s.detectedCadence !== undefined) {
      sumCadence += s.detectedCadence
      countCadence++
    }
  }

  // Use middle sample's timestamp as representative
  const middleSample = samples[Math.floor(samples.length / 2)]

  return {
    timestamp: middleSample.timestamp,
    efficiency: countEfficiency > 0 ? sumEfficiency / countEfficiency : null,
    efficiencyPercent: countEfficiency > 0 ? (sumEfficiency / countEfficiency) * 100 : null,
    confidence: countConfidence > 0 ? sumConfidence / countConfidence : null,
    detectedCadence: countCadence > 0 ? sumCadence / countCadence : null,
    // Keep other fields from middle sample
    rawAccel: middleSample.rawAccel,
    filteredAccel: middleSample.filteredAccel,
    grade: middleSample.grade
  }
}

/**
 * Get precomputed pedaling efficiency analysis for a ride
 *
 * Returns cached results computed by background Inngest job.
 * Results are computed after VTX files are merged for the ride.
 *
 * Query parameters:
 * - fields: 'metadata' to return only summary stats (default: all)
 * - start: ISO timestamp to filter from (optional)
 * - end: ISO timestamp to filter to (optional)
 * - resolution: samples per second (e.g. '1' for GPS frequency, '10' for high detail)
 *
 * Resolution is determined server-side:
 * - Full ride (no start/end): ~1000 samples
 * - Zoomed range: up to 10 samples per second based on duration
 * - Custom resolution (resolution param): specified samples per second
 *
 * Response states:
 * - 200: Analysis completed, returns samples + metadata
 * - 202: Analysis pending or processing, returns status
 * - 404: Ride not found
 * - 500: Analysis failed or internal error
 *
 * Response format:
 * {
 *   status: 'pending' | 'processing' | 'completed' | 'failed',
 *   samples: PedalingEfficiencyOutput[],  // Empty if not completed
 *   metadata: PedalingEfficiencyMetadata,  // Null if not completed
 *   computedAt?: string,                   // ISO timestamp when completed
 *   algorithmVersion?: string,             // Algorithm version used
 *   parameters?: object                    // Computation parameters
 * }
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: rideId } = await params
    const searchParams = request.nextUrl.searchParams

    // Parse query parameters
    const fieldsParam = searchParams.get('fields')
    const metadataOnly = fieldsParam === 'metadata'
    const startTime = searchParams.get('start') || undefined
    const endTime = searchParams.get('end') || undefined
    const resolution = searchParams.get('resolution') // Custom resolution (samples per second)

    // Authenticate user
    const authResult = await withAuth(request)
    if ('error' in authResult) return authResult.error

    const { user, supabase } = authResult.data

    // Verify ride ownership
    const { data: ride, error: rideError } = await supabase
      .from('rides')
      .select('id, user_id')
      .eq('id', rideId)
      .eq('user_id', user.id)
      .single()

    if (rideError || !ride) {
      return NextResponse.json({ error: 'Ride not found' }, { status: 404 })
    }

    // Fetch analysis results
    const { data: analysis, error: analysisError } = await supabase
      .from('ride_analysis')
      .select('*')
      .eq('ride_id', rideId)
      .eq('analysis_type', 'pedaling_efficiency')
      .maybeSingle()

    // No analysis exists - computation hasn't been triggered yet
    if (analysisError || !analysis) {
      return NextResponse.json(
        {
          status: 'not_started',
          message: 'Analysis not yet started. Ensure ride has both FIT and VTX recordings associated.',
          samples: [],
          metadata: null,
        },
        { status: 202 }
      ) // 202 Accepted
    }

    // Analysis is pending or processing
    if (analysis.status === 'pending' || analysis.status === 'processing') {
      const estimatedCompletion = analysis.started_at
        ? new Date(new Date(analysis.started_at).getTime() + 30000).toISOString() // ~30s estimate
        : null

      return NextResponse.json(
        {
          status: analysis.status,
          message:
            analysis.status === 'pending'
              ? 'Analysis queued, will start shortly'
              : 'Analysis in progress',
          startedAt: analysis.started_at,
          estimatedCompletion,
          samples: [],
          metadata: null,
        },
        { status: 202 }
      ) // 202 Accepted
    }

    // Analysis failed
    if (analysis.status === 'failed') {
      return NextResponse.json(
        {
          status: 'failed',
          error: analysis.error_message || 'Analysis failed',
          message: 'Pedaling efficiency calculation failed. You may need to re-associate recordings.',
          samples: [],
          metadata: null,
        },
        { status: 500 }
      )
    }

    // Analysis completed - return cached results
    let samples = analysis.samples || []

    // Filter by time range if provided
    if (startTime || endTime) {
      const startMs = startTime ? new Date(startTime).getTime() : -Infinity
      const endMs = endTime ? new Date(endTime).getTime() : Infinity

      samples = samples.filter((s: any) => {
        const sampleMs = new Date(s.timestamp).getTime()
        return sampleMs >= startMs && sampleMs <= endMs
      })
    }

    // Downsample based on resolution parameter or defaults
    if (resolution) {
      // Custom resolution: average samples into time buckets (e.g., 1 Hz = 1-second buckets)
      const samplesPerSecond = parseFloat(resolution)
      const bucketMs = 1000 / samplesPerSecond // e.g., 1 Hz = 1000ms buckets

      const bucketedSamples: any[] = []
      let currentBucket: any[] = []
      let bucketStartTime = samples.length > 0 ? new Date(samples[0].timestamp).getTime() : 0

      for (const sample of samples) {
        const sampleTime = new Date(sample.timestamp).getTime()

        // Check if sample belongs to next bucket
        if (sampleTime >= bucketStartTime + bucketMs) {
          // Average current bucket and push
          if (currentBucket.length > 0) {
            const avgSample = averageSamples(currentBucket)
            bucketedSamples.push(avgSample)
          }

          // Start new bucket
          bucketStartTime = Math.floor(sampleTime / bucketMs) * bucketMs
          currentBucket = [sample]
        } else {
          currentBucket.push(sample)
        }
      }

      // Push final bucket
      if (currentBucket.length > 0) {
        const avgSample = averageSamples(currentBucket)
        bucketedSamples.push(avgSample)
      }

      samples = bucketedSamples
    } else if (!startTime || !endTime) {
      // Full ride overview: ~1000 samples using stride sampling
      const targetResolution = 1000
      if (samples.length > targetResolution) {
        const stride = Math.ceil(samples.length / targetResolution)
        samples = samples.filter((_: any, i: number) => i % stride === 0)
      }
    } else {
      // Zoomed view: up to 10 samples per second using stride sampling
      const durationSeconds = (new Date(endTime).getTime() - new Date(startTime).getTime()) / 1000
      const targetResolution = Math.min(Math.ceil(durationSeconds * 10), 5000)
      if (samples.length > targetResolution) {
        const stride = Math.ceil(samples.length / targetResolution)
        samples = samples.filter((_: any, i: number) => i % stride === 0)
      }
    }

    // Return metadata only if requested
    if (metadataOnly) {
      return NextResponse.json(
        {
          status: 'completed',
          samples: [],
          metadata: analysis.metadata,
          computedAt: analysis.completed_at,
          algorithmVersion: analysis.algorithm_version,
          parameters: analysis.parameters,
        },
        {
          headers: {
            'Cache-Control': 'public, max-age=3600, immutable',
            'ETag': `"${analysis.id}-${analysis.completed_at}-metadata"`,
          },
        }
      )
    }

    // Return full results
    return NextResponse.json(
      {
        status: 'completed',
        samples,
        metadata: analysis.metadata,
        computedAt: analysis.completed_at,
        algorithmVersion: analysis.algorithm_version,
        parameters: analysis.parameters,
      },
      {
        headers: {
          'Cache-Control': 'public, max-age=3600, immutable',
          'ETag': `"${analysis.id}-${analysis.completed_at}-${startTime || 'full'}-${endTime || 'full'}"`,
        },
      }
    )
  } catch (error: any) {
    console.error('Error fetching pedaling efficiency:', error)
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 })
  }
}
