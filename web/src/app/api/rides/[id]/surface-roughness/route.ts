import { NextRequest, NextResponse } from 'next/server'
import {
  setupAnalysisRoute,
  buildPendingResponse,
  loadSamples,
  parseRanges,
  filterByRanges,
} from '@/lib/api/ride-analysis'

export const dynamic = 'force-dynamic'

/**
 * Helper: Average multiple roughness samples
 */
function averageSamples(samples: any[]): any {
  if (samples.length === 0) return null
  if (samples.length === 1) return samples[0]

  let sumRoughness = 0
  let sumRoughnessRms = 0
  let sumSpeed = 0
  let speedCount = 0

  for (const s of samples) {
    sumRoughness += s.roughness || 0
    sumRoughnessRms += s.roughnessRms || 0
    if (s.speed !== null && s.speed !== undefined) {
      sumSpeed += s.speed
      speedCount++
    }
  }

  // Use middle sample's timestamp as representative
  const middleSample = samples[Math.floor(samples.length / 2)]

  return {
    timestamp: middleSample.timestamp,
    roughness: sumRoughness / samples.length,
    roughnessRms: sumRoughnessRms / samples.length,
    speed: speedCount > 0 ? sumSpeed / speedCount : null,
  }
}

/**
 * Get precomputed surface roughness analysis for a ride
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
    const resolution = searchParams.get('resolution')
    const ranges = parseRanges(searchParams)

    const setup = await setupAnalysisRoute(request, rideId, 'surface_roughness')
    if ('earlyResponse' in setup) return setup.earlyResponse

    const { context, analysis } = setup

    const pendingResponse = buildPendingResponse(
      analysis,
      'Surface roughness calculation failed. You may need to re-associate recordings.'
    )
    if (pendingResponse) return pendingResponse

    const completedAnalysis = analysis!

    let samples: any[] = filterByRanges(
      await loadSamples(context.supabase, completedAnalysis.samples_path),
      ranges
    )

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
              const avgSample = averageSamples(currentBucket)
              bucketedSamples.push(avgSample)
            }

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
          'ETag': `"${completedAnalysis.id}-${completedAnalysis.completed_at}-${ranges ? JSON.stringify(ranges) : 'full'}"`,
        },
      }
    )
  } catch (error: any) {
    console.error('Error fetching surface roughness:', error)
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 })
  }
}
