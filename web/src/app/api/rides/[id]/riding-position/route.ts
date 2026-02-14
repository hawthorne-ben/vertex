import { NextRequest, NextResponse } from 'next/server'
import { withAuth } from '@/lib/api/auth'

export const dynamic = 'force-dynamic'

/**
 * Helper: Average multiple position samples using majority vote for position
 */
function averageSamples(samples: any[]): any {
  if (samples.length === 0) return null
  if (samples.length === 1) return samples[0]

  // Count position occurrences for majority vote
  const counts = {
    standing: 0,
    seated: 0,
    null: 0
  }

  let sumRocking = 0
  let sumConfidence = 0
  let sumCadence = 0
  let cadenceCount = 0

  for (const s of samples) {
    if (s.position === 'standing') counts.standing++
    else if (s.position === 'seated') counts.seated++
    else counts.null++

    sumRocking += s.rockingMagnitude || 0
    sumConfidence += s.confidence || 0
    if (s.detectedCadence !== null && s.detectedCadence !== undefined) {
      sumCadence += s.detectedCadence
      cadenceCount++
    }
  }

  // Determine majority position
  let majorityPosition: 'standing' | 'seated' | null
  if (counts.null > counts.standing && counts.null > counts.seated) {
    majorityPosition = null
  } else if (counts.standing > counts.seated) {
    majorityPosition = 'standing'
  } else {
    majorityPosition = 'seated'
  }

  // Use middle sample's timestamp as representative
  const middleSample = samples[Math.floor(samples.length / 2)]

  return {
    timestamp: middleSample.timestamp,
    position: majorityPosition,
    rockingMagnitude: sumRocking / samples.length,
    confidence: sumConfidence / samples.length,
    detectedCadence: cadenceCount > 0 ? sumCadence / cadenceCount : null
  }
}

/**
 * Get precomputed riding position analysis for a ride
 *
 * Returns cached results computed by background Inngest job.
 * Results are computed after VTX files are merged for the ride.
 *
 * Query parameters:
 * - fields: 'metadata' to return only summary stats (default: all)
 * - start: ISO timestamp to filter from (optional)
 * - end: ISO timestamp to filter to (optional)
 * - resolution: samples per second (e.g. '1' for GPS frequency) - optional
 *
 * Note: Position data is already downsampled to 1 Hz during computation
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
 *   samples: RidingPositionSample[],  // Empty if not completed
 *   metadata: RidingPositionMetadata,  // Null if not completed
 *   computedAt?: string,               // ISO timestamp when completed
 *   algorithmVersion?: string,         // Algorithm version used
 *   parameters?: object                // Computation parameters
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
      .eq('analysis_type', 'riding_position')
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
          message: 'Riding position calculation failed. You may need to re-associate recordings.',
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

    // Downsample if resolution is specified and is lower than 1 Hz
    // Position data is already at 1 Hz, so only downsample if requested resolution is lower
    if (resolution) {
      const samplesPerSecond = parseFloat(resolution)

      // Only downsample if requested resolution is less than 1 Hz
      if (samplesPerSecond < 1) {
        const bucketMs = 1000 / samplesPerSecond

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
    console.error('Error fetching riding position:', error)
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 })
  }
}
