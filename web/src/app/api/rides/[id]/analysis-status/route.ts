import { NextRequest, NextResponse } from 'next/server'
import { withAuth } from '@/lib/api/auth'

export const dynamic = 'force-dynamic'

type AnalysisType =
  | 'pedaling_efficiency'
  | 'riding_position'
  | 'surface_roughness'
  | 'braking'

const ALL_TYPES: AnalysisType[] = [
  'pedaling_efficiency',
  'riding_position',
  'surface_roughness',
  'braking',
]

interface StatusEntry {
  status: 'not_started' | 'pending' | 'processing' | 'completed' | 'failed'
  startedAt: string | null
  completedAt: string | null
  errorMessage: string | null
  algorithmVersion: string | null
}

/**
 * Lightweight cross-metric status endpoint. Returns the status of all four
 * IMU-derived analyses in a single query so the client can poll *one* tiny
 * endpoint while jobs are processing instead of polling each metric route
 * (which read large samples blobs and run per-metric ride-ownership checks).
 *
 * Response: { statuses: { [analysis_type]: StatusEntry }, allCompleted: boolean }
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: rideId } = await params

    const authResult = await withAuth(request)
    if ('error' in authResult) return authResult.error

    const { user, supabase } = authResult.data

    const { data: ride, error: rideError } = await supabase
      .from('rides')
      .select('id, user_id')
      .eq('id', rideId)
      .eq('user_id', user.id)
      .single()

    if (rideError || !ride) {
      return NextResponse.json({ error: 'Ride not found' }, { status: 404 })
    }

    const { data: rows, error: analysesError } = await supabase
      .from('ride_analysis')
      .select(
        'analysis_type, status, started_at, completed_at, error_message, algorithm_version'
      )
      .eq('ride_id', rideId)
      .in('analysis_type', ALL_TYPES)

    if (analysesError) {
      return NextResponse.json(
        { error: `Failed to fetch analysis statuses: ${analysesError.message}` },
        { status: 500 }
      )
    }

    const byType = new Map<AnalysisType, any>()
    for (const row of rows ?? []) {
      byType.set(row.analysis_type as AnalysisType, row)
    }

    const statuses: Record<AnalysisType, StatusEntry> = {} as any
    let allCompleted = true

    for (const t of ALL_TYPES) {
      const row = byType.get(t)
      if (!row) {
        statuses[t] = {
          status: 'not_started',
          startedAt: null,
          completedAt: null,
          errorMessage: null,
          algorithmVersion: null,
        }
        allCompleted = false
        continue
      }

      statuses[t] = {
        status: row.status,
        startedAt: row.started_at,
        completedAt: row.completed_at,
        errorMessage: row.error_message,
        algorithmVersion: row.algorithm_version,
      }

      if (row.status !== 'completed') allCompleted = false
    }

    return NextResponse.json(
      { statuses, allCompleted },
      {
        headers: {
          'Cache-Control': 'public, no-cache',
        },
      }
    )
  } catch (error: any) {
    console.error('Error fetching analysis status:', error)
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    )
  }
}
