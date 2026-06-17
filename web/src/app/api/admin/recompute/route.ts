import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { inngest } from '@/inngest/client'
import { ALGORITHM_VERSION } from '@/lib/analysis/imu-constants'

export const dynamic = 'force-dynamic'

/**
 * GET — list all rides with their current analysis version and staleness.
 * POST — trigger recompute for specific ride IDs or all stale rides.
 *
 * Body for POST:
 *   { rideIds: string[] }           recompute specific rides
 *   { all: true }                   recompute all rides with merged VTX
 *   { stale: true }                 recompute only rides on an older version
 */

export async function GET(_request: NextRequest) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Fetch all rides that have a merged VTX path (i.e. analysable)
  const { data: rides, error: ridesError } = await supabase
    .from('rides')
    .select('id, name, start_time, merged_vtx_path')
    .eq('user_id', user.id)
    .not('merged_vtx_path', 'is', null)
    .order('start_time', { ascending: false })

  if (ridesError) {
    return NextResponse.json({ error: ridesError.message }, { status: 500 })
  }

  const rideIds = (rides ?? []).map(r => r.id)

  // Fetch the pedaling_efficiency analysis row per ride (representative of all 4)
  const { data: analyses, error: analysesError } = await supabase
    .from('ride_analysis')
    .select('ride_id, algorithm_version, status, completed_at')
    .in('ride_id', rideIds)
    .eq('analysis_type', 'pedaling_efficiency')

  if (analysesError) {
    return NextResponse.json({ error: analysesError.message }, { status: 500 })
  }

  const analysisByRide = new Map<string, any>()
  for (const a of analyses ?? []) {
    analysisByRide.set(a.ride_id, a)
  }

  const result = (rides ?? []).map(ride => {
    const analysis = analysisByRide.get(ride.id)
    const storedVersion = analysis?.algorithm_version ?? null
    return {
      id: ride.id,
      name: ride.name,
      startTime: ride.start_time,
      status: analysis?.status ?? 'not_started',
      algorithmVersion: storedVersion,
      currentVersion: ALGORITHM_VERSION,
      isStale: storedVersion !== ALGORITHM_VERSION,
      completedAt: analysis?.completed_at ?? null,
    }
  })

  return NextResponse.json({
    currentVersion: ALGORITHM_VERSION,
    rides: result,
    staleCount: result.filter(r => r.isStale).length,
    totalCount: result.length,
  })
}

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json().catch(() => ({}))
  const { rideIds, all, stale } = body as {
    rideIds?: string[]
    all?: boolean
    stale?: boolean
  }

  // Resolve which rides to recompute
  let targetIds: string[] = []

  if (rideIds?.length) {
    targetIds = rideIds
  } else if (all || stale) {
    const { data: rides, error } = await supabase
      .from('rides')
      .select('id, merged_vtx_path')
      .eq('user_id', user.id)
      .not('merged_vtx_path', 'is', null)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    if (stale) {
      const allIds = (rides ?? []).map(r => r.id)
      const { data: analyses } = await supabase
        .from('ride_analysis')
        .select('ride_id, algorithm_version')
        .in('ride_id', allIds)
        .eq('analysis_type', 'pedaling_efficiency')

      const currentIds = new Set(
        (analyses ?? [])
          .filter(a => a.algorithm_version === ALGORITHM_VERSION)
          .map(a => a.ride_id)
      )
      targetIds = allIds.filter(id => !currentIds.has(id))
    } else {
      targetIds = (rides ?? []).map(r => r.id)
    }
  } else {
    return NextResponse.json(
      { error: 'Provide rideIds, all: true, or stale: true' },
      { status: 400 }
    )
  }

  if (targetIds.length === 0) {
    return NextResponse.json({ triggered: 0, message: 'No rides to recompute' })
  }

  // Verify ownership of all target rides
  const { data: ownedRides, error: ownershipError } = await supabase
    .from('rides')
    .select('id')
    .eq('user_id', user.id)
    .in('id', targetIds)

  if (ownershipError) return NextResponse.json({ error: ownershipError.message }, { status: 500 })

  const ownedIds = (ownedRides ?? []).map(r => r.id)

  // Delete existing analyses to force fresh computation
  if (ownedIds.length > 0) {
    await supabase
      .from('ride_analysis')
      .delete()
      .eq('user_id', user.id)
      .in('ride_id', ownedIds)
  }

  // Fire Inngest events with a small stagger to avoid thundering herd
  for (let i = 0; i < ownedIds.length; i++) {
    await inngest.send({
      name: 'ride/vtx.merged',
      data: { rideId: ownedIds[i], userId: user.id },
      user: { external_id: user.id },
    })
    // Stagger by 300ms between events
    if (i < ownedIds.length - 1) {
      await new Promise(r => setTimeout(r, 300))
    }
  }

  return NextResponse.json({
    triggered: ownedIds.length,
    rideIds: ownedIds,
  })
}
