import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

/**
 * POST /api/rides/batch-delete
 *
 * Delete multiple rides at once
 * Limit: 100 rides per request
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { rideIds } = body

    // Validate input
    if (!Array.isArray(rideIds) || rideIds.length === 0) {
      return NextResponse.json(
        { error: 'rideIds must be a non-empty array' },
        { status: 400 }
      )
    }

    if (rideIds.length > 100) {
      return NextResponse.json(
        { error: 'Maximum 100 rides can be deleted at once' },
        { status: 400 }
      )
    }

    // Create Supabase client (respects RLS)
    const supabase = await createClient()

    // Get user session
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    // Fetch rides to delete (RLS ensures user owns them)
    const { data: rides, error: fetchError } = await supabase
      .from('rides')
      .select('id, name')
      .in('id', rideIds)

    if (fetchError) {
      console.error('Failed to fetch rides:', fetchError)
      return NextResponse.json(
        { error: 'Failed to fetch rides' },
        { status: 500 }
      )
    }

    if (!rides || rides.length === 0) {
      return NextResponse.json(
        { error: 'No rides found or access denied' },
        { status: 404 }
      )
    }

    // Delete from database (cascade will handle ride_recordings and ride_analysis)
    const { error: deleteError } = await supabase
      .from('rides')
      .delete()
      .in('id', rides.map(r => r.id))

    if (deleteError) {
      console.error('Failed to delete rides:', deleteError)
      return NextResponse.json(
        { error: 'Failed to delete rides from database' },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      deleted: rides.length,
      message: `Successfully deleted ${rides.length} ride${rides.length > 1 ? 's' : ''}`
    })

  } catch (error) {
    console.error('Batch delete error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
