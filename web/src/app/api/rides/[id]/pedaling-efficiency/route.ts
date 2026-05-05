import { NextRequest, NextResponse } from 'next/server'
import {
  setupAnalysisRoute,
  buildPendingResponse,
  loadSamples,
} from '@/lib/api/ride-analysis'

export const dynamic = 'force-dynamic'

/**
 * Helper: Average multiple stability samples into one
 *
 * Handles both v5+ field names (stability/stabilityPercent) and
 * legacy v4 field names (efficiency/efficiencyPercent) for backwards
 * compatibility with previously stored analyses.
 */
function averageSamples(samples: any[]): any {
  if (samples.length === 0) return null
  if (samples.length === 1) return normalizeSample(samples[0])

  let sumStability = 0
  let sumCadence = 0
  let countStability = 0
  let countCadence = 0

  for (const s of samples) {
    // Support both old (efficiency) and new (stability) field names
    const val = s.stability ?? s.efficiency ?? null
    if (val !== null && val !== undefined) {
      sumStability += val
      countStability++
    }
    if (s.cadence !== null && s.cadence !== undefined) {
      sumCadence += s.cadence
      countCadence++
    }
  }

  // Use middle sample's timestamp as representative
  const middleSample = samples[Math.floor(samples.length / 2)]
  const avgStability = countStability > 0 ? sumStability / countStability : null

  return {
    timestamp: middleSample.timestamp,
    stability: avgStability,
    stabilityPercent: avgStability !== null ? avgStability * 100 : null,
    isPedaling: middleSample.isPedaling,
    cadence: countCadence > 0 ? sumCadence / countCadence : null,
    grade: middleSample.grade,
    // Pass through spectral debug fields from middle sample
    cadenceHz: middleSample.cadenceHz ?? null,
    rollRms: middleSample.rollRms ?? middleSample.rollCoherence ?? null,
    yawRms: middleSample.yawRms ?? middleSample.yawCoherence ?? null,
    surgeRms: middleSample.surgeRms ?? middleSample.surgeCoherence ?? null,
  }
}

/**
 * Normalize a single sample from legacy field names to v5+ field names.
 * Stored analyses from v4 use efficiency/efficiencyPercent; v5+ uses stability/stabilityPercent.
 */
function normalizeSample(s: any): any {
  if (s.stability !== undefined) return s // Already v5+
  if (s.efficiency !== undefined) {
    return {
      ...s,
      stability: s.efficiency,
      stabilityPercent: s.efficiencyPercent ?? (s.efficiency !== null ? s.efficiency * 100 : null),
    }
  }
  return s
}

/**
 * Normalize legacy metadata from v4 (efficiency) to v5 (stability) field names.
 */
function normalizeMetadata(meta: any): any {
  if (!meta) return meta
  if (meta.avgStability !== undefined) return meta // Already v5+
  return {
    ...meta,
    avgStability: meta.avgSmoothness ?? meta.avgEfficiency ?? null,
    avgStabilityPercent: meta.avgSmoothnessPercent ?? meta.avgEfficiencyPercent ?? null,
    stablePercent: meta.smoothPercent ?? meta.smoothPercent ?? 0,
    unstablePercent: meta.roughPercent ?? meta.roughPercent ?? 0,
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

    const setup = await setupAnalysisRoute(request, rideId, 'pedaling_efficiency')
    if ('earlyResponse' in setup) return setup.earlyResponse

    const { context, analysis } = setup

    const pendingResponse = buildPendingResponse(
      analysis,
      'Pedaling efficiency calculation failed. You may need to re-associate recordings.'
    )
    if (pendingResponse) return pendingResponse

    // After buildPendingResponse returns null, status is 'completed' and
    // analysis is non-null. Hoist to a narrowed local for the rest of the handler.
    const completedAnalysis = analysis!

    // Fetch the heavy samples column only now that we know status is completed
    const rawSamples = await loadSamples(context.supabase, completedAnalysis.samples_path)

    // Normalize legacy field names (v4 efficiency → v5 stability)
    let samples = rawSamples.map(normalizeSample)

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

    // Normalize legacy metadata field names
    const metadata = normalizeMetadata(completedAnalysis.metadata)

    // Return metadata only if requested
    if (metadataOnly) {
      return NextResponse.json(
        {
          status: 'completed',
          samples: [],
          metadata,
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
        metadata,
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
    console.error('Error fetching pedaling efficiency:', error)
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 })
  }
}
