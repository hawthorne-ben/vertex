import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { DataTabs } from '@/components/data-tabs'

interface DataPageProps {
  searchParams: Promise<{ tab?: string }>
}

export default async function DataPage({ searchParams }: DataPageProps) {
  const resolvedSearchParams = await searchParams
  const supabase = await createClient()
  
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  
  if (authError || !user) {
    redirect('/login')
  }

  // Fetch user's IMU data time ranges (sorted by most recent data)
  const { data: imuFiles, error: imuError } = await supabase
    .from('imu_data_files')
    .select('*')
    .eq('user_id', user.id)
    .order('uploaded_at', { ascending: false })

  // Fetch user's FIT files (sorted by most recent upload)
  const { data: fitFiles, error: fitError } = await supabase
    .from('fit_files')
    .select('*')
    .eq('user_id', user.id)
    .order('uploaded_at', { ascending: false })

  if (imuError) {
    console.error('Error fetching IMU data:', imuError)
  }

  if (fitError) {
    console.error('Error fetching FIT data:', fitError)
  }

  return (
    <div className="container mx-auto px-4 md:px-6 py-8 max-w-6xl">
      <div className="mb-8">
        <h1 className="text-3xl font-normal text-primary mb-2">Data Files</h1>
        <p className="text-secondary">
          View and manage your uploaded sensor data and cycling computer files
        </p>
      </div>

      <DataTabs imuFiles={imuFiles || []} fitFiles={fitFiles || []} />
    </div>
  )
}

