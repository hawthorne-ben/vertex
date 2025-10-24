"use client"

import { useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { DataFilesList } from '@/components/data-files-list'
import { FitFilesList } from '@/components/fit-files-list'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { createClient } from '@/lib/supabase/client'

interface DataTabsProps {
  imuFiles: any[]
  fitFiles: any[]
}

export function DataTabs({ imuFiles: initialImuFiles, fitFiles: initialFitFiles }: DataTabsProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [imuFiles, setImuFiles] = useState(initialImuFiles)
  const [fitFiles, setFitFiles] = useState(initialFitFiles)
  
  // Get the active tab from search params, default to 'imu'
  const activeTab = searchParams.get('tab') === 'fit' ? 'fit' : 'imu'

  // Refresh data function
  const refreshData = async () => {
    try {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      
      if (user) {
        // Fetch updated IMU files
        const { data: updatedImuFiles } = await supabase
          .from('imu_data_files')
          .select('*')
          .eq('user_id', user.id)
          .order('uploaded_at', { ascending: false })

        // Fetch updated FIT files
        const { data: updatedFitFiles } = await supabase
          .from('fit_files')
          .select('*')
          .eq('user_id', user.id)
          .order('uploaded_at', { ascending: false })

        if (updatedImuFiles) setImuFiles(updatedImuFiles)
        if (updatedFitFiles) setFitFiles(updatedFitFiles)
      }
    } catch (error) {
      console.error('Error refreshing data:', error)
    }
  }

  const handleTabChange = (value: string) => {
    // Update URL with the new tab
    const params = new URLSearchParams(searchParams.toString())
    if (value === 'imu') {
      params.delete('tab') // Remove tab param for default IMU view
    } else {
      params.set('tab', value)
    }
    
    const newUrl = params.toString() ? `?${params.toString()}` : ''
    router.push(`/data${newUrl}`)
  }

  return (
    <Tabs value={activeTab} onValueChange={handleTabChange} className="w-full">
      <TabsList className="grid w-full grid-cols-2">
        <TabsTrigger value="imu">
          IMU Data ({imuFiles?.length || 0})
        </TabsTrigger>
        <TabsTrigger value="fit">
          FIT Files ({fitFiles?.length || 0})
        </TabsTrigger>
      </TabsList>
      
      <TabsContent value="imu" className="mt-6">
        <DataFilesList files={imuFiles || []} onDataChange={refreshData} />
      </TabsContent>
      
      <TabsContent value="fit" className="mt-6">
        <FitFilesList files={fitFiles || []} onDataChange={refreshData} />
      </TabsContent>
    </Tabs>
  )
}
