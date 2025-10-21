import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { DataFilesList } from '@/components/data-files-list'

export default async function DataPage() {
  const supabase = await createClient()
  
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  
  if (authError || !user) {
    redirect('/login')
  }

  // Fetch user's IMU data time ranges (sorted by most recent data)
  const { data: files, error } = await supabase
    .from('imu_data_files')
    .select('*')
    .eq('user_id', user.id)
    .order('start_time', { ascending: false, nullsFirst: false })

  if (error) {
    console.error('Error fetching data:', error)
  }

  return (
    <div className="container mx-auto px-4 md:px-6 py-8 max-w-6xl">
      <div className="mb-8">
        <h1 className="text-3xl font-normal text-stone-900 mb-2">IMU Data</h1>
        <p className="text-stone-600">
          Time ranges where you have valid sensor data
        </p>
      </div>

      <DataFilesList files={files || []} />
    </div>
  )
}

