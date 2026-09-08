import { NextRequest, NextResponse } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import {
  RIDE_LIST_SELECT,
  RIDE_LIST_PAGE_SIZE,
  toRideListRow,
} from '@/lib/api/ride-list-fields'

export const dynamic = 'force-dynamic'

/**
 * GET /api/rides/list?page=1&pageSize=10
 *
 * One page of the rides list, plus the total count so the client can render
 * page numbers without having fetched every row.
 *
 * Separate from GET /api/rides, which returns every ride joined with
 * ride_summaries for consumers that need the mini-metrics. This one serves the
 * list page only and selects the narrow column set it actually renders.
 */
export async function GET(request: NextRequest) {
  const authResult = await withAuth(request)
  if ('error' in authResult) return authResult.error
  const { user, supabase } = authResult.data

  const { searchParams } = new URL(request.url)
  const page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10) || 1)
  // Clamp: the page size reaches us from client-held state (localStorage), so
  // it is user-controllable and must not be trusted to bound the query.
  const pageSize = Math.min(
    100,
    Math.max(1, parseInt(searchParams.get('pageSize') ?? String(RIDE_LIST_PAGE_SIZE), 10) || RIDE_LIST_PAGE_SIZE),
  )

  const from = (page - 1) * pageSize
  const to = from + pageSize - 1

  const { data, error, count } = await supabase
    .from('rides')
    .select(RIDE_LIST_SELECT, { count: 'exact' })
    .eq('user_id', user.id)
    .order('start_time', { ascending: false })
    .range(from, to)

  if (error) {
    console.error('Failed to fetch rides page:', error)
    return NextResponse.json({ error: 'Failed to fetch rides' }, { status: 500 })
  }

  return NextResponse.json({
    rides: (data ?? []).map(toRideListRow),
    total: count ?? 0,
    page,
    pageSize,
  })
}
