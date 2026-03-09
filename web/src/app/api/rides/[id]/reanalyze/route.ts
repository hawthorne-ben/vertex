import { NextRequest, NextResponse } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { inngest } from '@/inngest/client'

export const dynamic = 'force-dynamic'

/**
 * Trigger reanalysis of ride analytics
 *
 * This endpoint allows users to manually trigger recomputation of analytics
 * when analysis fails or when they want to recompute with updated algorithms.
 *
 * It triggers the Inngest job by sending the 'ride/vtx.merged' event.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: rideId } = await params

    // Authenticate user
    const authResult = await withAuth(request)
    if ('error' in authResult) return authResult.error

    const { user, supabase } = authResult.data

    // Verify ride ownership
    const { data: ride, error: rideError } = await supabase
      .from('rides')
      .select('id, user_id, merged_vtx_path')
      .eq('id', rideId)
      .eq('user_id', user.id)
      .single()

    if (rideError || !ride) {
      return NextResponse.json({ error: 'Ride not found' }, { status: 404 })
    }

    // Check if ride has merged VTX data
    if (!ride.merged_vtx_path) {
      return NextResponse.json(
        { error: 'Ride does not have merged VTX data. Analysis cannot be performed.' },
        { status: 400 }
      )
    }

    // Delete all existing analyses to force fresh computation
    const { error: deleteError } = await supabase
      .from('ride_analysis')
      .delete()
      .eq('ride_id', rideId)

    if (deleteError) {
      console.error('[ReanalyzeAPI] Failed to delete old analyses:', deleteError)
      // Continue anyway - upsert will handle it
    }

    // Trigger the analysis job via Inngest SDK
    await inngest.send({
      name: 'ride/vtx.merged',
      data: {
        rideId: rideId,
        userId: user.id,
      },
      user: {
        external_id: user.id,
      },
    })

    return NextResponse.json({
      success: true,
      message: 'Analysis job triggered successfully',
      rideId,
    })
  } catch (error: any) {
    console.error('Error triggering reanalysis:', error)
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    )
  }
}
