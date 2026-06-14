"use client"

import { useState } from 'react'
import { DataFilesList } from '@/components/data-files-list'
import { createClient } from '@/lib/supabase/client'

interface DataTabsProps {
  imuFiles: any[]
}

export function DataTabs({ imuFiles: initialImuFiles }: DataTabsProps) {
  const [imuFiles, setImuFiles] = useState(initialImuFiles)

  // Refresh data function
  const refreshData = async () => {
    try {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()

      if (user) {
        // Fetch VTX recordings only
        const { data: recordings } = await supabase
          .from('recordings')
          .select('id, filename, status, file_size_bytes, start_time, end_time, sample_count, sample_rate, error_message, uploaded_at')
          .eq('user_id', user.id)
          .eq('file_type', 'vtx')
          .order('uploaded_at', { ascending: false })

        if (recordings) {
          setImuFiles(recordings)
        }
      }
    } catch (error) {
      console.error('Error refreshing data:', error)
    }
  }

  return (
    <div className="w-full">
      <DataFilesList files={imuFiles || []} onDataChange={refreshData} />
    </div>
  )
}
