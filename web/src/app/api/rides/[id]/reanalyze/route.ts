import { NextRequest, NextResponse } from 'next/server'
import { withAuth } from '@/lib/api/auth'

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

    // Delete existing failed analyses to allow fresh computation
    const { error: deleteError } = await supabase
      .from('ride_analysis')
      .delete()
      .eq('ride_id', rideId)
      .in('status', ['failed', 'processing']) // Remove failed or stuck analyses

    if (deleteError) {
      console.error('[ReanalyzeAPI] Failed to delete old analyses:', deleteError)
      // Continue anyway - upsert will handle it
    }

    // Trigger the analysis job by sending Inngest event
    // We use the same event that's triggered after VTX merge
    const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'
    const inngestEndpoint = `${baseUrl}/api/inngest`
    const inngestEventKey = process.env.INNGEST_EVENT_KEY

    const eventPayload = {
      name: 'ride/vtx.merged',
      data: {
        rideId: rideId,
        userId: user.id,
      },
      user: {
        external_id: user.id,
      },
    }

    // Send event to Inngest
    const inngestResponse = await fetch(inngestEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(inngestEventKey ? { 'Authorization': `Bearer ${inngestEventKey}` } : {}),
      },
      body: JSON.stringify(eventPayload),
    })

    if (!inngestResponse.ok) {
      const errorText = await inngestResponse.text()
      console.error('[ReanalyzeAPI] Inngest event failed:', errorText)
      return NextResponse.json(
        { error: 'Failed to trigger analysis job', details: errorText },
        { status: 500 }
      )
    }

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
