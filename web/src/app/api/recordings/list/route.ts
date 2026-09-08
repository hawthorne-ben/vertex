import { NextRequest, NextResponse } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import {
  RECORDING_LIST_SELECT,
  RECORDING_LIST_PAGE_SIZE,
} from '@/lib/api/recording-list-fields'

export const dynamic = 'force-dynamic'

/**
 * GET /api/recordings/list?page=1&pageSize=10
 *
 * One page of the recordings list, plus the total count so the client can
 * render page numbers without holding every row.
 *
 * VTX only — FIT files are surfaced as rides on /rides, matching the server
 * component that renders the first page.
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
    Math.max(
      1,
      parseInt(searchParams.get('pageSize') ?? String(RECORDING_LIST_PAGE_SIZE), 10) ||
        RECORDING_LIST_PAGE_SIZE,
    ),
  )

  const from = (page - 1) * pageSize
  const to = from + pageSize - 1

  const { data, error, count } = await supabase
    .from('recordings')
    .select(RECORDING_LIST_SELECT, { count: 'exact' })
    .eq('user_id', user.id)
    .eq('file_type', 'vtx')
    .order('start_time', { ascending: false })
    .range(from, to)

  if (error) {
    console.error('Failed to fetch recordings page:', error)
    return NextResponse.json({ error: 'Failed to fetch recordings' }, { status: 500 })
  }

  return NextResponse.json({
    recordings: data ?? [],
    total: count ?? 0,
    page,
    pageSize,
  })
}
