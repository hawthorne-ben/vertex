import { NextRequest, NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { withAuth } from './auth'
import { downloadSamples } from '@/lib/analysis/samples-storage'

export type RideAnalysisType =
  | 'pedaling_efficiency'
  | 'riding_position'
  | 'surface_roughness'
  | 'braking'

interface AnalysisRowLight {
  id: string
  status: 'pending' | 'processing' | 'completed' | 'failed'
  started_at: string | null
  completed_at: string | null
  error_message: string | null
  algorithm_version: string | null
  parameters: any
  metadata: any
  samples_path: string | null
}

interface FullContext {
  rideId: string
  user: { id: string }
  supabase: SupabaseClient
}

interface RouteSetupSuccess {
  context: FullContext
  /**
   * Lightweight analysis row (samples NOT included). Null when no analysis row
   * exists yet. Use loadSamples(context) to fetch the heavy samples column once
   * status is confirmed completed.
   */
  analysis: AnalysisRowLight | null
}

interface RouteSetupError {
  earlyResponse: NextResponse
}

export type RouteSetupResult = RouteSetupSuccess | RouteSetupError

/**
 * Authenticates, verifies ride ownership, and fetches the analysis row WITHOUT
 * the heavy `samples` JSONB column. Lets routes return early for not-started /
 * processing / failed states without paying the disk-IO cost of pulling the
 * potentially-multi-MB samples blob on every poll.
 */
export async function setupAnalysisRoute(
  request: NextRequest,
  rideId: string,
  analysisType: RideAnalysisType
): Promise<RouteSetupResult> {
  const authResult = await withAuth(request)
  if ('error' in authResult) {
    return { earlyResponse: authResult.error }
  }

  const { user, supabase } = authResult.data

  const { data: ride, error: rideError } = await supabase
    .from('rides')
    .select('id, user_id')
    .eq('id', rideId)
    .eq('user_id', user.id)
    .single()

  if (rideError || !ride) {
    return {
      earlyResponse: NextResponse.json(
        { error: 'Ride not found' },
        { status: 404 }
      ),
    }
  }

  const { data: analysis } = await supabase
    .from('ride_analysis')
    .select(
      'id, status, started_at, completed_at, error_message, algorithm_version, parameters, metadata, samples_path'
    )
    .eq('ride_id', rideId)
    .eq('analysis_type', analysisType)
    .maybeSingle<AnalysisRowLight>()

  return {
    context: { rideId, user: { id: user.id }, supabase },
    analysis: analysis ?? null,
  }
}

/**
 * Build the standard early response for non-completed analysis states.
 * Returns null if the analysis is completed and the route should continue
 * to fetch samples.
 */
export function buildPendingResponse(
  analysis: AnalysisRowLight | null,
  failureMessage: string
): NextResponse | null {
  if (!analysis) {
    return NextResponse.json(
      {
        status: 'not_started',
        message:
          'Analysis not yet started. Ensure ride has both FIT and VTX recordings associated.',
        samples: [],
        metadata: null,
      },
      { status: 202 }
    )
  }

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

  if (analysis.status === 'failed') {
    return NextResponse.json(
      {
        status: 'failed',
        error: analysis.error_message || 'Analysis failed',
        message: failureMessage,
        samples: [],
        metadata: null,
      },
      { status: 500 }
    )
  }

  return null
}

/**
 * Load samples for a confirmed-completed analysis from Supabase Storage.
 * Called only after buildPendingResponse returns null (status === 'completed'
 * and samples_path is non-null), so the bulky download never runs on polls.
 */
export async function loadSamples(
  supabase: SupabaseClient,
  samplesPath: string | null
): Promise<any[]> {
  if (!samplesPath) {
    // Completed status but no path means a producer wrote completion without
    // populating samples_path — surface as an empty result rather than 500.
    return []
  }
  return downloadSamples(supabase, samplesPath)
}
