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
  let sumCadence = 0
  let cadenceCount = 0

  for (const s of samples) {
    if (s.position === 'standing') counts.standing++
    else if (s.position === 'seated') counts.seated++
    else counts.null++

    sumRocking += s.rockingMagnitude || 0
    if (s.cadence !== null && s.cadence !== undefined) {
      sumCadence += s.cadence
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
    cadence: cadenceCount > 0 ? sumCadence / cadenceCount : null
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
    const resolution = searchParams.get('resolution') // Custom resolution (samples per second)
    const ranges = parseRanges(searchParams)

    const setup = await setupAnalysisRoute(request, rideId, 'riding_position')
    if ('earlyResponse' in setup) return setup.earlyResponse

    const { context, analysis } = setup

    const pendingResponse = buildPendingResponse(
      analysis,
      'Riding position calculation failed. You may need to re-associate recordings.'
    )
    if (pendingResponse) return pendingResponse

    const completedAnalysis = analysis!

    // Fetch the heavy samples column only now that we know status is completed
    let samples: any[] = filterByRanges(
      await loadSamples(context.supabase, completedAnalysis.samples_path),
      ranges
    )

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
    console.error('Error fetching riding position:', error)
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 })
  }
}
