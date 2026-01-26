import { NextRequest, NextResponse } from 'next/server'
import { withAuth } from '@/lib/api/auth'

export const dynamic = 'force-dynamic'

/**
 * Get precomputed pedaling efficiency analysis for a ride
 *
 * Returns cached results computed by background Inngest job.
 * Results are computed after VTX files are merged for the ride.
 *
 * Query parameters:
 * - fields: 'metadata' to return only summary stats (default: all)
 * - resolution: Max samples to return via downsampling (default: full resolution)
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

    console.log('[Pedaling Efficiency API] Request:', { rideId, params: Object.fromEntries(searchParams) })

    // Parse query parameters
    const fieldsParam = searchParams.get('fields')
    const metadataOnly = fieldsParam === 'metadata'
    const resolution = searchParams.get('resolution')
      ? parseInt(searchParams.get('resolution')!)
      : null

    // Authenticate user
    const authResult = await withAuth(request)
    if ('error' in authResult) {
      console.log('[Pedaling Efficiency API] Auth failed')
      return authResult.error
    }

    const { user, supabase } = authResult.data
    console.log('[Pedaling Efficiency API] Authenticated:', user.id)

    // Verify ride ownership
    const { data: ride, error: rideError } = await supabase
      .from('rides')
      .select('id, user_id')
      .eq('id', rideId)
      .eq('user_id', user.id)
      .single()

    if (rideError || !ride) {
      console.log('[Pedaling Efficiency API] Ride not found:', rideError)
      return NextResponse.json({ error: 'Ride not found' }, { status: 404 })
    }

    console.log('[Pedaling Efficiency API] Fetching analysis for ride:', rideId)

    // Fetch analysis results
    const { data: analysis, error: analysisError } = await supabase
      .from('ride_analysis')
      .select('*')
      .eq('ride_id', rideId)
      .eq('analysis_type', 'pedaling_efficiency')
      .maybeSingle()

    console.log('[Pedaling Efficiency API] Analysis result:', {
      found: !!analysis,
      status: analysis?.status,
      error: analysisError?.message
    })

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

    // Downsample if requested and necessary
    if (resolution && samples.length > resolution) {
      // Simple LTTB downsampling (can import from lib if needed)
      // For now, just take evenly spaced samples
      const stride = Math.ceil(samples.length / resolution)
      samples = samples.filter((_: any, i: number) => i % stride === 0)
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
          'ETag': `"${analysis.id}-${analysis.completed_at}-${resolution || 'full'}"`,
        },
      }
    )
  } catch (error: any) {
    console.error('Error fetching pedaling efficiency:', error)
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 })
  }
}
