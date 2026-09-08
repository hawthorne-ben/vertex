import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { DataTabs } from '@/components/data-tabs'
import {
  RECORDING_LIST_SELECT,
  RECORDING_LIST_PAGE_SIZE,
} from '@/lib/api/recording-list-fields'

export default async function RecordingsPage() {
  const supabase = await createClient()

  const { data: { user }, error: authError } = await supabase.auth.getUser()

  if (authError || !user) {
    redirect('/login')
  }

  // First page only — later pages come from /api/recordings/list. VTX only;
  // FIT files are surfaced as rides on /rides. `count: 'exact'` gives the
  // client the page count without it having to hold every row.
  const { data: recordings, error: recordingsError, count } = await supabase
    .from('recordings')
    .select(RECORDING_LIST_SELECT, { count: 'exact' })
    .eq('user_id', user.id)
    .eq('file_type', 'vtx')
    .order('start_time', { ascending: false })
    .range(0, RECORDING_LIST_PAGE_SIZE - 1)

  if (recordingsError) {
    console.error('Error fetching recordings:', recordingsError)
  }

  return (
    <div className="container mx-auto px-4 md:px-6 max-w-6xl">
      <DataTabs imuFiles={recordings || []} totalCount={count ?? 0} />
    </div>
  )
}

