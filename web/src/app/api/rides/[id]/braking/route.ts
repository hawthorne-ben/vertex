import { NextRequest, NextResponse } from 'next/server'
import {
  setupAnalysisRoute,
  buildPendingResponse,
  loadSamples,
} from '@/lib/api/ride-analysis'

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

    const setup = await setupAnalysisRoute(request, rideId, 'braking')
    if ('earlyResponse' in setup) return setup.earlyResponse

    const { context, analysis } = setup

    const pendingResponse = buildPendingResponse(
      analysis,
      'Braking analysis failed. You may need to re-associate recordings.'
    )
    if (pendingResponse) return pendingResponse

    const completedAnalysis = analysis!

    let samples = await loadSamples(context.supabase, completedAnalysis.samples_path)

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
          metadata: completedAnalysis.metadata,
          computedAt: completedAnalysis.completed_at,
          algorithmVersion: completedAnalysis.algorithm_version,
          parameters: completedAnalysis.parameters,
        },
        {
          headers: {
            'Cache-Control': 'public, no-cache',
            'ETag': `"${completedAnalysis.id}-${completedAnalysis.completed_at}-metadata"`,
          },
        }
      )
    }

    // Return full results
    return NextResponse.json(
      {
        status: 'completed',
        samples,
        metadata: completedAnalysis.metadata,
        computedAt: completedAnalysis.completed_at,
        algorithmVersion: completedAnalysis.algorithm_version,
        parameters: completedAnalysis.parameters,
      },
      {
        headers: {
          'Cache-Control': 'public, no-cache',
          'ETag': `"${completedAnalysis.id}-${completedAnalysis.completed_at}-${startTime || 'full'}-${endTime || 'full'}"`,
        },
      }
    )
  } catch (error: any) {
    console.error('Error fetching braking analysis:', error)
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 })
  }
}
