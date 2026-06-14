import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { DataTabs } from '@/components/data-tabs'

export default async function RecordingsPage() {
  const supabase = await createClient()

  const { data: { user }, error: authError } = await supabase.auth.getUser()

  if (authError || !user) {
    redirect('/login')
  }

  // Fetch user's VTX recordings only (FIT files are rides and shown on /rides)
  const { data: recordings, error: recordingsError } = await supabase
    .from('recordings')
    .select('id, filename, status, file_size_bytes, start_time, end_time, sample_count, sample_rate, error_message, uploaded_at')
    .eq('user_id', user.id)
    .eq('file_type', 'vtx')
    .order('start_time', { ascending: false })

  if (recordingsError) {
    console.error('Error fetching recordings:', recordingsError)
  }

  return (
    <div className="container mx-auto px-4 md:px-6 max-w-6xl">
      <DataTabs imuFiles={recordings || []} />
    </div>
  )
}

