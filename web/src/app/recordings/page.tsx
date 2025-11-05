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
    .select('*')
    .eq('user_id', user.id)
    .eq('file_type', 'vtx')
    .order('start_time', { ascending: false })

  if (recordingsError) {
    console.error('Error fetching recordings:', recordingsError)
  }

  return (
    <div className="container mx-auto px-4 md:px-6 py-8 max-w-6xl">
      <div className="mb-8">
        <h1 className="text-3xl font-normal text-primary mb-2">Recordings</h1>
        <p className="text-secondary">
          View and analyze your Vertex IMU sensor recordings
        </p>
      </div>

      <DataTabs imuFiles={recordings || []} />
    </div>
  )
}

