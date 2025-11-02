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

  // Fetch user's recordings (VTX and FIT files from new recordings table)
  const { data: recordings, error: recordingsError } = await supabase
    .from('recordings')
    .select('*')
    .eq('user_id', user.id)
    .order('start_time', { ascending: false })

  if (recordingsError) {
    console.error('Error fetching recordings:', recordingsError)
  }

  // Separate by file type for backward compatibility with DataTabs component
  const vtxFiles = (recordings || []).filter(r => r.file_type === 'vtx')
  const fitFiles = (recordings || []).filter(r => r.file_type === 'fit')

  return (
    <div className="container mx-auto px-4 md:px-6 py-8 max-w-6xl">
      <div className="mb-8">
        <h1 className="text-3xl font-normal text-primary mb-2">Recordings</h1>
        <p className="text-secondary">
          View and analyze your VTX sensor recordings and FIT cycling computer files
        </p>
      </div>

      <DataTabs imuFiles={vtxFiles} fitFiles={fitFiles} />
    </div>
  )
}

