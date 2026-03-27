import { NextRequest, NextResponse } from 'next/server'
import { withAuth } from '@/lib/api/auth'

export const dynamic = 'force-dynamic'

/**
 * Get precomputed braking analysis for a ride
 *
 * Returns cached results computed by background Inngest job.
 *
 * Query parameters:
 * - fields: 'metadata' to return only summary stats (default: all)
 * - start: ISO timestamp to filter from (optional)
 * - end: ISO timestamp to filter to (optional)
 * - resolution: samples per second (e.g. '1' for GPS frequency) - optional
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
    const resolution = searchParams.get('resolution')

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
      .eq('analysis_type', 'braking')
      .maybeSingle()

    // No analysis exists
    if (analysisError || !analysis) {
      return NextResponse.json(
        {
          status: 'not_started',
          message: 'Analysis not yet started. Ensure ride has both FIT and VTX recordings associated.',
          samples: [],
          metadata: null,
        },
        { status: 202 }
      )
    }

    // Analysis is pending or processing
    if (analysis.status === 'pending' || analysis.status === 'processing') {
      const estimatedCompletion = analysis.started_at
        ? new Date(new Date(analysis.started_at).getTime() + 30000).toISOString()
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
      )
    }

    // Analysis failed
    if (analysis.status === 'failed') {
      return NextResponse.json(
        {
          status: 'failed',
          error: analysis.error_message || 'Analysis failed',
          message: 'Braking analysis failed. You may need to re-associate recordings.',
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

    // Downsample if resolution is specified and is lower than native rate
    if (resolution) {
      const samplesPerSecond = parseFloat(resolution)

      if (samplesPerSecond < 25) {
        const bucketMs = 1000 / samplesPerSecond

        const bucketedSamples: any[] = []
        let currentBucket: any[] = []
        let bucketStartTime = samples.length > 0 ? new Date(samples[0].timestamp).getTime() : 0

        for (const sample of samples) {
          const sampleTime = new Date(sample.timestamp).getTime()

          if (sampleTime >= bucketStartTime + bucketMs) {
            if (currentBucket.length > 0) {
              // Use peak braking intensity in bucket (not average)
              const peakSample = currentBucket.reduce((best: any, s: any) =>
                (s.brakingIntensity || 0) > (best.brakingIntensity || 0) ? s : best
              )
              bucketedSamples.push(peakSample)
            }

            bucketStartTime = Math.floor(sampleTime / bucketMs) * bucketMs
            currentBucket = [sample]
          } else {
            currentBucket.push(sample)
          }
        }

        // Push final bucket
        if (currentBucket.length > 0) {
          const peakSample = currentBucket.reduce((best: any, s: any) =>
            (s.brakingIntensity || 0) > (best.brakingIntensity || 0) ? s : best
          )
          bucketedSamples.push(peakSample)
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
            'Cache-Control': 'public, no-cache',
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
          'Cache-Control': 'public, no-cache',
          'ETag': `"${analysis.id}-${analysis.completed_at}-${startTime || 'full'}-${endTime || 'full'}"`,
        },
      }
    )
  } catch (error: any) {
    console.error('Error fetching braking analysis:', error)
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 })
  }
}
