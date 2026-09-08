import { createClient } from '@/lib/supabase/server'
import { RidesListClient } from '@/components/rides-list-client'
import {
  RIDE_LIST_SELECT,
  RIDE_LIST_PAGE_SIZE,
  toRideListRow,
} from '@/lib/api/ride-list-fields'


export default async function RidesPage() {
  const supabase = await createClient()

  // Get current user
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return <div>Please log in to view rides</div>
  }

  // Only the first page. The list used to fetch every ride with select('*'),
  // which at ~2.5 KB/row (route_path alone is ~1.5 KB) meant a multi-megabyte
  // RSC payload once a user accumulated a few hundred rides. Later pages come
  // from /api/rides/list; `count: 'exact'` gives the client the page count
  // without it having to hold every row.
  const { data: rides, error: ridesError, count } = await supabase
    .from('rides')
    .select(RIDE_LIST_SELECT, { count: 'exact' })
    .eq('user_id', user.id)
    .order('start_time', { ascending: false })
    .range(0, RIDE_LIST_PAGE_SIZE - 1)

  if (ridesError) {
    console.error('Failed to fetch rides:', ridesError)
    return <div>Failed to load rides</div>
  }

  return (
    <div className="container mx-auto px-4 md:px-6 max-w-6xl">
      <RidesListClient
        rides={(rides || []).map(toRideListRow)}
        totalCount={count ?? 0}
      />
    </div>
  )
}
